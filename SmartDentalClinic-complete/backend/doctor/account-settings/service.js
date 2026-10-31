'use strict';
// Account settings belong to the authenticated USER, regardless of which clinic
// the same person manages or works in. Only non-licensing profile fields are editable.
const {verifyPassword}=require('../../security/password');
const {contactFromBody,preferredLanguage}=require('../../clinic/account-settings/service');

function cleanName(value){
 if(typeof value!=='string')return null;
 const name=value.trim().replace(/\s+/g,' ');
 return name.length>=2&&name.length<=150&&!/[\x00-\x1f\x7f<>]/.test(name)?name:null;
}
function contactInput(body){
 const contact=contactFromBody(body);
 const firstName=cleanName(body?.first_name),lastName=cleanName(body?.last_name);
 return contact&&firstName&&lastName?{...contact,firstName,lastName}:null;
}
function professionalInput(body){
 const raw=body?.years_of_experience;
 const years=raw===''||raw===undefined?null:Number(raw);
 const bio=typeof body?.bio==='string'?body.bio.trim():null;
 if(bio===null||bio.length>2000||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(bio))return null;
 if(years!==null&&(!Number.isSafeInteger(years)||years<0||years>65))return null;
 return {years,bio:bio||null};
}
async function load(pool,userId,doctorId){
 const r=await pool.query(`SELECT u."User_ID",u."First_Name",u."Last_Name",u."Email",u."Phone",
    u."Preferred_Language",d."Doctor_ID",d."License_Number",d."License_Status",
    d."Years_Of_Experience",d."Bio"
   FROM sdc."USER" u JOIN sdc."DOCTOR" d ON d."User_ID"=u."User_ID"
   WHERE u."User_ID"=$1::bigint AND d."Doctor_ID"=$2::bigint AND u."Account_Status"='active'`,[userId,doctorId]);
 return r.rows[0]||null;
}
async function changeContact(pool,userId,doctorId,body){
 const data=contactInput(body);
 if(!data||typeof body?.password!=='string'||!body.password)return {status:'invalid'};
 const c=await pool.connect();
 try{
  await c.query('BEGIN');
  await c.query("SELECT set_config('sdc.user_id',$1::text,true)",[String(userId)]);
  const r=await c.query(`SELECT u."Password_Hash",u."Email" FROM sdc."USER" u
   JOIN sdc."DOCTOR" d ON d."User_ID"=u."User_ID"
   WHERE u."User_ID"=$1::bigint AND d."Doctor_ID"=$2::bigint AND u."Account_Status"='active' FOR UPDATE OF u`,[userId,doctorId]);
  if(r.rowCount!==1){await c.query('ROLLBACK');return {status:'not_found'};}
  if(!await verifyPassword(body.password,r.rows[0].Password_Hash)){
   await c.query('ROLLBACK');return {status:'password'};
  }
  if(String(r.rows[0].Email||'').toLowerCase()!==data.email){
   const collision=await c.query(`SELECT 1 FROM sdc."USER" WHERE lower(btrim("Email"))=lower(btrim($1::varchar(254))) AND "User_ID"<>$2::bigint LIMIT 1`,[data.email,userId]);
   if(collision.rowCount){await c.query('ROLLBACK');return {status:'duplicate'};}
  }
  await c.query(`UPDATE sdc."USER" SET "First_Name"=$2::varchar(150),"Last_Name"=$3::varchar(150),
   "Email"=$4::varchar(254),"Phone"=$5::varchar(30) WHERE "User_ID"=$1::bigint`,
   [userId,data.firstName,data.lastName,data.email,data.phone]);
  await c.query(`INSERT INTO sdc."AUDIT_LOG" ("Occurred_At","Action_Type","Target_Type","Target_Reference","Description","User_ID")
   VALUES (LOCALTIMESTAMP,'doctor.account.contact.updated','User',$1,'تحديث بيانات حساب الطبيب',$2::bigint)`,[String(userId),userId]);
  await c.query('COMMIT');return {status:'ok'};
 }catch(error){try{await c.query('ROLLBACK');}catch{};if(error.code==='23505')return {status:'duplicate'};throw error;}finally{c.release();}
}
async function changeProfessional(pool,userId,doctorId,body){
 const data=professionalInput(body);if(!data)return {status:'invalid'};
 const c=await pool.connect();
 try{
  await c.query('BEGIN');
  await c.query("SELECT set_config('sdc.user_id',$1::text,true)",[String(userId)]);
  const changed=await c.query(`UPDATE sdc."DOCTOR" SET "Years_Of_Experience"=$3::int,"Bio"=$4::text
    WHERE "Doctor_ID"=$1::bigint AND "User_ID"=$2::bigint RETURNING "Doctor_ID"`,[doctorId,userId,data.years,data.bio]);
  if(!changed.rowCount){await c.query('ROLLBACK');return {status:'not_found'};}
  await c.query(`INSERT INTO sdc."AUDIT_LOG" ("Occurred_At","Action_Type","Target_Type","Target_Reference","Description","User_ID")
    VALUES (LOCALTIMESTAMP,'doctor.account.professional.updated','Doctor',$1,'تحديث نبذة الطبيب وخبرته دون تغيير الترخيص',$2::bigint)`,[String(doctorId),userId]);
  await c.query('COMMIT');return {status:'ok'};
 }catch(error){try{await c.query('ROLLBACK');}catch{};throw error;}finally{c.release();}
}
async function changeLanguage(pool,userId,doctorId,language){
 if(!preferredLanguage(language))return {status:'invalid'};
 const c=await pool.connect();
 try{
  await c.query('BEGIN');
  await c.query("SELECT set_config('sdc.user_id',$1::text,true)",[String(userId)]);
  const updated=await c.query(`UPDATE sdc."USER" SET "Preferred_Language"=$3::varchar(10)
   WHERE "User_ID"=$1::bigint AND "Account_Status"='active'
     AND EXISTS(SELECT 1 FROM sdc."DOCTOR" WHERE "User_ID"=$1::bigint AND "Doctor_ID"=$2::bigint)`,[userId,doctorId,language]);
  if(!updated.rowCount){await c.query('ROLLBACK');return {status:'not_found'};}
  await c.query(`INSERT INTO sdc."AUDIT_LOG" ("Occurred_At","Action_Type","Target_Type","Target_Reference","Description","User_ID")
  VALUES (LOCALTIMESTAMP,'doctor.account.language.updated','User',$1,'تعديل اللغة المفضلة لحساب الطبيب',$2::bigint)`,[String(userId),userId]);
  await c.query('COMMIT');return {status:'ok'};
 }catch(error){try{await c.query('ROLLBACK');}catch{};throw error;}finally{c.release();}
}
module.exports={cleanName,contactInput,professionalInput,load,changeContact,changeProfessional,changeLanguage};
