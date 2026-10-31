'use strict';
// Invite an already verified doctor to an approved clinic. A doctor must accept before
// receiving clinic access. No data is taken from read-only contact fields in the UI.
const ID=/^[1-9]\d{0,17}$/;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const validId=x=>ID.test(String(x||''));
function validDate(x){if(typeof x!=='string'||!DATE.test(x))return false;const t=new Date(x+'T12:00:00Z');return !Number.isNaN(t.getTime())&&t.toISOString().slice(0,10)===x;}
function inviteFields(raw){
 const doctorId=String(raw?.doctor_id||''),startDate=String(raw?.clinic_doctor_start_date||''),notes=String(raw?.clinic_doctor_notes||'').trim();
 if(!validId(doctorId)||!validDate(startDate)||notes.length>2000)return null;
 return {doctorId,startDate,notes};
}
async function candidates(pool,clinic){
 const rs=await pool.query(`SELECT d."Doctor_ID"::text AS id,u."First_Name"||' '||u."Last_Name" AS name,
 d."License_Number" AS license,u."Email" AS email,u."Phone" AS phone,
 COALESCE((SELECT string_agg(DISTINCT s."Name_AR",'، ') FROM sdc."HAS_SPECIALTY" h JOIN sdc."SPECIALTY" s ON s."Specialty_ID"=h."Specialty_ID" WHERE h."Doctor_ID"=d."Doctor_ID" AND s."Is_Active"=true),'طب الأسنان') AS specialties
 FROM sdc."DOCTOR" d JOIN sdc."USER" u ON u."User_ID"=d."User_ID"
 WHERE d."License_Status"='verified' AND u."Account_Status"='active' AND u."Login_Enabled"=true
 AND NOT EXISTS(SELECT 1 FROM sdc."WORKS_AT" w WHERE w."Clinic_ID"=$1::bigint AND w."Doctor_ID"=d."Doctor_ID" AND w."Membership_Status" IN ('pending','active','suspended'))
 ORDER BY u."First_Name",u."Last_Name",d."Doctor_ID" LIMIT 200`,[clinic]);
 return rs.rows;
}
async function others(pool,clinic){
 const rs=await pool.query(`SELECT w."Doctor_ID"::text AS id,w."Membership_Status" AS status,
 u."First_Name"||' '||u."Last_Name" AS name,w."Start_Date"::text AS start_date,
 w."Admin_Notes" AS notes,c."Manager_Doctor_ID"=w."Doctor_ID" AS manager
 FROM sdc."WORKS_AT" w JOIN sdc."DOCTOR" d ON d."Doctor_ID"=w."Doctor_ID"
 JOIN sdc."USER" u ON u."User_ID"=d."User_ID" JOIN sdc."CLINIC" c ON c."Clinic_ID"=w."Clinic_ID"
 WHERE w."Clinic_ID"=$1::bigint AND w."Membership_Status" IN ('pending','suspended')
 ORDER BY w."Start_Date" DESC,u."First_Name"`,[clinic]);
 return rs.rows;
}
async function invites(pool,doctor){
 if(!validId(doctor))return [];
 const rs=await pool.query(`SELECT c."Clinic_ID"::text AS id,c."Clinic_Name" AS name,
 to_char(w."Start_Date",'YYYY-MM-DD') AS start_date,w."Admin_Notes" AS notes
 FROM sdc."WORKS_AT" w JOIN sdc."CLINIC" c ON c."Clinic_ID"=w."Clinic_ID"
 WHERE w."Doctor_ID"=$1::bigint AND w."Membership_Status"='pending' AND c."Clinic_Status"='active' AND c."Approval_Status"='approved'
 ORDER BY w."Start_Date",c."Clinic_Name"`,[doctor]);return rs.rows;
}
async function invitation(pool,clinic,doctor,user,raw,options={}){
 const adminOverride=options.adminOverride===true;
 const reason=String(options.reason||'').trim();
 if(adminOverride&&(reason.length<8||reason.length>1000))return {status:'invalid'};
 if(!validId(clinic)||!validId(user))return {status:'forbidden'};
 const parsed=inviteFields(raw);if(!parsed)return {status:'invalid'};
 const db=await pool.connect();try{
  await db.query('BEGIN');await db.query("SELECT set_config('sdc.user_id',$1,true)",[user]);
  if(adminOverride){const a=await db.query('SELECT sdc.sdc_is_superadmin($1::bigint) AS allowed',[user]);if(a.rows[0]?.allowed!==true){await db.query('ROLLBACK');return {status:'forbidden'};}}
  const c=await db.query(`SELECT "Clinic_ID" FROM sdc."CLINIC" WHERE "Clinic_ID"=$1::bigint AND "Approval_Status"='approved' AND "Clinic_Status"='active' AND ($3::boolean OR "Manager_Doctor_ID"=$2::bigint) FOR UPDATE`,[clinic,doctor,adminOverride]);
  if(!c.rowCount){await db.query('ROLLBACK');return {status:'forbidden'};}
  // Lock doctor before membership updates, matching booking/scheduling coordination.
  const d=await db.query(`SELECT d."Doctor_ID",d."User_ID" FROM sdc."DOCTOR" d JOIN sdc."USER" u ON u."User_ID"=d."User_ID" WHERE d."Doctor_ID"=$1::bigint AND d."License_Status"='verified' AND u."Account_Status"='active' AND u."Login_Enabled"=true FOR UPDATE OF d`,[parsed.doctorId]);
  if(!d.rowCount){await db.query('ROLLBACK');return {status:'unavailable'};}
  const old=await db.query(`SELECT "Membership_Status" AS status FROM sdc."WORKS_AT" WHERE "Clinic_ID"=$1::bigint AND "Doctor_ID"=$2::bigint FOR UPDATE`,[clinic,parsed.doctorId]);
  if(old.rowCount && old.rows[0].status!=='inactive'){await db.query('ROLLBACK');return {status:'already'};}
  if(old.rowCount)await db.query(`UPDATE sdc."WORKS_AT" SET "Membership_Status"='pending',"Start_Date"=$3::date,"Admin_Notes"=$4::text WHERE "Clinic_ID"=$1::bigint AND "Doctor_ID"=$2::bigint`,[clinic,parsed.doctorId,parsed.startDate,parsed.notes||null]);
  else await db.query(`INSERT INTO sdc."WORKS_AT"("Start_Date","Membership_Status","Admin_Notes","Clinic_ID","Doctor_ID") VALUES($1::date,'pending',$2::text,$3::bigint,$4::bigint)`,[parsed.startDate,parsed.notes||null,clinic,parsed.doctorId]);
  await db.query(`INSERT INTO sdc."NOTIFICATION"("Title","Body","Notification_Type","Created_At","Target_Type","Target_Reference","User_ID") VALUES('دعوة للانضمام إلى عيادة','لديك طلب انضمام إلى عيادة. افتح ملفك الشخصي لقبوله أو رفضه.','doctor.clinic.invitation',LOCALTIMESTAMP,'Clinic',$1::varchar(512),$2::bigint)`,[clinic,d.rows[0].User_ID]);
  if(!adminOverride)await db.query(`INSERT INTO sdc."AUDIT_LOG"("Occurred_At","Action_Type","Target_Type","Target_Reference","Description","User_ID") VALUES(LOCALTIMESTAMP,'doctor.clinic.invite','Doctor',$1::varchar(512),'إرسال دعوة لطبيب معتمد إلى العيادة',$2::bigint)`,[parsed.doctorId,user]);
  if(adminOverride)await db.query(`INSERT INTO sdc."AUDIT_LOG"("Occurred_At","Action_Type","Target_Type","Target_Reference","Description","Reason","User_ID") VALUES(LOCALTIMESTAMP,'admin.clinic.doctor.invite','Doctor',$1,$2,$3,$4::bigint)`,[`${clinic}:${parsed.doctorId}`,'دعوة طبيب إلى العيادة بواسطة المشرف العام',reason,user]);
  await db.query('COMMIT');return {status:'ok'};
 }catch(e){await db.query('ROLLBACK').catch(()=>{});if(e.code==='23505')return {status:'already'};throw e;}finally{db.release();}
}
async function decide(pool,doctor,user,clinic,action){
 if(!validId(doctor)||!validId(user)||!validId(clinic)||!['accept','decline'].includes(action))return {status:'invalid'};
 const db=await pool.connect();try{
  await db.query('BEGIN');await db.query("SELECT set_config('sdc.user_id',$1,true)",[user]);
  await db.query(`SELECT "Doctor_ID" FROM sdc."DOCTOR" WHERE "Doctor_ID"=$1::bigint FOR UPDATE`,[doctor]);
  const rs=await db.query(`SELECT w."Membership_Status" AS status,w."Admin_Notes" AS notes,c."Manager_Doctor_ID",c."Clinic_Status",c."Approval_Status" FROM sdc."WORKS_AT" w JOIN sdc."CLINIC" c ON c."Clinic_ID"=w."Clinic_ID" WHERE w."Clinic_ID"=$1::bigint AND w."Doctor_ID"=$2::bigint FOR UPDATE OF w`,[clinic,doctor]);
  const r=rs.rows[0];if(!r||r.status!=='pending'||r.Clinic_Status!=='active'||r.Approval_Status!=='approved'){await db.query('ROLLBACK');return {status:'unavailable'};}
  // The original doctor profile can also accept invitations. Never allow that
  // existing endpoint to bypass a platform suspension of an employment posting.
  const employment=/^تم قبول طلب التوظيف JA-([1-9]\d{0,17})$/.exec(String(r.notes||''));
  if(employment){
   const approved=await db.query(`SELECT j."Job_ID" FROM sdc."APPLIES_FOR" a JOIN sdc."JOB" j ON j."Job_ID"=a."Job_ID" WHERE a."Application_ID"=$1::bigint AND a."Doctor_ID"=$2::bigint AND j."Clinic_ID"=$3::bigint AND a."Application_Status"='accepted' AND j."Admin_Suspended_At" IS NULL FOR UPDATE OF j`,[employment[1],doctor,clinic]);
   if(!approved.rowCount){await db.query('ROLLBACK');return {status:'unavailable'};}
  }
  await db.query(`UPDATE sdc."WORKS_AT" SET "Membership_Status"=$3::varchar(150) WHERE "Clinic_ID"=$1::bigint AND "Doctor_ID"=$2::bigint`,[clinic,doctor,action==='accept'?'active':'inactive']);
  const manager=await db.query(`SELECT "User_ID" FROM sdc."DOCTOR" WHERE "Doctor_ID"=$1::bigint`,[r.Manager_Doctor_ID]);
  if(manager.rowCount)await db.query(`INSERT INTO sdc."NOTIFICATION"("Title","Body","Notification_Type","Created_At","Target_Type","Target_Reference","User_ID") VALUES($1::varchar(150),$2::text,'clinic.doctor.invitation.response',LOCALTIMESTAMP,'Clinic',$3::varchar(512),$4::bigint)`,[action==='accept'?'وافق الطبيب على الانضمام':'اعتذر الطبيب عن الانضمام',action==='accept'?'تم تفعيل عضوية الطبيب في العيادة.':'تم رفض دعوة الانضمام إلى العيادة.',clinic,manager.rows[0].User_ID]);
  await db.query(`INSERT INTO sdc."AUDIT_LOG"("Occurred_At","Action_Type","Target_Type","Target_Reference","Description","User_ID") VALUES(LOCALTIMESTAMP,$1::varchar(150),'Clinic',$2::varchar(512),'قرار الطبيب بشأن دعوة الانضمام',$3::bigint)`,[`doctor.clinic.${action}`,clinic,user]);
  await db.query('COMMIT');return {status:'ok'};
 }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}finally{db.release();}
}
async function manage(pool,clinic,managerDoctor,user,doctor,action,options={}){
 const adminOverride=options.adminOverride===true;
 const reason=String(options.reason||'').trim();
 if(adminOverride&&(reason.length<8||reason.length>1000))return {status:'invalid'};
 if(!validId(clinic)||!validId(managerDoctor)||!validId(user)||!validId(doctor)||!['cancel','suspend','resume','remove'].includes(action))return {status:'invalid'};
 if(String(doctor)===String(managerDoctor))return {status:'forbidden'};
 if(action==='remove'&&!adminOverride)return {status:'forbidden'};
 const db=await pool.connect();try{
  await db.query('BEGIN');await db.query("SELECT set_config('sdc.user_id',$1,true)",[user]);
  if(adminOverride){const a=await db.query('SELECT sdc.sdc_is_superadmin($1::bigint) AS allowed',[user]);if(a.rows[0]?.allowed!==true){await db.query('ROLLBACK');return {status:'forbidden'};}}
  const c=await db.query(`SELECT 1 FROM sdc."CLINIC" WHERE "Clinic_ID"=$1::bigint AND ($3::boolean OR "Manager_Doctor_ID"=$2::bigint) AND "Approval_Status"='approved' AND "Clinic_Status"='active' FOR UPDATE`,[clinic,managerDoctor,adminOverride]);
  if(!c.rowCount){await db.query('ROLLBACK');return {status:'forbidden'};}
  await db.query(`SELECT "Doctor_ID" FROM sdc."DOCTOR" WHERE "Doctor_ID"=$1::bigint FOR UPDATE`,[doctor]);
  const current=await db.query(`SELECT "Membership_Status" AS status FROM sdc."WORKS_AT" WHERE "Clinic_ID"=$1::bigint AND "Doctor_ID"=$2::bigint FOR UPDATE`,[clinic,doctor]);
  const expected=action==='cancel'?'pending':action==='suspend'?'active':'suspended';
  if(action==='remove'? !['pending','suspended','active'].includes(current.rows[0]?.status) : current.rows[0]?.status!==expected){await db.query('ROLLBACK');return {status:'stale'};}
  if(action==='suspend'){
   const conflict=await db.query(`SELECT 1 FROM sdc."BOOKING" WHERE "Clinic_ID"=$1::bigint AND "Doctor_ID"=$2::bigint AND ("Booking_Status"='in_progress' OR ("Booking_Status" IN ('pending','confirmed') AND "Appointment_Date">=CURRENT_DATE)) LIMIT 1`,[clinic,doctor]);
   if(conflict.rowCount){await db.query('ROLLBACK');return {status:'bookings'};}
  }
  if(action==='remove'){
   const used=await db.query(`SELECT 1 FROM sdc."BOOKING" WHERE "Clinic_ID"=$1::bigint AND "Doctor_ID"=$2::bigint LIMIT 1`,[clinic,doctor]);
   if(used.rowCount){await db.query('ROLLBACK');return {status:'in_use'};}
   // Other FKs (doctor schedule, assigned services etc.) may still protect this link.
   await db.query(`DELETE FROM sdc."WORKS_AT" WHERE "Clinic_ID"=$1::bigint AND "Doctor_ID"=$2::bigint`,[clinic,doctor]);
  }
  const next=action==='remove'?'inactive':action==='cancel'?'inactive':action==='suspend'?'suspended':'active';
  if(action!=='remove')await db.query(`UPDATE sdc."WORKS_AT" SET "Membership_Status"=$3::varchar(150) WHERE "Clinic_ID"=$1::bigint AND "Doctor_ID"=$2::bigint`,[clinic,doctor,next]);
  const target=await db.query(`SELECT "User_ID" FROM sdc."DOCTOR" WHERE "Doctor_ID"=$1::bigint`,[doctor]);
  if(target.rowCount)await db.query(`INSERT INTO sdc."NOTIFICATION"("Title","Body","Notification_Type","Created_At","Target_Type","Target_Reference","User_ID") VALUES('تحديث عضوية العيادة',$1::text,'doctor.clinic.membership',LOCALTIMESTAMP,'Clinic',$2::varchar(512),$3::bigint)`,[next==='active'?'تمت إعادة تفعيل عضويتك.':next==='suspended'?'تم تعليق عضويتك.':action==='remove'?'تم إنهاء ارتباطك بهذه العيادة.':'تم إلغاء دعوة الانضمام.',clinic,target.rows[0].User_ID]);
  if(!adminOverride)await db.query(`INSERT INTO sdc."AUDIT_LOG"("Occurred_At","Action_Type","Target_Type","Target_Reference","Description","User_ID") VALUES(LOCALTIMESTAMP,$1::varchar(150),'Doctor',$2::varchar(512),'تحديث عضوية الطبيب في العيادة',$3::bigint)`,[`doctor.clinic.${action}`,doctor,user]);
  if(adminOverride)await db.query(`INSERT INTO sdc."AUDIT_LOG"("Occurred_At","Action_Type","Target_Type","Target_Reference","Description","Reason","User_ID") VALUES(LOCALTIMESTAMP,$1,'Doctor',$2,$3,$4,$5::bigint)`,[`admin.clinic.doctor.${action}`,`${clinic}:${doctor}`,'تدخل إداري في عضوية الطبيب داخل العيادة',reason,user]);
  await db.query('COMMIT');return {status:'ok'};
 }catch(e){await db.query('ROLLBACK').catch(()=>{});if(adminOverride&&e.code==='23503')return {status:'in_use'};throw e;}finally{db.release();}
}
module.exports={validDate,inviteFields,candidates,others,invites,invitation,decide,manage};
