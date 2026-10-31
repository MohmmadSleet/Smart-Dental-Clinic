'use strict';
// Clinic-local day and time, consistent with the appointment module.
const appointments=require('../appointments/service');
const patientNotices=require('../patient/workspace/event-notifications');
const num=appointments.num;
const today=()=>appointments.localNow();
async function tx(pool,fn){
 const db=await pool.connect();
 try {await db.query('BEGIN');const result=await fn(db);await db.query('COMMIT');return result;}
 catch(error){await db.query('ROLLBACK').catch(()=>{});throw error;}
 finally{db.release();}
}
async function daily(pool,clinicId,date=today().date){
 if(!num(clinicId)||!appointments.dateValid(date))return [];
 const result=await pool.query(`SELECT b."Booking_ID"::text AS id,
 to_char(b."Appointment_Date",'YYYY-MM-DD') AS date,
 to_char(b."Start_Time",'HH24:MI') AS time,
 b."Booking_Status" AS status,b."Request_Status" AS request_status,b."Arrived_At" IS NOT NULL AS arrived,
 to_char(b."Arrived_At",'HH24:MI') AS arrived_time,
 b."Doctor_ID"::text AS doctor_id,
 pu."First_Name"||' '||pu."Last_Name" AS patient_name,
 du."First_Name"||' '||du."Last_Name" AS doctor_name,
 s."Service_Name" AS service_name,
 v."Visit_ID"::text AS visit_id,v."Visit_Status" AS visit_status
 FROM sdc."BOOKING" b
 JOIN sdc."PATIENT" p ON p."Patient_ID"=b."Patient_ID"
 JOIN sdc."USER" pu ON pu."User_ID"=p."User_ID"
 JOIN sdc."DOCTOR" d ON d."Doctor_ID"=b."Doctor_ID"
 JOIN sdc."USER" du ON du."User_ID"=d."User_ID"
 JOIN sdc."SERVICE" s ON s."Service_ID"=b."Service_ID"
 LEFT JOIN sdc."VISIT" v ON v."Booking_ID"=b."Booking_ID"
 WHERE b."Clinic_ID"=$1::bigint AND b."Appointment_Date"=$2::date
 ORDER BY b."Start_Time",b."Booking_ID" LIMIT 500`,[clinicId,date]);
 return result.rows;
}
function counters(rows){return {
 arrived:rows.filter(r=>r.arrived).length,
 waiting:rows.filter(r=>r.arrived&&r.status==='confirmed').length,
 treating:rows.filter(r=>r.status==='in_progress').length,
 noShow:rows.filter(r=>r.status==='no_show').length
};}
async function clinicAction(pool,{clinicId,userId,bookingId,action}){
 if(!num(clinicId)||!num(userId)||!num(bookingId)||!['check_in','no_show'].includes(action))return {status:'invalid'};
 return tx(pool,async db=>{
  await db.query("SELECT set_config('sdc.user_id',$1::text,true)",[userId]);
  const {rows}=await db.query(`SELECT b."Booking_ID"::text AS id,b."Booking_Status" AS status,
   b."Arrived_At" AS arrived,b."Request_Status" AS request_status,to_char(b."Appointment_Date",'YYYY-MM-DD') AS date,
   to_char(b."Start_Time",'HH24:MI') AS time,b."Doctor_ID"::text AS doctor_id,
   d."User_ID"::text AS doctor_user,p."User_ID"::text AS patient_user,
   (SELECT EXISTS(SELECT 1 FROM sdc."VISIT" v WHERE v."Booking_ID"=b."Booking_ID")) AS has_visit
   FROM sdc."BOOKING" b
   JOIN sdc."DOCTOR" d USING ("Doctor_ID") JOIN sdc."PATIENT" p USING("Patient_ID")
   WHERE b."Booking_ID"=$1::bigint AND b."Clinic_ID"=$2::bigint FOR UPDATE OF b`,[bookingId,clinicId]);
  const b=rows[0];if(!b)return {status:'not_found'};
  if(action==='check_in'&&b.date!==today().date)return {status:'not_today'};
  if(b.status!=='confirmed'||b.request_status==='pending')return {status:'invalid_state'};
  if(action==='check_in'){
   if(b.arrived)return {status:'already_arrived'};
   await db.query(`UPDATE sdc."BOOKING" SET "Arrived_At"=(now() AT TIME ZONE 'Asia/Hebron') WHERE "Booking_ID"=$1::bigint`,[bookingId]);
  }else{
   if(b.arrived)return {status:'already_arrived'};
   if(b.has_visit)return {status:'invalid_state'};
   if(b.date>today().date||(b.date===today().date&&b.time>today().time))return {status:'too_early'};
   await db.query(`UPDATE sdc."BOOKING" SET "Booking_Status"='no_show' WHERE "Booking_ID"=$1::bigint`,[bookingId]);
  }
  const verb=action==='check_in'?'booking.patient_arrived':'booking.no_show';
  await db.query(`INSERT INTO sdc."AUDIT_LOG"("Occurred_At","Action_Type","Target_Type","Target_Reference","Description","User_ID")
   VALUES(LOCALTIMESTAMP,$1::varchar(150),'Booking',$2::varchar(512),$3::text,$4::bigint)`,
   [verb,bookingId,action==='check_in'?'تأكيد وصول المريض إلى العيادة':'تسجيل عدم حضور المريض',userId]);
  const notify=action==='check_in'?b.doctor_user:b.patient_user;
  if(String(notify)!==String(userId))await db.query(`INSERT INTO sdc."NOTIFICATION"("Title","Body","Notification_Type","Created_At","User_ID","Target_Type","Target_Reference")
    VALUES($1::varchar(150),$2::text,'booking',LOCALTIMESTAMP,$3::bigint,'Booking',$4::varchar(512))`,[
    action==='check_in'?'وصول المريض':'عدم حضور الموعد',action==='check_in'?'وصل مريض موعدك إلى العيادة ويمكنك بدء الزيارة من قائمة مواعيدك.':'تم تسجيل عدم حضورك للموعد المحدد.',notify,bookingId]);
  return {status:'ok',id:bookingId};
 });
}
async function visitContext(pool,clinicId,doctorId,bookingId){
 if(!num(clinicId)||!num(doctorId)||!num(bookingId))return null;
 const q=await pool.query(`SELECT b."Booking_ID"::text AS id,b."Booking_Status" AS status,
 to_char(b."Appointment_Date",'YYYY-MM-DD') AS date,to_char(b."Start_Time",'HH24:MI') AS time,
 b."Arrived_At" IS NOT NULL AS arrived,b."Patient_ID"::text AS patient_id,
 pu."First_Name"||' '||pu."Last_Name" AS patient_name,pu."Phone" AS phone,p."Health_Notes" AS health_notes,
 (SELECT string_agg(m."Current_Medications",'، ' ORDER BY m."Current_Medications") FROM sdc."PATIENT_CURRENT_MEDICATIONS" m WHERE m."Patient_ID"=p."Patient_ID") AS current_medications,
 (SELECT string_agg(a."Allergies",'، ' ORDER BY a."Allergies") FROM sdc."PATIENT_ALLERGIES" a WHERE a."Patient_ID"=p."Patient_ID") AS allergies,
 s."Service_Name" AS service_name,v."Visit_ID"::text AS visit_id,v."Visit_Status" AS visit_status,
 v."Chief_Complaint" AS chief_complaint,v."Examination_Notes" AS examination_notes
 FROM sdc."BOOKING" b JOIN sdc."PATIENT" p ON p."Patient_ID"=b."Patient_ID"
 JOIN sdc."USER" pu ON pu."User_ID"=p."User_ID" JOIN sdc."SERVICE" s ON s."Service_ID"=b."Service_ID"
 LEFT JOIN sdc."VISIT" v ON v."Booking_ID"=b."Booking_ID"
 WHERE b."Booking_ID"=$1::bigint AND b."Clinic_ID"=$2::bigint AND b."Doctor_ID"=$3::bigint`,[bookingId,clinicId,doctorId]);
 return q.rows[0]||null;
}
// Keep in sync with the clinical findings whitelist used by the visit tab.
const allowedFindings=new Set(['وجود تسوس','ألم عند الضغط','تورم','حركة في السن','نزف لثوي','حساسية حرارية']);
function cleanFindings(value){
 if(value===undefined)return null; // Older callers never implicitly erase findings.
 if(typeof value!=='string'||value.length>240)return false;
 const items=value?value.split('|'):[];
 if(items.length>allowedFindings.size||new Set(items).size!==items.length||items.some(x=>!allowedFindings.has(x)))return false;
 return items;
}
async function doctorAction(pool,{clinicId,doctorId,userId,bookingId,action,complaint,examination,findings}){
 if(!num(clinicId)||!num(doctorId)||!num(userId)||!num(bookingId)||!['start','save','complete'].includes(action))return {status:'invalid'};
 const chief=String(complaint||'').trim();const exam=String(examination||'').trim();
 const selected=cleanFindings(findings);
 if(selected===false||chief.length>150||exam.length>6000||action==='start'&&!chief)return {status:'invalid'};
 return tx(pool,async db=>{
  await db.query("SELECT set_config('sdc.user_id',$1::text,true)",[userId]);
  const q=await db.query(`SELECT b."Booking_Status" AS status,b."Arrived_At" IS NOT NULL AS arrived,
  to_char(b."Appointment_Date",'YYYY-MM-DD') AS date,v."Visit_ID"::text AS visit_id,
  v."Visit_Status" AS visit_status,v."Chief_Complaint" AS chief_complaint,
  v."Examination_Notes" AS examination_notes
  FROM sdc."BOOKING" b LEFT JOIN sdc."VISIT" v ON v."Booking_ID"=b."Booking_ID"
  WHERE b."Booking_ID"=$1::bigint AND b."Clinic_ID"=$2::bigint AND b."Doctor_ID"=$3::bigint FOR UPDATE OF b`,
  [bookingId,clinicId,doctorId]);
  const b=q.rows[0];if(!b)return {status:'not_found'};
  if(action==='start'){
   if(b.status==='in_progress'&&b.visit_id)return {status:'ok',id:bookingId}; // safe retry; no duplicate
   if(b.date!==today().date||b.status!=='confirmed'||b.visit_id)return {status:'invalid_state',reason:b.date!==today().date?'wrong_day':'booking_state'};
   if(!b.arrived)return {status:'invalid_state',reason:'arrival_required'};
   await db.query(`UPDATE sdc."BOOKING" SET "Booking_Status"='in_progress' WHERE "Booking_ID"=$1::bigint`,[bookingId]);
   // The actual clinical start is distinct from the reserved appointment start.
   // Clock is clinic-local, matching existing TIMESTAMP WITHOUT TIME ZONE columns.
   const started=await db.query(`INSERT INTO sdc."VISIT"("Chief_Complaint","Examination_Notes","Visit_Status","Booking_ID","Actual_Started_At")
     VALUES($1::varchar(150),NULLIF($3::text,''),'in_progress',$2::bigint,(now() AT TIME ZONE 'Asia/Hebron')) RETURNING "Visit_ID"::text AS id`,[chief,bookingId,exam]);
   b.visit_id=started.rows[0].id;
  }else{
   if(!b.visit_id||b.status!=='in_progress'||b.visit_status!=='in_progress')return {status:'invalid_state'};
   if(action==='complete'&&(!chief&&!b.chief_complaint||!exam&&!b.examination_notes))return {status:'incomplete'};
   if(action==='save'&&!chief&&!exam)return {status:'invalid'};
   await db.query(`UPDATE sdc."VISIT" SET "Chief_Complaint"=COALESCE(NULLIF($2::varchar(150),''),"Chief_Complaint"),
     "Examination_Notes"=COALESCE(NULLIF($3::text,''),"Examination_Notes"),
     "Visit_Status"=$4::varchar(150),
     "Actual_Completed_At"=CASE WHEN $4::varchar(150)='completed' THEN (now() AT TIME ZONE 'Asia/Hebron') ELSE "Actual_Completed_At" END
     WHERE "Visit_ID"=$1::bigint`,[b.visit_id,chief,exam,action==='complete'?'completed':'in_progress']);
   if(action==='complete'){
    await db.query(`UPDATE sdc."BOOKING" SET "Booking_Status"='completed' WHERE "Booking_ID"=$1::bigint`,[bookingId]);
    const pat=await db.query(`SELECT p."User_ID"::text user_id FROM sdc."BOOKING" bk JOIN sdc."PATIENT" p ON p."Patient_ID"=bk."Patient_ID" WHERE bk."Booking_ID"=$1::bigint`,[bookingId]);
    if(pat.rowCount)await patientNotices.emit(db,{userId:pat.rows[0].user_id,type:'patient.visit.completed',
     title:'اكتملت زيارتك',body:'اكتملت زيارتك ويمكنك الاطلاع على تفاصيلها في سجلك الطبي.',targetType:'Visit',targetId:b.visit_id});
   }
  }
  // All three main visit actions persist the selected findings together with
  // the notes. A failed checklist write rolls back the whole visit transition.
  if(selected!==null){
   await db.query(`DELETE FROM sdc."VISIT_CLINICAL_FINDINGS" WHERE "Visit_ID"=$1::bigint`,[b.visit_id]);
   for(const finding of selected)await db.query(`INSERT INTO sdc."VISIT_CLINICAL_FINDINGS"("Clinical_Findings","Visit_ID") VALUES($1,$2::bigint)`,[finding,b.visit_id]);
  }
  await db.query(`INSERT INTO sdc."AUDIT_LOG"("Occurred_At","Action_Type","Target_Type","Target_Reference","Description","User_ID")
   VALUES((now() AT TIME ZONE 'Asia/Hebron'),$1::varchar(150),'Booking',$2::varchar(512),$3::text,$4::bigint)`,
   [`visit.${action}`,bookingId,action==='start'?'بدء الزيارة الفعلية':action==='complete'?'إنهاء الزيارة مع حفظ الشكوى والفحص':'حفظ ملاحظات الزيارة',userId]);
  return {status:'ok',id:bookingId};
 });
}
module.exports={daily,counters,clinicAction,visitContext,doctorAction};
