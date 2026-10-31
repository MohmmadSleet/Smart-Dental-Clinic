'use strict';
// Staff operations reuse the clinic's reviewed data services. Every query is scoped
// to the ACTIVE clinic chosen in the authenticated session, not a form value.
const patients=require('../clinic/patients/service');
const finance=require('../clinic/finance-inventory-service');
const lab=require('../clinic/laboratories-jobs-service');
const billing=require('../clinic/invoice-issuing-service');
const ID=/^[1-9]\d{0,17}$/;
const id=value=>ID.test(String(value||''));
// Only administrative intake data is accepted. Never persist medical details
// supplied to the staff endpoint, even if a crafted form includes them.
function staffPatientInput(body={}){
 const permitted=['clinic_patient_first_name','clinic_patient_last_name','clinic_patient_birthdate',
   'clinic_patient_gender','clinic_patient_phone'];
 const safe=Object.fromEntries(permitted.map(key=>[key,body[key]]));
 return {...safe,clinic_patient_email:'',blood_type:'unknown',health_notes:'لم تُجمع معلومات صحية عند إنشاء الملف الإداري',
  clinic_patient_allergies:'',clinic_patient_chronic_diseases:'',clinic_patient_current_medications:''};
}
// The staff directory is deliberately separate from the clinic-wide patient service.
// It returns no email, date of birth, medical data, full phone number, or visit dates.
async function listStaffDirectory(pool,clinic,query={}){
 if(!id(clinic))throw Error('Invalid clinic context');
 const search=typeof query.q==='string'?query.q.trim().slice(0,80):'';
 const n=Number(query.page);
 const page=Number.isSafeInteger(n)&&n>=1&&n<=500? n:1;
 const limit=30;
 const rows=await pool.query(`SELECT p."Patient_ID"::text AS id,
  concat_ws(' ',u."First_Name",u."Last_Name") AS name,
  CASE WHEN length(btrim(coalesce(u."Phone",'')))<8 THEN NULL ELSE right(btrim(u."Phone"),4) END AS phone_tail
  FROM sdc."REGISTERED_AT" a
  JOIN sdc."PATIENT" p ON p."Patient_ID"=a."Patient_ID"
  JOIN sdc."USER" u ON u."User_ID"=p."User_ID"
  WHERE a."Clinic_ID"=$1::bigint AND ($2::text='' OR
    position(lower($2::text) in lower(concat_ws(' ',u."First_Name",u."Last_Name")))>0
    OR p."Patient_ID"::text=$2::text)
  ORDER BY u."First_Name",u."Last_Name",p."Patient_ID"
  LIMIT 31 OFFSET $3::int`,[clinic,search,(page-1)*limit]);
 return {rows:rows.rows.slice(0,limit),search,page,hasPrevious:page>1,hasNext:rows.rows.length>limit};
}
async function stats(pool,clinic,permissions){
 const {can}=require('./policy');
 const visible=code=>can(permissions,code);
 const result={appointments:0,patients:0,payments:0,labs:0,waiting:0};
 const tasks=[];
 if(visible('appointments.view'))tasks.push(pool.query(`SELECT COUNT(*)::int AS today,COUNT(*) FILTER(WHERE "Booking_Status"='pending')::int AS waiting FROM sdc."BOOKING" WHERE "Clinic_ID"=$1::bigint AND "Appointment_Date"=CURRENT_DATE`,[clinic]).then(r=>{result.appointments=r.rows[0].today;result.waiting=r.rows[0].waiting;}));

 if(visible('invoices.view'))tasks.push(pool.query(`SELECT COALESCE(SUM(p."Amount"),0)::numeric AS amount FROM sdc."RECORDS_PAYMENT" p JOIN sdc."INVOICE" i ON i."Invoice_ID"=p."Invoice_ID" WHERE i."Clinic_ID"=$1::bigint AND p."Paid_At"::date=CURRENT_DATE`,[clinic]).then(r=>{result.payments=Number(r.rows[0].amount);}));
 if(visible('lab_orders.view'))tasks.push(pool.query(`SELECT COUNT(*)::int AS count FROM sdc."LAB_ORDER" o JOIN sdc."VISIT" v ON v."Visit_ID"=o."Visit_ID" JOIN sdc."BOOKING" b ON b."Booking_ID"=v."Booking_ID" WHERE b."Clinic_ID"=$1::bigint AND o."Order_Status" IN ('draft','sent')`,[clinic]).then(r=>{result.labs=r.rows[0].count;}));
 await Promise.all(tasks);return result;
}
async function account(pool,user){const r=await pool.query(`SELECT "First_Name" first,"Last_Name" last,"Email" email,"Phone" phone FROM sdc."USER" WHERE "User_ID"=$1::bigint`,[user]);return r.rows[0]||null;}
async function saveAccount(pool,user,body){
 const phone=String(body.phone||'').trim();
 if(phone.length>30||!id(user))return {status:'invalid'};
 const db=await pool.connect();
 try{
  await db.query('BEGIN');
  await db.query("SELECT set_config('sdc.user_id',$1,true)",[String(user)]);
  const r=await db.query(`UPDATE sdc."USER" SET "Phone"=$2 WHERE "User_ID"=$1::bigint AND "Account_Status"='active' RETURNING "User_ID"`,[user,phone||null]);
  if(!r.rowCount){await db.query('ROLLBACK');return {status:'not_found'};}
  await db.query('COMMIT');
  return {status:'ok'};
 }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}finally{db.release();}
}
module.exports={id,stats,account,saveAccount,staffPatientInput,listStaffDirectory,patients,finance,lab,billing};
