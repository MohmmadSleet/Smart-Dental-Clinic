"use strict";
// AI-based dental guidance + DB-verified suggestions. All booking authority stays in appointments/service.
const booking = require("../../appointments/service");
const ai = require("./ai-engine");
const ID = /^[1-9]\d{0,17}$/;
const normalizeInput = (x) => (typeof x === "string" ? x.trim() : "");
function coordinates(body) {
  const rawLat = normalizeInput(body.latitude),
    rawLng = normalizeInput(body.longitude);
  if (!rawLat && !rawLng) return null;
  if (
    !/^-?\d{1,3}(?:\.\d{1,7})?$/.test(rawLat) ||
    !/^-?\d{1,3}(?:\.\d{1,7})?$/.test(rawLng)
  )
    return null;
  const lat = Number(rawLat),
    lng = Number(rawLng);
  return Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
    ? { lat, lng }
    : null;
}
function km(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad,
    dLon = (b.lng - a.lng) * rad;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return Math.round(6371 * 2 * Math.asin(Math.min(1, Math.sqrt(s))) * 10) / 10;
}
async function context(db, choices) {
  const doctorIds = [...new Set(choices.map((x) => x.doctor_id))];
  const clinicIds = [...new Set(choices.map((x) => x.clinic_id))];
  const [specialties, doctorSpecs, clinics] = await Promise.all([
    db.query(
      `SELECT "Specialty_ID"::text id,"Name_AR" ar,"Name_EN" en FROM sdc."SPECIALTY" WHERE "Is_Active"=true ORDER BY "Specialty_ID" LIMIT 100`,
    ),
    doctorIds.length
      ? db.query(
          `SELECT h."Doctor_ID"::text doctor_id,h."Specialty_ID"::text specialty_id FROM sdc."HAS_SPECIALTY" h JOIN sdc."SPECIALTY" s USING("Specialty_ID") WHERE h."Doctor_ID"=ANY($1::bigint[]) AND s."Is_Active"=true`,
          [doctorIds],
        )
      : Promise.resolve({ rows: [] }),
    clinicIds.length
      ? db.query(
          `SELECT "Clinic_ID"::text id,"Latitude"::text lat,"Longitude"::text lng,"City" city FROM sdc."CLINIC" WHERE "Clinic_ID"=ANY($1::bigint[])`,
          [clinicIds],
        )
      : Promise.resolve({ rows: [] }),
  ]);
  const byDoctor = new Map();
  for (const row of doctorSpecs.rows) {
    if (!byDoctor.has(row.doctor_id)) byDoctor.set(row.doctor_id, new Set());
    byDoctor.get(row.doctor_id).add(row.specialty_id);
  }
  return {
    specialties: specialties.rows.map((s) => ({
      id: s.id,
      name: `${s.ar}${s.en ? " / " + s.en : ""}`,
    })),
    byDoctor,
    clinics: new Map(clinics.rows.map((c) => [c.id, c])),
  };
}
function matchingChoices(catalog, verdict, meta, origin) {
  let serviceIds = new Set(verdict.service_ids);
  // If no specific service can be matched, only an examination/consultation is a safe default.
  if (!serviceIds.size && verdict.scope === "dental")
    serviceIds = new Set(
      catalog
        .filter((c) =>
          /(فحص|كشف|استشارة|examination|consult|exam)/i.test(c.service_name),
        )
        .map((c) => c.service_id),
    );
  if (!serviceIds.size) return [];
  const wanted = new Set(verdict.specialty_ids);
  return catalog
    .filter(
      (c) =>
        serviceIds.has(c.service_id) &&
        (!wanted.size ||
          [...(meta.byDoctor.get(c.doctor_id) || [])].some((x) =>
            wanted.has(x),
          )),
    )
    .map((c) => {
      const loc = meta.clinics.get(c.clinic_id);
      const lat = Number(loc?.lat),
        lng = Number(loc?.lng);
      return {
        ...c,
        city: loc?.city || "",
        distance:
          origin &&
          loc &&
          loc.lat != null &&
          loc.lng != null &&
          Number.isFinite(lat) &&
          Number.isFinite(lng)
            ? km(origin, { lat, lng })
            : null,
      };
    })
    .sort((a, b) => {
      if (origin)
        return (
          (a.distance ?? Infinity) - (b.distance ?? Infinity) ||
          a.clinic_id.localeCompare(b.clinic_id)
        );
      return (
        a.clinic_id.localeCompare(b.clinic_id) ||
        a.doctor_id.localeCompare(b.doctor_id)
      );
    });
}
// Clinic-local civil minutes. The real slot service remains the sole authority for availability.
// Windows are conservative triage *targets* and must be reviewed by a local dentist.
const tzOffsetFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Hebron",
  timeZoneName: "longOffset",
});
function localMinutes(date, time) {
  // Resolve local civil time to an instant, including seasonal daylight-saving changes.
  const civil = Date.parse(`${date}T${time}:00Z`);
  if (!Number.isFinite(civil)) return NaN;
  let instant = civil;
  for (let i = 0; i < 3; i++) {
    const zone =
      tzOffsetFormatter
        .formatToParts(new Date(instant))
        .find((p) => p.type === "timeZoneName")?.value || "GMT";
    const parts = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(zone);
    const offset = parts
      ? (parts[1] === "-" ? -1 : 1) *
        (Number(parts[2]) * 60 + Number(parts[3] || 0))
      : 0;
    instant = civil - offset * 60000;
  }
  return instant / 60000;
}
function riskWindow(risk) {
  return risk === "high"
    ? 24 * 60
    : risk === "medium"
      ? 7 * 1440
      : risk === "low"
        ? 30 * 1440
        : 0;
}
function isWithinRiskWindow(risk, now, date, time) {
  const minutes = localMinutes(date, time) - localMinutes(now.date, now.time);
  return minutes > 0 && minutes <= riskWindow(risk);
}
async function suggest(db, patientId, catalog, verdict, meta, origin) {
  if (verdict.scope !== "dental" || verdict.risk === "emergency") return [];
  const choices = matchingChoices(catalog, verdict, meta, origin);
  const now = booking.localNow(),
    days = Math.ceil(riskWindow(verdict.risk) / 1440) + 1;
  const midnight = Date.parse(now.date + "T12:00:00Z");
  const found = [];
  let checks = 0;
  // Search broadly before ranking; do not let a geographically close clinic's
  // unavailable calendar hide an earlier slot elsewhere. Every slot is checked
  // via the existing booking service (working hours, absences, busy/patient conflicts).
  for (const choice of choices.slice(0, 24)) {
    for (let day = 0; day < days && checks < 240; day++) {
      const date = new Date(midnight + day * 86400000)
        .toISOString()
        .slice(0, 10);
      checks++;
      const availability = await booking.availability(
        db,
        choice,
        date,
        patientId,
      );
      const time = availability.slots.find((t) =>
        isWithinRiskWindow(verdict.risk, now, date, t),
      );
      if (time) {
        found.push({ ...choice, date, time });
        break;
      }
    }
    if (checks >= 240) break;
  }
  const earliest = found.length
    ? Math.min(...found.map((x) => localMinutes(x.date, x.time)))
    : 0;
  found.sort((a, b) => {
    const t = (a.date + "T" + a.time).localeCompare(b.date + "T" + b.time);
    const distance = (a.distance ?? Infinity) - (b.distance ?? Infinity);
    if (verdict.risk === "high") return t || distance;
    if (verdict.risk === "medium") {
      // Stable urgency bands: prioritize a roughly 24-hour window, then proximity.
      // A per-pair comparator would be non-transitive and produce arbitrary order.
      const aBand = Math.floor(
        (localMinutes(a.date, a.time) - earliest) / 1440,
      );
      const bBand = Math.floor(
        (localMinutes(b.date, b.time) - earliest) / 1440,
      );
      return aBand - bBand || distance || t;
    }
    return distance || t;
  });
  const recommended = [],
    usedClinics = new Set();
  for (const c of found) {
    if (!usedClinics.has(c.clinic_id)) {
      recommended.push(c);
      usedClinics.add(c.clinic_id);
    }
    if (recommended.length === 3) break;
  }
  for (const c of found) {
    if (recommended.length >= 3) break;
    if (!recommended.includes(c)) recommended.push(c);
  }
  return recommended.map((c) => ({
    ...c,
    reason: `${verdict.locale === "en" ? (verdict.risk === "high" ? "Urgent: verified slot within 24 hours" : verdict.risk === "medium" ? "Verified slot within 7 days" : "Verified routine appointment") : verdict.risk === "high" ? "عاجل: موعد متحقق منه خلال 24 ساعة" : verdict.risk === "medium" ? "موعد متحقق منه خلال 7 أيام" : "موعد روتيني متحقق منه"}${c.distance != null ? (verdict.locale === "en" ? `; approximate straight-line distance ${c.distance} km` : `؛ المسافة الجوية التقريبية ${c.distance} كم`) : ""}${verdict.locale === "en" ? ". Pending clinic confirmation; not a diagnosis." : ". الحجز يحتاج تأكيد العيادة؛ هذا ليس تشخيصًا."}`,
  }));
}

async function create(pool, userId, body, locale = "ar") {
  const symptoms = normalizeInput(body.symptoms),
    answer = normalizeInput(body.followup_answer),
    question = normalizeInput(body.followup_question);
  if (
    body.ai_consent !== "1" ||
    symptoms.length < 10 ||
    symptoms.length > 1500 ||
    answer.length > 500 ||
    question.length > 220 ||
    (!question && answer)
  )
    return { status: "invalid" };
  const patient = await booking.patientId(pool, userId);
  if (!patient) return { status: "forbidden" };
  const catalog = await booking.catalog(pool, null);
  const meta = await context(pool, catalog);
  const origin = coordinates(body);
  const services = ai.listFromCatalog(catalog);
  const contextForModel = {
    services,
    specialties: meta.specialties,
    question,
    answer,
    allowQuestion: !question,
    locale: locale === "en" ? "en" : "ar",
  };
  const verdict = await ai.evaluate(symptoms, contextForModel);
  // A follow-up is optional; we keep this pre-save state in the existing form, not a new table.
  if (verdict.question && !answer && verdict.risk !== "emergency")
    return {
      status: "followup",
      symptoms,
      question: verdict.question,
      origin,
      mode: verdict.mode,
    };
  const recs = await suggest(
    pool,
    patient,
    catalog,
    { ...verdict, locale: locale === "en" ? "en" : "ar" },
    meta,
    origin,
  );
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("SELECT set_config('sdc.user_id',$1,true)", [userId]);
    const r = await db.query(
      `INSERT INTO sdc."AI_ASSESSMENT"("Created_At","Assessment_Status","Symptoms_Summary","Preliminary_Result","Risk_Level","Advice_Text","Patient_ID")
   VALUES(LOCALTIMESTAMP,'completed',$1,$2,$3,$4,$5::bigint) RETURNING "Assessment_ID"::text id`,
      [symptoms, verdict.summary, verdict.risk, verdict.advice, patient],
    );
    const id = r.rows[0].id;
    // Consent is recorded using the EXISTING audit table, not an extra database table.
    await db.query(
      `INSERT INTO sdc."AUDIT_LOG"("Occurred_At","Action_Type","Target_Type","Target_Reference","Description","User_ID") VALUES(LOCALTIMESTAMP,'ai.assessment.consent','AI_Assessment',$1::varchar(512),$2,$3::bigint)`,
      [
        id,
        verdict.mode === "mock"
          ? "تقييم تجريبي بموافقة المريض"
          : verdict.mode === "safety-rule"
            ? "توجيه سلامة أولي بقواعد الطوارئ بعد موافقة المريض"
            : "موافقة المريض على معالجة وصف الأعراض لتقييم الأسنان بواسطة API",
        userId,
      ],
    );
    const messages = [[1, "patient", symptoms]];
    if (question && answer)
      messages.push(
        [2, "assistant", question],
        [3, "patient", answer],
        [4, "assistant", verdict.advice],
      );
    else messages.push([2, "assistant", verdict.advice]);
    for (const [order, sender, message] of messages)
      await db.query(
        `INSERT INTO sdc."AI_ASSESSMENT_MESSAGES"("Message_Order","Sender_Type","Message_Text","Sent_At","Assessment_ID") VALUES($1,$2,$3,LOCALTIMESTAMP,$4::bigint)`,
        [order, sender, message, id],
      );
    for (let i = 0; i < recs.length; i++) {
      const rec = recs[i];
      await db.query(
        `INSERT INTO sdc."AI_RECOMMENDATION"("Recommendation_Order","Created_At","Suggested_Date","Suggested_Start_Time","Price_Snapshot","Duration_Minutes_Snapshot","Recommendation_Reason","Assessment_ID","Doctor_ID","Clinic_ID","Service_ID")
    VALUES($1,LOCALTIMESTAMP,$2::date,$3::time,$4::numeric,$5::integer,$6,$7::bigint,$8::bigint,$9::bigint,$10::bigint)`,
        [
          i + 1,
          rec.date,
          rec.time,
          rec.price,
          rec.duration,
          rec.reason,
          id,
          rec.doctor_id,
          rec.clinic_id,
          rec.service_id,
        ],
      );
    }
    await db.query("COMMIT");
    return { status: "ok", id };
  } catch (e) {
    await db.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    db.release();
  }
}
async function detail(pool, userId, assessmentId) {
  if (!ID.test(String(assessmentId || ""))) return null;
  const r = await pool.query(
    `SELECT a."Assessment_ID"::text id,a."Symptoms_Summary" symptoms,a."Preliminary_Result" result,a."Risk_Level" risk,a."Advice_Text" advice,to_char(a."Created_At",'DD/MM/YYYY HH24:MI') date
 FROM sdc."AI_ASSESSMENT" a JOIN sdc."PATIENT" p ON p."Patient_ID"=a."Patient_ID" WHERE a."Assessment_ID"=$1::bigint AND p."User_ID"=$2::bigint`,
    [assessmentId, userId],
  );
  if (!r.rowCount) return null;
  const rec = await pool.query(
    `SELECT r."Recommendation_ID"::text id,r."Suggested_Date"::text date,to_char(r."Suggested_Start_Time",'HH24:MI') time,r."Price_Snapshot"::text price,r."Duration_Minutes_Snapshot" duration,r."Recommendation_Reason" reason,r."Clinic_ID"::text clinic_id,r."Doctor_ID"::text doctor_id,r."Service_ID"::text service_id,
 c."Clinic_Name" clinic,s."Service_Name" service,u."First_Name"||' '||u."Last_Name" doctor,
 COALESCE((SELECT string_agg(DISTINCT sp."Name_AR",'، ') FROM sdc."HAS_SPECIALTY" hs JOIN sdc."SPECIALTY" sp ON sp."Specialty_ID"=hs."Specialty_ID" WHERE hs."Doctor_ID"=r."Doctor_ID" AND sp."Is_Active"=true),'') specialties,
 (SELECT "Booking_ID"::text FROM sdc."BOOKING" WHERE "Recommendation_ID"=r."Recommendation_ID") booking_id
 FROM sdc."AI_RECOMMENDATION" r JOIN sdc."CLINIC" c ON c."Clinic_ID"=r."Clinic_ID" JOIN sdc."SERVICE" s ON s."Service_ID"=r."Service_ID"
 JOIN sdc."DOCTOR" d ON d."Doctor_ID"=r."Doctor_ID" JOIN sdc."USER" u ON u."User_ID"=d."User_ID"
 WHERE r."Assessment_ID"=$1::bigint ORDER BY r."Recommendation_Order" LIMIT 10`,
    [assessmentId],
  );
  const [history, stale] = await Promise.all([
    pool.query(
      `SELECT "Message_Order" seq,"Sender_Type" sender,"Message_Text" text FROM sdc."AI_ASSESSMENT_MESSAGES" WHERE "Assessment_ID"=$1::bigint ORDER BY "Message_Order" DESC LIMIT 200`,
      [assessmentId],
    ),
    pool.query(
      `SELECT EXISTS(SELECT 1 FROM sdc."AUDIT_LOG" stale WHERE stale."User_ID"=$2::bigint AND stale."Action_Type"='ai.assessment.reassessment_needed' AND stale."Target_Type"='AI_Assessment' AND stale."Target_Reference"=$1 AND NOT EXISTS(SELECT 1 FROM sdc."AUDIT_LOG" fixed WHERE fixed."User_ID"=stale."User_ID" AND fixed."Target_Type"='AI_Assessment' AND fixed."Target_Reference"=stale."Target_Reference" AND fixed."Action_Type"='ai.assessment.reassessment_completed' AND fixed."Occurred_At">stale."Occurred_At")) stale`,
      [assessmentId, userId],
    ),
  ]);
  return {
    ...r.rows[0],
    recommendations: rec.rows,
    messages: history.rows.reverse(),
    needsReassessment: stale.rows[0].stale,
    timeCriticalDental: ai.timeCriticalDental(r.rows[0].symptoms),
  };
}

// If the AI provider cannot reassess a new message, fail closed: persist it,
// suspend older unbooked recommendations and let the patient retry in the same
// conversation. A failed external service must not leave stale offers bookable.
async function markAssessmentPending(
  pool,
  userId,
  assessmentId,
  text,
  locale,
  expectedSeq,
) {
  const reply =
    locale === "en"
      ? "I cannot safely reassess your new information right now. Earlier appointment suggestions have been paused. Please contact a dentist if symptoms are worsening; seek emergency care for severe danger signs. You may retry in this same chat."
      : "تعذّر تحديث تقييم معلوماتك الآن، لذلك أوقفنا استخدام اقتراحات الحجز السابقة مؤقتًا. تواصل مع طبيب أسنان إذا ازدادت الأعراض، واطلب الطوارئ عند علامات الخطر. يمكنك المحاولة مرة أخرى في نفس المحادثة.";
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("SELECT set_config('sdc.user_id',$1,true)", [userId]);
    const owned = await db.query(
      `SELECT 1 FROM sdc."AI_ASSESSMENT" a JOIN sdc."PATIENT" p ON p."Patient_ID"=a."Patient_ID" WHERE a."Assessment_ID"=$1::bigint AND p."User_ID"=$2::bigint FOR UPDATE OF a`,
      [assessmentId, userId],
    );
    if (!owned.rowCount) {
      await db.query("ROLLBACK");
      return { status: "not_found" };
    }
    const seq = await db.query(
      `SELECT COALESCE(MAX("Message_Order"),0)::int last FROM sdc."AI_ASSESSMENT_MESSAGES" WHERE "Assessment_ID"=$1::bigint`,
      [assessmentId],
    );
    if (Number(seq.rows[0].last) !== Number(expectedSeq)) {
      await db.query("ROLLBACK");
      return { status: "conflict" };
    }
    const first = seq.rows[0].last + 1;
    await db.query(
      `INSERT INTO sdc."AI_ASSESSMENT_MESSAGES"("Message_Order","Sender_Type","Message_Text","Sent_At","Assessment_ID") VALUES($1,'patient',$2,LOCALTIMESTAMP,$3::bigint),($4,'assistant',$5,LOCALTIMESTAMP,$3::bigint)`,
      [first, text, assessmentId, first + 1, reply],
    );
    await db.query(
      `INSERT INTO sdc."AUDIT_LOG"("Occurred_At","Action_Type","Target_Type","Target_Reference","Description","User_ID") SELECT LOCALTIMESTAMP,'ai.assessment.reassessment_needed','AI_Assessment',$1::varchar(512),'تحديث التقييم معلّق بسبب تعذر خدمة الذكاء الاصطناعي',$2::bigint WHERE NOT EXISTS (SELECT 1 FROM sdc."AUDIT_LOG" WHERE "User_ID"=$2::bigint AND "Action_Type"='ai.assessment.reassessment_needed' AND "Target_Type"='AI_Assessment' AND "Target_Reference"=$1)`,
      [assessmentId, userId],
    );
    await db.query("COMMIT");
    return {
      status: "ok",
      reply,
      needsReassessment: true,
      updated: false,
      assessmentId,
    };
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    db.release();
  }
}

// Recompute on the same assessment ID. A single chat stays in the history,
// and previous decision text is audit-logged before it is replaced.
async function continueAssessment(
  pool,
  userId,
  assessmentId,
  message,
  locale = "ar",
  locationInput = {},
) {
  const origin = coordinates(locationInput);
  const text = normalizeInput(message);
  if (
    !ID.test(String(assessmentId || "")) ||
    text.length < 2 ||
    text.length > 1000
  )
    return { status: "invalid" };
  const previous = await detail(pool, userId, assessmentId);
  if (!previous) return { status: "not_found" };
  const language = locale === "en" ? "en" : "ar";
  const expectedSeq = Number(
    previous.messages.at(-1)?.seq ?? previous.messages.length,
  );
  let response;
  try {
    response = await ai.continueConversation(text, {
      locale: language,
      symptoms: previous.symptoms,
      summary: previous.result,
      advice: previous.advice,
      risk: previous.risk,
      history: previous.messages,
    });
  } catch (error) {
    if (
      error.code === "AI_NOT_CONFIGURED" ||
      error.code === "AI_PROVIDER_UNAVAILABLE" ||
      error.code === "AI_TIMEOUT" ||
      error.message === "AI_EMPTY_OUTPUT"
    )
      return markAssessmentPending(
        pool,
        userId,
        assessmentId,
        text,
        language,
        expectedSeq,
      );
    throw error;
  }
  const clinicallyChanged = Boolean(
    previous.needsReassessment ||
    response.needs_reassessment ||
    ai.safety(text),
  );
  let verdict = null,
    recs = [],
    combined = "";
  if (clinicallyChanged) {
    // Context includes the entire short current conversation, but no patient identity,
    // coordinates or medical records. No new assessment or database table is created.
    const symptomHistory = previous.messages
      .filter((m) => m.sender === "patient")
      .map((m) => m.text);
    combined = [...symptomHistory, text].join("\n").slice(-1500);
    const catalog = await booking.catalog(pool, null);
    const meta = await context(pool, catalog);
    try {
      verdict = await ai.evaluate(combined, {
        services: ai.listFromCatalog(catalog),
        specialties: meta.specialties,
        question: "",
        answer: "المعلومات الجديدة ضمن المحادثة",
        allowQuestion: false,
        locale: language,
      });
    } catch (error) {
      if (
        error.code === "AI_NOT_CONFIGURED" ||
        error.code === "AI_PROVIDER_UNAVAILABLE" ||
        error.code === "AI_TIMEOUT" ||
        error.message === "AI_EMPTY_OUTPUT"
      )
        return markAssessmentPending(
          pool,
          userId,
          assessmentId,
          text,
          language,
          expectedSeq,
        );
      throw error;
    }
    // Never downgrade an earlier emergency automatically based only on an LLM.
    if (ai.RISK[previous.risk] > ai.RISK[verdict.risk]) {
      verdict = {
        ...verdict,
        risk: previous.risk,
        advice:
          previous.risk === "emergency"
            ? language === "en"
              ? "Seek emergency medical care now; do not await an online appointment."
              : "اطلب الرعاية الطارئة فورًا ولا تنتظر موعدًا إلكترونيًا."
            : verdict.advice,
      };
    }
    // Privacy: previously shared location is not retained in the assessment;
    // do not infer it. Availability still comes from the actual booking service.
    const patient = await booking.patientId(pool, userId);
    recs = await suggest(
      pool,
      patient,
      catalog,
      { ...verdict, locale: language },
      meta,
      origin || null,
    );
  }
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("SELECT set_config('sdc.user_id',$1,true)", [userId]);
    const owned = await db.query(
      `SELECT a."Assessment_ID",a."Symptoms_Summary",a."Risk_Level",a."Preliminary_Result",a."Advice_Text" FROM sdc."AI_ASSESSMENT" a JOIN sdc."PATIENT" p ON p."Patient_ID"=a."Patient_ID" WHERE a."Assessment_ID"=$1::bigint AND p."User_ID"=$2::bigint FOR UPDATE OF a`,
      [assessmentId, userId],
    );
    if (!owned.rowCount) {
      await db.query("ROLLBACK");
      return { status: "not_found" };
    }
    const seq = await db.query(
      `SELECT COALESCE(MAX("Message_Order"),0)::int "last" FROM sdc."AI_ASSESSMENT_MESSAGES" WHERE "Assessment_ID"=$1::bigint`,
      [assessmentId],
    );
    // Don't overwrite a later concurrent conversation based on stale context.
    if (
      Number(seq.rows[0].last) !==
      Number(previous.messages.at(-1)?.seq ?? previous.messages.length)
    ) {
      await db.query("ROLLBACK");
      return { status: "conflict" };
    }
    const first = seq.rows[0].last + 1;
    await db.query(
      `INSERT INTO sdc."AI_ASSESSMENT_MESSAGES"("Message_Order","Sender_Type","Message_Text","Sent_At","Assessment_ID") VALUES($1,'patient',$2,LOCALTIMESTAMP,$3::bigint),($4,'assistant',$5,LOCALTIMESTAMP,$3::bigint)`,
      [first, text, assessmentId, first + 1, response.reply],
    );
    if (clinicallyChanged) {
      const previousRecord = owned.rows[0];
      await db.query(
        `INSERT INTO sdc."AUDIT_LOG"("Occurred_At","Action_Type","Target_Type","Target_Reference","Description","User_ID") VALUES(LOCALTIMESTAMP,'ai.assessment.revised','AI_Assessment',$1::varchar(512),$2,$3::bigint)`,
        [
          assessmentId,
          JSON.stringify({
            previous_symptoms: String(
              previousRecord.Symptoms_Summary || "",
            ).slice(-1500),
            previous_risk: previousRecord.Risk_Level,
            previous_result: String(
              previousRecord.Preliminary_Result || "",
            ).slice(0, 450),
            previous_advice: String(previousRecord.Advice_Text || "").slice(
              0,
              900,
            ),
            updated_risk: verdict.risk,
          }),
          userId,
        ],
      );
      await db.query(
        `UPDATE sdc."AI_ASSESSMENT" SET "Preliminary_Result"=$2,"Advice_Text"=$3,"Risk_Level"=$4,"Symptoms_Summary"=$5 WHERE "Assessment_ID"=$1::bigint`,
        [assessmentId, verdict.summary, verdict.advice, verdict.risk, combined],
      );
      // The previously booked recommendation is historical and must never be
      // deleted or changed. Remove only unbooked (outdated) suggestions.
      await db.query(
        `DELETE FROM sdc."AI_RECOMMENDATION" r WHERE r."Assessment_ID"=$1::bigint AND NOT EXISTS(SELECT 1 FROM sdc."BOOKING" b WHERE b."Recommendation_ID"=r."Recommendation_ID")`,
        [assessmentId],
      );
      const booked = await db.query(
        `SELECT b."Booking_ID"::text id,b."Clinic_ID"::text clinic_id,b."Doctor_ID"::text doctor_id FROM sdc."BOOKING" b JOIN sdc."AI_RECOMMENDATION" r ON r."Recommendation_ID"=b."Recommendation_ID" WHERE r."Assessment_ID"=$1::bigint AND b."Booking_Status" NOT IN ('cancelled','rejected','no_show') LIMIT 1`,
        [assessmentId],
      );
      if (booked.rowCount) {
        const bookingId = booked.rows[0].id;
        // Do not change a pre-existing booking's date, price or service.
        // Notify its treating team that new symptoms were recorded, without
        // putting health details or third-party content in the notification.
        await db.query(
          `INSERT INTO sdc."NOTIFICATION"("Title","Body","Notification_Type","Created_At","Target_Type","Target_Reference","User_ID") SELECT 'تحديث معلومات المريض','أضاف المريض معلومات جديدة بعد طلب الحجز. الرجاء التواصل معه ومراجعة ملاءمة الموعد.','booking',LOCALTIMESTAMP,'Booking',$1::varchar(512),u."User_ID" FROM sdc."DOCTOR" d JOIN sdc."USER" u ON u."User_ID"=d."User_ID" WHERE d."Doctor_ID"=$2::bigint ON CONFLICT DO NOTHING`,
          [bookingId, booked.rows[0].doctor_id],
        );
        await db.query(
          `INSERT INTO sdc."NOTIFICATION"("Title","Body","Notification_Type","Created_At","Target_Type","Target_Reference","User_ID") SELECT DISTINCT 'تحديث معلومات مريض','أضاف المريض معلومات جديدة بعد طلب الحجز. يجب مراجعة الموعد والتواصل معه.','staff.booking.updated',LOCALTIMESTAMP,'Booking',$1::varchar(512),staff."User_ID" FROM sdc."STAFF_AT" staff JOIN sdc."STAFF_PERMISSIONS" perm ON perm."User_ID"=staff."User_ID" AND perm."Clinic_ID"=staff."Clinic_ID" JOIN sdc."USER" u ON u."User_ID"=staff."User_ID" WHERE staff."Clinic_ID"=$2::bigint AND staff."Membership_Status"='active' AND perm."Permission_Code"=ANY(ARRAY['appointments.view','appointments.manage']::varchar[]) AND u."Account_Status"='active' AND u."Login_Enabled"=true AND staff."User_ID"<>$3::bigint ON CONFLICT DO NOTHING`,
          [bookingId, booked.rows[0].clinic_id, userId],
        );
      }
      if (!booked.rowCount) {
        const idx = await db.query(
          `SELECT COALESCE(MAX("Recommendation_Order"),0)::int AS n FROM sdc."AI_RECOMMENDATION" WHERE "Assessment_ID"=$1::bigint`,
          [assessmentId],
        );
        for (let i = 0; i < recs.length; i++) {
          const rec = recs[i];
          await db.query(
            `INSERT INTO sdc."AI_RECOMMENDATION"("Recommendation_Order","Created_At","Suggested_Date","Suggested_Start_Time","Price_Snapshot","Duration_Minutes_Snapshot","Recommendation_Reason","Assessment_ID","Doctor_ID","Clinic_ID","Service_ID") VALUES($1,LOCALTIMESTAMP,$2::date,$3::time,$4::numeric,$5::integer,$6,$7::bigint,$8::bigint,$9::bigint,$10::bigint)`,
            [
              idx.rows[0].n + i + 1,
              rec.date,
              rec.time,
              rec.price,
              rec.duration,
              rec.reason,
              assessmentId,
              rec.doctor_id,
              rec.clinic_id,
              rec.service_id,
            ],
          );
        }
      }
      // Clears any stale marker from older releases, without removing audit history.
      await db.query(
        `INSERT INTO sdc."AUDIT_LOG"("Occurred_At","Action_Type","Target_Type","Target_Reference","Description","User_ID") VALUES(LOCALTIMESTAMP,'ai.assessment.reassessment_completed','AI_Assessment',$1::varchar(512),'تم تحديث تقييم المحادثة نفسها بعد معلومات سريرية جديدة؛ لا يغيّر ذلك أي حجز سابق',$2::bigint)`,
        [assessmentId, userId],
      );
    }
    await db.query("COMMIT");
    return {
      status: "ok",
      reply: response.reply,
      needsReassessment: false,
      updated: clinicallyChanged,
      assessmentId,
    };
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    db.release();
  }
}

module.exports = {
  create,
  detail,
  coordinates,
  km,
  matchingChoices,
  suggest,
  context,
  continueAssessment,
  riskWindow,
  isWithinRiskWindow,
};
