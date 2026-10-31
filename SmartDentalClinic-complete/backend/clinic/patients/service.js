'use strict';
// Clinic patients: use the existing REGISTERED_AT association, never infer
// access to another clinic's records from a global patient ID.
const { normalizeGender, genderLabel } = require('../../patient/common/gender');
const ID=/^[1-9]\d{0,17}$/;
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BLOOD=new Set(['A+','A-','B+','B-','AB+','AB-','O+','O-','unknown']);
const GENDER=new Set(['male','female']);
const clean=(v,max=150)=>String(v??'').trim().slice(0,max+1);
const validDate=s=>/^\d{4}-\d\d-\d\d$/.test(s)&&!Number.isNaN(new Date(s+'T12:00:00Z').getTime())&&new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s&&s<=new Date().toISOString().slice(0,10)&&s>='1900-01-01';
const lines=s=>[...new Set(String(s??'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean))];
function parsePatient(body){
 const p={first:clean(body.clinic_patient_first_name),last:clean(body.clinic_patient_last_name),birth:clean(body.clinic_patient_birthdate,10),gender:normalizeGender(body.clinic_patient_gender),phone:clean(body.clinic_patient_phone,30),email:clean(body.clinic_patient_email,254).toLowerCase(),blood:clean(body.blood_type,10)||'unknown',notes:clean(body.health_notes,3000)||'لا توجد ملاحظات صحية مسجلة',allergies:lines(body.clinic_patient_allergies),chronic:lines(body.clinic_patient_chronic_diseases),medications:lines(body.clinic_patient_current_medications)};
 if(!p.first||p.first.length>150||!p.last||p.last.length>150||!validDate(p.birth)||!GENDER.has(p.gender)||!p.phone||p.phone.length>30||p.email&&!EMAIL.test(p.email)||!BLOOD.has(p.blood)||p.notes.length>3000||[p.allergies,p.chronic,p.medications].some(a=>a.length>30||a.some(s=>s.length>150)))return null;
 return p;
}
async function list(pool,clinic){
 const r=await pool.query(`SELECT p."Patient_ID"::text AS id,u."User_ID"::text AS user_id,u."First_Name"||' '||u."Last_Name" AS name,u."First_Name" AS first_name,u."Last_Name" AS last_name,
 u."Phone" AS phone,u."Email" AS email,u."Account_Status" AS status,
 (SELECT max(b."Appointment_Date") FROM sdc."BOOKING" b JOIN sdc."VISIT" v ON v."Booking_ID"=b."Booking_ID" WHERE b."Clinic_ID"=$1::bigint AND b."Patient_ID"=p."Patient_ID")::text AS last_visit
 FROM sdc."REGISTERED_AT" a JOIN sdc."PATIENT" p ON p."Patient_ID"=a."Patient_ID"
 JOIN sdc."USER" u ON u."User_ID"=p."User_ID"
 WHERE a."Clinic_ID"=$1::bigint ORDER BY u."First_Name",u."Last_Name",p."Patient_ID" LIMIT 1000`,[clinic]);
 return r.rows.map(x=>({...x,initials:x.name.split(/\s+/).slice(0,2).map(v=>v[0]).join(''),lastVisit:x.last_visit||null}));
}
async function detail(pool,clinic,id){
 if(!ID.test(String(id||'')))return null;
 const r=await pool.query(`SELECT p."Patient_ID"::text AS id,p."Date_Of_Birth"::text AS dob,p."Gender" AS gender,p."Blood_Type" AS blood,p."Health_Notes" AS notes,
 u."First_Name"||' '||u."Last_Name" AS name,u."Phone" AS phone,u."Email" AS email, u."Login_Enabled" AS login_enabled, (u."Password_Hash" IS NOT NULL) AS has_password
 FROM sdc."REGISTERED_AT" a JOIN sdc."PATIENT" p ON p."Patient_ID"=a."Patient_ID" JOIN sdc."USER" u ON u."User_ID"=p."User_ID"
 WHERE a."Clinic_ID"=$1::bigint AND a."Patient_ID"=$2::bigint`,[clinic,id]);
 if(!r.rowCount)return null;
 const [allergies,chronic,meds,visits,plans,invoices]=await Promise.all([
 pool.query(`SELECT "Allergies" AS name FROM sdc."PATIENT_ALLERGIES" WHERE "Patient_ID"=$1::bigint ORDER BY "Allergies"`,[id]),
 pool.query(`SELECT "Chronic_Diseases" AS name FROM sdc."PATIENT_CHRONIC_DISEASES" WHERE "Patient_ID"=$1::bigint ORDER BY "Chronic_Diseases"`,[id]),
 pool.query(`SELECT "Current_Medications" AS name FROM sdc."PATIENT_CURRENT_MEDICATIONS" WHERE "Patient_ID"=$1::bigint ORDER BY "Current_Medications"`,[id]),
 pool.query(`SELECT b."Booking_ID"::text AS booking_id,v."Visit_ID"::text AS visit_id,to_char(b."Appointment_Date",'YYYY-MM-DD') AS date,
 s."Service_Name" AS service,u."First_Name"||' '||u."Last_Name" AS doctor,v."Visit_Status" AS status,
 v."Report_Approved_At" IS NOT NULL AS report_approved
 FROM sdc."BOOKING" b JOIN sdc."VISIT" v ON v."Booking_ID"=b."Booking_ID"
 JOIN sdc."DOCTOR" d ON d."Doctor_ID"=b."Doctor_ID" JOIN sdc."USER" u ON u."User_ID"=d."User_ID"
 JOIN sdc."SERVICE" s ON s."Service_ID"=b."Service_ID"
 WHERE b."Clinic_ID"=$1::bigint AND b."Patient_ID"=$2::bigint ORDER BY b."Appointment_Date" DESC LIMIT 100`,[clinic,id]),
 pool.query(`SELECT t."Plan_ID"::text AS id,t."Plan_Name" AS name,t."Plan_Status" AS status,to_char(t."Start_Date",'YYYY-MM-DD') AS start,t."Estimated_Cost"::text AS cost,
 u."First_Name"||' '||u."Last_Name" AS doctor
 FROM sdc."TREATMENT_PLAN" t JOIN sdc."DOCTOR" d ON d."Doctor_ID"=t."Doctor_ID" JOIN sdc."USER" u ON u."User_ID"=d."User_ID"
 WHERE t."Clinic_ID"=$1::bigint AND t."Patient_ID"=$2::bigint ORDER BY t."Start_Date" DESC LIMIT 50`,[clinic,id]),
 pool.query(`SELECT i."Invoice_ID"::text AS id,i."Invoice_Status" AS status,
 COALESCE((SELECT sum(it."Quantity"*it."Unit_Price"-it."Discount_Amount") FROM sdc."INVOICE_INVOICE_ITEMS" it WHERE it."Invoice_ID"=i."Invoice_ID"),0)::numeric AS total,
 COALESCE((SELECT sum(pay."Amount") FROM sdc."RECORDS_PAYMENT" pay WHERE pay."Invoice_ID"=i."Invoice_ID"),0)::numeric AS paid
 FROM sdc."INVOICE" i WHERE i."Clinic_ID"=$1::bigint AND i."Patient_ID"=$2::bigint ORDER BY i."Created_At" DESC LIMIT 100`,[clinic,id])
 ]);
 const bill=invoices.rows.reduce((a,i)=>{if(i.status==='void')return a;return {total:a.total+Number(i.total),remaining:a.remaining+Math.max(0,Number(i.total)-Number(i.paid))};},{total:0,remaining:0});
 return {...r.rows[0],genderLabel:genderLabel(r.rows[0].gender),allergies:allergies.rows.map(x=>x.name),chronic:chronic.rows.map(x=>x.name),medications:meds.rows.map(x=>x.name),visits:visits.rows,plans:plans.rows,invoices:invoices.rows,bill};
}
async function create(pool,clinic,user,body,options={}){
 if(!ID.test(String(clinic||''))||!ID.test(String(user||'')))return {status:'forbidden'};
 const adminOverride=options.adminOverride===true;
 const adminReason=String(options.reason||'').trim();
 if(adminOverride&&(adminReason.length<8||adminReason.length>1000))return {status:'invalid'};
 const p=parsePatient(body);if(!p)return {status:'invalid'};
 const db=await pool.connect();try{
  await db.query('BEGIN');await db.query("SELECT set_config('sdc.user_id',$1,true)",[user]);
  if(adminOverride){const authority=await db.query('SELECT sdc.sdc_is_superadmin($1::bigint) AS allowed',[user]);if(authority.rows[0]?.allowed!==true){await db.query('ROLLBACK');return {status:'forbidden'};}}
  const allowed=await db.query(`SELECT 1 FROM sdc."CLINIC" WHERE "Clinic_ID"=$1::bigint AND "Clinic_Status"='active' AND "Approval_Status"='approved' FOR UPDATE`,[clinic]);
  if(!allowed.rowCount){await db.query('ROLLBACK');return {status:'forbidden'};}
  // Do not link existing patient accounts across clinics on the strength of a
  // supplied email/phone. That requires a separate verified patient consent.
  const existing=await db.query(`SELECT 1 FROM sdc."USER" u JOIN sdc."PATIENT" p ON p."User_ID"=u."User_ID"
    WHERE ($1::varchar(254) <> '' AND lower(u."Email")=$1::varchar(254))
       OR (u."Phone"=$2::varchar(30) AND p."Date_Of_Birth"=$3::date) LIMIT 1`,[p.email,p.phone,p.birth]);
  if(existing.rowCount){await db.query('ROLLBACK');return {status:'exists'};}
  const role=await db.query(`SELECT "Role_ID" FROM sdc."ROLE" WHERE "Role_Name"='Patient' AND "Role_Scope"='System'`);
  if(role.rowCount!==1){await db.query('ROLLBACK');return {status:'role_missing'};}
  const u=await db.query(`INSERT INTO sdc."USER"("First_Name","Last_Name","Email","Phone","Password_Hash","Account_Status","Created_At","Preferred_Language","Two_Factor_Enabled","Login_Enabled","Role_ID")
    VALUES($1::varchar(150),$2::varchar(150),$3::varchar(254),$4::varchar(30),NULL,'active',LOCALTIMESTAMP,'ar',false,false,$5::bigint) RETURNING "User_ID"`,[p.first,p.last,p.email||null,p.phone,role.rows[0].Role_ID]);
  const patient=await db.query(`INSERT INTO sdc."PATIENT"("Date_Of_Birth","Gender","Blood_Type","Health_Notes","User_ID") VALUES($1::date,$2::varchar(150),$3::varchar(10),$4::text,$5::bigint) RETURNING "Patient_ID"::text AS id`,[p.birth,p.gender,p.blood,p.notes,u.rows[0].User_ID]);
  const id=patient.rows[0].id;
  await db.query(`INSERT INTO sdc."REGISTERED_AT"("Patient_ID","Clinic_ID") VALUES($1::bigint,$2::bigint)`,[id,clinic]);
  for(const [table,col,values] of [['PATIENT_ALLERGIES','Allergies',p.allergies],['PATIENT_CHRONIC_DISEASES','Chronic_Diseases',p.chronic],['PATIENT_CURRENT_MEDICATIONS','Current_Medications',p.medications]])for(const val of values){
   // identifiers are fixed internal constants, not interpolated user input.
   await db.query(`INSERT INTO sdc."${table}"("${col}","Patient_ID") VALUES($1::varchar(150),$2::bigint)`,[val,id]);
  }
  await db.query(`INSERT INTO sdc."AUDIT_LOG"("Occurred_At","Action_Type","Target_Type","Target_Reference","Description","Reason","User_ID") VALUES(LOCALTIMESTAMP,$1::varchar(150),'Patient',$2::varchar(512),'إنشاء ملف مريض في عيادة بدون تفعيل تسجيل الدخول',$3::text,$4::bigint)`,[adminOverride?'admin.clinic.patient.created':'clinic.patient.created',id,adminOverride?adminReason:null,user]);
  await db.query('COMMIT');return {status:'ok',id};
 }catch(e){await db.query('ROLLBACK').catch(()=>{});if(e.code==='23505')return {status:'exists'};throw e;}finally{db.release();}
}
// Super Admin may correct administrative account contact details, not medical history.
async function updateAdmin(pool,clinic,patientId,adminId,body){
 if(!ID.test(String(clinic))||!ID.test(String(patientId))||!ID.test(String(adminId)))return {status:'invalid'};
 const first=clean(body.first_name),last=clean(body.last_name),phone=clean(body.phone,30),email=clean(body.email,254).toLowerCase();
 const reason=String(body.reason||'').trim();
 if(!first||first.length>150||!last||last.length>150||!phone||phone.length>30||(email&&!EMAIL.test(email))||reason.length<8||reason.length>1000)return {status:'invalid'};
 const db=await pool.connect();try{
  await db.query('BEGIN');await db.query("SELECT set_config('sdc.user_id',$1,true)",[String(adminId)]);
  const auth=await db.query('SELECT sdc.sdc_is_superadmin($1::bigint) AS allowed',[adminId]);
  if(auth.rows[0]?.allowed!==true){await db.query('ROLLBACK');return {status:'forbidden'};}
  const found=await db.query(`SELECT u."User_ID" FROM sdc."REGISTERED_AT" a
   JOIN sdc."PATIENT" p ON p."Patient_ID"=a."Patient_ID"
   JOIN sdc."USER" u ON u."User_ID"=p."User_ID"
   WHERE a."Clinic_ID"=$1::bigint AND a."Patient_ID"=$2::bigint FOR UPDATE OF u`,[clinic,patientId]);
  if(!found.rowCount){await db.query('ROLLBACK');return {status:'not_found'};}
  await db.query(`UPDATE sdc."USER" SET "First_Name"=$2::varchar(150),"Last_Name"=$3::varchar(150),"Phone"=$4::varchar(30),"Email"=$5::varchar(254)
   WHERE "User_ID"=$1::bigint`,[found.rows[0].User_ID,first,last,phone,email||null]);
  await db.query(`INSERT INTO sdc."AUDIT_LOG"("Occurred_At","Action_Type","Target_Type","Target_Reference","Description","Reason","User_ID")
   VALUES(LOCALTIMESTAMP,'admin.clinic.patient.contact_updated','Patient',$1,'تصحيح بيانات الاتصال الإدارية للمريض، دون تعديل معلوماته الطبية',$2,$3::bigint)`,[patientId,reason,adminId]);
  await db.query('COMMIT');return {status:'ok'};
 }catch(e){await db.query('ROLLBACK').catch(()=>{});if(e.code==='23505')return {status:'duplicate'};throw e;}finally{db.release();}
}
// Patient must be present and identity checked by clinic staff before changing an unclaimed file's email.
// Never allow a clinic to modify the email of an activated patient account.
async function updateUnclaimedEmail(pool,clinic,actor,patientId,body){
  if(![clinic,actor,patientId].every(v=>ID.test(String(v||''))))return {status:'invalid'};
  const email=typeof body?.email==='string'?body.email.trim().toLowerCase():'';
  const dob=typeof body?.date_of_birth==='string'?body.date_of_birth.trim():'';
  const phone=typeof body?.phone==='string'?body.phone.replace(/\D/g,''):'';
  if(!EMAIL.test(email)||email.length>254||!/^\d{4}-\d{2}-\d{2}$/.test(dob)||phone.length<7||phone.length>15||body?.identity_checked!=='on')return {status:'invalid'};
  const db=await pool.connect();try{
    await db.query('BEGIN');
    await db.query("SELECT set_config('sdc.user_id',$1,true)",[String(actor)]);
    const found=await db.query(`SELECT u."User_ID",u."Email" FROM sdc."REGISTERED_AT" a
       JOIN sdc."PATIENT" p ON p."Patient_ID"=a."Patient_ID"
       JOIN sdc."USER" u ON u."User_ID"=p."User_ID"
       WHERE a."Clinic_ID"=$1::bigint AND p."Patient_ID"=$2::bigint
       AND p."Date_Of_Birth"=$3::date AND regexp_replace(u."Phone",'[^0-9]','','g')=$4
       AND u."Login_Enabled"=FALSE AND u."Password_Hash" IS NULL
       AND u."Account_Status"='active' FOR UPDATE OF u`,[clinic,patientId,dob,phone]);
    if(found.rowCount!==1){await db.query('ROLLBACK');return {status:'not_found'};}
    await db.query(`UPDATE sdc."USER" SET "Email"=$2,"Password_Reset_Token_Hash"=NULL,"Password_Reset_Expires_At"=NULL WHERE "User_ID"=$1`,[found.rows[0].User_ID,email]);
    await db.query(`INSERT INTO sdc."AUDIT_LOG"("Occurred_At","Action_Type","Target_Type","Target_Reference","Description","User_ID")
      VALUES(LOCALTIMESTAMP,'clinic.patient.activation_email_verified','Patient',$1::varchar(512),'تأكيد هوية مريض غير مفعّل وتسجيل بريد التفعيل',$2::bigint)`,[String(patientId),String(actor)]);
    await db.query('COMMIT');return {status:'ok'};
  }catch(error){await db.query('ROLLBACK').catch(()=>{});if(error.code==='23505')return {status:'duplicate'};throw error;}
  finally{db.release();}
}
module.exports={parsePatient,list,detail,create,updateAdmin,updateUnclaimedEmail};
