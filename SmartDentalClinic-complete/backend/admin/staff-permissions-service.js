'use strict';
// v27.18: Super Admin oversight only. Clinic managers own role/permission edits.
// Every row represents one (User_ID, Clinic_ID) membership, never a global grant.
const {PERMISSIONS,ROLES}=require('../clinic/staff/service');
const PAGE_SIZE=30;
const validId=v=>typeof v==='string'&&/^[1-9]\d{0,17}$/.test(v);
const validReason=v=>typeof v==='string'&&v.trim().length>=8&&v.trim().length<=1000?v.trim():null;
const roleNames=Object.values(ROLES).map(r=>r.name);
function parseFilters(query={}){
 const q=typeof query.q==='string'?query.q.trim().slice(0,100):'';
 const clinic=validId(query.clinic)?query.clinic:'';
 const role=typeof query.role==='string'&&roleNames.includes(query.role)?query.role:'';
 const status=['active','suspended','inactive'].includes(query.status)?query.status:'';
 const number=typeof query.page==='string'&&/^\d{1,5}$/.test(query.page)?Number(query.page):1;
 return {q,clinic,role,status,page:Math.max(1,Math.min(number,10000))};
}
const FROM=` FROM sdc."STAFF_AT" s JOIN sdc."USER" u ON u."User_ID"=s."User_ID"
 JOIN sdc."ROLE" ur ON ur."Role_ID"=u."Role_ID" AND ur."Role_Name"='Staff' AND ur."Role_Scope"='System'
 JOIN sdc."CLINIC" c ON c."Clinic_ID"=s."Clinic_ID"
 JOIN sdc."ROLE" r ON r."Role_ID"=s."Role_ID" AND r."Role_Scope"='Clinic'`;
function where(f){
 const clauses=[],values=[];
 if(f.q){values.push('%'+f.q.replace(/[\\%_]/g,'\\$&')+'%');clauses.push(`concat_ws(' ',u."User_ID"::text,u."First_Name",u."Last_Name",u."Email",c."Clinic_Name",c."Clinic_ID"::text) ILIKE $${values.length} ESCAPE '\\'`);}
 if(f.clinic){values.push(f.clinic);clauses.push(`s."Clinic_ID"=$${values.length}::bigint`);}
 if(f.role){values.push(f.role);clauses.push(`r."Role_Name"=$${values.length}`);}
 if(f.status){values.push(f.status);clauses.push(`s."Membership_Status"=$${values.length}`);}
 return {sql:clauses.length?' WHERE '+clauses.join(' AND '):'',values};
}
const PERMS=` LEFT JOIN LATERAL (
 SELECT COALESCE(array_agg(p."Permission_Code" ORDER BY p."Permission_Code"),ARRAY[]::varchar[]) AS permissions
 FROM sdc."STAFF_PERMISSIONS" p WHERE p."User_ID"=s."User_ID" AND p."Clinic_ID"=s."Clinic_ID"
 ) perms ON true`;
function mapRow(r){
 const rawPermissions=Array.isArray(r.permissions)?r.permissions.filter(p=>typeof p==='string'):[];
 const permissions=rawPermissions.filter(p=>PERMISSIONS.includes(p));
 const unexpectedPermissions=rawPermissions.filter(p=>!PERMISSIONS.includes(p));
 return {...r,permissions,unexpectedPermissions,grantsCount:permissions.length,
  effective:r.membership_status==='active'&&r.account_status==='active'&&r.login_enabled===true&&r.clinic_status==='active'&&r.approval_status==='approved',
  roleLabel:Object.values(ROLES).find(role=>role.name===r.role_name)?.label||r.role_name};
}
async function list(pool,query={}){
 const f=parseFilters(query),{sql,values}=where(f);
 const [count,clinics]=await Promise.all([
  pool.query(`SELECT count(*)::integer AS total ${FROM}${sql}`,values),
  pool.query(`SELECT DISTINCT c."Clinic_ID"::text AS id,c."Clinic_Name" AS name FROM sdc."STAFF_AT" s JOIN sdc."CLINIC" c ON c."Clinic_ID"=s."Clinic_ID" ORDER BY name,id`)
 ]);
 const total=Number(count.rows[0]?.total)||0,pages=Math.max(1,Math.ceil(total/PAGE_SIZE));
 const page=Math.min(f.page,pages);
 const rs=await pool.query(`SELECT s."User_ID"::text AS user_id,s."Clinic_ID"::text AS clinic_id,
 concat_ws(' ',u."First_Name",u."Last_Name") AS name,u."Email" AS email,
 c."Clinic_Name" AS clinic_name,c."Clinic_Status" AS clinic_status,c."Approval_Status" AS approval_status,
 u."Account_Status" AS account_status,u."Login_Enabled" AS login_enabled,
 s."Membership_Status" AS membership_status,r."Role_Name" AS role_name,perms.permissions
 ${FROM}${PERMS}${sql}
 ORDER BY c."Clinic_Name",u."First_Name",u."Last_Name",s."User_ID" DESC
 LIMIT $${values.length+1} OFFSET $${values.length+2}`,[...values,PAGE_SIZE,(page-1)*PAGE_SIZE]);
 return {staffRows:rs.rows.map(mapRow),staffClinics:clinics.rows,staffRoles:ROLES,staffFilters:{...f,page},staffPage:page,staffPages:pages,staffTotal:total};
}
// Audit-only observation: cannot set permissions, change role or membership status.
async function addNote(pool,{userId,clinicId,adminId,reason}){
 if(!validId(userId)||!validId(clinicId)||!validId(adminId)||!validReason(reason))return {status:'invalid'};
 const db=await pool.connect();
 try{
  await db.query('BEGIN');
  await db.query("SELECT set_config('sdc.user_id',$1,true)",[adminId]);
  const allowed=await db.query('SELECT sdc.sdc_is_superadmin($1::bigint) AS allowed',[adminId]);
  if(allowed.rows[0]?.allowed!==true){await db.query('ROLLBACK');return {status:'forbidden'};}
  const row=await db.query(`SELECT s."User_ID" FROM sdc."STAFF_AT" s
   JOIN sdc."ROLE" r ON r."Role_ID"=s."Role_ID" AND r."Role_Scope"='Clinic'
   WHERE s."User_ID"=$1::bigint AND s."Clinic_ID"=$2::bigint FOR SHARE OF s`,[userId,clinicId]);
  if(!row.rowCount){await db.query('ROLLBACK');return {status:'not_found'};}
  await db.query(`INSERT INTO sdc."AUDIT_LOG"("Occurred_At","Action_Type","Target_Type","Target_Reference","Description","Reason","User_ID")
   VALUES(LOCALTIMESTAMP,'staff.admin.oversight_note','StaffMembership',$1::varchar(512),$2::text,$3::text,$4::bigint)`,[
    `${userId}:${clinicId}`,`ملاحظة رقابية على عضوية الموظف ${userId} في العيادة ${clinicId}`,reason.trim(),adminId]);
  await db.query('COMMIT');return {status:'ok'};
 }catch(error){await db.query('ROLLBACK').catch(()=>{});throw error;}finally{db.release();}
}
module.exports={PAGE_SIZE,parseFilters,list,addNote,validId,validReason,mapRow};
