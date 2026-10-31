'use strict';
// v27.20: privacy-preserving clinical oversight for Super Admin.
// Never select the report PDF reference, diagnosis, complaints, medications,
// medical files, prescriptions, or clinician notes in this read model.
const ID=/^[1-9]\d{0,17}$/;
const PAGE_SIZE=25;
const validId=x=>typeof x==='string'&&ID.test(x);
const validReason=x=>typeof x==='string'&&x.trim().length>=8&&x.trim().length<=1000&&!/[\u0000-\u001f\u007f]/.test(x);
const cleanDate=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x?x:'';
const states=new Set(['approved','awaiting']);
function filters(q={}){
 const page=typeof q.page==='string'&&/^\d{1,5}$/.test(q.page)?Math.max(1,Math.min(10000,Number(q.page))):1;
 return {q:validId(q.q)?q.q:'',clinic:validId(q.clinic)?q.clinic:'',state:states.has(q.state)?q.state:'',from:cleanDate(q.from),to:cleanDate(q.to),page};
}
const FROM=` FROM sdc."VISIT" v
 JOIN sdc."BOOKING" b ON b."Booking_ID"=v."Booking_ID"
 JOIN sdc."CLINIC" c ON c."Clinic_ID"=b."Clinic_ID"
 JOIN sdc."DOCTOR" d ON d."Doctor_ID"=b."Doctor_ID"
 JOIN sdc."USER" du ON du."User_ID"=d."User_ID"`;
const COLS=`v."Visit_ID"::text id,b."Booking_ID"::text booking_id,
 b."Appointment_Date"::text appointment_date,v."Visit_Status" visit_status,
 (v."Report_Approved_At" IS NOT NULL) report_approved,v."Report_Approved_At" approved_at,
 b."Clinic_ID"::text clinic_id,c."Clinic_Name" clinic_name,
 b."Doctor_ID"::text doctor_id,concat_ws(' ',du."First_Name",du."Last_Name") doctor_name`;
function where(f){
 const clauses=[],values=[];
 const add=(fragment,val)=>{values.push(val);clauses.push(fragment.replace('?',`$${values.length}`));};
 if(f.q)add(`v."Visit_ID"=?::bigint`,f.q);
 if(f.clinic)add(`b."Clinic_ID"=?::bigint`,f.clinic);
 if(f.state)clauses.push(f.state==='approved'?`v."Report_Approved_At" IS NOT NULL`:`v."Report_Approved_At" IS NULL`);
 if(f.from)add(`b."Appointment_Date">=?::date`,f.from);
 if(f.to)add(`b."Appointment_Date"<=?::date`,f.to);
 return {sql:clauses.length?' WHERE '+clauses.join(' AND '):'',values};
}
async function list(pool,query={}){
 const f=filters(query),{sql,values}=where(f);
 const [counter,clinics]=await Promise.all([
  pool.query(`SELECT count(*)::integer total ${FROM}${sql}`,values),
  pool.query(`SELECT "Clinic_ID"::text id,"Clinic_Name" name FROM sdc."CLINIC" ORDER BY "Clinic_Name","Clinic_ID"`)
 ]);
 const total=Number(counter.rows[0]?.total)||0;
 const pages=Math.max(1,Math.ceil(total/PAGE_SIZE)),page=Math.min(f.page,pages);
 const rows=await pool.query(`SELECT ${COLS}${FROM}${sql} ORDER BY b."Appointment_Date" DESC,v."Visit_ID" DESC LIMIT $${values.length+1} OFFSET $${values.length+2}`,[...values,PAGE_SIZE,(page-1)*PAGE_SIZE]);
 return {medicalRows:rows.rows,medicalClinics:clinics.rows,medicalFilters:{...f,page},medicalTotal:total,medicalPage:page,medicalPages:pages};
}
async function detail(pool,id){
 if(!validId(id))return null;
 const record=await pool.query(`SELECT ${COLS}${FROM} WHERE v."Visit_ID"=$1::bigint`,[id]);
 if(!record.rowCount)return null;
 const logs=await pool.query(`SELECT a."Log_ID"::text id,a."Occurred_At" occurred_at,a."Action_Type" action,
  CASE WHEN a."Action_Type"='visit.admin.oversight_note' THEN a."Reason" ELSE NULL END reason,
  concat_ws(' ',u."First_Name",u."Last_Name") actor
  FROM sdc."AUDIT_LOG" a LEFT JOIN sdc."USER" u ON u."User_ID"=a."User_ID"
  WHERE a."Target_Type"='Visit' AND a."Target_Reference"=$1::varchar(512)
  ORDER BY a."Occurred_At" DESC,a."Log_ID" DESC LIMIT 30`,[id]);
 return {medicalRecord:record.rows[0],medicalAudit:logs.rows};
}
async function note(pool,{visitId,adminId,reason}){
 if(!validId(String(visitId))||!validId(String(adminId))||!validReason(reason))return {status:'invalid'};
 const db=await pool.connect();
 try{
  await db.query('BEGIN');
  await db.query("SELECT set_config('sdc.user_id',$1,true)",[adminId]);
  const auth=await db.query('SELECT sdc.sdc_is_superadmin($1::bigint) allowed',[adminId]);
  if(auth.rows[0]?.allowed!==true){await db.query('ROLLBACK');return {status:'unauthorized'};}
  const found=await db.query('SELECT 1 FROM sdc."VISIT" WHERE "Visit_ID"=$1::bigint FOR SHARE',[visitId]);
  if(!found.rowCount){await db.query('ROLLBACK');return {status:'not_found'};}
  await db.query(`INSERT INTO sdc."AUDIT_LOG"("Occurred_At","Action_Type","Target_Type","Target_Reference","Description","Reason","User_ID")
   VALUES(LOCALTIMESTAMP,'visit.admin.oversight_note','Visit',$1::varchar(512),$2,$3,$4::bigint)`,
   [visitId,'ملاحظة إدارية رقابية حول حالة اعتماد التقرير، دون الاطلاع على بياناته السريرية أو تغييرها',reason.trim(),adminId]);
  await db.query('COMMIT');return {status:'ok'};
 }catch(err){await db.query('ROLLBACK').catch(()=>{});throw err;}finally{db.release();}
}
module.exports={validId,validReason,cleanDate,filters,where,list,detail,note,PAGE_SIZE};
