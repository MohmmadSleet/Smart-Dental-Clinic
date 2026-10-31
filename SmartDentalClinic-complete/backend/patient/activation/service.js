'use strict';
const crypto=require('node:crypto');
const {hashPassword}=require('../../security/password');
const {validToken}=require('../../auth/password-reset/service');
const {revokeUserSessions}=require('../../auth/session');
const {config}=require('../../auth/password-reset/delivery');
const {deliverActivation}=require('./delivery');
const IDENTITY_EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const TTL_MINUTES=20;
const tokenHash=token=>crypto.createHash('sha256').update('sdc.patient.claim.v1:'+token).digest('hex');
function validPassword(password){return typeof password==='string'&&password.length>=8&&password.length<=128&&/[A-Z]/.test(password)&&/[a-z]/.test(password)&&/[0-9]/.test(password);}
function patientIdentity(input){
  const email=typeof input?.email==='string'?input.email.trim().toLowerCase():'';
  const phone=typeof input?.phone==='string'?input.phone.replace(/\D/g,''):'';
  const dob=typeof input?.date_of_birth==='string'?input.date_of_birth.trim():'';
  const date=new Date(dob+'T00:00:00Z');
  if(email.length>254||!IDENTITY_EMAIL.test(email)||phone.length<7||phone.length>15||!DATE.test(dob)||!Number.isFinite(+date)||date.toISOString().slice(0,10)!==dob)return null;
  return {email,phone,dob};
}
async function requestActivation(pool,form,{sender=deliverActivation,lang="ar"}={}){
  config(); // Fail closed before storing a token if delivery isn't configured.
  const identity=patientIdentity(form);if(!identity)return false;
  const token=crypto.randomBytes(32).toString('hex');
  const client=await pool.connect();let user=null;
  try{
    await client.query('BEGIN');
    const rs=await client.query(`SELECT u."User_ID",u."Email" FROM sdc."USER" u
       JOIN sdc."PATIENT" p ON p."User_ID"=u."User_ID"
       WHERE lower(btrim(u."Email"))=$1 AND regexp_replace(u."Phone",'[^0-9]','','g')=$2
       AND p."Date_Of_Birth"=$3::date AND EXISTS(SELECT 1 FROM sdc."REGISTERED_AT" a WHERE a."Patient_ID"=p."Patient_ID")
       AND u."Account_Status"='active' AND u."Login_Enabled"=FALSE AND u."Password_Hash" IS NULL
       FOR UPDATE OF u`,[identity.email,identity.phone,identity.dob]);
    if(rs.rowCount!==1){await client.query('ROLLBACK');return false;}
    user=rs.rows[0];
    await client.query(`UPDATE sdc."USER" SET "Password_Reset_Token_Hash"=$2,
       "Password_Reset_Expires_At"=timezone('UTC',now())+interval '20 minutes'
       WHERE "User_ID"=$1`,[user.User_ID,tokenHash(token)]);
    await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
  finally{client.release();}
  try{await sender(user.Email,token,undefined,lang);}
  catch(error){
    await pool.query(`UPDATE sdc."USER" SET "Password_Reset_Token_Hash"=NULL,"Password_Reset_Expires_At"=NULL
      WHERE "User_ID"=$1 AND "Password_Reset_Token_Hash"=$2`,[user.User_ID,tokenHash(token)]).catch(()=>{});
    throw error;
  }
  return true;
}
async function isValidActivation(pool,token){
  if(!validToken(token))return false;
  const rs=await pool.query(`SELECT 1 FROM sdc."USER" u JOIN sdc."PATIENT" p ON p."User_ID"=u."User_ID"
    WHERE u."Password_Reset_Token_Hash"=$1 AND u."Password_Reset_Expires_At">timezone('UTC',now())
    AND u."Password_Hash" IS NULL AND u."Login_Enabled"=FALSE AND u."Account_Status"='active'
    LIMIT 1`,[tokenHash(token)]);
  return rs.rowCount===1;
}
async function activatePatient(pool,token,password,accepted,policyVersion){
  if(!validToken(token)||!validPassword(password)||accepted!=='on'||!policyVersion||policyVersion==='غير مهيّأ'||policyVersion.length>150)return false;
  const client=await pool.connect();let userId;
  try{
    await client.query('BEGIN');
    const r=await client.query(`SELECT u."User_ID" FROM sdc."USER" u
      JOIN sdc."PATIENT" p ON p."User_ID"=u."User_ID"
      WHERE u."Password_Reset_Token_Hash"=$1 AND u."Password_Reset_Expires_At">timezone('UTC',now())
      AND u."Password_Hash" IS NULL AND u."Login_Enabled"=FALSE AND u."Account_Status"='active'
      AND EXISTS(SELECT 1 FROM sdc."REGISTERED_AT" a WHERE a."Patient_ID"=p."Patient_ID")
      FOR UPDATE OF u`,[tokenHash(token)]);
    if(r.rowCount!==1){await client.query('ROLLBACK');return false;}
    userId=String(r.rows[0].User_ID);
    const hashed=await hashPassword(password);
    const update=await client.query(`UPDATE sdc."USER" SET "Password_Hash"=$2,"Login_Enabled"=TRUE,
      "Password_Reset_Token_Hash"=NULL,"Password_Reset_Expires_At"=NULL
      WHERE "User_ID"=$1 AND "Password_Reset_Token_Hash"=$3 AND "Password_Hash" IS NULL
      RETURNING "User_ID"`,[userId,hashed,tokenHash(token)]);
    if(update.rowCount!==1){await client.query('ROLLBACK');return false;}
    for(const type of ['terms_of_use','privacy_policy']){
      await client.query(`INSERT INTO sdc."USER_POLICY_CONSENTS" ("Policy_Type","Policy_Version","Accepted_At","User_ID")
        VALUES($1,$2,LOCALTIMESTAMP,$3::bigint) ON CONFLICT DO NOTHING`,[type,policyVersion,userId]);
    }
    await client.query(`UPDATE sdc."USER_SESSIONS" SET "Revoked_At"=GREATEST("Started_At",LOCALTIMESTAMP) WHERE "User_ID"=$1::bigint AND "Revoked_At" IS NULL`,[userId]);
    await client.query(`INSERT INTO sdc."AUDIT_LOG" ("Occurred_At","Action_Type","Target_Type","Target_Reference","Description")
      VALUES(LOCALTIMESTAMP,'patient.account.claimed','User',$1::varchar(512),'تفعيل حساب المريض الموجود بعد التحقق بالبريد والبيانات المسجلة')`,[userId]);
    await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
  finally{client.release();}
  revokeUserSessions(userId);
  return true;
}
module.exports={patientIdentity,validPassword,tokenHash,requestActivation,isValidActivation,activatePatient,TTL_MINUTES};
