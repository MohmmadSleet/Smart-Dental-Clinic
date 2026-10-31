'use strict';
// v27.17 - Super Admin oversight of clinic-owned vacancies and applications.
// The clinic alone creates/edits adverts and accepts/rejects candidates.
const ID=/^[1-9]\d{0,17}$/;
const validId=x=>typeof x==='string'&&ID.test(x);
const reasonText=x=>typeof x==='string'&&x.trim().length>=8&&x.trim().length<=1000?x.trim():null;
const safeQ=x=>typeof x==='string'?x.trim().slice(0,100):'';
const safeDate=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&!Number.isNaN(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x?x:'';
const statuses=new Set(['draft','open','closed','archived']);
const applicationStatuses=new Set(['pending','accepted','rejected','withdrawn']);
const size=30;
function pageNumber(v){return typeof v==='string'&&/^\d{1,5}$/.test(v)?Math.max(1,Math.min(10000,+v)):1;}
function parseJobFilters(q={}){
 return {q:safeQ(q.job_q),status:statuses.has(q.job_status)?q.job_status:'',clinic:validId(q.job_clinic)?q.job_clinic:'',from:safeDate(q.job_from),to:safeDate(q.job_to),page:pageNumber(q.job_page)};
}
function parseApplicationFilters(q={}){
 return {status:applicationStatuses.has(q.app_status)?q.app_status:'',from:safeDate(q.app_from),to:safeDate(q.app_to),page:pageNumber(q.app_page)};
}
const BASE=` FROM sdc."JOB" j JOIN sdc."CLINIC" c ON c."Clinic_ID"=j."Clinic_ID"
 JOIN sdc."SPECIALTY" s ON s."Specialty_ID"=j."Specialty_ID"`;
function whereJobs(f){const clauses=[],args=[];
 if(f.q){args.push('%'+f.q.replace(/[\\%_]/g,'\\$&')+'%');clauses.push(`concat_ws(' ',j."Job_ID"::text,j."Job_Title",c."Clinic_Name",c."City",s."Name_AR") ILIKE $${args.length} ESCAPE '\\'`);}
 if(f.status){args.push(f.status);clauses.push(`j."Job_Status"=$${args.length}`);}
 if(f.clinic){args.push(f.clinic);clauses.push(`j."Clinic_ID"=$${args.length}::bigint`);}
 if(f.from){args.push(f.from);clauses.push(`j."Application_Deadline">=$${args.length}::date`);}
 if(f.to){args.push(f.to);clauses.push(`j."Application_Deadline"<=$${args.length}::date`);}
 return {sql:clauses.length?' WHERE '+clauses.join(' AND '):'',args};
}
async function list(pool,query={}){
 const filters=parseJobFilters(query),{sql,args}=whereJobs(filters);
 const totalResult=await pool.query(`SELECT count(*)::integer AS total ${BASE}${sql}`,args);
 const total=Number(totalResult.rows[0]?.total)||0,pages=Math.max(1,Math.ceil(total/size)),page=Math.min(filters.page,pages);
 const [rows,clinics,jobCreateClinics,jobSpecialties]=await Promise.all([
  pool.query(`SELECT j."Job_ID"::text id,j."Job_Title" title,j."Job_Status" status,j."Admin_Suspended_At" admin_suspended_at,c."Clinic_Name" clinic,c."City" city,
   c."Clinic_ID"::text clinic_id,s."Name_AR" specialty,j."Application_Deadline"::text deadline,
   (SELECT count(*)::integer FROM sdc."APPLIES_FOR" a WHERE a."Job_ID"=j."Job_ID") applicants
   ${BASE}${sql} ORDER BY j."Job_ID" DESC LIMIT $${args.length+1} OFFSET $${args.length+2}`,[...args,size,(page-1)*size]),
  pool.query(`SELECT c."Clinic_ID"::text id,c."Clinic_Name" name FROM sdc."CLINIC" c
   WHERE EXISTS(SELECT 1 FROM sdc."JOB" j WHERE j."Clinic_ID"=c."Clinic_ID") ORDER BY c."Clinic_Name" LIMIT 1000`),
  pool.query(`SELECT "Clinic_ID"::text id,"Clinic_Name" name FROM sdc."CLINIC" WHERE "Approval_Status"='approved' AND "Clinic_Status"='active' ORDER BY "Clinic_Name" LIMIT 1000`),
  pool.query(`SELECT "Specialty_ID"::text id,"Name_AR" name FROM sdc."SPECIALTY" WHERE "Is_Active"=TRUE ORDER BY "Name_AR"`)
 ]);
 return {jobs:rows.rows,jobClinics:clinics.rows,jobCreateClinics:jobCreateClinics.rows,jobSpecialties:jobSpecialties.rows,jobFilters:{...filters,page},jobPager:{page,pages,total}};
}
async function detail(pool,id,query={}){
 if(!validId(id))return null;
 const job=await pool.query(`SELECT j."Job_ID"::text id,j."Job_Title" title,j."Job_Status" status,j."Admin_Suspended_At" admin_suspended_at,
 j."Employment_Type" employment,j."Minimum_Experience_Years" experience,j."Application_Deadline"::text deadline,
 j."Work_Schedule_Description" schedule,j."Salary_Description" salary,j."Summary" summary,
 j."Responsibilities" responsibilities,j."Requirements" requirements,
 c."Clinic_ID"::text clinic_id,c."Clinic_Name" clinic,c."City" city,
 s."Specialty_ID"::text specialty_id,s."Name_AR" specialty
 ${BASE} WHERE j."Job_ID"=$1::bigint`,[id]);
 if(!job.rowCount)return null;
 const filters=parseApplicationFilters(query),args=[id],conds=['a."Job_ID"=$1::bigint'];
 if(filters.status){args.push(filters.status);conds.push(`a."Application_Status"=$${args.length}`);}
 if(filters.from){args.push(filters.from);conds.push(`a."Applied_At">=$${args.length}::date`);}
 if(filters.to){args.push(filters.to);conds.push(`a."Applied_At"<($${args.length}::date + INTERVAL '1 day')`);}
 const where=' WHERE '+conds.join(' AND ');
 const totalResult=await pool.query(`SELECT count(*)::integer AS total FROM sdc."APPLIES_FOR" a${where}`,args);
 const total=Number(totalResult.rows[0]?.total)||0,pages=Math.max(1,Math.ceil(total/size)),page=Math.min(filters.page,pages);
 const [applications,counts]=await Promise.all([
 pool.query(`SELECT a."Application_ID"::text id,a."Doctor_ID"::text doctor_id,a."Full_Name" name,
 a."Specialty_Name" specialty,a."Application_Status" status,to_char(a."Applied_At",'YYYY-MM-DD HH24:MI') applied_at
 FROM sdc."APPLIES_FOR" a${where} ORDER BY a."Applied_At" DESC,a."Application_ID" DESC
 LIMIT $${args.length+1} OFFSET $${args.length+2}`,[...args,size,(page-1)*size]),
 pool.query(`SELECT count(*)::integer total,count(*) FILTER(WHERE "Application_Status"='pending')::integer pending,
 count(*) FILTER(WHERE "Application_Status"='accepted')::integer accepted
 FROM sdc."APPLIES_FOR" WHERE "Job_ID"=$1::bigint`,[id])]);
 const jobSpecialties=await pool.query(`SELECT "Specialty_ID"::text id,"Name_AR" name FROM sdc."SPECIALTY" WHERE "Is_Active"=TRUE ORDER BY "Name_AR"`);
 return {job:job.rows[0],jobSpecialties:jobSpecialties.rows,applications:applications.rows,counts:counts.rows[0],appFilters:{...filters,page},appPager:{page,pages,total}};
}
async function application(pool,id){
 if(!validId(id))return null;
 const r=await pool.query(`SELECT a."Application_ID"::text id,a."Job_ID"::text job_id,a."Doctor_ID"::text doctor_id,
 a."Application_Status" status,to_char(a."Applied_At",'YYYY-MM-DD HH24:MI') applied_at,
 a."Expected_Salary" expected_salary,a."Cover_Letter" cover_letter,a."Clinic_Feedback" feedback,
 a."Full_Name" full_name,a."Email" email,a."Phone" phone,a."Residence_City" city,
 a."Specialty_Name" specialty,a."License_Number" license,a."License_Status" license_status,
 a."Years_Of_Experience" years_experience,
 j."Job_Title" job_title,j."Job_Status" job_status,c."Clinic_ID"::text clinic_id,c."Clinic_Name" clinic,
 u."Account_Status" doctor_account_status,d."License_Status" current_license_status
 FROM sdc."APPLIES_FOR" a JOIN sdc."JOB" j ON j."Job_ID"=a."Job_ID"
 JOIN sdc."CLINIC" c ON c."Clinic_ID"=j."Clinic_ID" JOIN sdc."DOCTOR" d ON d."Doctor_ID"=a."Doctor_ID"
 JOIN sdc."USER" u ON u."User_ID"=d."User_ID" WHERE a."Application_ID"=$1::bigint`,[id]);
 if(!r.rowCount)return null;
 const [files,notes]=await Promise.all([
 pool.query(`SELECT "Attachment_ID"::text id,"Attachment_Type" type,"File_Name" name,
 to_char("Uploaded_At",'YYYY-MM-DD HH24:MI') uploaded_at
 FROM sdc."JOB_APPLICATION_ATTACHMENTS" WHERE "Application_ID"=$1::bigint ORDER BY "Uploaded_At" DESC,"Attachment_ID" DESC`,[id]),
 pool.query(`SELECT to_char(a."Occurred_At",'YYYY-MM-DD HH24:MI') occurred,a."Reason" reason,
 concat_ws(' ',u."First_Name",u."Last_Name") actor
 FROM sdc."AUDIT_LOG" a LEFT JOIN sdc."USER" u ON u."User_ID"=a."User_ID"
 WHERE a."Target_Type"='JobApplication' AND a."Target_Reference"=$1
 ORDER BY a."Occurred_At" DESC,a."Log_ID" DESC LIMIT 30`,[id])]);
 return {application:r.rows[0],attachments:files.rows,oversightNotes:notes.rows};
}
async function attachment(pool,appId,attachmentId){
 if(!validId(appId)||!validId(attachmentId))return null;
 const rs=await pool.query(`SELECT f."File_Reference" ref,f."File_Name" name
 FROM sdc."JOB_APPLICATION_ATTACHMENTS" f WHERE f."Application_ID"=$1::bigint AND f."Attachment_ID"=$2::bigint`,[appId,attachmentId]);
 return rs.rows[0]||null;
}
async function mutate(pool,{adminId,kind,id,body={}}){
 if(!validId(String(adminId))||!validId(String(id))||!['suspend','resume','delete','note'].includes(kind))return {status:'invalid'};
 const why=reasonText(body.reason);if(!why)return {status:'invalid'};
 const db=await pool.connect();
 try{
  await db.query('BEGIN');
  await db.query("SELECT set_config('sdc.user_id',$1,true)",[String(adminId)]);
  const access=await db.query('SELECT sdc.sdc_is_superadmin($1::bigint) AS allowed',[adminId]);
  if(access.rows[0]?.allowed!==true){await db.query('ROLLBACK');return {status:'unauthorized'};}
  let target='',event='',description='';
  if(kind!=='note'){
   const record=await db.query(`SELECT "Job_Status" status,"Admin_Suspended_At" admin_suspended_at,("Application_Deadline" < (now() AT TIME ZONE 'Asia/Hebron')::date) AS expired
     FROM sdc."JOB" WHERE "Job_ID"=$1::bigint FOR UPDATE`,[id]);
   if(!record.rowCount){await db.query('ROLLBACK');return {status:'not_found'};}
   const job=record.rows[0];
   if(kind==='suspend'){
    if(job.status!=='open'||job.admin_suspended_at){await db.query('ROLLBACK');return {status:'unchanged'};}
    await db.query(`UPDATE sdc."JOB" SET "Job_Status"='closed',"Admin_Suspended_At"=LOCALTIMESTAMP WHERE "Job_ID"=$1::bigint`,[id]);
    event='job.admin.suspended';description='تعليق إعلان مفتوح بقرار إداري ومنع تعديله أو إعادة نشره من العيادة';
   }else if(kind==='resume'){
    if(!job.admin_suspended_at||job.status!=='closed'){await db.query('ROLLBACK');return {status:'unchanged'};}
    if(job.expired){
     await db.query('ROLLBACK');return {status:'expired'};
    }
    await db.query(`UPDATE sdc."JOB" SET "Admin_Suspended_At"=NULL,"Job_Status"='open' WHERE "Job_ID"=$1::bigint`,[id]);
    event='job.admin.resumed';description='رفع التعليق الإداري عن إعلان الوظيفة وإعادة نشره';
   }else{
    if(job.admin_suspended_at){await db.query('ROLLBACK');return {status:'in_use'};}
    const count=await db.query(`SELECT 1 FROM sdc."APPLIES_FOR" WHERE "Job_ID"=$1::bigint LIMIT 1`,[id]);
    if(count.rowCount){await db.query('ROLLBACK');return {status:'in_use'};}
    // FK constraints protect any additional references not known to this module.
    await db.query(`DELETE FROM sdc."JOB" WHERE "Job_ID"=$1::bigint`,[id]);
    event='job.admin.unused_deleted';description='حذف إعلان دون أي طلبات توظيف مع حفظ التدقيق الإداري';
   }
   target='Job';
  }else{
   const exists=await db.query(`SELECT 1 FROM sdc."APPLIES_FOR" WHERE "Application_ID"=$1::bigint FOR UPDATE`,[id]);
   if(!exists.rowCount){await db.query('ROLLBACK');return {status:'not_found'};}
   target='JobApplication';event='job_application.admin_note';description='ملاحظة رقابية للمشرف، دون تعديل قرار العيادة';
  }
  await db.query(`INSERT INTO sdc."AUDIT_LOG"("Occurred_At","Action_Type","Target_Type","Target_Reference","Description","Reason","User_ID")
   VALUES(LOCALTIMESTAMP,$1,$2,$3,$4,$5,$6::bigint)`,[event,target,id,description,why,adminId]);
  await db.query('COMMIT');return {status:'ok'};
 }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}finally{db.release();}
}
module.exports={validId,reasonText,parseJobFilters,parseApplicationFilters,list,detail,application,attachment,mutate};
