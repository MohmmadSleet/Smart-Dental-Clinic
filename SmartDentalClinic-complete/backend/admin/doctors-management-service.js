'use strict';
// v27.14: platform administrator's real doctor read models + guarded account actions.
const ID=/^[1-9]\d{0,17}$/;
const validId=v=>typeof v==='string'&&ID.test(v);
const reasonText=v=>typeof v==='string'&&v.trim().length>=8&&v.trim().length<=1000?v.trim():null;
const LICENSE=/^[\p{L}\p{N}][\p{L}\p{N}./_ -]{2,149}$/u;
const validLicense=v=>typeof v==='string'&&LICENSE.test(v.trim());

async function list(pool){
 const r=await pool.query(`SELECT d."Doctor_ID"::text AS "Doctor_ID", d."License_Number",d."License_Status",
    u."First_Name",u."Last_Name",u."Account_Status",u."Login_Enabled",
    COALESCE((SELECT string_agg(s."Name_AR",'، ' ORDER BY s."Name_AR") FROM sdc."HAS_SPECIALTY" hs JOIN sdc."SPECIALTY" s USING("Specialty_ID") WHERE hs."Doctor_ID"=d."Doctor_ID"),'') AS specialties,
    COALESCE((SELECT string_agg(c."Clinic_Name",'، ' ORDER BY c."Clinic_Name") FROM sdc."WORKS_AT" w JOIN sdc."CLINIC" c USING("Clinic_ID") WHERE w."Doctor_ID"=d."Doctor_ID" AND w."Membership_Status"='active'),'') AS clinics
   FROM sdc."DOCTOR" d JOIN sdc."USER" u USING("User_ID")
   ORDER BY CASE d."License_Status" WHEN 'pending' THEN 0 WHEN 'rejected' THEN 1 ELSE 2 END,d."Doctor_ID" DESC LIMIT 1000`);
 return r.rows;
}
async function jobs(pool){
 const r=await pool.query(`SELECT j."Job_ID"::text id,j."Job_Title" title,j."Job_Status" status,c."Clinic_Name" clinic,c."City" city,
 (SELECT count(*)::int FROM sdc."APPLIES_FOR" a WHERE a."Job_ID"=j."Job_ID") applicants
 FROM sdc."JOB" j JOIN sdc."CLINIC" c USING("Clinic_ID") ORDER BY j."Job_ID" DESC LIMIT 200`);
 return r.rows;
}
async function detail(pool,id){
 if(!validId(id))return null;
 const r=await pool.query(`SELECT d."Doctor_ID"::text id,d."User_ID"::text user_id,d."License_Number" license,d."License_Status" license_status,
 d."License_Review_Notes" review_notes,d."License_Submission_Note" submission_note,d."License_Reviewed_By_User_ID"::text reviewer,
 d."Years_Of_Experience" experience,d."Bio" bio,u."First_Name" first_name,u."Last_Name" last_name,u."Email" email,
 u."Phone" phone,u."Account_Status" account_status,u."Login_Enabled" login_enabled
 FROM sdc."DOCTOR" d JOIN sdc."USER" u USING("User_ID") WHERE d."Doctor_ID"=$1::bigint`,[id]);
 if(!r.rowCount)return null;
 const [specialties,allSpecialties,clinics,bookings,applications,schedules,absences]=await Promise.all([
  pool.query(`SELECT s."Specialty_ID"::text id,s."Name_AR" name FROM sdc."HAS_SPECIALTY" h JOIN sdc."SPECIALTY" s USING("Specialty_ID") WHERE h."Doctor_ID"=$1::bigint ORDER BY s."Name_AR"`,[id]),
  pool.query(`SELECT "Specialty_ID"::text id,"Name_AR" name FROM sdc."SPECIALTY" WHERE "Is_Active"=true ORDER BY "Name_AR"`),
  pool.query(`SELECT c."Clinic_ID"::text id,c."Clinic_Name" name,w."Membership_Status" status,w."Start_Date"::text start_date,
    (c."Manager_Doctor_ID"=$1::bigint) manager FROM sdc."WORKS_AT" w JOIN sdc."CLINIC" c USING("Clinic_ID")
    WHERE w."Doctor_ID"=$1::bigint ORDER BY c."Clinic_Name"`,[id]),
  pool.query(`SELECT b."Booking_ID"::text id,b."Appointment_Date"::text date,to_char(b."Start_Time",'HH24:MI') start_time,
    b."Booking_Status" status,s."Service_Name" service,c."Clinic_Name" clinic,
    concat_ws(' ',pu."First_Name",pu."Last_Name") patient
    FROM sdc."BOOKING" b JOIN sdc."PATIENT" p USING("Patient_ID") JOIN sdc."USER" pu ON pu."User_ID"=p."User_ID"
    JOIN sdc."SERVICE" s USING("Service_ID") JOIN sdc."CLINIC" c USING("Clinic_ID")
    WHERE b."Doctor_ID"=$1::bigint ORDER BY b."Appointment_Date" DESC,b."Booking_ID" DESC LIMIT 150`,[id]),
  pool.query(`SELECT a."Application_ID"::text id,a."Application_Status" status,j."Job_Title" title,
    c."Clinic_Name" clinic FROM sdc."APPLIES_FOR" a JOIN sdc."JOB" j USING("Job_ID") JOIN sdc."CLINIC" c ON c."Clinic_ID"=j."Clinic_ID"
    WHERE a."Doctor_ID"=$1::bigint ORDER BY a."Application_ID" DESC LIMIT 100`,[id]),
  pool.query(`SELECT h."Day_Of_Week" AS "day",to_char(h."Start_Time",'HH24:MI') starts,to_char(h."End_Time",'HH24:MI') ends,
    h."Is_Active" active,c."Clinic_Name" clinic FROM sdc."DOCTOR_WORKING_HOURS" h
    JOIN sdc."CLINIC" c USING("Clinic_ID") WHERE h."Doctor_ID"=$1::bigint ORDER BY c."Clinic_Name",h."Day_Of_Week",h."Start_Time"`,[id]),
  pool.query(`SELECT a."Absence_ID"::text id,a."From_Date"::text starts,a."To_Date"::text ends,a."Reason" reason,
    c."Clinic_Name" clinic FROM sdc."DOCTOR_ABSENCES" a JOIN sdc."CLINIC" c USING("Clinic_ID")
    WHERE a."Doctor_ID"=$1::bigint ORDER BY a."From_Date" DESC LIMIT 100`,[id])
 ]);
 return {doctor:r.rows[0],specialties:specialties.rows,allSpecialties:allSpecialties.rows,clinics:clinics.rows,
  bookings:bookings.rows,applications:applications.rows,schedules:schedules.rows,absences:absences.rows};
}
const conflictSQL=`SELECT 1 FROM sdc."BOOKING" WHERE "Doctor_ID"=$1::bigint AND
 ("Booking_Status"='in_progress' OR ("Booking_Status" IN ('pending','confirmed') AND "Appointment_Date">=(now() AT TIME ZONE 'Asia/Hebron')::date)) LIMIT 1`;
const managedSQL=`SELECT 1 FROM sdc."CLINIC" WHERE "Manager_Doctor_ID"=$1::bigint AND "Approval_Status"='approved' AND "Clinic_Status"='active' LIMIT 1`;
async function mutate(pool,{doctorId,adminId,action,body}){
 if(!validId(String(doctorId))||!['suspend','resume','edit'].includes(action))return {status:'invalid'};
 if(!validId(String(adminId)))return {status:'unauthorized'};
 const reason=reasonText(body?.reason);
 if(!reason)return {status:'invalid'};
 const license=action==='edit'&&typeof body?.license_number==='string'?body.license_number.trim():null;
 const specialty=action==='edit'?String(body?.specialty_id||''):'';
 if(action==='edit'&&(!validLicense(license)||(specialty!==''&&!validId(specialty))))return {status:'invalid'};
 const db=await pool.connect();let revoke=null;
 try{
  await db.query('BEGIN');
  await db.query("SELECT set_config('sdc.user_id',$1,true)",[String(adminId)]);
  const permit=await db.query('SELECT sdc.sdc_is_superadmin($1::bigint) AS allowed',[adminId]);
  if(permit.rows[0]?.allowed!==true){await db.query('ROLLBACK');return {status:'unauthorized'};}
  const found=await db.query(`SELECT d."Doctor_ID",d."User_ID"::text user_id,d."License_Number" license,d."License_Status" license_status,
   u."Account_Status" account_status,u."Login_Enabled" login_enabled
   FROM sdc."DOCTOR" d JOIN sdc."USER" u USING("User_ID") WHERE d."Doctor_ID"=$1::bigint FOR UPDATE OF d,u`,[doctorId]);
  if(!found.rowCount){await db.query('ROLLBACK');return {status:'not_found'};}
  const d=found.rows[0];let event='',description='';
  if(action==='suspend'){
   if(d.account_status!=='active'||d.license_status!=='verified'){await db.query('ROLLBACK');return {status:'unchanged'};}
   if((await db.query(managedSQL,[doctorId])).rowCount){await db.query('ROLLBACK');return {status:'manager'};}
   if((await db.query(conflictSQL,[doctorId])).rowCount){await db.query('ROLLBACK');return {status:'bookings'};}
   await db.query(`UPDATE sdc."USER" SET "Account_Status"='suspended',"Login_Enabled"=false WHERE "User_ID"=$1::bigint`,[d.user_id]);
   revoke=d.user_id;event='doctor.account.suspended';description='تعليق حساب الطبيب بعد التحقق من عدم وجود حجوزات أو عيادات يديرها';
  }else if(action==='resume'){
   if(d.account_status!=='suspended'||d.license_status!=='verified'){await db.query('ROLLBACK');return {status:'unchanged'};}
   await db.query(`UPDATE sdc."USER" SET "Account_Status"='active',"Login_Enabled"=true WHERE "User_ID"=$1::bigint`,[d.user_id]);
   event='doctor.account.resumed';description='إعادة تفعيل حساب طبيب موثق';
  }else{
   const changed=license!==d.license;
   if(changed){
    if((await db.query(`SELECT 1 FROM sdc."DOCTOR" WHERE lower(btrim("License_Number"))=lower($1) AND "Doctor_ID"<>$2::bigint LIMIT 1`,[license,doctorId])).rowCount){await db.query('ROLLBACK');return {status:'duplicate'};}
    if((await db.query(managedSQL,[doctorId])).rowCount){await db.query('ROLLBACK');return {status:'manager'};}
    if((await db.query(conflictSQL,[doctorId])).rowCount){await db.query('ROLLBACK');return {status:'bookings'};}
    await db.query(`UPDATE sdc."DOCTOR" SET "License_Number"=$2,"License_Status"='pending',
     "License_Reviewed_By_User_ID"=NULL,"License_Review_Notes"=NULL WHERE "Doctor_ID"=$1::bigint`,[doctorId,license]);
    await db.query(`UPDATE sdc."USER" SET "Account_Status"='pending',"Login_Enabled"=false WHERE "User_ID"=$1::bigint`,[d.user_id]);
    revoke=d.user_id;
   }
   if(specialty){
    const allowed=await db.query(`SELECT 1 FROM sdc."SPECIALTY" WHERE "Specialty_ID"=$1::bigint AND "Is_Active"=true`,[specialty]);
    if(!allowed.rowCount){await db.query('ROLLBACK');return {status:'invalid'};}
    const inserted=await db.query(`INSERT INTO sdc."HAS_SPECIALTY"("Doctor_ID","Specialty_ID") VALUES($1::bigint,$2::bigint) ON CONFLICT DO NOTHING RETURNING "Specialty_ID"`,[doctorId,specialty]);
    if(!inserted.rowCount&&!changed){await db.query('ROLLBACK');return {status:'unchanged'};}
   }
   if(!changed&&!specialty){await db.query('ROLLBACK');return {status:'unchanged'};}
   event=changed?'doctor.license.resubmitted':'doctor.specialty.added';
   description=changed?'تعديل رقم الترخيص وإعادة فتح مراجعة الترخيص مع تعطيل الدخول لحين الاعتماد':'إضافة تخصص للطبيب';
  }
  if(revoke)await db.query(`UPDATE sdc."USER_SESSIONS" SET "Revoked_At"=GREATEST("Started_At",LOCALTIMESTAMP)
   WHERE "User_ID"=$1::bigint AND "Revoked_At" IS NULL`,[revoke]);
  await db.query(`INSERT INTO sdc."AUDIT_LOG"("Occurred_At","Action_Type","Target_Type","Target_Reference","Description","Reason","User_ID")
   VALUES(LOCALTIMESTAMP,$1,'Doctor',$2,$3,$4,$5)`,[event,doctorId,description,reason,adminId]);
  await db.query('COMMIT');
  if(revoke)require('../auth/session').revokeUserSessions(revoke);
  return {status:'ok',action};
 }catch(error){await db.query('ROLLBACK').catch(()=>{});throw error;}finally{db.release();}
}

// Platform correction of a doctor's account contact data. Kept separate from license validation.
async function mutateProfile(pool,{doctorId,adminId,body={}}){
 if(!validId(String(doctorId))||!validId(String(adminId)))return {status:'invalid'};
 const reason=reasonText(body.reason);
 const first=typeof body.first_name==='string'?body.first_name.trim().replace(/\s+/g,' '):'';
 const last=typeof body.last_name==='string'?body.last_name.trim().replace(/\s+/g,' '):'';
 const phone=typeof body.phone==='string'?body.phone.trim():'';
 if(!reason||!first||!last||!phone||first.length>150||last.length>150||phone.length>30||/[\u0000-\u001f]/.test(first+last+phone))return {status:'invalid'};
 const db=await pool.connect();
 try{
  await db.query('BEGIN');
  await db.query("SELECT set_config('sdc.user_id',$1,true)",[String(adminId)]);
  const permit=await db.query('SELECT sdc.sdc_is_superadmin($1::bigint) AS allowed',[adminId]);
  if(permit.rows[0]?.allowed!==true){await db.query('ROLLBACK');return {status:'unauthorized'};}
  const rs=await db.query(`SELECT u."User_ID",u."First_Name" first_name,u."Last_Name" last_name,u."Phone" phone
   FROM sdc."DOCTOR" d JOIN sdc."USER" u USING("User_ID") WHERE d."Doctor_ID"=$1::bigint FOR UPDATE OF d,u`,[doctorId]);
  if(!rs.rowCount){await db.query('ROLLBACK');return {status:'not_found'};}
  const old=rs.rows[0];
  if(old.first_name===first&&old.last_name===last&&old.phone===phone){await db.query('ROLLBACK');return {status:'unchanged'};}
  await db.query(`UPDATE sdc."USER" SET "First_Name"=$2,"Last_Name"=$3,"Phone"=$4 WHERE "User_ID"=$1::bigint`,[String(old.User_ID),first,last,phone]);
  await db.query(`INSERT INTO sdc."AUDIT_LOG"("Occurred_At","Action_Type","Target_Type","Target_Reference","Description","Reason","User_ID")
   VALUES(LOCALTIMESTAMP,'doctor.account.profile_corrected','Doctor',$1,'تصحيح بيانات التواصل للطبيب إداريًا دون المساس بالترخيص أو السجل الطبي',$2,$3::bigint)`,[doctorId,reason,adminId]);
  await db.query('COMMIT');return {status:'ok'};
 }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}finally{db.release();}
}
module.exports={list,jobs,detail,mutate,mutateProfile,validId,reasonText,validLicense};

// Limited removal for registrations that never became operational.
// No cascading deletion: linked clinical/financial/clinic records prevent commit.
async function deleteUnusedRegistration(pool,{doctorId,adminId,reason}){
 if(!validId(String(doctorId))||!validId(String(adminId))||!reasonText(reason))return {status:'invalid'};
 const db=await pool.connect();
 try{
  await db.query('BEGIN');
  await db.query("SELECT set_config('sdc.user_id',$1,true)",[String(adminId)]);
  const auth=await db.query('SELECT sdc.sdc_is_superadmin($1::bigint) allowed',[adminId]);
  if(auth.rows[0]?.allowed!==true){await db.query('ROLLBACK');return {status:'unauthorized'};}
  const x=await db.query(`SELECT d."User_ID"::text AS user_id,d."License_Status" license,
    u."Account_Status" account,u."Login_Enabled" login,u."Last_Login_At" last_login
    FROM sdc."DOCTOR" d JOIN sdc."USER" u USING("User_ID")
    WHERE d."Doctor_ID"=$1::bigint FOR UPDATE OF d,u`,[doctorId]);
  if(!x.rowCount){await db.query('ROLLBACK');return {status:'not_found'};}
  const r=x.rows[0];
  if(!['pending','rejected'].includes(r.license)||r.account==='active'||r.login||r.last_login){await db.query('ROLLBACK');return {status:'not_deletable'};}
  // No memberships, bookings, professional records, or login sessions.
  const linked=await db.query(`SELECT
   EXISTS(SELECT 1 FROM sdc."WORKS_AT" WHERE "Doctor_ID"=$1::bigint)
   OR EXISTS(SELECT 1 FROM sdc."CLINIC" WHERE "Manager_Doctor_ID"=$1::bigint)
   OR EXISTS(SELECT 1 FROM sdc."BOOKING" WHERE "Doctor_ID"=$1::bigint)
   OR EXISTS(SELECT 1 FROM sdc."TREATMENT_PLAN" WHERE "Doctor_ID"=$1::bigint)
   OR EXISTS(SELECT 1 FROM sdc."AI_RECOMMENDATION" WHERE "Doctor_ID"=$1::bigint)
   OR EXISTS(SELECT 1 FROM sdc."PROVIDES" WHERE "Doctor_ID"=$1::bigint)
   OR EXISTS(SELECT 1 FROM sdc."APPLIES_FOR" WHERE "Doctor_ID"=$1::bigint)
   OR EXISTS(SELECT 1 FROM sdc."DOCTOR_WORKING_HOURS" WHERE "Doctor_ID"=$1::bigint)
   OR EXISTS(SELECT 1 FROM sdc."DOCTOR_ABSENCES" WHERE "Doctor_ID"=$1::bigint)
   OR EXISTS(SELECT 1 FROM sdc."USER_SESSIONS" WHERE "User_ID"=$2::bigint)
   OR EXISTS(SELECT 1 FROM sdc."AUDIT_LOG" WHERE "User_ID"=$2::bigint) linked`,[doctorId,r.user_id]);
  if(linked.rows[0]?.linked){await db.query('ROLLBACK');return {status:'in_use'};}
  await db.query('DELETE FROM sdc."HAS_SPECIALTY" WHERE "Doctor_ID"=$1::bigint',[doctorId]);
  await db.query('DELETE FROM sdc."NOTIFICATION" WHERE "User_ID"=$1::bigint',[r.user_id]);
  await db.query('DELETE FROM sdc."USER_RECOVERY_CODES" WHERE "User_ID"=$1::bigint',[r.user_id]);
  await db.query('DELETE FROM sdc."USER_POLICY_CONSENTS" WHERE "User_ID"=$1::bigint',[r.user_id]);
  await db.query('DELETE FROM sdc."DOCTOR" WHERE "Doctor_ID"=$1::bigint',[doctorId]);
  await db.query('DELETE FROM sdc."USER" WHERE "User_ID"=$1::bigint',[r.user_id]);
  await db.query(`INSERT INTO sdc."AUDIT_LOG"("Occurred_At","Action_Type","Target_Type","Target_Reference","Description","Reason","User_ID")
    VALUES(LOCALTIMESTAMP,'doctor.registration.unused_deleted','Doctor',$1::varchar(512),
    'حذف تسجيل طبيب لم يُفعّل أو يُستخدم مع الاحتفاظ بأثر تدقيق للمشرف',$2,$3::bigint)`,[String(doctorId),reason.trim(),adminId]);
  await db.query('COMMIT');return {status:'ok'};
 }catch(e){await db.query('ROLLBACK').catch(()=>{});if(e.code==='23503'||e.code==='23514')return {status:'in_use'};throw e;}finally{db.release();}
}
module.exports.deleteUnusedRegistration=deleteUnusedRegistration;
