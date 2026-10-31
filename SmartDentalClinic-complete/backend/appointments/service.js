'use strict';
// Server authoritative bookings. All times are clinic-local Asia/Hebron.
const VALID_ID=/^[1-9]\d{0,17}$/;
const patientNotices=require('../patient/workspace/event-notifications');
const VALID_DATE=/^\d{4}-\d\d-\d\d$/;
const VALID_TIME=/^(?:[01]\d|2[0-3]):(?:00|30)$/;
const ACTIVE=['pending','confirmed','in_progress','completed'];
const labels={pending:'بانتظار الموافقة',confirmed:'مؤكد',in_progress:'جاري',completed:'مكتمل',cancelled:'ملغي',rejected:'مرفوض',no_show:'لم يحضر'};
const EXPIRED_REASON='انتهى وقت الموعد قبل تأكيده من العيادة. يمكنك تقديم طلب حجز جديد.';
const num=x=>VALID_ID.test(String(x||''))?String(x):null;
const hm=t=>{const m=/^(\d{2}):(\d{2})/.exec(String(t||''));return m?Number(m[1])*60+Number(m[2]):-1;};
const dateValid=d=>VALID_DATE.test(String(d))&&!Number.isNaN(Date.parse(d+'T00:00:00Z'))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
const dayOfWeek=d=>new Date(d+'T12:00:00Z').getUTCDay();
function localNow(){const x=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Hebron',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date());const get=k=>x.find(p=>p.type===k).value;return {date:`${get('year')}-${get('month')}-${get('day')}`,time:`${get('hour')}:${get('minute')}`};}
function future(date,time){const now=localNow();return date>now.date || date===now.date&&time>now.time;}
async function catalog(db,clinicId){
 const rs=await db.query(`SELECT c."Clinic_ID"::text AS clinic_id,c."Clinic_Name" AS clinic_name,p."Doctor_ID"::text AS doctor_id,
 u."First_Name"||' '||u."Last_Name" AS doctor_name,o."Service_ID"::text AS service_id,s."Service_Name" AS service_name,
 o."Price"::text AS price,o."Duration_Minutes" AS duration
 FROM sdc."PROVIDES" p JOIN sdc."OFFERS" o ON o."Clinic_ID"=p."Clinic_ID" AND o."Service_ID"=p."Service_ID"
 JOIN sdc."WORKS_AT" w ON w."Clinic_ID"=p."Clinic_ID" AND w."Doctor_ID"=p."Doctor_ID"
 JOIN sdc."DOCTOR" d ON d."Doctor_ID"=p."Doctor_ID" JOIN sdc."USER" u ON u."User_ID"=d."User_ID"
 JOIN sdc."SERVICE" s ON s."Service_ID"=p."Service_ID" JOIN sdc."CLINIC" c ON c."Clinic_ID"=p."Clinic_ID"
 WHERE c."Approval_Status"='approved' AND c."Clinic_Status"='active' AND o."Is_Available"=true
 AND w."Membership_Status"='active' AND d."License_Status"='verified' AND u."Account_Status"='active'
 AND EXISTS(SELECT 1 FROM sdc."DOCTOR_WORKING_HOURS" h WHERE h."Clinic_ID"=p."Clinic_ID" AND h."Doctor_ID"=p."Doctor_ID" AND h."Is_Active"=true)
 AND ($1::bigint IS NOT NULL OR c."Online_Booking_Enabled"=true)
 AND ($1::bigint IS NULL OR c."Clinic_ID"=$1::bigint) ORDER BY c."Clinic_Name",doctor_name,s."Service_Name" LIMIT 2000`,[clinicId||null]);
 return rs.rows;
}
function chosen(rows,b){return rows.find(r=>r.clinic_id===String(b.clinic_id||'')&&r.doctor_id===String(b.doctor_id||'')&&r.service_id===String(b.service_id||''))||null;}
async function patientId(db,userId){const r=await db.query('SELECT "Patient_ID"::text AS id FROM sdc."PATIENT" WHERE "User_ID"=$1::bigint',[userId]);return r.rows[0]?.id||null;}
async function patientOptions(db,clinicId){const r=await db.query(`SELECT p."Patient_ID"::text AS id,u."First_Name"||' '||u."Last_Name" AS name FROM sdc."REGISTERED_AT" r JOIN sdc."PATIENT" p ON p."Patient_ID"=r."Patient_ID" JOIN sdc."USER" u ON u."User_ID"=p."User_ID" WHERE r."Clinic_ID"=$1::bigint ORDER BY name LIMIT 1000`,[clinicId]);return r.rows;}
// Availability is always the intersection of active doctor hours and clinic hours.
// Closed exceptions take precedence; custom-hours exceptions replace clinic weekly hours ONLY on their date.
// Return a reason so existing booking pages can explain why a normal working day has no slots.
async function availability(db,choice,date,patient=null,ignoreBooking=null){
 const empty=reason=>({slots:[],reason});
 if(!choice||!dateValid(date))return empty('invalid_date');
 if(date<localNow().date||date>new Date(Date.now()+180*86400000).toISOString().slice(0,10))return empty('out_of_range');
 const membership=await db.query(`SELECT 1 FROM sdc."WORKS_AT" WHERE "Clinic_ID"=$1::bigint AND "Doctor_ID"=$2::bigint AND "Membership_Status"='active' AND "Start_Date"<=$3::date`,[choice.clinic_id,choice.doctor_id,date]);
 if(!membership.rowCount)return empty('inactive_membership');
 const p=[choice.clinic_id,choice.doctor_id,date];
 const [weekly,exceptions,absence,busy]=await Promise.all([
 db.query(`SELECT to_char("Start_Time",'HH24:MI') AS start,CASE WHEN "End_Time"=TIME '24:00' THEN '24:00' ELSE to_char("End_Time",'HH24:MI') END AS end FROM sdc."DOCTOR_WORKING_HOURS" WHERE "Clinic_ID"=$1::bigint AND "Doctor_ID"=$2::bigint AND "Day_Of_Week"=$3::smallint AND "Is_Active"=true`,[choice.clinic_id,choice.doctor_id,dayOfWeek(date)]),
 db.query(`SELECT "Exception_Type" AS type,to_char("Start_Time",'HH24:MI') AS start,to_char("End_Time",'HH24:MI') AS end FROM sdc."CLINIC_WORKING_EXCEPTIONS" WHERE "Clinic_ID"=$1::bigint AND "Exception_Date"=$2::date`,[choice.clinic_id,date]),
 db.query(`SELECT 1 FROM sdc."DOCTOR_ABSENCES" WHERE "Clinic_ID"=$1::bigint AND "Doctor_ID"=$2::bigint AND $3::date BETWEEN "From_Date" AND "To_Date" LIMIT 1`,p),
 db.query(`SELECT to_char("Start_Time",'HH24:MI') AS start,"Duration_Minutes_Snapshot" AS duration FROM sdc."BOOKING" WHERE "Appointment_Date"=$1::date AND "Booking_Status" NOT IN ('cancelled','rejected','no_show') AND ("Doctor_ID"=$2::bigint OR ($3::bigint IS NOT NULL AND "Patient_ID"=$3::bigint)) AND ($4::bigint IS NULL OR "Booking_ID"<>$4::bigint)`,[date,choice.doctor_id,patient,ignoreBooking])
 ]);
 // Never allow a closed day to become available, even if working hours exist.
 if(exceptions.rows.some(x=>x.type==='closed'))return empty('clinic_closed');
 if(absence.rowCount)return empty('doctor_absent');
 if(!weekly.rows.length)return empty('doctor_no_hours');
 const clinicHours=exceptions.rowCount
  ?exceptions.rows.filter(x=>x.type==='custom_hours')
  :(await db.query(`SELECT to_char("Start_Time",'HH24:MI') AS start,CASE WHEN "End_Time"=TIME '24:00' THEN '24:00' ELSE to_char("End_Time",'HH24:MI') END AS end FROM sdc."CLINIC_WORKING_HOURS" WHERE "Clinic_ID"=$1::bigint AND "Day_Of_Week"=$2::smallint`,[choice.clinic_id,dayOfWeek(date)])).rows;
 if(!clinicHours.length)return empty('clinic_no_hours');
 const duration=Number(choice.duration),out=[];
 let hasOverlap=false;
 for(const doc of weekly.rows)for(const c of clinicHours){
  const start=Math.ceil(Math.max(hm(doc.start),hm(c.start))/30)*30,end=Math.min(hm(doc.end),hm(c.end));
  if(start+duration<=end)hasOverlap=true;
  for(let time=start;time+duration<=end;time+=30){const t=`${String(Math.floor(time/60)).padStart(2,'0')}:${String(time%60).padStart(2,'0')}`;
   if(!future(date,t)||busy.rows.some(x=>time<hm(x.start)+Number(x.duration)&&time+duration>hm(x.start)))continue;
   out.push(t);
  }
 }
 if(!hasOverlap)return empty('no_overlap');
 if(!out.length)return empty('no_free_slots');
 return {slots:[...new Set(out)].sort(),reason:'available'};
}
async function slots(db,choice,date,patient=null,ignoreBooking=null){
 return (await availability(db,choice,date,patient,ignoreBooking)).slots;
}
const availabilityReasons=Object.freeze({
 invalid_date:'يرجى اختيار تاريخ صحيح.',
 out_of_range:'التاريخ خارج فترة الحجز المسموحة (حتى 180 يومًا من اليوم).',
 inactive_membership:'الطبيب غير مرتبط بهذه العيادة ارتباطًا نشطًا في التاريخ المختار.',
 clinic_closed:'العيادة مغلقة في هذا التاريخ بسبب استثناء إغلاق؛ لا يمكن الحجز فيه.',
 doctor_absent:'الطبيب في إجازة أو غياب خلال التاريخ المختار.',
 doctor_no_hours:'لا يوجد دوام فعّال للطبيب في هذا اليوم. راجع جدول دوام الطبيب داخل العيادة.',
 clinic_no_hours:'لا توجد ساعات عمل للعيادة في هذا اليوم. راجع الدوام الأسبوعي أو ساعات الاستثناء.',
 no_overlap:'ساعات عمل الطبيب والعيادة لا تتقاطع بما يكفي لمدة الخدمة.',
 no_free_slots:'ساعات الدوام موجودة، لكن كل الأوقات انتهت أو محجوزة لهذا اليوم.'
});
async function audit(db,action,id,userId,description){await db.query(`INSERT INTO sdc."AUDIT_LOG"("Occurred_At","Action_Type","Target_Type","Target_Reference","Description","User_ID") VALUES(LOCALTIMESTAMP,$1::varchar(150),'Booking',$2::varchar(512),$3::text,$4::bigint)`,[action,String(id),description,userId]);}
async function note(db,userId,title,body,bookingId){await db.query(`INSERT INTO sdc."NOTIFICATION"("Title","Body","Notification_Type","Created_At","User_ID","Target_Type","Target_Reference") VALUES($1::varchar(150),$2::text,'booking',LOCALTIMESTAMP,$3::bigint,'Booking',$4::varchar(512))`,[title,body,userId,String(bookingId)]);}
async function transaction(pool,fn){const c=await pool.connect();try{await c.query('BEGIN');const result=await fn(c);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}}
// Automatically close expired UNCONFIRMED requests, not confirmed appointments.
// The row lock, advisory scan lock, status guard and single transaction make
// retries safe, including multiple Express workers and concurrent approvals.
// Date and time refer to the clinic timezone, not the server OS timezone.
async function expirePending(pool,{now=localNow(),batchSize=200}={}){
 if(!dateValid(now.date)||!/^\d\d:\d\d$/.test(now.time))throw new Error('Invalid expiry clock');
 const db=await pool.connect();
 try{
  await db.query('BEGIN');
  const lock=await db.query('SELECT pg_try_advisory_xact_lock(534443,274423) AS locked');
  if(lock.rows[0]?.locked!==true){await db.query('ROLLBACK');return {status:'busy',closed:0};}
  const selected=await db.query(`SELECT b."Booking_ID"::text AS id,b."Patient_ID"::text AS patient_id,
   b."Created_By_User_ID"::text AS created_by_user_id,
   b."Administrative_Notes" AS old_administrative_notes,b."Request_Status" AS request_status
   FROM sdc."BOOKING" b
   WHERE b."Booking_Status"='pending' AND b."Arrived_At" IS NULL
    AND (b."Appointment_Date"<$1::date OR (b."Appointment_Date"=$1::date AND b."Start_Time"<=$2::time))
    AND NOT EXISTS(SELECT 1 FROM sdc."VISIT" v WHERE v."Booking_ID"=b."Booking_ID")
   ORDER BY b."Appointment_Date",b."Start_Time",b."Booking_ID"
   LIMIT $3::int FOR UPDATE OF b SKIP LOCKED`,[now.date,now.time,Math.min(Math.max(Number(batchSize)||200,1),500)]);
  // The existing reschedule-audit trigger requires an authenticated actor if
  // Request_Status changes. Use an active platform administrator for automated
  // changes, or the original creator as a fallback if no administrator exists.
  let systemActor=null;
  if(selected.rows.some(b=>b.request_status==='pending')){
   const admins=await db.query(`SELECT u."User_ID"::text AS id FROM sdc."USER" u
     JOIN sdc."ROLE" r USING("Role_ID")
     WHERE r."Role_Scope"='System' AND r."Role_Name"='Super Admin'
       AND u."Account_Status"='active' AND u."Login_Enabled"=true
     ORDER BY u."User_ID" LIMIT 1`);
   systemActor=admins.rows[0]?.id||null;
  }
  let closed=0;
  for(const b of selected.rows){
   if(b.request_status==='pending')await db.query("SELECT set_config('sdc.user_id',$1,true)",[systemActor||b.created_by_user_id]);
   const saved=await db.query(`UPDATE sdc."BOOKING"
    SET "Booking_Status"='rejected',
     "Administrative_Notes"=$2::text,
     "Request_Status"=CASE WHEN "Request_Status"='pending' THEN 'rejected' ELSE "Request_Status" END,
     "Resolved_At"=CASE WHEN "Request_Status"='pending' THEN (now() AT TIME ZONE 'Asia/Hebron') ELSE "Resolved_At" END
    WHERE "Booking_ID"=$1::bigint AND "Booking_Status"='pending' AND "Arrived_At" IS NULL
    RETURNING "Booking_ID"`,[b.id,EXPIRED_REASON]);
   if(!saved.rowCount)continue;
   await db.query(`INSERT INTO sdc."AUDIT_LOG"
    ("Occurred_At","Action_Type","Target_Type","Target_Reference","Description","Reason","User_ID")
    VALUES((now() AT TIME ZONE 'Asia/Hebron'),'booking.expired.unconfirmed','Booking',$1::varchar(512),
      'انتهى موعد طلب الحجز قبل تأكيد العيادة',$2::text,NULL)`,[b.id,b.old_administrative_notes?`${EXPIRED_REASON} | ملاحظات إدارية سابقة: ${b.old_administrative_notes}`:EXPIRED_REASON]);
   await patientNotices.emit(db,{patientId:b.patient_id,type:'patient.booking.expired',
    title:'انتهاء طلب الحجز',body:EXPIRED_REASON,targetType:'Booking',targetId:b.id});
   closed++;
  }
  await db.query('COMMIT');
  return {status:'ok',closed,checked:selected.rows.length};
 }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}
 finally{db.release();}
}
function startExpiration(pool,logger=console){
 const tick=()=>expirePending(pool).then(r=>{if(r.closed)logger.info('[BOOKINGS_EXPIRED]',r.closed);})
  .catch(e=>logger.error('[BOOKINGS_EXPIRATION_FAILED]',e.code||e.message));
 void tick();const timer=setInterval(tick,60*1000);timer.unref?.();return timer;
}
async function book(pool,b,actor,clinicId){
 const date=String(b.appointment_date||b.clinic_booking_date||''),time=String(b.appointment_time||'');
 if(actor.role==='admin'&&(String(b.admin_reason||'').trim().length<8||String(b.admin_reason||'').trim().length>1000))return {status:'invalid'};
 if(!dateValid(date)||!VALID_TIME.test(time)||!future(date,time)||!num(b.doctor_id)||!num(b.service_id)||!num(b.clinic_id)||String(b.notes||'').trim().length>2000)return {status:'invalid'};
 return transaction(pool,async db=>{
  await db.query("SELECT set_config('sdc.user_id',$1,true)",[actor.userId]);
  if(actor.role==='staff'){
   if(clinicId!==String(b.clinic_id||'') )return {status:'forbidden'};
   const permit=await db.query(`SELECT sdc.sdc_can($1::bigint,$2::bigint,'appointments.manage') AS allowed`,[actor.userId,clinicId]);
   if(permit.rows[0]?.allowed!==true)return {status:'forbidden'};
  }
  if(actor.role==='admin'){
   const auth=await db.query('SELECT sdc.sdc_is_superadmin($1::bigint) AS allowed',[actor.userId]);
   if(auth.rows[0]?.allowed!==true)return {status:'forbidden'};
  }
  // Lock the doctor BEFORE reading slots; concurrent bookings by this doctor serialize.
  await db.query('SELECT "Doctor_ID" FROM sdc."DOCTOR" WHERE "Doctor_ID"=$1::bigint FOR UPDATE',[b.doctor_id]);
  let patient;
  if(actor.role==='patient')patient=await patientId(db,actor.userId);
  else if(['doctor','admin','staff'].includes(actor.role)&&clinicId===String(b.clinic_id))patient=num(b.patient_id);
  if(!patient)return {status:'forbidden'};
  await db.query('SELECT "Patient_ID" FROM sdc."PATIENT" WHERE "Patient_ID"=$1::bigint FOR UPDATE',[patient]);
  if(actor.role!=='patient'){const enrolled=await db.query('SELECT 1 FROM sdc."REGISTERED_AT" WHERE "Clinic_ID"=$1::bigint AND "Patient_ID"=$2::bigint',[clinicId,patient]);if(!enrolled.rowCount)return {status:'forbidden'};}
  const options=await catalog(db,clinicId||null),choice=chosen(options,b);
  if(!choice)return {status:'unavailable'};
  const validSlots=await slots(db,choice,date,patient);
  if(!validSlots.includes(time))return {status:'unavailable'};
  if(actor.role==='patient')await db.query('INSERT INTO sdc."REGISTERED_AT"("Patient_ID","Clinic_ID") VALUES($1::bigint,$2::bigint) ON CONFLICT DO NOTHING',[patient,choice.clinic_id]);
  // Optional follow-up linkage. It is not enough to pass a patient identifier:
  // lock the physician's completed visit and verify clinic/patient ownership.
  const followUpId=String(b.follow_up_visit_id||'').trim();
  if(followUpId&&!num(followUpId))return {status:'invalid'};
  if(followUpId){
   const q=await db.query(`SELECT v."Visit_ID" FROM sdc."VISIT" v JOIN sdc."BOOKING" previous ON previous."Booking_ID"=v."Booking_ID"
    WHERE v."Visit_ID"=$1::bigint AND previous."Clinic_ID"=$2::bigint AND previous."Patient_ID"=$3::bigint
    AND previous."Booking_Status"='completed' AND v."Follow_Up_Type" IS NOT NULL AND v."Suggested_Date" IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM sdc."BOOKING" later WHERE later."Follow_Up_Of_Visit_ID"=v."Visit_ID")
    FOR UPDATE OF v`,[followUpId,choice.clinic_id,patient]);
   if(!q.rowCount)return {status:'unavailable'};
  }
  // Recommendations can be accepted only by their owner. Lock the assessment
  // so concurrent accepts cannot book multiple proposals for one assessment.
  const recId=String(b.recommendation_id||'').trim();
  if(recId&&(!num(recId)||actor.role!=='patient'||followUpId))return {status:'invalid'};
  let symptoms='';
  if(recId){
   const found=await db.query(`SELECT r."Recommendation_ID",a."Assessment_ID",a."Symptoms_Summary" symptoms
     FROM sdc."AI_RECOMMENDATION" r JOIN sdc."AI_ASSESSMENT" a USING("Assessment_ID")
     WHERE r."Recommendation_ID"=$1::bigint AND a."Patient_ID"=$2::bigint
       AND r."Clinic_ID"=$3::bigint AND r."Doctor_ID"=$4::bigint AND r."Service_ID"=$5::bigint
       AND r."Suggested_Date"=$6::date AND r."Suggested_Start_Time"=$7::time
       AND r."Price_Snapshot"=$8::numeric AND r."Duration_Minutes_Snapshot"=$9::integer
     FOR UPDATE OF a`,[recId,patient,choice.clinic_id,choice.doctor_id,choice.service_id,date,time,choice.price,choice.duration]);
   if(!found.rowCount)return {status:'unavailable'};
   // A follow-up message may reveal symptoms that invalidate the original
   // recommendation. Check inside the same transaction while the assessment is locked.
   const reassess=await db.query(`SELECT 1 FROM sdc."AUDIT_LOG" stale WHERE stale."Action_Type"='ai.assessment.reassessment_needed' AND stale."Target_Type"='AI_Assessment' AND stale."Target_Reference"=$1::varchar(512) AND stale."User_ID"=$2::bigint AND NOT EXISTS(SELECT 1 FROM sdc."AUDIT_LOG" complete WHERE complete."Action_Type"='ai.assessment.reassessment_completed' AND complete."Target_Type"=stale."Target_Type" AND complete."Target_Reference"=stale."Target_Reference" AND complete."User_ID"=stale."User_ID" AND complete."Occurred_At">stale."Occurred_At") LIMIT 1`,[String(found.rows[0].Assessment_ID),actor.userId]);
   if(reassess.rowCount)return {status:'unavailable'};
   // A recommendation can become past the clinically appropriate window even
   // without symptom changes. Never turn a delayed slot into an 'urgent' booking.
   const riskCheck=await db.query(`SELECT a."Risk_Level" AS risk FROM sdc."AI_ASSESSMENT" a WHERE a."Assessment_ID"=$1::bigint`,[found.rows[0].Assessment_ID]);
   const risk=riskCheck.rows[0]?.risk;
   if(!['high','medium','low'].includes(risk)||!require('../patient/workspace/triage').isWithinRiskWindow(risk,localNow(),date,time))return {status:'unavailable'};
   const already=await db.query(`SELECT 1 FROM sdc."BOOKING" bk JOIN sdc."AI_RECOMMENDATION" rec USING("Recommendation_ID") WHERE rec."Assessment_ID"=$1::bigint LIMIT 1`,[found.rows[0].Assessment_ID]);
   if(already.rowCount)return {status:'already'};
   symptoms=String(found.rows[0].symptoms||'').slice(0,1500);
  }
  const result=await db.query(`INSERT INTO sdc."BOOKING"("Appointment_Date","Start_Time","Duration_Minutes_Snapshot","Service_Price_Snapshot","Booking_Status","Booking_Source","Created_At","Patient_Notes","Patient_ID","Clinic_ID","Doctor_ID","Service_ID","Created_By_User_ID","Follow_Up_Of_Visit_ID","Recommendation_ID")
   VALUES($1::date,$2::time,$3::integer,$4::numeric,$5::varchar(150),$6::varchar(150),LOCALTIMESTAMP,$7::text,$8::bigint,$9::bigint,$10::bigint,$11::bigint,$12::bigint,$13::bigint,$14::bigint) RETURNING "Booking_ID"::text AS id`,
   [date,time,choice.duration,choice.price,actor.role==='patient'?'pending':'confirmed',recId?'ai':'manual',recId?('الأعراض المذكورة في التقييم الأولي: '+symptoms):actor.role==='admin'?null:String(b.notes||'').trim()||null,patient,choice.clinic_id,choice.doctor_id,choice.service_id,actor.userId,followUpId||null,recId||null]);
  const id=result.rows[0].id;
  if(actor.role==='admin'&&String(b.notes||'').trim())await db.query(`UPDATE sdc."BOOKING" SET "Administrative_Notes"=$2::text WHERE "Booking_ID"=$1::bigint`,[id,String(b.notes).trim()]);
  if(actor.role==='admin')await db.query(`INSERT INTO sdc."AUDIT_LOG"("Occurred_At","Action_Type","Target_Type","Target_Reference","Description","Reason","User_ID") VALUES(LOCALTIMESTAMP,'booking.admin_created','Booking',$1::varchar(512),'إنشاء حجز إداري مع حفظ سعر الخدمة والمدة',$2::text,$3::bigint)`,[id,b.admin_reason.trim(),actor.userId]);
  else await audit(db,'booking.created',id,actor.userId,'إنشاء حجز فعلي مع الاحتفاظ بسعر الخدمة ومدة الجلسة');
  const receiver=await db.query(`SELECT u."User_ID"::text AS id FROM sdc."DOCTOR" d JOIN sdc."USER" u USING("User_ID") WHERE d."Doctor_ID"=$1::bigint`,[choice.doctor_id]);
  if(receiver.rowCount&&receiver.rows[0].id!==String(actor.userId))await note(db,receiver.rows[0].id,'موعد جديد','تم إنشاء موعد في عيادتك.',id);
  await patientNotices.emit(db,{patientId:patient,type:'patient.booking.created',
   title:actor.role==='patient'?'تم استلام طلب الحجز':'تم إنشاء موعدك',
   body:actor.role==='patient'?`استلمنا طلبك بتاريخ ${date} الساعة ${time}. الموعد بانتظار تأكيد العيادة.`:`تم حجز موعدك بتاريخ ${date} الساعة ${time}. افتح تفاصيل الموعد للمراجعة.`,
   targetType:'Booking',targetId:id});
  await require('../staff/event-notifications').emit(db,{clinicId:choice.clinic_id,actorId:actor.userId,type:'Booking',targetId:id,title:'موعد جديد',body:'تم إنشاء موعد جديد في العيادة، افتح المواعيد لمتابعته.'});
  return {status:'ok',id};
 });
}
const LIST_SQL=`SELECT b."Booking_ID"::text AS id,to_char(b."Appointment_Date",'YYYY-MM-DD') AS date,to_char(b."Start_Time",'HH24:MI') AS time,b."Booking_Status" AS status,b."Arrived_At" IS NOT NULL AS arrived,b."Booking_Source" AS source,b."Doctor_Rating" AS doctor_rating,b."Clinic_Rating" AS clinic_rating,b."Review_Comment" AS review_comment,b."Duration_Minutes_Snapshot" AS duration,b."Service_Price_Snapshot"::text AS price,b."Patient_Notes" AS notes,b."Administrative_Notes" AS administrative_notes,(b."Booking_Status"='rejected' AND POSITION('انتهى وقت الموعد قبل تأكيده من العيادة.' IN COALESCE(b."Administrative_Notes",''))>0) AS expired_unconfirmed,b."Request_Status" AS request_status,to_char(b."Requested_Date",'YYYY-MM-DD') AS requested_date,to_char(b."Requested_Start_Time",'HH24:MI') AS requested_time,b."Change_Request_Reason" AS request_reason,b."Request_Source" AS request_source,b."Clinic_ID"::text AS clinic_id,b."Doctor_ID"::text AS doctor_id,b."Patient_ID"::text AS patient_id,c."Clinic_Name" AS clinic_name,s."Service_Name" AS service_name,pu."First_Name"||' '||pu."Last_Name" AS patient_name,du."First_Name"||' '||du."Last_Name" AS doctor_name
 FROM sdc."BOOKING" b JOIN sdc."CLINIC" c USING("Clinic_ID") JOIN sdc."SERVICE" s USING("Service_ID") JOIN sdc."PATIENT" p USING("Patient_ID") JOIN sdc."USER" pu ON pu."User_ID"=p."User_ID" JOIN sdc."DOCTOR" d USING("Doctor_ID") JOIN sdc."USER" du ON du."User_ID"=d."User_ID"`;
async function list(pool,actor,clinicId){let where,params;
 if(actor.role==='patient'){where='WHERE p."User_ID"=$1::bigint';params=[actor.userId];}
 else if(actor.role==='doctor'){where='WHERE b."Clinic_ID"=$1::bigint AND b."Doctor_ID"=$2::bigint';params=[clinicId,actor.doctorId];}
 else throw new Error('Unsupported actor');
 const rs=await pool.query(`${LIST_SQL} ${where} ORDER BY b."Appointment_Date" DESC,b."Start_Time" DESC LIMIT 300`,params);
 return rs.rows;
}
async function clinicList(pool,clinicId){const r=await pool.query(`${LIST_SQL} WHERE b."Clinic_ID"=$1::bigint ORDER BY b."Appointment_Date" DESC,b."Start_Time" DESC LIMIT 500`,[clinicId]);return r.rows;}
async function detail(pool,id,actor,clinicId){if(!num(id))return null;const r=await pool.query(`${LIST_SQL} WHERE b."Booking_ID"=$1::bigint`,[id]);const booking=r.rows[0];if(!booking)return null;
 if(actor.role==='patient'){const p=await patientId(pool,actor.userId);if(p!==booking.patient_id)return null;}
 else if(actor.role==='doctor'){if(!clinicId||clinicId!==booking.clinic_id||actor.doctorId!==booking.doctor_id&&!actor.isManager)return null;}else return null;
 return booking;
}
async function action(pool,actor,clinicId,b){const id=num(b.booking_id),name=String(b.action||'');if(!id||!['confirm','reject','cancel','move','request_change','approve_change','reject_change'].includes(name))return {status:'invalid'};
 const date=String(b.requested_date||''),time=String(b.requested_time||''),reason=String(b.reason||'').trim();
 if(actor.role==='admin'&&(reason.length<8||reason.length>1000))return {status:'invalid'};
 if(['request_change','move'].includes(name)&&(!dateValid(date)||!VALID_TIME.test(time)||!future(date,time)||reason.length>2000||(name==='request_change'&&!reason)))return {status:'invalid'};
 // A clinic rejection must record an explanation that the patient can see.
 if(name==='reject'&&(!reason||reason.length>2000))return {status:'reason_required'};
 return transaction(pool,async db=>{
  await db.query("SELECT set_config('sdc.user_id',$1,true)",[actor.userId]);
  if(actor.role==='admin'){
   const auth=await db.query('SELECT sdc.sdc_is_superadmin($1::bigint) AS allowed',[actor.userId]);
   if(auth.rows[0]?.allowed!==true)return {status:'forbidden'};
  }
  // Lock doctor before booking to match lock order used by new bookings.
  const doctor=await db.query('SELECT "Doctor_ID" FROM sdc."BOOKING" WHERE "Booking_ID"=$1::bigint',[id]);if(!doctor.rowCount)return {status:'not_found'};
  await db.query('SELECT 1 FROM sdc."DOCTOR" WHERE "Doctor_ID"=$1::bigint FOR UPDATE',[doctor.rows[0].Doctor_ID]);
  const booking=(await db.query(`${LIST_SQL} WHERE b."Booking_ID"=$1::bigint FOR UPDATE OF b`,[id])).rows[0];if(!booking)return {status:'not_found'};
  let authorizedStaff=false;
  if(actor.role==='staff'&&clinicId===booking.clinic_id){
   const permit=await db.query(`SELECT sdc.sdc_can($1::bigint,$2::bigint,'appointments.manage') AS allowed`,[actor.userId,clinicId]);
   authorizedStaff=permit.rows[0]?.allowed===true;
  }
  const manager=authorizedStaff || actor.role==='admin'&&clinicId===booking.clinic_id || actor.role==='doctor'&&clinicId===booking.clinic_id&&actor.isManager;
  const physician=actor.role==='doctor'&&clinicId===booking.clinic_id&&actor.doctorId===booking.doctor_id;
  const patient=actor.role==='patient'&&(await patientId(db,actor.userId))===booking.patient_id;
  if(!(manager||physician||patient))return {status:'forbidden'};
  // Once the patient checks in, the session is handled by daily operations.
  if(booking.arrived&&['cancel','move','request_change','approve_change'].includes(name))return {status:'closed'};
  if(['confirm','reject','approve_change','reject_change','move'].includes(name)&&!manager)return {status:'forbidden'};
  if(!future(booking.date,booking.time)&&name!=='reject_change')return {status:'closed'};
  if(name==='confirm'||name==='reject'){
   if(booking.status!=='pending'||booking.request_status==='pending')return {status:'closed'};
   if(name==='reject'){
    // Reuse the existing administrative note on this rejected booking (no schema change).
    await db.query(`UPDATE sdc."BOOKING" SET "Booking_Status"='rejected',"Administrative_Notes"=$2::text WHERE "Booking_ID"=$1::bigint`,[id,reason]);
   }else{
    await db.query(`UPDATE sdc."BOOKING" SET "Booking_Status"='confirmed' WHERE "Booking_ID"=$1::bigint`,[id]);
   }
  }else if(name==='cancel'){
   if(!['pending','confirmed'].includes(booking.status)||booking.request_status==='pending')return {status:'closed'};
   await db.query('UPDATE sdc."BOOKING" SET "Booking_Status"=\'cancelled\' WHERE "Booking_ID"=$1::bigint',[id]);
  }else if(name==='move'){
   if(!['pending','confirmed'].includes(booking.status)||booking.request_status==='pending')return {status:'closed'};
   const service=(await db.query('SELECT "Service_ID"::text AS id FROM sdc."BOOKING" WHERE "Booking_ID"=$1::bigint',[id])).rows[0].id;
   const choice=(await catalog(db,booking.clinic_id)).find(x=>x.doctor_id===booking.doctor_id&&x.service_id===service);
   if(!choice||!(await slots(db,choice,date,booking.patient_id,id)).includes(time))return {status:'unavailable'};
   await db.query(`UPDATE sdc."BOOKING" SET "Appointment_Date"=$2::date,"Start_Time"=$3::time,"Administrative_Notes"=NULLIF($4::text,'') WHERE "Booking_ID"=$1::bigint`,[id,date,time,reason]);
  }else if(name==='request_change'){
   if(!['pending','confirmed'].includes(booking.status)||booking.request_status==='pending'||manager&&!physician)return {status:'closed'};
   const service=(await db.query('SELECT "Service_ID"::text AS id FROM sdc."BOOKING" WHERE "Booking_ID"=$1::bigint',[id])).rows[0].id;
   const choice=(await catalog(db,booking.clinic_id)).find(x=>x.doctor_id===booking.doctor_id&&x.service_id===service);
   if(!choice||!(await slots(db,choice,date,booking.patient_id,id)).includes(time))return {status:'unavailable'};
   await db.query(`UPDATE sdc."BOOKING" SET "Requested_Date"=$2::date,"Requested_Start_Time"=$3::time,"Change_Request_Reason"=$4::text,"Request_Source"=$5::varchar(150),"Requested_At"=LOCALTIMESTAMP,"Request_Status"='pending',"Resolved_At"=NULL WHERE "Booking_ID"=$1::bigint`,[id,date,time,reason,patient?'patient':'doctor']);
  }else{
   if(booking.request_status!=='pending')return {status:'closed'};
   if(name==='approve_change'){
    const service=(await db.query('SELECT "Service_ID"::text AS id FROM sdc."BOOKING" WHERE "Booking_ID"=$1::bigint',[id])).rows[0].id;
    const choice=(await catalog(db,booking.clinic_id)).find(x=>x.doctor_id===booking.doctor_id&&x.service_id===service);
    if(!choice||!(await slots(db,choice,booking.requested_date,booking.patient_id,id)).includes(booking.requested_time))return {status:'unavailable'};
    await db.query(`UPDATE sdc."BOOKING" SET "Appointment_Date"="Requested_Date","Start_Time"="Requested_Start_Time","Request_Status"='approved',"Resolved_At"=LOCALTIMESTAMP WHERE "Booking_ID"=$1::bigint`,[id]);
   }else await db.query(`UPDATE sdc."BOOKING" SET "Request_Status"='rejected',"Resolved_At"=LOCALTIMESTAMP WHERE "Booking_ID"=$1::bigint`,[id]);
  }
  if(actor.role==='admin')await db.query(`INSERT INTO sdc."AUDIT_LOG"("Occurred_At","Action_Type","Target_Type","Target_Reference","Description","Reason","User_ID") VALUES(LOCALTIMESTAMP,$1::varchar(150),'Booking',$2::varchar(512),$3::text,$4::text,$5::bigint)`,[`booking.admin.${name}`,id,`تدخل إداري في حالة الحجز: ${name}`,reason,actor.userId]);
  else await audit(db,`booking.${name}`,id,actor.userId,reason||`تغيير حالة الحجز: ${name}`);
  const user=(await db.query('SELECT "User_ID"::text AS id FROM sdc."PATIENT" WHERE "Patient_ID"=$1::bigint',[booking.patient_id])).rows[0];
  if(user&&user.id!==String(actor.userId))await note(db,user.id,name==='reject'?'رفض موعد':'تحديث موعد',name==='reject'?`تم رفض موعدك. السبب: ${reason}`:'تم تحديث حالة موعدك، افتح مواعيدي للمراجعة.',id);
  // Doctor receives one notice per successful booking transition performed
  // by a different account. Booking status checks above reject stale replays.
  const doctorUser=await db.query(`SELECT d."User_ID"::text AS id FROM sdc."DOCTOR" d WHERE d."Doctor_ID"=$1::bigint`,[booking.doctor_id]);
  if(doctorUser.rowCount&&doctorUser.rows[0]?.id&&doctorUser.rows[0].id!==String(actor.userId)){
   const doctorNotice={confirm:['تأكيد موعد','أكدت العيادة موعدًا من مواعيدك.'],reject:['رفض موعد','تم رفض موعد مرتبط بجدولك.'],cancel:['إلغاء موعد','أُلغي موعد من مواعيدك.'],move:['تغيير وقت موعد','عدّلت العيادة موعدًا من مواعيدك.'],request_change:['طلب تغيير موعد','ورد طلب تغيير على موعد من مواعيدك.'],approve_change:['اعتماد تغيير موعد','اعتمدت العيادة الوقت الجديد لموعد من مواعيدك.'],reject_change:['رفض تغيير موعد','رُفض طلب تغيير موعد من مواعيدك.']};
   await note(db,doctorUser.rows[0].id,...doctorNotice[name],id);
  }
  await require('../staff/event-notifications').emit(db,{clinicId:booking.clinic_id,actorId:actor.userId,type:'Booking',targetId:id,title:'تحديث موعد',body:'تم تحديث موعد في العيادة. افتح المواعيد لمراجعة حالته.'});
  return {status:'ok',id};
 });
}
// Hard delete is exceptionally permitted for an unused PENDING booking only.
// A confirmed booking is cancelled through the existing state machine; any
// clinical/financial links must remain historically queryable.
async function adminDeletePending(pool,{clinicId,bookingId,adminId,reason}){
 if(!num(clinicId)||!num(bookingId)||!num(adminId)||typeof reason!=='string'||reason.trim().length<8||reason.trim().length>1000)return {status:'invalid'};
 const db=await pool.connect();try{
  await db.query('BEGIN');await db.query("SELECT set_config('sdc.user_id',$1,true)",[adminId]);
  const auth=await db.query('SELECT sdc.sdc_is_superadmin($1::bigint) AS allowed',[adminId]);
  if(auth.rows[0]?.allowed!==true){await db.query('ROLLBACK');return {status:'forbidden'};}
  const found=await db.query(`SELECT "Booking_Status" AS status,"Arrived_At" AS arrived,"Settlement_ID" AS settlement,
   "Plan_ID" AS plan,"Recommendation_ID" AS recommendation,"Follow_Up_Of_Visit_ID" AS follow_up
   FROM sdc."BOOKING" WHERE "Booking_ID"=$1::bigint AND "Clinic_ID"=$2::bigint FOR UPDATE`,[bookingId,clinicId]);
  if(!found.rowCount){await db.query('ROLLBACK');return {status:'not_found'};}
  const b=found.rows[0];
  if(b.status!=='pending'||b.arrived||b.settlement||b.plan||b.recommendation||b.follow_up){await db.query('ROLLBACK');return {status:'in_use'};}
  const visit=await db.query('SELECT 1 FROM sdc."VISIT" WHERE "Booking_ID"=$1::bigint LIMIT 1',[bookingId]);
  if(visit.rowCount){await db.query('ROLLBACK');return {status:'in_use'};}
  await db.query('DELETE FROM sdc."BOOKING" WHERE "Booking_ID"=$1::bigint AND "Clinic_ID"=$2::bigint',[bookingId,clinicId]);
  await db.query(`INSERT INTO sdc."AUDIT_LOG"("Occurred_At","Action_Type","Target_Type","Target_Reference","Description","Reason","User_ID") VALUES(LOCALTIMESTAMP,'booking.admin.deleted_pending','Booking',$1,'حذف حجز معلّق غير مرتبط بسجل سريري أو مالي',$2,$3::bigint)`,[bookingId,reason.trim(),adminId]);
  await db.query('COMMIT');return {status:'ok'};
 }catch(e){await db.query('ROLLBACK').catch(()=>{});if(e.code==='23503'||e.code==='23514')return {status:'in_use'};throw e;}finally{db.release();}
}
module.exports={EXPIRED_REASON,expirePending,startExpiration,catalog,chosen,patientId,patientOptions,availability,availabilityReasons,slots,book,list,clinicList,detail,action,adminDeletePending,num,dateValid,future,hm,localNow,labels,VALID_TIME};
