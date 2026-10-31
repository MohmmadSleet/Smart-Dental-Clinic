'use strict';
// Patient account read/write operations. Every query derives identity from the
// tracked session, never from a patient_id supplied by a browser.
const {normalizeGender}=require('../common/gender');
const ID=/^[1-9]\d{0,17}$/;
const BLOOD=new Set(['O+','O-','A+','A-','B+','B-','AB+','AB-','unknown']);
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// The registration service deliberately writes this value until the patient's
// first, server-validated medical questionnaire has been submitted.
const HEALTH_SETUP_PENDING='لم تُستكمل البيانات الصحية بعد';
const money=x=>Number(x||0);
const isoDate=v=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v+'T12:00:00Z'))&&new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v&&v>='1900-01-01'&&v<=new Date().toISOString().slice(0,10);
const trim=(v,max)=>typeof v==='string'?v.trim().slice(0,max+1):'';
function cleanLines(v){if(typeof v!=='string'||v.length>7000)return null;const list=[...new Set(v.split(/\r?\n/).map(x=>x.trim()).filter(Boolean))];return list.length<=30&&list.every(x=>x.length<=150)?list:null;}
async function profile(pool,userId){
 const r=await pool.query(`SELECT p."Patient_ID"::text id,p."Date_Of_Birth"::text dob,p."Gender" gender,p."Blood_Type" blood,p."Health_Notes" notes,
 u."First_Name" first,u."Last_Name" last,u."Email" email,u."Phone" phone
 FROM sdc."PATIENT" p JOIN sdc."USER" u ON u."User_ID"=p."User_ID" WHERE u."User_ID"=$1::bigint`,[userId]);
 if(!r.rowCount)return null;const patient=r.rows[0];
 const values=await Promise.all([
 pool.query(`SELECT "Allergies" name FROM sdc."PATIENT_ALLERGIES" WHERE "Patient_ID"=$1::bigint ORDER BY "Allergies"`,[patient.id]),
 pool.query(`SELECT "Chronic_Diseases" name FROM sdc."PATIENT_CHRONIC_DISEASES" WHERE "Patient_ID"=$1::bigint ORDER BY "Chronic_Diseases"`,[patient.id]),
 pool.query(`SELECT "Current_Medications" name FROM sdc."PATIENT_CURRENT_MEDICATIONS" WHERE "Patient_ID"=$1::bigint ORDER BY "Current_Medications"`,[patient.id])]);
 return {...patient,allergies:values[0].rows.map(x=>x.name),chronic:values[1].rows.map(x=>x.name),medications:values[2].rows.map(x=>x.name)};
}
function accountInput(b){
 const p={first:trim(b.first_name,150),last:trim(b.last_name,150),dob:trim(b.dob,10),gender:normalizeGender(b.gender),phone:trim(b.phone,30),email:trim(b.email,254).toLowerCase()};
 return p.first&&p.first.length<=150&&p.last&&p.last.length<=150&&isoDate(p.dob)&&['male','female'].includes(p.gender)&&p.phone&&p.phone.length<=30&&EMAIL.test(p.email)&&p.email.length<=254?p:null;
}
function healthInput(b){
 const x={blood:trim(b.blood_type,10),notes:trim(b.health_notes,3000),allergies:cleanLines(b.allergies),chronic:cleanLines(b.chronic_diseases),medications:cleanLines(b.current_medications)};
 return BLOOD.has(x.blood)&&x.notes&&x.notes!==HEALTH_SETUP_PENDING&&x.notes.length<=3000&&x.allergies?.length>0&&x.chronic?.length>0&&x.medications?.length>0&&b.health_confirm==='on'?x:null;
}
// No browser flag, URL parameter, or local storage can bypass this gate.
// Existing patient files with genuine medical notes are left untouched; only
// new/incomplete registrations using the established sentinel are gated.
async function healthSetupPending(pool,userId){
 const rs=await pool.query(`SELECT "Health_Notes" notes FROM sdc."PATIENT" WHERE "User_ID"=$1::bigint`,[userId]);
 if(!rs.rowCount)return null;
 return rs.rows[0].notes===HEALTH_SETUP_PENDING;
}
function firstHealthInput(b){
 const v=healthInput(b);
 return v&&v.notes!==HEALTH_SETUP_PENDING&&v.allergies.length>0&&v.chronic.length>0&&v.medications.length>0?v:null;
}
async function updateProfile(pool,userId,section,b){
 const value=section==='account'?accountInput(b):section==='health'?healthInput(b):null;
 if(!value)return {status:'invalid'};
 const db=await pool.connect();try{
  await db.query('BEGIN');await db.query("SELECT set_config('sdc.user_id',$1,true)",[userId]);
  const p=await db.query(`SELECT p."Patient_ID"::text id FROM sdc."PATIENT" p WHERE p."User_ID"=$1::bigint FOR UPDATE`,[userId]);
  if(!p.rowCount){await db.query('ROLLBACK');return {status:'not_found'};}
  if(section==='account'){
   await db.query(`UPDATE sdc."USER" SET "First_Name"=$2,"Last_Name"=$3,"Phone"=$4,"Email"=$5 WHERE "User_ID"=$1::bigint`,[userId,value.first,value.last,value.phone,value.email]);
   await db.query(`UPDATE sdc."PATIENT" SET "Date_Of_Birth"=$2::date,"Gender"=$3 WHERE "Patient_ID"=$1::bigint`,[p.rows[0].id,value.dob,value.gender]);
  }else{
   await db.query(`UPDATE sdc."PATIENT" SET "Blood_Type"=$2,"Health_Notes"=$3 WHERE "Patient_ID"=$1::bigint`,[p.rows[0].id,value.blood,value.notes]);
   for(const [table,col,list] of [['PATIENT_ALLERGIES','Allergies',value.allergies],['PATIENT_CHRONIC_DISEASES','Chronic_Diseases',value.chronic],['PATIENT_CURRENT_MEDICATIONS','Current_Medications',value.medications]]){
    await db.query(`DELETE FROM sdc."${table}" WHERE "Patient_ID"=$1::bigint`,[p.rows[0].id]);
    for(const entry of list)await db.query(`INSERT INTO sdc."${table}"("${col}","Patient_ID") VALUES($1,$2::bigint)`,[entry,p.rows[0].id]);
   }
  }
  await db.query(`INSERT INTO sdc."AUDIT_LOG"("Occurred_At","Action_Type","Target_Type","Target_Reference","Description","User_ID") VALUES(LOCALTIMESTAMP,$1,'Patient',$2::varchar(512),$3,$4::bigint)`,[`patient.profile.${section}.updated`,p.rows[0].id,section==='health'?'تحديث التاريخ الصحي للمريض':'تحديث البيانات الشخصية للمريض',userId]);
  await db.query('COMMIT');return {status:'ok'};
 }catch(e){await db.query('ROLLBACK').catch(()=>{});if(e.code==='23505')return {status:'duplicate'};throw e;}finally{db.release();}
}
const safeTarget=n=>{
 const type=String(n.target_type||'').toLowerCase(),id=String(n.target_ref||'');
 if(['booking','appointment'].includes(type)&&ID.test(id))return `/patient/booking-details?id=${id}`;
 if(type==='invoice'||type==='payment')return '/patient/invoices';
 if(type==='visit')return '/patient/diagnosis-history';
 return '/patient/index';
};
async function notifications(pool,userId,limit=100){const rs=await pool.query(`SELECT "Notification_ID"::text id,"Title" title,"Body" body,"Notification_Type" type,
 to_char("Created_At",'DD/MM/YYYY HH24:MI') date,"Read_At" IS NOT NULL AS read,"Target_Type" target_type,"Target_Reference" target_ref
 FROM sdc."NOTIFICATION" WHERE "User_ID"=$1::bigint AND "Notification_Type" NOT LIKE 'admin.%'
 ORDER BY "Created_At" DESC,"Notification_ID" DESC LIMIT $2::integer`,[userId,limit]);return rs.rows.map(n=>({...n,url:safeTarget(n)}));}
async function unread(pool,userId){const r=await pool.query(`SELECT COUNT(*)::int count FROM sdc."NOTIFICATION" WHERE "User_ID"=$1::bigint AND "Read_At" IS NULL AND "Notification_Type" NOT LIKE 'admin.%'`,[userId]);return r.rows[0]?.count||0;}
function safeReturnTo(raw){
 const url=String(raw||'').split('#')[0];
 // A fixed allowlist of real patient pages; never reflect untrusted redirect targets.
 const match=/^\/patient\/(index|profile|appointments|clinics|clinic-details|doctors|doctor-details|invoices|diagnosis-history|appointment-details|booking-details|book-appointment|ai-diagnosis)(?:\?[\w=&%.-]{0,300})?$/.exec(url);
 return match?url:'/patient/index';
}
async function readNotifications(pool,userId,action,id,returnTo){
 if(!['all','read','delete','open'].includes(action)||(action!=='all'&&!ID.test(String(id||''))))return {status:'invalid'};
 if(action==='all'){await pool.query(`UPDATE sdc."NOTIFICATION" SET "Read_At"=COALESCE("Read_At",LOCALTIMESTAMP) WHERE "User_ID"=$1::bigint AND "Notification_Type" NOT LIKE 'admin.%' AND "Read_At" IS NULL`,[userId]);return {status:'ok',url:safeReturnTo(returnTo)};}
 const op=action==='delete'?`DELETE FROM sdc."NOTIFICATION" WHERE "User_ID"=$1::bigint AND "Notification_ID"=$2::bigint AND "Notification_Type" NOT LIKE 'admin.%' RETURNING "Target_Type" target_type,"Target_Reference" target_ref`:`UPDATE sdc."NOTIFICATION" SET "Read_At"=COALESCE("Read_At",LOCALTIMESTAMP) WHERE "User_ID"=$1::bigint AND "Notification_ID"=$2::bigint AND "Notification_Type" NOT LIKE 'admin.%' RETURNING "Target_Type" target_type,"Target_Reference" target_ref`;
 const r=await pool.query(op,[userId,id]);return r.rowCount?{status:'ok',url:action==='open'?safeTarget(r.rows[0]):safeReturnTo(returnTo)}:{status:'not_found'};
}
async function invoices(pool,userId){
 const rows=await pool.query(`SELECT i."Invoice_ID"::text id,i."Invoice_Status" status,to_char(i."Issued_At",'DD/MM/YYYY') issued,c."Clinic_Name" clinic,
 COALESCE(t.total,0)::numeric total,COALESCE(p.paid,0)::numeric paid,
 COALESCE((SELECT du."First_Name"||' '||du."Last_Name" FROM sdc."VISIT" v JOIN sdc."BOOKING" b ON b."Booking_ID"=v."Booking_ID" JOIN sdc."DOCTOR" d ON d."Doctor_ID"=b."Doctor_ID" JOIN sdc."USER" du ON du."User_ID"=d."User_ID" WHERE v."Visit_ID"=i."Visit_ID"),'—') doctor
 FROM sdc."INVOICE" i JOIN sdc."PATIENT" pat ON pat."Patient_ID"=i."Patient_ID" JOIN sdc."CLINIC" c ON c."Clinic_ID"=i."Clinic_ID"
 LEFT JOIN LATERAL (SELECT SUM("Quantity"*"Unit_Price"-"Discount_Amount") total FROM sdc."INVOICE_INVOICE_ITEMS" WHERE "Invoice_ID"=i."Invoice_ID") t ON TRUE
 LEFT JOIN LATERAL (SELECT SUM("Amount") paid FROM sdc."RECORDS_PAYMENT" WHERE "Invoice_ID"=i."Invoice_ID") p ON TRUE
 WHERE pat."User_ID"=$1::bigint AND i."Invoice_Status"='issued' ORDER BY i."Issued_At" DESC,i."Invoice_ID" DESC LIMIT 300`,[userId]);
 const ids=rows.rows.map(x=>x.id);
 const [lines,pays]=ids.length?await Promise.all([
 pool.query(`SELECT "Invoice_ID"::text id,"Description" description,"Quantity"::text qty,"Unit_Price"::text price,"Discount_Amount"::text discount FROM sdc."INVOICE_INVOICE_ITEMS" WHERE "Invoice_ID"=ANY($1::bigint[]) ORDER BY "Item_ID"`,[ids]),
 pool.query(`SELECT "Invoice_ID"::text id,"Payment_ID"::text payment_id,"Amount"::text amount,"Payment_Method" method,to_char("Paid_At",'DD/MM/YYYY HH24:MI') paid_at FROM sdc."RECORDS_PAYMENT" WHERE "Invoice_ID"=ANY($1::bigint[]) ORDER BY "Paid_At" DESC`,[ids])
 ]):[{rows:[]},{rows:[]}];
 const items=rows.rows.map(r=>({...r,total:money(r.total),paid:money(r.paid),remaining:Math.max(0,(Math.round(money(r.total)*100)-Math.round(money(r.paid)*100))/100),lines:lines.rows.filter(x=>x.id===r.id),payments:pays.rows.filter(x=>x.id===r.id)}));
 return {items,total:items.reduce((x,y)=>x+y.total,0),paid:items.reduce((x,y)=>x+y.paid,0),remaining:items.reduce((x,y)=>x+y.remaining,0)};
}
async function visits(pool,userId){
 const [visits,followups,assessments]=await Promise.all([
  pool.query(`SELECT v."Visit_ID"::text id,b."Booking_ID"::text booking_id,to_char(b."Appointment_Date",'YYYY-MM-DD') date,to_char(b."Start_Time",'HH24:MI') time,
  v."Visit_Status" status,v."Chief_Complaint" complaint,v."Examination_Notes" examination,v."Recommendations" recommendations,v."Report_Approved_At" IS NOT NULL approved,
  c."Clinic_Name" clinic,s."Service_Name" service,du."First_Name"||' '||du."Last_Name" doctor,
  v."Follow_Up_Type" followup,to_char(v."Suggested_Date",'YYYY-MM-DD') suggested_date,v."Follow_Up_Notes" followup_notes,
  (SELECT string_agg("Diagnosis_Text",'، ' ORDER BY "Diagnosis_ID") FROM sdc."VISIT_DIAGNOSES" WHERE "Visit_ID"=v."Visit_ID") diagnosis,
  (SELECT string_agg(m."Medication_Name"||' — '||m."Dosage"||' — '||m."Frequency",'، ' ORDER BY m."Medication_ID") FROM sdc."PRESCRIPTION" pr JOIN sdc."PRESCRIPTION_MEDICATIONS" m ON m."Prescription_ID"=pr."Prescription_ID" WHERE pr."Visit_ID"=v."Visit_ID" AND pr."Prescription_Status"='issued') prescription
  FROM sdc."VISIT" v JOIN sdc."BOOKING" b ON b."Booking_ID"=v."Booking_ID" JOIN sdc."PATIENT" p ON p."Patient_ID"=b."Patient_ID"
  JOIN sdc."CLINIC" c ON c."Clinic_ID"=b."Clinic_ID" JOIN sdc."SERVICE" s ON s."Service_ID"=b."Service_ID"
  JOIN sdc."DOCTOR" d ON d."Doctor_ID"=b."Doctor_ID" JOIN sdc."USER" du ON du."User_ID"=d."User_ID"
  WHERE p."User_ID"=$1::bigint ORDER BY b."Appointment_Date" DESC,v."Visit_ID" DESC LIMIT 200`,[userId]),
  pool.query(`SELECT v."Visit_ID"::text id,v."Follow_Up_Type" followup,to_char(v."Suggested_Date",'YYYY-MM-DD') date,
  b."Clinic_ID"::text clinic_id,b."Doctor_ID"::text doctor_id,b."Service_ID"::text service_id,c."Clinic_Name" clinic,du."First_Name"||' '||du."Last_Name" doctor,
  linked."Booking_ID"::text linked_id FROM sdc."VISIT" v JOIN sdc."BOOKING" b ON b."Booking_ID"=v."Booking_ID"
  JOIN sdc."PATIENT" p ON p."Patient_ID"=b."Patient_ID" JOIN sdc."CLINIC" c ON c."Clinic_ID"=b."Clinic_ID" JOIN sdc."DOCTOR" d ON d."Doctor_ID"=b."Doctor_ID" JOIN sdc."USER" du ON du."User_ID"=d."User_ID"
  LEFT JOIN sdc."BOOKING" linked ON linked."Follow_Up_Of_Visit_ID"=v."Visit_ID"
  WHERE p."User_ID"=$1::bigint AND b."Booking_Status"='completed' AND v."Follow_Up_Type" IS NOT NULL AND v."Suggested_Date" IS NOT NULL
  ORDER BY v."Suggested_Date" DESC LIMIT 80`,[userId]),
  pool.query(`SELECT a."Assessment_ID"::text id,to_char(a."Created_At",'DD/MM/YYYY HH24:MI') date,a."Symptoms_Summary" symptoms,a."Preliminary_Result" result,a."Risk_Level" risk,a."Advice_Text" advice,
  (SELECT COUNT(*)::int FROM sdc."AI_RECOMMENDATION" WHERE "Assessment_ID"=a."Assessment_ID") recommendations
  FROM sdc."AI_ASSESSMENT" a JOIN sdc."PATIENT" p ON p."Patient_ID"=a."Patient_ID" WHERE p."User_ID"=$1::bigint ORDER BY a."Created_At" DESC,a."Assessment_ID" DESC LIMIT 100`,[userId])
 ]);
 return {visits:visits.rows,followups:followups.rows,assessments:assessments.rows};
}
async function approvedPdf(pool,userId,visitId){if(!ID.test(String(visitId||'')))return null;
 const r=await pool.query(`SELECT v."Approved_Report_File_Reference" reference FROM sdc."VISIT" v JOIN sdc."BOOKING" b ON b."Booking_ID"=v."Booking_ID" JOIN sdc."PATIENT" p ON p."Patient_ID"=b."Patient_ID" WHERE v."Visit_ID"=$1::bigint AND p."User_ID"=$2::bigint AND v."Report_Approved_At" IS NOT NULL`,[visitId,userId]);
 if(!r.rowCount||!String(r.rows[0].reference||'').startsWith(`visit-${visitId}-`))return null;return require('../../doctor/workspace/report-pdf').find(r.rows[0].reference);
}
// Resolve only an approved visit belonging to the signed-in patient. A moved
// installation may have its VISIT row but not its private storage directory.
// In that case supply an accurately labelled extract, not a forgery of the
// original immutable PDF (which remains the document of record).
async function patientPdf(pool,userId,visitId,lang="ar"){
 if(!ID.test(String(visitId||'')))return null;
 const db=require('../../doctor/workspace/report-pdf');
 const result=await pool.query(`SELECT v."Visit_ID"::text id,v."Approved_Report_File_Reference" reference,
 v."Chief_Complaint" complaint,v."Examination_Notes" examination,v."Recommendations" recommendations,
 v."Follow_Up_Type" followup_type,to_char(v."Suggested_Date",'YYYY-MM-DD') followup_date,v."Follow_Up_Notes" followup_notes,
 v."Actual_Started_At" actual_start,v."Actual_Completed_At" actual_end,
 b."Patient_ID"::text patient_id,to_char(b."Appointment_Date",'YYYY-MM-DD') date,
 c."Clinic_Name" clinic_name,pu."First_Name"||' '||pu."Last_Name" patient_name,
 du."First_Name"||' '||du."Last_Name" doctor_name,sv."Service_Name" service
 FROM sdc."VISIT" v JOIN sdc."BOOKING" b USING("Booking_ID") JOIN sdc."PATIENT" p ON p."Patient_ID"=b."Patient_ID"
 JOIN sdc."USER" pu ON pu."User_ID"=p."User_ID" JOIN sdc."CLINIC" c ON c."Clinic_ID"=b."Clinic_ID"
 JOIN sdc."DOCTOR" doc ON doc."Doctor_ID"=b."Doctor_ID" JOIN sdc."USER" du ON du."User_ID"=doc."User_ID"
 JOIN sdc."SERVICE" sv ON sv."Service_ID"=b."Service_ID"
 WHERE v."Visit_ID"=$1::bigint AND p."User_ID"=$2::bigint AND v."Report_Approved_At" IS NOT NULL`,[visitId,userId]);
 if(!result.rowCount)return null;
 const visit=result.rows[0];
 const ref=String(visit.reference||'');
 if(ref.startsWith(`visit-${visitId}-`)){
  const file=await db.find(ref);
  if(file)return {type:'original',file};
 }
 const [diagnoses,procedures,medications,findings,surfaces,files,odontogram,stages]=await Promise.all([
  pool.query(`SELECT "Tooth_Number" tooth,"Diagnosis_Text" text FROM sdc."VISIT_DIAGNOSES" WHERE "Visit_ID"=$1::bigint ORDER BY "Diagnosis_ID"`,[visitId]),
  pool.query(`SELECT pr."Tooth_Number" tooth,pr."Quantity"::text quantity,pr."Unit_Price_Snapshot"::text price,s."Service_Name" service FROM sdc."PROCEDURE" pr JOIN sdc."SERVICE" s USING("Service_ID") WHERE pr."Visit_ID"=$1::bigint AND pr."Procedure_Status"='completed' ORDER BY pr."Procedure_ID"`,[visitId]),
  pool.query(`SELECT m."Medication_Name" name,m."Dosage" dosage,m."Frequency" frequency,m."Duration" duration,m."Route" route FROM sdc."PRESCRIPTION" p JOIN sdc."PRESCRIPTION_MEDICATIONS" m USING("Prescription_ID") WHERE p."Visit_ID"=$1::bigint AND p."Prescription_Status"='issued' ORDER BY p."Prescription_ID",m."Medication_ID"`,[visitId]),
  pool.query(`SELECT "Clinical_Findings" finding FROM sdc."VISIT_CLINICAL_FINDINGS" WHERE "Visit_ID"=$1::bigint ORDER BY "Clinical_Findings"`,[visitId]),
  pool.query(`SELECT "Tooth_Number" tooth,"Surface" surface,"Note" note FROM sdc."VISIT_TOOTH_SURFACE_NOTES" WHERE "Visit_ID"=$1::bigint ORDER BY "Note_ID"`,[visitId]),
  pool.query(`SELECT "File_Name" name,"File_Reference" reference,"File_Type" mime FROM sdc."VISIT_VISIT_FILES" WHERE "Visit_ID"=$1::bigint AND "Included_In_Report"=true ORDER BY "File_ID"`,[visitId]),
  pool.query(`SELECT "Tooth_Number" tooth,"Tooth_Status" status FROM sdc."VISIT_ODONTOGRAM" WHERE "Visit_ID"=$1::bigint ORDER BY "Tooth_Number"`,[visitId]),
  pool.query(`SELECT tp."Plan_Name" plan,st."Stage_Order" step,st."Tooth_Number" tooth,st."Description" description,st."Stage_Status" status
    FROM sdc."VISIT" v JOIN sdc."BOOKING" b ON b."Booking_ID"=v."Booking_ID"
    JOIN sdc."TREATMENT_PLAN" tp ON tp."Plan_ID"=b."Plan_ID"
    JOIN sdc."TREATMENT_STAGE" st ON st."Plan_ID"=tp."Plan_ID"
    WHERE v."Visit_ID"=$1::bigint AND tp."Patient_ID"=b."Patient_ID" AND tp."Doctor_ID"=b."Doctor_ID" AND tp."Clinic_ID"=b."Clinic_ID"
    ORDER BY st."Stage_Order" LIMIT 200`,[visitId])
 ]);
 // The original signed PDF is always preferred. Extracts are labelled and
 // built from approved rows; never claim images exist when their file is lost.
 let images=[];
 try{images=await require('../../doctor/workspace/report-service').selectedImages(files.rows);}catch(error){
  console.error('[PATIENT_REPORT_EXTRACT_IMAGES_UNAVAILABLE]',visitId,error.code||error.message);
  visit.extract_attachments_notice='قد لا تتوفر بعض الصور الأصلية في هذا المستخرج. راجع ملفات الزيارة في النظام.';
 }
 const buffer=await db.extractForDownload({lang,visit,diagnoses:diagnoses.rows,procedures:procedures.rows,medications:medications.rows,findings:findings.rows,surfaces:surfaces.rows,files:files.rows,odontogram:odontogram.rows,stages:stages.rows,images});
 return {type:'extract',buffer};
}
// Release only attachments explicitly included in an APPROVED medical report.
// All lookups must join the session owner: IDs in the URL never grant access.
const fsPrivate=require('node:fs/promises');
const visitFiles=require('../../doctor/workspace/visit-files');
const APPROVED_FILE_TYPES=new Set(['application/pdf','image/jpeg','image/png']);
async function reportAttachments(pool,userId,visitId){
 if(!ID.test(String(visitId||'')))return [];
 const found=await pool.query(`SELECT f."File_ID"::text id,f."File_Name" name,f."Description" description,f."File_Type" mime,f."File_Reference" reference
 FROM sdc."VISIT_VISIT_FILES" f JOIN sdc."VISIT" v ON v."Visit_ID"=f."Visit_ID"
 JOIN sdc."BOOKING" b ON b."Booking_ID"=v."Booking_ID" JOIN sdc."PATIENT" p ON p."Patient_ID"=b."Patient_ID"
 WHERE v."Visit_ID"=$1::bigint AND p."User_ID"=$2::bigint AND v."Report_Approved_At" IS NOT NULL
 AND f."Included_In_Report"=true ORDER BY f."File_ID"`,[visitId,userId]);
 return Promise.all(found.rows.filter(x=>APPROVED_FILE_TYPES.has(x.mime)).map(async x=>{
  const location=visitFiles.securePath(x.reference);
  const stat=location?await fsPrivate.stat(location).catch(()=>null):null;
  const suffix=location?require('node:path').extname(location):'';
  const available=Boolean(stat?.isFile()&&stat.size>=8&&stat.size<=5*1024*1024&&({'.pdf':'application/pdf','.jpg':'image/jpeg','.png':'image/png'}[suffix]===x.mime));
  return {id:x.id,name:x.name,description:x.description,mime:x.mime,kind:x.mime.startsWith('image/')?'image':'document',available};
 }));
}
async function reportAttachmentFile(pool,userId,visitId,fileId){
 if(!ID.test(String(visitId||''))||!ID.test(String(fileId||'')))return null;
 const r=await pool.query(`SELECT f."File_Name" name,f."File_Type" mime,f."File_Reference" reference
 FROM sdc."VISIT_VISIT_FILES" f JOIN sdc."VISIT" v ON v."Visit_ID"=f."Visit_ID"
 JOIN sdc."BOOKING" b ON b."Booking_ID"=v."Booking_ID" JOIN sdc."PATIENT" p ON p."Patient_ID"=b."Patient_ID"
 WHERE v."Visit_ID"=$1::bigint AND f."File_ID"=$2::bigint AND p."User_ID"=$3::bigint
 AND v."Report_Approved_At" IS NOT NULL AND f."Included_In_Report"=true`,[visitId,fileId,userId]);
 if(!r.rowCount)return null;
 const row=r.rows[0],location=visitFiles.securePath(row.reference);
 if(!location||!APPROVED_FILE_TYPES.has(row.mime)||!({'.pdf':'application/pdf','.jpg':'image/jpeg','.png':'image/png'}[require('node:path').extname(location)]===row.mime))return null;
 const stat=await fsPrivate.stat(location).catch(()=>null);
 if(!stat?.isFile()||stat.size<8||stat.size>5*1024*1024)return null;
 // Check magic bytes before presenting files as trusted PDFs/images.
 const f=await fsPrivate.open(location,'r').catch(()=>null);if(!f)return null;let header=Buffer.alloc(8);
 try{await f.read(header,0,8,0);}finally{await f.close();}
 const valid=row.mime==='application/pdf'?header.subarray(0,5).toString('ascii')==='%PDF-':
 row.mime==='image/png'?header.equals(Buffer.from([137,80,78,71,13,10,26,10])):
 header[0]===255&&header[1]===216&&header[2]===255;
 return valid?{location,mime:row.mime,name:String(row.name||'medical-attachment').replace(/[\r\n\x00-\x1f]/g,' ').slice(0,160)}:null;
}
async function dashboard(pool,userId){
 const [bookings,medical,billing,unreadCount,clinics,doctors]=await Promise.all([
  require('../../appointments/service').list(pool,{role:'patient',userId},null),visits(pool,userId),invoices(pool,userId),unread(pool,userId),require('../directory-service').clinics(pool),require('../directory-service').doctors(pool)
 ]);
 const now=require('../../appointments/service').localNow();const next=bookings.filter(b=>['pending','confirmed'].includes(b.status)&&(b.date>now.date||b.date===now.date&&b.time>=now.time)).sort((a,b)=>a.date.localeCompare(b.date)||a.time.localeCompare(b.time))[0]||null;
 return {next,bookings,medical,billing,unread:unreadCount,clinics:clinics.slice(0,3),doctors:doctors.slice(0,3)};
}
module.exports={profile,accountInput,healthInput,firstHealthInput,healthSetupPending,HEALTH_SETUP_PENDING,updateProfile,notifications,unread,readNotifications,safeTarget,safeReturnTo,invoices,visits,approvedPdf,patientPdf,reportAttachments,reportAttachmentFile,dashboard,ID};
// Review is one-per-completed-booking, written with actor context for the
// database's deferred integrity checks. A failed transaction leaves no partial review.
async function rateBooking(pool,userId,bookingId,doctorRating,clinicRating,comment){
 if(!ID.test(String(bookingId||''))||!['1','2','3','4','5'].includes(String(doctorRating))||!['1','2','3','4','5'].includes(String(clinicRating))||typeof comment!=='string'||comment.trim().length>150)return {status:'invalid'};
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query("SELECT set_config('sdc.user_id',$1::text,true)",[String(userId)]);
  const q=await client.query(`UPDATE sdc."BOOKING" b SET "Doctor_Rating"=$3::smallint,"Clinic_Rating"=$4::smallint,"Review_Comment"=NULLIF($5::varchar(150),''),"Reviewed_At"=LOCALTIMESTAMP
 WHERE b."Booking_ID"=$2::bigint AND b."Booking_Status"='completed' AND b."Reviewed_At" IS NULL
 AND b."Appointment_Date"+b."Start_Time"<=LOCALTIMESTAMP
 AND EXISTS(SELECT 1 FROM sdc."PATIENT" p WHERE p."Patient_ID"=b."Patient_ID" AND p."User_ID"=$1::bigint) RETURNING b."Booking_ID"`,[userId,bookingId,doctorRating,clinicRating,comment.trim()]);
  if(!q.rowCount){await client.query('ROLLBACK');return {status:'closed'};}
  await client.query(`INSERT INTO sdc."AUDIT_LOG"("Occurred_At","Action_Type","Target_Type","Target_Reference","Description","User_ID") VALUES(LOCALTIMESTAMP,'booking.patient.reviewed','Booking',$1::varchar(512),'حفظ تقييم زيارة مكتملة بواسطة صاحب الحجز',$2::bigint)`,[String(bookingId),userId]);
  await client.query('COMMIT');return {status:'ok'};
 }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
 finally{client.release();}
}
module.exports.rateBooking=rateBooking;
