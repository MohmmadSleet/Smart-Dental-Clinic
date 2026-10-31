'use strict';
// v27.15: account directory and guarded user account administration.
// Role assignments remain owned by registration, doctor verification and clinic staff workflows.
const {revokeUserSessions}=require('../auth/session');
const PAGE_SIZE=30;
const validId=v=>typeof v==='string'&&/^[1-9]\d{0,17}$/.test(v);
const reasonText=v=>typeof v==='string'&&v.trim().length>=8&&v.trim().length<=1000?v.trim():null;
const clean=(s,max)=>typeof s==='string'?s.trim().replace(/\s+/g,' ').slice(0,max+1):'';
const ROLE={Patient:'patient',Doctor:'doctor',Staff:'staff','Super Admin':'admin'};
const FILTER_ROLES=['patient','doctor','staff','admin'];
const FILTER_STATUS=['active','pending','suspended','disabled'];
function parseFilters(query={}){
 const q=clean(query.q,100).slice(0,100);
 const role=FILTER_ROLES.includes(query.role)?query.role:'';
 const status=FILTER_STATUS.includes(query.status)?query.status:'';
 const p=typeof query.page==='string'&&/^\d{1,5}$/.test(query.page)?+query.page:1;
 return {q,role,status,page:Math.min(Math.max(p,1),10000)};
}
const FROM=` FROM sdc."USER" u JOIN sdc."ROLE" r ON r."Role_ID"=u."Role_ID"
 LEFT JOIN sdc."PATIENT" p ON p."User_ID"=u."User_ID"
 LEFT JOIN sdc."DOCTOR" d ON d."User_ID"=u."User_ID"
 LEFT JOIN LATERAL (SELECT string_agg(c."Clinic_Name" || ' (' || cr."Role_Name" || ')','، ' ORDER BY c."Clinic_Name") clinics,
   count(*)::integer memberships FROM sdc."STAFF_AT" st
   JOIN sdc."CLINIC" c ON c."Clinic_ID"=st."Clinic_ID"
   JOIN sdc."ROLE" cr ON cr."Role_ID"=st."Role_ID"
   WHERE st."User_ID"=u."User_ID" AND st."Membership_Status"='active') staff ON true
 LEFT JOIN LATERAL (SELECT string_agg(c."Clinic_Name",'، ' ORDER BY c."Clinic_Name") clinics
   FROM sdc."WORKS_AT" w JOIN sdc."CLINIC" c ON c."Clinic_ID"=w."Clinic_ID"
   WHERE w."Doctor_ID"=d."Doctor_ID" AND w."Membership_Status"='active') working ON true
 LEFT JOIN LATERAL (SELECT string_agg(c."Clinic_Name",'، ' ORDER BY c."Clinic_Name") clinics
   FROM sdc."REGISTERED_AT" ra JOIN sdc."CLINIC" c ON c."Clinic_ID"=ra."Clinic_ID"
   WHERE ra."Patient_ID"=p."Patient_ID") registered ON true`;
const COLS=`u."User_ID"::text id,u."First_Name" first_name,u."Last_Name" last_name,u."Email" email,
 u."Phone" phone,u."Account_Status" AS "status",u."Login_Enabled" login_enabled,u."Last_Login_At" last_login,
 u."Created_At" created_at,r."Role_Name" role_name,r."Role_Scope" role_scope,
 p."Patient_ID"::text patient_id,d."Doctor_ID"::text doctor_id,staff.clinics staff_clinics,staff.memberships staff_count,working.clinics doctor_clinics,registered.clinics patient_clinics`;
function where(f){
 const c=[],v=[];
 if(f.q){v.push('%'+f.q.replace(/[\\%_]/g,'\\$&')+'%');c.push(`concat_ws(' ',u."User_ID"::text,u."First_Name",u."Last_Name",u."Email",u."Phone",p."Patient_ID"::text,d."Doctor_ID"::text) ILIKE $${v.length} ESCAPE '\\'`);}
 if(f.role){v.push(Object.entries(ROLE).find(x=>x[1]===f.role)[0]);c.push(`r."Role_Name"=$${v.length} AND r."Role_Scope"='System'`);}
 if(f.status){v.push(f.status);c.push(`u."Account_Status"=$${v.length}`);}
 return {sql:c.length?' WHERE '+c.join(' AND '):'',values:v};
}
async function list(pool,filters){
 const f=parseFilters(filters),{sql,values}=where(f);
 const count=await pool.query(`SELECT count(*)::integer n ${FROM}${sql}`,values);
 const total=Number(count.rows[0]?.n)||0,pages=Math.max(1,Math.ceil(total/PAGE_SIZE));
 const page=Math.min(f.page,pages);
 const rs=await pool.query(`SELECT ${COLS} ${FROM}${sql} ORDER BY u."User_ID" DESC LIMIT $${values.length+1} OFFSET $${values.length+2}`,
 [...values,PAGE_SIZE,(page-1)*PAGE_SIZE]);
 return {users:rs.rows.map(withRole),filters:{...f,page},page,pages,total};
}
function withRole(r){return {...r,role:r.role_scope==='System'?ROLE[r.role_name]||'unknown':'unknown'};}
async function detail(pool,id){
 if(!validId(id))return null;
 const rs=await pool.query(`SELECT ${COLS},p."Date_Of_Birth"::text birthdate,p."Gender" gender
 ${FROM} WHERE u."User_ID"=$1::bigint`,[id]);
 if(!rs.rowCount)return null;
 const user=withRole(rs.rows[0]);
 const memberships= user.role==='staff' ? (await pool.query(`SELECT c."Clinic_ID"::text id,c."Clinic_Name" name,r."Role_Name" role,s."Membership_Status" status
 FROM sdc."STAFF_AT" s JOIN sdc."CLINIC" c USING("Clinic_ID") JOIN sdc."ROLE" r ON r."Role_ID"=s."Role_ID"
 WHERE s."User_ID"=$1::bigint ORDER BY c."Clinic_Name"`,[id])).rows:
 user.role==='doctor' ? (await pool.query(`SELECT c."Clinic_ID"::text id,c."Clinic_Name" name,w."Membership_Status" status,
 CASE WHEN c."Manager_Doctor_ID"=d."Doctor_ID" THEN 'مدير العيادة' ELSE 'طبيب' END role
 FROM sdc."DOCTOR" d JOIN sdc."WORKS_AT" w ON w."Doctor_ID"=d."Doctor_ID" JOIN sdc."CLINIC" c USING("Clinic_ID")
 WHERE d."User_ID"=$1::bigint ORDER BY c."Clinic_Name"`,[id])).rows:
 user.role==='patient' ? (await pool.query(`SELECT c."Clinic_ID"::text id,c."Clinic_Name" name,'مريض' role,'active' status
 FROM sdc."PATIENT" p JOIN sdc."REGISTERED_AT" ra USING("Patient_ID") JOIN sdc."CLINIC" c USING("Clinic_ID")
 WHERE p."User_ID"=$1::bigint ORDER BY c."Clinic_Name"`,[id])).rows:[];
 const activity=(await pool.query(`SELECT a."Action_Type" action,a."Description" description,a."Occurred_At" occurred,a."Reason" reason
 FROM sdc."AUDIT_LOG" a WHERE a."Target_Type"='User' AND a."Target_Reference"=$1::varchar(512)
 ORDER BY a."Occurred_At" DESC,a."Log_ID" DESC LIMIT 30`,[id])).rows;
 let patient={allergies:[],diseases:[],medications:[],appointments:[],visits:[],invoices:[]};
 if(user.role==='patient'&&user.patient_id){
  const p=user.patient_id;
  const [appointments,invoices]=await Promise.all([
   pool.query(`SELECT b."Booking_ID"::text id,b."Appointment_Date"::text date,to_char(b."Start_Time",'HH24:MI') time,
     b."Booking_Status" status,c."Clinic_Name" clinic,s."Service_Name" service,concat_ws(' ',du."First_Name",du."Last_Name") doctor
     FROM sdc."BOOKING" b JOIN sdc."CLINIC" c USING("Clinic_ID") JOIN sdc."SERVICE" s USING("Service_ID")
     JOIN sdc."DOCTOR" d USING("Doctor_ID") JOIN sdc."USER" du ON du."User_ID"=d."User_ID"
     WHERE b."Patient_ID"=$1::bigint ORDER BY b."Appointment_Date" DESC,b."Booking_ID" DESC LIMIT 75`,[p]),
   pool.query(`SELECT i."Invoice_ID"::text id,i."Invoice_Status" status,i."Created_At" created,c."Clinic_Name" clinic,
     COALESCE((SELECT sum(ii."Quantity"*ii."Unit_Price"-ii."Discount_Amount") FROM sdc."INVOICE_INVOICE_ITEMS" ii WHERE ii."Invoice_ID"=i."Invoice_ID"),0) total,
     COALESCE((SELECT sum(pm."Amount") FROM sdc."RECORDS_PAYMENT" pm WHERE pm."Invoice_ID"=i."Invoice_ID"),0) paid
     FROM sdc."INVOICE" i JOIN sdc."CLINIC" c USING("Clinic_ID") WHERE i."Patient_ID"=$1::bigint
     ORDER BY i."Created_At" DESC,i."Invoice_ID" DESC LIMIT 50`,[p])
  ]);
  patient={allergies:[],diseases:[],medications:[],appointments:appointments.rows,visits:[],invoices:invoices.rows};
 }
 return {user,memberships,activity,patient};
}
const UPCOMING=`SELECT 1 FROM sdc."BOOKING" b JOIN sdc."PATIENT" p ON p."Patient_ID"=b."Patient_ID"
 WHERE p."User_ID"=$1::bigint AND (b."Booking_Status"='in_progress' OR
 (b."Booking_Status" IN ('pending','confirmed') AND b."Appointment_Date">=(now() AT TIME ZONE 'Asia/Hebron')::date)) LIMIT 1`;
async function mutate(pool,{userId,adminId,action,body={}}){
 if(!validId(String(userId))||!validId(String(adminId))||!['suspend','resume','edit','delete'].includes(action))return {status:'invalid'};
 const reason=reasonText(body.reason);
 if(!reason)return {status:'invalid'};
 const first=clean(body.first_name,150),last=clean(body.last_name,150),phone=clean(body.phone,30);
 if(action==='edit'&&(!first||first.length>150||!last||last.length>150||!phone||phone.length>30||/[\u0000-\u001f]/.test(first+last+phone)))return {status:'invalid'};
 if(String(userId)===String(adminId))return {status:'self'};
 const db=await pool.connect();let revoke=false;
 try{
  await db.query('BEGIN');
  await db.query("SELECT set_config('sdc.user_id',$1,true)",[String(adminId)]);
  const allowed=await db.query('SELECT sdc.sdc_is_superadmin($1::bigint) allowed',[adminId]);
  if(allowed.rows[0]?.allowed!==true){await db.query('ROLLBACK');return {status:'unauthorized'};}
  const rs=await db.query(`SELECT u."User_ID",u."Account_Status" AS "status",u."Login_Enabled" login_enabled,u."First_Name" first_name,
     u."Last_Name" last_name,u."Phone" phone,u."Login_Enabled" login_enabled,u."Last_Login_At" last_login,r."Role_Name" AS "role",r."Role_Scope" AS "scope"
     FROM sdc."USER" u JOIN sdc."ROLE" r USING("Role_ID")
     WHERE u."User_ID"=$1::bigint FOR UPDATE OF u`,[userId]);
  if(!rs.rowCount){await db.query('ROLLBACK');return {status:'not_found'};}
  const u=rs.rows[0];
  if(u.scope!=='System'||u.role==='Super Admin'||u.role==='Doctor'){
   await db.query('ROLLBACK');return {status:'role_owned'};
  }
  if(action==='suspend'){
   if(u.status!=='active'){await db.query('ROLLBACK');return {status:'unchanged'};}
   if(u.role==='Patient'&&(await db.query(UPCOMING,[userId])).rowCount){await db.query('ROLLBACK');return {status:'bookings'};}
   await db.query(`UPDATE sdc."USER" SET "Account_Status"='suspended',"Login_Enabled"=false WHERE "User_ID"=$1::bigint`,[userId]);
   revoke=true;
  }else if(action==='resume'){
   if(u.status!=='suspended'){await db.query('ROLLBACK');return {status:'unchanged'};}
   // Do not grant access to accounts that lack credentials.
   const credentials=await db.query(`SELECT 1 FROM sdc."USER" WHERE "User_ID"=$1::bigint AND "Email" IS NOT NULL AND "Password_Hash" IS NOT NULL`,[userId]);
   if(!credentials.rowCount){await db.query('ROLLBACK');return {status:'credentials'};}
   await db.query(`UPDATE sdc."USER" SET "Account_Status"='active',"Login_Enabled"=true WHERE "User_ID"=$1::bigint`,[userId]);
  }else if(action==='delete'){
   // Physical deletion is ONLY for unfinished, unused accounts with no login history/profile/role membership.
   // PostgreSQL's FK constraints are an additional last line of defense for every other reference.
   if(u.status!=='pending'||u.login_enabled!==false||u.last_login){await db.query('ROLLBACK');return {status:'not_deletable'};}
   const linked=await db.query(`SELECT 1 WHERE
    EXISTS(SELECT 1 FROM sdc."PATIENT" WHERE "User_ID"=$1::bigint) OR
    EXISTS(SELECT 1 FROM sdc."DOCTOR" WHERE "User_ID"=$1::bigint) OR
    EXISTS(SELECT 1 FROM sdc."STAFF_AT" WHERE "User_ID"=$1::bigint)`,[userId]);
   if(linked.rowCount){await db.query('ROLLBACK');return {status:'in_use'};}
   await db.query(`DELETE FROM sdc."USER" WHERE "User_ID"=$1::bigint`,[userId]);
  }else{
   if(u.first_name===first&&u.last_name===last&&u.phone===phone){await db.query('ROLLBACK');return {status:'unchanged'};}
   await db.query(`UPDATE sdc."USER" SET "First_Name"=$2,"Last_Name"=$3,"Phone"=$4 WHERE "User_ID"=$1::bigint`,[userId,first,last,phone]);
  }
  const event={suspend:'user.account.suspended',resume:'user.account.resumed',edit:'user.profile.updated',delete:'user.account.unused_deleted'}[action];
  await db.query(`INSERT INTO sdc."AUDIT_LOG"("Occurred_At","Action_Type","Target_Type","Target_Reference","Description","Reason","User_ID")
   VALUES(LOCALTIMESTAMP,$1,'User',$2::varchar(512),$3,$4,$5::bigint)`,[event,String(userId),
    action==='edit'?'تعديل اسم المستخدم وهاتفه دون المساس بالصلاحيات أو البيانات الطبية':
    action==='suspend'?'تعليق حساب مستخدم وتعطيل دخوله':
    action==='resume'?'إعادة تفعيل حساب مستخدم':
    'حذف حساب تسجيل غير مكتمل وخالٍ من الارتباطات',reason,String(adminId)]);
  if(revoke)await db.query(`UPDATE sdc."USER_SESSIONS" SET "Revoked_At"=GREATEST("Started_At",LOCALTIMESTAMP) WHERE "User_ID"=$1::bigint AND "Revoked_At" IS NULL`,[userId]);
  await db.query('COMMIT');
  if(revoke)revokeUserSessions(userId);
  return {status:'ok'};
 }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}finally{db.release();}
}
module.exports={list,detail,mutate,parseFilters,validId,reasonText,ROLE,PAGE_SIZE};
