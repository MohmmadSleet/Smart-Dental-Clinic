'use strict';
// Global specialties and reusable service names. No service/specialty suspension.
// Clinic-specific fees/durations/doctor assignments are intentionally NOT managed here.
const ID=/^[1-9]\d{0,17}$/;
const validId=value=>ID.test(String(value||''));
const normalized=(v,max)=>typeof v==='string'&&v.trim().length>0&&v.trim().length<=max?v.trim().replace(/\s+/g,' '):null;
const reason=v=>{const r=normalized(v,1000);return r&&r.length>=8?r:null;};

async function specialties(pool){
 const r=await pool.query(`SELECT s."Specialty_ID"::text AS id,s."Name_AR" AS ar,s."Name_EN" AS en,s."Is_Active" AS active,
 (SELECT COUNT(*)::integer FROM sdc."HAS_SPECIALTY" h WHERE h."Specialty_ID"=s."Specialty_ID") AS doctors,
 (SELECT COUNT(*)::integer FROM sdc."JOB" j WHERE j."Specialty_ID"=s."Specialty_ID") AS jobs,
 (SELECT COUNT(*)::integer FROM sdc."AI_ASSESSMENT" a WHERE a."Specialty_ID"=s."Specialty_ID") AS assessments
 FROM sdc."SPECIALTY" s ORDER BY s."Name_AR",s."Specialty_ID"`);
 return {specialties:r.rows,summary:{total:r.rows.length,active:r.rows.filter(s=>s.active).length}};
}
async function services(pool){
 const r=await pool.query(`SELECT s."Service_ID"::text AS id,s."Service_Name" AS name,TRUE AS active,
 (SELECT COUNT(*)::integer FROM sdc."OFFERS" o WHERE o."Service_ID"=s."Service_ID") AS clinics,
 (SELECT COUNT(*)::integer FROM sdc."PROVIDES" p WHERE p."Service_ID"=s."Service_ID") AS assignments,
 (SELECT COUNT(*)::integer FROM sdc."BOOKING" b WHERE b."Service_ID"=s."Service_ID") AS bookings,
 (SELECT COUNT(*)::integer FROM sdc."PROCEDURE" p WHERE p."Service_ID"=s."Service_ID") AS procedures,
 (SELECT COUNT(*)::integer FROM sdc."AI_RECOMMENDATION" r WHERE r."Service_ID"=s."Service_ID") AS recommendations,
 (SELECT MIN(o."Clinic_ID")::text FROM sdc."OFFERS" o WHERE o."Service_ID"=s."Service_ID") AS first_clinic_id
 FROM sdc."SERVICE" s ORDER BY s."Service_Name",s."Service_ID"`);
 return {services:r.rows,summary:{total:r.rows.length,inUse:r.rows.filter(s=>Number(s.clinics)>0).length}};
}
async function mutate(pool,{kind,action,id,adminId,body={}}){
 if(!['specialty','service'].includes(kind)||!['create','update','delete'].includes(action))return {status:'invalid'};
 if(!validId(adminId)||action!=='create'&&!validId(id))return {status:'invalid'};
 const why=reason(body.reason);
 if(!why)return {status:'invalid'};
 const ar=kind==='specialty'&&['create','update'].includes(action)?normalized(body.ar,150):null;
 const en=kind==='specialty'&&['create','update'].includes(action)?normalized(body.en,150):null;
 const name=kind==='service'&&['create','update'].includes(action)?normalized(body.name,150):null;
 if(['create','update'].includes(action)&&!(kind==='specialty'?ar&&en:name))return {status:'invalid'};
 if(kind==='specialty'&&['create','update'].includes(action)&&!(/^[\p{L}][\p{L}\p{M}\p{N} .()\-\/،_]{0,149}$/u.test(ar)&&/^[\p{L}][\p{L}\p{M}\p{N} .()\-\/_]{0,149}$/u.test(en)))return {status:'invalid'};
 const db=await pool.connect();
 try{
  await db.query('BEGIN');
  await db.query("SELECT set_config('sdc.user_id',$1,true)",[String(adminId)]);
  const auth=await db.query('SELECT sdc.sdc_is_superadmin($1::bigint) AS allowed',[adminId]);
  if(auth.rows[0]?.allowed!==true){await db.query('ROLLBACK');return {status:'unauthorized'};}
  // Same advisory lock as the schema's global write gate; take it BEFORE reading
  // duplicate names so simultaneous writes cannot both pass the check.
  await db.query('SELECT pg_advisory_xact_lock(534443,570406)');
  const table=kind==='specialty'?'SPECIALTY':'SERVICE',pk=kind==='specialty'?'Specialty_ID':'Service_ID';
  let current=null;
  if(action!=='create'){
   const found=await db.query(`SELECT * FROM sdc."${table}" WHERE "${pk}"=$1::bigint FOR UPDATE`,[id]);
   if(!found.rowCount){await db.query('ROLLBACK');return {status:'not_found'};}
   current=found.rows[0];
  }
  let record=id;
  if(kind==='specialty'){
   if(['create','update'].includes(action)){
    const dup=await db.query(`SELECT 1 FROM sdc."SPECIALTY" WHERE (lower(btrim("Name_AR"))=lower($1) OR lower(btrim("Name_EN"))=lower($2)) AND ($3::bigint IS NULL OR "Specialty_ID"<>$3::bigint) LIMIT 1`,[ar,en,action==='create'?null:id]);
    if(dup.rowCount){await db.query('ROLLBACK');return {status:'duplicate'};}
    if(action==='create'){
     const inserted=await db.query(`INSERT INTO sdc."SPECIALTY"("Name_AR","Name_EN","Is_Active") VALUES($1,$2,$3::boolean) RETURNING "Specialty_ID"`,[ar,en,true]);
     record=String(inserted.rows[0].Specialty_ID);
    }else{
     if(current.Name_AR===ar&&current.Name_EN===en){await db.query('ROLLBACK');return {status:'unchanged'};}
     await db.query(`UPDATE sdc."SPECIALTY" SET "Name_AR"=$2,"Name_EN"=$3 WHERE "Specialty_ID"=$1::bigint`,[id,ar,en]);
    }
   }else{
    const used=await db.query(`SELECT (EXISTS(SELECT 1 FROM sdc."HAS_SPECIALTY" WHERE "Specialty_ID"=$1::bigint)
      OR EXISTS(SELECT 1 FROM sdc."JOB" WHERE "Specialty_ID"=$1::bigint)
      OR EXISTS(SELECT 1 FROM sdc."AI_ASSESSMENT" WHERE "Specialty_ID"=$1::bigint)) AS used`,[id]);
    if(action==='delete'&&used.rows[0]?.used){
     await db.query('ROLLBACK');return {status:'in_use'};
    }
    await db.query('DELETE FROM sdc."SPECIALTY" WHERE "Specialty_ID"=$1::bigint',[id]);
   }
  }else{
   if(['create','update'].includes(action)){
    const dup=await db.query(`SELECT 1 FROM sdc."SERVICE" WHERE lower(btrim("Service_Name"))=lower($1) AND ($2::bigint IS NULL OR "Service_ID"<>$2::bigint) LIMIT 1`,[name,action==='create'?null:id]);
    if(dup.rowCount){await db.query('ROLLBACK');return {status:'duplicate'};}
   }
   {
    if(action!=='create'){
    const usage=await db.query(`SELECT
      EXISTS(SELECT 1 FROM sdc."OFFERS" WHERE "Service_ID"=$1::bigint) AS offers,
      EXISTS(SELECT 1 FROM sdc."PROVIDES" WHERE "Service_ID"=$1::bigint) AS assignments,
      EXISTS(SELECT 1 FROM sdc."BOOKING" WHERE "Service_ID"=$1::bigint) AS bookings,
      EXISTS(SELECT 1 FROM sdc."PROCEDURE" WHERE "Service_ID"=$1::bigint) AS procedures,
      EXISTS(SELECT 1 FROM sdc."AI_RECOMMENDATION" WHERE "Service_ID"=$1::bigint) AS recommendations`,[id]);
    const u=usage.rows[0]||{};
    if(action==='delete'&&Object.values(u).some(Boolean)){await db.query('ROLLBACK');return {status:'in_use'};}
    // Renaming a used service would alter the label on historical bookings.
    if(action==='update'&&(u.bookings||u.procedures||u.recommendations)){
     await db.query('ROLLBACK');return {status:'history'};
    }
   }
   if(action==='create'){
    const inserted=await db.query('INSERT INTO sdc."SERVICE"("Service_Name") VALUES($1) RETURNING "Service_ID"',[name]);
    record=String(inserted.rows[0].Service_ID);
   }else if(action==='update'){
    if(current.Service_Name===name){await db.query('ROLLBACK');return {status:'unchanged'};}
    await db.query('UPDATE sdc."SERVICE" SET "Service_Name"=$2 WHERE "Service_ID"=$1::bigint',[id,name]);
   }else if(action==='delete')await db.query('DELETE FROM sdc."SERVICE" WHERE "Service_ID"=$1::bigint',[id]);
   }
  }
  await db.query(`INSERT INTO sdc."AUDIT_LOG"("Occurred_At","Action_Type","Target_Type","Target_Reference","Description","Reason","User_ID")
    VALUES(LOCALTIMESTAMP,$1,$2,$3,$4,$5,$6::bigint)`,[
      `${kind}.${action}`,kind==='specialty'?'Specialty':'Service',String(record),
      ({create:'إضافة',update:'تعديل',delete:'حذف سجل غير مستخدم'})[action]+(kind==='specialty'?' تخصص':' خدمة'),why,adminId]);
  await db.query('COMMIT');return {status:'ok',id:String(record)};
 }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}finally{db.release();}
}
module.exports={specialties,services,mutate,validId,reason};
