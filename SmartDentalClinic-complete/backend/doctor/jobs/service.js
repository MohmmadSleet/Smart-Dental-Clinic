'use strict';
// Applicant-owned job workflow. Never trust doctor, clinic, specialty or license values sent by browsers.
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const ROOT=path.resolve(process.env.JOB_APPLICATION_FILES_DIR||path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'.smart-dental-clinic'),'SmartDentalClinic','job-applications'));
const ID=/^[1-9]\d{0,17}$/;
const validId=value=>ID.test(String(value||''));
const cut=(x,n)=>String(x||'').trim().slice(0,n);
const STATUS=Object.freeze({pending:'قيد المراجعة',accepted:'مقبول',rejected:'مرفوض',withdrawn:'مسحوب'});
const TYPES=Object.freeze({full_time:'دوام كامل',part_time:'دوام جزئي',contract:'عقد'});
const BASE=` FROM sdc."JOB" j JOIN sdc."CLINIC" c ON c."Clinic_ID"=j."Clinic_ID"
 JOIN sdc."SPECIALTY" s ON s."Specialty_ID"=j."Specialty_ID"`;
const ACTIVE=`j."Job_Status"='open' AND j."Admin_Suspended_At" IS NULL
 AND j."Application_Deadline">=(now() AT TIME ZONE 'Asia/Hebron')::date
 AND c."Clinic_Status"='active' AND c."Approval_Status"='approved'`;
const COLUMNS=`j."Job_ID"::text id,j."Job_Title" title,j."Employment_Type" employment,
 j."Minimum_Experience_Years" experience,j."Application_Deadline"::text deadline,
 j."Work_Schedule_Description" schedule,j."Salary_Description" salary,j."Summary" summary,
 j."Responsibilities" responsibilities,j."Requirements" requirements,j."Job_Status" status,
 j."Admin_Suspended_At" suspended_at,c."Clinic_ID"::text clinic_id,c."Clinic_Name" clinic,c."City" city,
 s."Specialty_ID"::text specialty_id,s."Name_AR" specialty`;
function queryFilters(query={}){
 const q=cut(query.q,80),city=cut(query.city,100),specialty=validId(query.specialty)?String(query.specialty):'',employment=TYPES[query.employment]?query.employment:'';
 return {q,city,specialty,employment,page:/^[1-9]\d{0,3}$/.test(String(query.page||''))?Math.min(9999,Number(query.page)):1};
}
async function list(pool,query={}){
 const f=queryFilters(query),clauses=[ACTIVE],args=[];
 if(f.q){args.push('%'+f.q.replace(/[\\%_]/g,'\\$&')+'%');clauses.push(`concat_ws(' ',j."Job_Title",c."Clinic_Name",s."Name_AR",c."City") ILIKE $${args.length} ESCAPE '\\'`);}
 if(f.city){args.push(f.city);clauses.push(`c."City"=$${args.length}`);}
 if(f.specialty){args.push(f.specialty);clauses.push(`j."Specialty_ID"=$${args.length}::bigint`);}
 if(f.employment){args.push(f.employment);clauses.push(`j."Employment_Type"=$${args.length}`);}
 const where=' WHERE '+clauses.join(' AND ');
 const [count,filters]=await Promise.all([
  pool.query(`SELECT count(*)::int AS total${BASE}${where}`,args),
  pool.query(`SELECT "Specialty_ID"::text id,"Name_AR" name FROM sdc."SPECIALTY" WHERE "Is_Active"=true ORDER BY "Name_AR"`)
 ]);
 const total=Number(count.rows[0]?.total||0),pages=Math.max(1,Math.ceil(total/20)),page=Math.min(f.page,pages);
 const jobs=await pool.query(`SELECT ${COLUMNS}${BASE}${where} ORDER BY j."Job_ID" DESC LIMIT $${args.length+1} OFFSET $${args.length+2}`,[...args,20,(page-1)*20]);
 return {jobs:jobs.rows,filters:{...f,page},pager:{total,pages,page},specialties:filters.rows};
}
async function detail(pool,id,doctorId){
 if(!validId(id))return null;
 const r=await pool.query(`SELECT ${COLUMNS},(${ACTIVE}) AS available,
 EXISTS(SELECT 1 FROM sdc."HAS_SPECIALTY" h WHERE h."Doctor_ID"=$2::bigint AND h."Specialty_ID"=j."Specialty_ID") AS specialty_match,
 (SELECT "Application_ID"::text FROM sdc."APPLIES_FOR" a WHERE a."Doctor_ID"=$2::bigint AND a."Job_ID"=j."Job_ID" LIMIT 1) AS application_id
 ${BASE} WHERE j."Job_ID"=$1::bigint AND ((${ACTIVE}) OR EXISTS(
    SELECT 1 FROM sdc."APPLIES_FOR" p WHERE p."Doctor_ID"=$2::bigint AND p."Job_ID"=j."Job_ID"))`,[id,doctorId]);return r.rows[0]||null;
}
async function doctorProfile(pool,actor){
 if(!validId(actor?.doctorId)||!validId(actor?.userId))return null;
 const r=await pool.query(`SELECT d."Doctor_ID"::text id,d."License_Number" license,d."License_Status" license_status,
 d."Years_Of_Experience" years,u."First_Name"||' '||u."Last_Name" name,u."Email" email,u."Phone" phone
 FROM sdc."DOCTOR" d JOIN sdc."USER" u ON u."User_ID"=d."User_ID"
 WHERE d."Doctor_ID"=$1::bigint AND d."User_ID"=$2::bigint AND u."Account_Status"='active'`,[actor.doctorId,actor.userId]);
 return r.rows[0]||null;
}
function kind(file){
 if(!file?.buffer||!file.size||file.size>5*1024*1024)return null;
 const b=file.buffer,ext=path.extname(file.originalname||'').toLowerCase();
 if(ext==='.pdf'&&b.subarray(0,5).toString()==='%PDF-')return {ext,mime:'application/pdf'};
 if((ext==='.jpg'||ext==='.jpeg')&&b[0]===255&&b[1]===216&&b[2]===255)return {ext:'.jpg',mime:'image/jpeg'};
 if(ext==='.png'&&b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return {ext,mime:'image/png'};
 if(ext==='.docx'&&b.subarray(0,4).equals(Buffer.from([80,75,3,4])))return {ext,mime:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'};
 if(ext==='.doc'&&b.subarray(0,8).equals(Buffer.from([208,207,17,224,161,177,26,225])))return {ext,mime:'application/msword'};
 return null;
}
function validateFiles(files){
 const cv=files?.applicant_cv||[],certs=files?.applicant_certificates||[];
 if(cv.length!==1||certs.length>3)return null;
 const all=[...cv,...certs];if(all.reduce((n,f)=>n+f.size,0)>15*1024*1024)return null;
 const mapped=all.map((file,index)=>({file,type:index===0?'cv':'certificate',format:kind(file)}));
 return mapped.every(x=>x.format&& (x.type!=='cv'||['.pdf','.doc','.docx'].includes(x.format.ext)))?mapped:null;
}
function input(body,files){
 const phone=cut(body?.applicant_phone,30),city=cut(body?.applicant_city,150),exp=String(body?.applicant_experience||''),salary=String(body?.applicant_expected_salary||'').trim();
 const cover=cut(body?.applicant_cover_letter,5000);
 if(String(body?.application_consent)!=='on'||phone.length<7||city.length<2||String(body?.applicant_phone||'').length>30||String(body?.applicant_city||'').length>150||
  !/^\d{1,2}$/.test(exp)||Number(exp)>60||String(body?.applicant_cover_letter||'').length>5000||
  salary&&!/^(?:\d{1,8})(?:\.\d{1,2})?$/.test(salary))return null;
 const attachments=validateFiles(files);return attachments?{phone,city,experience:Number(exp),salary:salary||null,cover:cover||null,attachments}:null;
}
function storedPath(ref){return /^[0-9a-f-]{36}\.(pdf|doc|docx|jpg|png)$/.test(String(ref))?path.join(ROOT,ref):null;}
async function apply(pool,actor,jobId,body,files){
 if(!validId(jobId)||!validId(actor?.userId)||!validId(actor?.doctorId))return {status:'invalid'};
 const info=input(body,files);if(!info)return {status:'invalid'};
 const db=await pool.connect(),written=[];let committed=false;
 try{
  await db.query('BEGIN');await db.query("SET LOCAL TIME ZONE 'Asia/Hebron'");
  await db.query("SELECT set_config('sdc.user_id',$1,true)",[actor.userId]);
  const profile=await db.query(`SELECT d."Doctor_ID",d."License_Number",d."License_Status",u."Email",u."Phone",u."First_Name",u."Last_Name",u."Account_Status"
   FROM sdc."DOCTOR" d JOIN sdc."USER" u ON u."User_ID"=d."User_ID"
   WHERE d."Doctor_ID"=$1::bigint AND d."User_ID"=$2::bigint FOR UPDATE OF d`,[actor.doctorId,actor.userId]);
  const doc=profile.rows[0];if(!doc||doc.License_Status!=='verified'||doc.Account_Status!=='active'||!doc.Email){await db.query('ROLLBACK');return {status:'forbidden'};}
  const job=await db.query(`SELECT j."Job_ID",j."Clinic_ID",j."Specialty_ID",j."Job_Status",j."Application_Deadline",j."Admin_Suspended_At",
  c."Clinic_Status",c."Approval_Status",c."Manager_Doctor_ID"
  FROM sdc."JOB" j JOIN sdc."CLINIC" c ON c."Clinic_ID"=j."Clinic_ID" WHERE j."Job_ID"=$1::bigint FOR UPDATE OF j`,[jobId]);
  const j=job.rows[0];if(!j){await db.query('ROLLBACK');return {status:'not_found'};}
  const current=await db.query(`SELECT (now() AT TIME ZONE 'Asia/Hebron')::date<= $1::date AS valid`,[j.Application_Deadline]);
  if(j.Job_Status!=='open'||j.Admin_Suspended_At||j.Clinic_Status!=='active'||j.Approval_Status!=='approved'||current.rows[0]?.valid!==true){await db.query('ROLLBACK');return {status:'closed'};}
  const match=await db.query(`SELECT h."Specialty_ID" FROM sdc."HAS_SPECIALTY" h WHERE h."Doctor_ID"=$1::bigint AND h."Specialty_ID"=$2::bigint`,[actor.doctorId,j.Specialty_ID]);
  if(!match.rowCount){await db.query('ROLLBACK');return {status:'specialty'};}
  if(info.experience<Number(j.Minimum_Experience_Years)){await db.query('ROLLBACK');return {status:'experience'};}
  const existing=await db.query(`SELECT "Application_ID" FROM sdc."APPLIES_FOR" WHERE "Doctor_ID"=$1::bigint AND "Job_ID"=$2::bigint`,[actor.doctorId,jobId]);
  if(existing.rowCount){await db.query('ROLLBACK');return {status:'duplicate',id:String(existing.rows[0].Application_ID)};}
  const name=String(doc.First_Name+' '+doc.Last_Name).trim();
  const spec=await db.query(`SELECT "Name_AR" FROM sdc."SPECIALTY" WHERE "Specialty_ID"=$1::bigint`,[j.Specialty_ID]);
  const saved=await db.query(`INSERT INTO sdc."APPLIES_FOR"("Application_Status","Applied_At","Expected_Salary","Cover_Letter","Sharing_Consent_At","Full_Name","Email","Phone","Residence_City","Specialty_Name","License_Number","License_Status","Years_Of_Experience","Doctor_ID","Job_ID")
   VALUES('pending',LOCALTIMESTAMP,$1::numeric,$2,LOCALTIMESTAMP,$3,$4,$5,$6,$7,$8,$9,$10::int,$11::bigint,$12::bigint) RETURNING "Application_ID"`,
   [info.salary,info.cover,name,doc.Email,info.phone,info.city,spec.rows[0].Name_AR,doc.License_Number,doc.License_Status,info.experience,actor.doctorId,jobId]);
  const id=String(saved.rows[0].Application_ID);
  await fs.mkdir(ROOT,{recursive:true,mode:0o700});
  for(const item of info.attachments){
   const ref=crypto.randomUUID()+item.format.ext,filename=path.join(ROOT,ref);
   await fs.writeFile(filename,item.file.buffer,{flag:'wx',mode:0o600});written.push(filename);
   const display=path.basename(item.file.originalname).replace(/[\x00-\x1f\\/]/g,'_').slice(0,180)||'document'+item.format.ext;
   await db.query(`INSERT INTO sdc."JOB_APPLICATION_ATTACHMENTS"("Attachment_Type","File_Name","File_Reference","Uploaded_At","Application_ID") VALUES($1,$2,$3,LOCALTIMESTAMP,$4::bigint)`,[item.type,display,ref,id]);
  }
  const manager=await db.query(`SELECT "User_ID" FROM sdc."DOCTOR" WHERE "Doctor_ID"=$1::bigint`,[j.Manager_Doctor_ID]);
  if(manager.rowCount)await db.query(`INSERT INTO sdc."NOTIFICATION"("Title","Body","Notification_Type","Created_At","User_ID","Target_Type","Target_Reference") VALUES('طلب توظيف جديد','تقدّم طبيب على وظيفة منشورة في عيادتك.','clinic.job.application',LOCALTIMESTAMP,$1::bigint,'Clinic',$2::varchar(512))`,[manager.rows[0].User_ID,String(j.Clinic_ID)]);
  await db.query(`INSERT INTO sdc."AUDIT_LOG"("Occurred_At","Action_Type","Target_Type","Target_Reference","Description","User_ID") VALUES(LOCALTIMESTAMP,'job.application.submitted','JobApplication',$1::varchar(512),'تقديم طلب توظيف من الطبيب',$2::bigint)`,[id,actor.userId]);
  await db.query('COMMIT');committed=true;return {status:'ok',id};
 }catch(error){await db.query('ROLLBACK').catch(()=>{});if(error.code==='23505')return {status:'duplicate'};throw error;}
 finally{if(!committed)await Promise.all(written.map(x=>fs.unlink(x).catch(()=>{})));db.release();}
}
async function application(pool,actor,id){
 if(!validId(id)||!validId(actor?.doctorId))return null;
 const r=await pool.query(`SELECT a.*,j."Job_Title",j."Job_ID",j."Clinic_ID",c."Clinic_Name",c."City" AS "Clinic_City"
 FROM sdc."APPLIES_FOR" a JOIN sdc."JOB" j ON j."Job_ID"=a."Job_ID" JOIN sdc."CLINIC" c ON c."Clinic_ID"=j."Clinic_ID"
 WHERE a."Application_ID"=$1::bigint AND a."Doctor_ID"=$2::bigint`,[id,actor.doctorId]);
 if(!r.rowCount)return null;
 const current=r.rows[0];
 // The employment decision belongs to the exact job application, not a different clinic invite.
 const membership=await pool.query(`SELECT w."Membership_Status" AS status,
 EXISTS(SELECT 1 FROM sdc."PROVIDES" p JOIN sdc."OFFERS" o ON o."Clinic_ID"=p."Clinic_ID" AND o."Service_ID"=p."Service_ID" WHERE p."Clinic_ID"=w."Clinic_ID" AND p."Doctor_ID"=w."Doctor_ID" AND o."Is_Available"=true) AS ready_services,
 EXISTS(SELECT 1 FROM sdc."DOCTOR_WORKING_HOURS" h WHERE h."Clinic_ID"=w."Clinic_ID" AND h."Doctor_ID"=w."Doctor_ID" AND h."Is_Active"=true) AS ready_hours
 FROM sdc."WORKS_AT" w WHERE w."Clinic_ID"=$1::bigint AND w."Doctor_ID"=$2::bigint AND w."Admin_Notes"=$3 LIMIT 1`,[current.Clinic_ID,actor.doctorId,`تم قبول طلب التوظيف JA-${id}`]);
 const files=await pool.query(`SELECT "Attachment_ID"::text id,"Attachment_Type" type,"File_Name" name FROM sdc."JOB_APPLICATION_ATTACHMENTS" WHERE "Application_ID"=$1::bigint ORDER BY "Attachment_ID"`,[id]);
 return {application:{...current,job_membership_status:membership.rows[0]?.status||null,ready_for_booking:!!(membership.rows[0]?.ready_services&&membership.rows[0]?.ready_hours)},attachments:files.rows};
}
async function recentApplications(pool,actor){
 if(!validId(actor?.doctorId))return [];
 const rs=await pool.query(`SELECT a."Application_ID"::text id,a."Application_Status" status,a."Applied_At" applied,
 j."Job_Title" title,c."Clinic_Name" clinic FROM sdc."APPLIES_FOR" a JOIN sdc."JOB" j ON j."Job_ID"=a."Job_ID" JOIN sdc."CLINIC" c ON c."Clinic_ID"=j."Clinic_ID"
 WHERE a."Doctor_ID"=$1::bigint ORDER BY a."Applied_At" DESC,a."Application_ID" DESC LIMIT 50`,[actor.doctorId]);return rs.rows;
}
// Only the owner of an ACCEPTED application may decide its matching pending job invitation.
async function decideJobInvitation(pool,actor,id,action){
 if(!validId(id)||!validId(actor?.userId)||!validId(actor?.doctorId)||!['accept','decline'].includes(action))return {status:'invalid'};
 const db=await pool.connect();try{
  await db.query('BEGIN');await db.query("SELECT set_config('sdc.user_id',$1,true)",[actor.userId]);
  const verified=await db.query(`SELECT d."Doctor_ID" FROM sdc."DOCTOR" d JOIN sdc."USER" u ON u."User_ID"=d."User_ID" WHERE d."Doctor_ID"=$1::bigint AND d."User_ID"=$2::bigint AND d."License_Status"='verified' AND u."Account_Status"='active' AND u."Login_Enabled"=true FOR UPDATE OF d`,[actor.doctorId,actor.userId]);
  if(!verified.rowCount){await db.query('ROLLBACK');return {status:'forbidden'};}
  const app=await db.query(`SELECT a."Application_Status",j."Clinic_ID",j."Admin_Suspended_At",c."Manager_Doctor_ID",c."Clinic_Status",c."Approval_Status"
   FROM sdc."APPLIES_FOR" a JOIN sdc."JOB" j ON j."Job_ID"=a."Job_ID" JOIN sdc."CLINIC" c ON c."Clinic_ID"=j."Clinic_ID"
   WHERE a."Application_ID"=$1::bigint AND a."Doctor_ID"=$2::bigint FOR UPDATE OF a`,[id,actor.doctorId]);
  const row=app.rows[0];if(!row||row.Application_Status!=='accepted'||row.Admin_Suspended_At||row.Clinic_Status!=='active'||row.Approval_Status!=='approved'){await db.query('ROLLBACK');return {status:'unavailable'};}
  const updated=await db.query(`UPDATE sdc."WORKS_AT" SET "Membership_Status"=$4 WHERE "Clinic_ID"=$1::bigint AND "Doctor_ID"=$2::bigint AND "Membership_Status"='pending' AND "Admin_Notes"=$3 RETURNING "Doctor_ID"`,[row.Clinic_ID,actor.doctorId,`تم قبول طلب التوظيف JA-${id}`,action==='accept'?'active':'inactive']);
  if(!updated.rowCount){await db.query('ROLLBACK');return {status:'conflict'};}
  const owner=await db.query(`SELECT "User_ID" FROM sdc."DOCTOR" WHERE "Doctor_ID"=$1::bigint`,[row.Manager_Doctor_ID]);
  if(owner.rowCount)await db.query(`INSERT INTO sdc."NOTIFICATION"("Title","Body","Notification_Type","Created_At","Target_Type","Target_Reference","User_ID") VALUES($1,$2,'clinic.doctor.invitation.response',LOCALTIMESTAMP,'Clinic',$3::varchar(512),$4::bigint)`,[action==='accept'?'أكد الطبيب الانضمام':'اعتذر الطبيب عن الانضمام',action==='accept'?'انضم الطبيب عبر طلب التوظيف. يرجى إسناد الخدمات وتحديد الدوام قبل إتاحة الحجز.':'اعتذر الطبيب عن الانضمام بعد قبول طلب التوظيف.',String(row.Clinic_ID),owner.rows[0].User_ID]);
  await db.query(`INSERT INTO sdc."AUDIT_LOG"("Occurred_At","Action_Type","Target_Type","Target_Reference","Description","User_ID") VALUES(LOCALTIMESTAMP,$1,'JobApplication',$2::varchar(512),$3,$4::bigint)`,[action==='accept'?'job.application.joined':'job.application.join.declined',id,action==='accept'?'تأكيد الطبيب للانضمام وبدء إعداد خدماته ودوامه':'اعتذار الطبيب عن الانضمام',actor.userId]);
  await db.query('COMMIT');return {status:'ok'};
 }catch(error){await db.query('ROLLBACK').catch(()=>{});throw error;}finally{db.release();}
}
async function attachment(pool,actor,id,file){
 if(!validId(id)||!validId(file))return null;
 const r=await pool.query(`SELECT f."File_Reference" ref,f."File_Name" name
 FROM sdc."JOB_APPLICATION_ATTACHMENTS" f JOIN sdc."APPLIES_FOR" a ON a."Application_ID"=f."Application_ID"
 WHERE a."Application_ID"=$1::bigint AND f."Attachment_ID"=$2::bigint AND a."Doctor_ID"=$3::bigint`,[id,file,actor.doctorId]);
 const record=r.rows[0];if(!record)return null;const filename=storedPath(record.ref);
 return filename?{...record,filename}:null;
}
async function withdraw(pool,actor,id){
 if(!validId(id)||!validId(actor?.doctorId))return {status:'invalid'};
 const db=await pool.connect();try{await db.query('BEGIN');await db.query("SELECT set_config('sdc.user_id',$1,true)",[actor.userId]);
  const changed=await db.query(`UPDATE sdc."APPLIES_FOR" SET "Application_Status"='withdrawn' WHERE "Application_ID"=$1::bigint AND "Doctor_ID"=$2::bigint AND "Application_Status"='pending' RETURNING "Application_ID"`,[id,actor.doctorId]);
  if(!changed.rowCount){await db.query('ROLLBACK');return {status:'conflict'};}
  const manager=await db.query(`SELECT d."User_ID" AS user_id,j."Clinic_ID" AS clinic_id FROM sdc."APPLIES_FOR" a JOIN sdc."JOB" j ON j."Job_ID"=a."Job_ID" JOIN sdc."CLINIC" c ON c."Clinic_ID"=j."Clinic_ID" JOIN sdc."DOCTOR" d ON d."Doctor_ID"=c."Manager_Doctor_ID" WHERE a."Application_ID"=$1::bigint`,[id]);
  if(manager.rowCount)await db.query(`INSERT INTO sdc."NOTIFICATION"("Title","Body","Notification_Type","Created_At","User_ID","Target_Type","Target_Reference") VALUES('سحب طلب توظيف','سحب أحد الأطباء طلبه قبل اتخاذ القرار.','clinic.job.application',LOCALTIMESTAMP,$1::bigint,'Clinic',$2::varchar(512))`,[manager.rows[0].user_id,String(manager.rows[0].clinic_id)]);
  await db.query(`INSERT INTO sdc."AUDIT_LOG"("Occurred_At","Action_Type","Target_Type","Target_Reference","Description","User_ID") VALUES(LOCALTIMESTAMP,'job.application.withdrawn','JobApplication',$1::varchar(512),'سحب الطبيب طلب التوظيف قبل القرار',$2::bigint)`,[id,actor.userId]);
  await db.query('COMMIT');return {status:'ok'};
 }catch(error){await db.query('ROLLBACK').catch(()=>{});throw error;}finally{db.release();}
}
module.exports={ROOT,validId,STATUS,TYPES,queryFilters,list,detail,doctorProfile,input,kind,validateFiles,storedPath,apply,application,recentApplications,decideJobInvitation,attachment,withdraw};
