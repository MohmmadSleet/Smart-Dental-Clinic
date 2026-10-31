'use strict';
// Platform corrections to publicly visible clinic contact/profile data.
// Approval, ownership, license, coordinates and operational workflows are NOT modified here.
const ID=/^[1-9]\d{0,17}$/;
const clean=(v,max)=>typeof v==='string'&&v.trim().length>0&&v.trim().length<=max?v.trim().replace(/\s+/g,' '):null;
const optional=(v,max)=>typeof v==='string'&&v.trim().length<=max?v.trim():null;
const email=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function parse(body={}){
 const fields={name:clean(body.name,150),phone:clean(body.phone,30),email:clean(body.email,254)?.toLowerCase(),
  city:clean(body.city,150),area:clean(body.area,150),address:clean(body.address,2000),description:optional(body.description,4000),
  reason:clean(body.reason,1000)};
 if(Object.values(fields).some(x=>x===null)||fields.reason.length<8||!email.test(fields.email)||
  /[\u0000-\u001f]/.test([fields.name,fields.phone,fields.email,fields.city,fields.area,fields.address].join(' ')))return null;
 return fields;
}
async function update(pool,{clinicId,adminId,body}){
 if(!ID.test(String(clinicId))||!ID.test(String(adminId)))return {status:'invalid'};
 const v=parse(body);if(!v)return {status:'invalid'};
 const db=await pool.connect();
 try{
  await db.query('BEGIN');
  await db.query("SELECT set_config('sdc.user_id',$1,true)",[String(adminId)]);
  const allowed=await db.query('SELECT sdc.sdc_is_superadmin($1::bigint) allowed',[adminId]);
  if(allowed.rows[0]?.allowed!==true){await db.query('ROLLBACK');return {status:'unauthorized'};}
  const old=await db.query(`SELECT "Clinic_Name","Clinic_Phone","Clinic_Email","City","Area","Address_Text","Description"
    FROM sdc."CLINIC" WHERE "Clinic_ID"=$1::bigint FOR UPDATE`,[clinicId]);
  if(!old.rowCount){await db.query('ROLLBACK');return {status:'not_found'};}
  const o=old.rows[0];
  if(o.Clinic_Name===v.name&&o.Clinic_Phone===v.phone&&o.Clinic_Email===v.email&&o.City===v.city&&o.Area===v.area&&o.Address_Text===v.address&&(o.Description||'')===(v.description||'')){
   await db.query('ROLLBACK');return {status:'unchanged'};
  }
  await db.query(`UPDATE sdc."CLINIC" SET "Clinic_Name"=$2,"Clinic_Phone"=$3,"Clinic_Email"=$4,"City"=$5,"Area"=$6,"Address_Text"=$7,"Description"=$8
   WHERE "Clinic_ID"=$1::bigint`,[clinicId,v.name,v.phone,v.email,v.city,v.area,v.address,v.description||null]);
  await db.query(`INSERT INTO sdc."AUDIT_LOG"("Occurred_At","Action_Type","Target_Type","Target_Reference","Description","Reason","User_ID")
   VALUES(LOCALTIMESTAMP,'clinic.admin.profile.updated','Clinic',$1::varchar(512),'تصحيح بيانات التواصل والوصف للعيادة بواسطة المشرف العام دون تغيير الملكية أو الترخيص أو الاعتماد',$2,$3::bigint)`,
   [String(clinicId),v.reason,adminId]);
  await db.query('COMMIT');return {status:'ok'};
 }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}finally{db.release();}
}
module.exports={parse,update};

// Delete only a rejected, never-operated clinic application. Dependents other
// than its private application documents are deliberately NOT cascaded; FKs
// stop deletion of anything with a booking, membership, invoice, etc.
async function deleteRejected(pool,{clinicId,adminId,reason}){
 if(!ID.test(String(clinicId))||!ID.test(String(adminId))||!clean(reason,1000)||reason.trim().length<8)return {status:'invalid'};
 const db=await pool.connect();let references=[];
 try{
  await db.query('BEGIN');
  await db.query("SELECT set_config('sdc.user_id',$1,true)",[String(adminId)]);
  const allowed=await db.query('SELECT sdc.sdc_is_superadmin($1::bigint) allowed',[adminId]);
  if(allowed.rows[0]?.allowed!==true){await db.query('ROLLBACK');return {status:'unauthorized'};}
  const c=await db.query('SELECT "Approval_Status","Clinic_Status" FROM sdc."CLINIC" WHERE "Clinic_ID"=$1::bigint FOR UPDATE',[clinicId]);
  if(!c.rowCount){await db.query('ROLLBACK');return {status:'not_found'};}
  if(c.rows[0].Approval_Status!=='rejected'||c.rows[0].Clinic_Status!=='inactive'){
   await db.query('ROLLBACK');return {status:'not_deletable'};
  }
  const files=await db.query('SELECT "File_Reference" FROM sdc."CLINIC_DOCUMENTS" WHERE "Clinic_ID"=$1::bigint FOR UPDATE',[clinicId]);
  references=files.rows.map(x=>x.File_Reference);
  await db.query('DELETE FROM sdc."CLINIC_DOCUMENTS" WHERE "Clinic_ID"=$1::bigint',[clinicId]);
  // No CASCADE: any remaining FK must stop this transaction.
  await db.query('DELETE FROM sdc."CLINIC" WHERE "Clinic_ID"=$1::bigint',[clinicId]);
  await db.query(`INSERT INTO sdc."AUDIT_LOG"("Occurred_At","Action_Type","Target_Type","Target_Reference","Description","Reason","User_ID")
   VALUES(LOCALTIMESTAMP,'clinic.rejected.unused_deleted','Clinic',$1::varchar(512),
   'حذف طلب عيادة مرفوض غير مرتبط بسجلات تشغيلية مع وثائق الطلب',$2,$3::bigint)`,[clinicId,reason.trim(),adminId]);
  await db.query('COMMIT');
 }catch(e){await db.query('ROLLBACK').catch(()=>{});if(e?.code==='23503')return {status:'in_use'};throw e;}finally{db.release();}
 // The database deletion is complete; remove private files after commit.
 const fs=require('node:fs/promises');
 const {documentPath}=require('../clinic/onboarding/service');
 const failed=[];
 for(const reference of references){
  const file=documentPath(reference);
  if(!file){failed.push(reference);continue;}
  try{await fs.unlink(file);}catch(e){if(e?.code!=='ENOENT')failed.push(reference);}
 }
 if(failed.length)console.error('[ADMIN_CLINIC_DOCUMENT_CLEANUP_PENDING]',{clinicId,count:failed.length});
 return {status:failed.length?'cleanup_pending':'ok'};
}
module.exports.deleteRejected=deleteRejected;
