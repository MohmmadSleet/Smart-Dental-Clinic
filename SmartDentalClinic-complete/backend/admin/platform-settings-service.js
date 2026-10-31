'use strict';
// Controlled platform-level settings: do not imply that registration/MFA policies
// can be toggled without updating their respective enforcement layers.
const ID=/^[1-9]\d{0,17}$/;
const clean=(v,max)=>typeof v==='string'?v.trim().replace(/\s+/g,' ').slice(0,max+1):'';
function validateProfile(body={}){
 const first=clean(body.first_name,150),last=clean(body.last_name,150),phone=clean(body.phone,30);
 if(!first||!last||!phone||first.length>150||last.length>150||phone.length>30||
 /[\u0000-\u001f]/.test(first+last+phone))return null;
 return {first,last,phone};
}
async function read(pool,userId){
 if(!ID.test(String(userId)))throw Error('Invalid admin');
 const account=await pool.query(`SELECT u."First_Name" first_name,u."Last_Name" last_name,u."Email" email,u."Phone" phone,
    u."Account_Status" status,u."Two_Factor_Enabled" mfa
    FROM sdc."USER" u JOIN sdc."ROLE" r ON r."Role_ID"=u."Role_ID"
    WHERE u."User_ID"=$1::bigint AND r."Role_Name"='Super Admin' AND r."Role_Scope"='System'`,[String(userId)]);
 if(account.rowCount!==1)throw Error('Admin account missing');
 return {account:account.rows[0]};
}
async function save(pool,actor,action,body={}){
 const data=action==='profile'?validateProfile(body):null;
 if(!ID.test(String(actor))||!data)return {status:'invalid'};
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query(`SELECT set_config('sdc.user_id',$1,true)`,[String(actor)]);
  const allowed=await client.query(`SELECT sdc.sdc_is_superadmin($1::bigint) allowed`,[String(actor)]);
  if(allowed.rows[0]?.allowed!==true){await client.query('ROLLBACK');return {status:'forbidden'};}
  const updated=await client.query(`UPDATE sdc."USER" SET "First_Name"=$1,"Last_Name"=$2,"Phone"=$3
    WHERE "User_ID"=$4::bigint AND "Account_Status"='active' AND "Login_Enabled"=TRUE`,
    [data.first,data.last,data.phone,String(actor)]);
  if(updated.rowCount!==1){await client.query('ROLLBACK');return {status:'not_found'};}
  await client.query(`INSERT INTO sdc."AUDIT_LOG"("Occurred_At","Action_Type","Target_Type","Target_Reference","Description","Reason","User_ID")
   VALUES(LOCALTIMESTAMP,$1,'Platform',$2,$3,NULL,$4::bigint)`,
   ['platform.admin.profile.updated','admin-profile',
    'تحديث الاسم والهاتف لحساب المشرف',String(actor)]);
  await client.query('COMMIT');return {status:'ok'};
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
}
module.exports={read,save,validateProfile};
