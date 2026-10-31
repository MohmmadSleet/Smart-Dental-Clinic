'use strict';
// Persistent platform inbox, scoped to the authenticated Super Admin.
// Only actionable administrative events are reflected; no patient clinical contents.
const ID=/^[1-9]\d{0,17}$/;
const scope=`n."User_ID"=$1::bigint AND n."Notification_Type" LIKE 'admin.%' AND n."Dismissed_At" IS NULL`;
function target(row){
 const id=String(row.Target_Reference||'');
 if(!ID.test(id))return '/admin/index';
 switch(String(row.Target_Type||'')){
  case 'Clinic':return '/admin/clinic-application-details?id='+id;
  case 'ClinicDocument':{const match=/^([1-9]\d{0,17}):([1-9]\d{0,17})$/.exec(id);return match?'/admin/clinic-application-details?id='+match[1]:'/admin/index';}
  case 'Doctor':return '/admin/doctor-license-review?id='+id;
  case 'Settlement':return '/admin/finance?tab=settlements';
  case 'Audit':return '/admin/system-log';
  default:return '/admin/index';
 }
}
// Refresh the inbox from authoritative, already-persisted events. No double alerts
// and no resurrection after user dismisses a notice: unique key + Dismissed_At.
async function synchronize(pool,userId){
 if(!ID.test(String(userId)))return;
 await pool.query(`INSERT INTO sdc."NOTIFICATION"("Title","Body","Notification_Type","Created_At","User_ID","Target_Type","Target_Reference")
  SELECT e.title,e.body,e.kind,e.occurred,$1::bigint,e.target,e.ref FROM (
   SELECT 'طلب اعتماد عيادة'::varchar(150) title,
    ('طلب اعتماد جديد: '||LEFT(c."Clinic_Name",120))::text body,
    'admin.clinic.review'::varchar(150) kind,c."Submitted_At" occurred,
    'Clinic'::varchar(150) target,c."Clinic_ID"::varchar(512) ref
   FROM sdc."CLINIC" c WHERE c."Approval_Status"='pending'
   UNION ALL
   SELECT 'طلب مراجعة ترخيص طبيب'::varchar(150),
    ('ترخيص طبيب بانتظار المراجعة، رقم الملف: '||d."Doctor_ID"::text)::text,
    'admin.doctor.license',LOCALTIMESTAMP,'Doctor',d."Doctor_ID"::varchar(512)
   FROM sdc."DOCTOR" d WHERE d."License_Status"='pending'
   UNION ALL
   SELECT 'تسوية مالية جديدة'::varchar(150),
    ('تسوية مالية للعيادة رقم '||s."Clinic_ID"::text||' تستدعي مراجعة المدفوعات')::text,
    'admin.finance.settlement',s."Created_At",'Settlement',s."Settlement_ID"::varchar(512)
   FROM sdc."SETTLEMENT" s WHERE s."Created_At" >= LOCALTIMESTAMP-INTERVAL '30 days'
   UNION ALL
   SELECT 'تنبيه أمني أو إداري'::varchar(150),
    ('حدث إداري مهم في سجل التدقيق: '||a."Action_Type"||'، رقم السجل '||a."Log_ID"::text)::text,
    'admin.security.audit',a."Occurred_At",'Audit',a."Log_ID"::varchar(512)
   FROM sdc."AUDIT_LOG" a
   WHERE a."Occurred_At" >= LOCALTIMESTAMP-INTERVAL '30 days'
     AND (a."Action_Type" LIKE 'security.%' OR a."Action_Type" IN ('user.account.suspended','doctor.account.suspended'))
  ) e
  WHERE sdc.sdc_is_superadmin($1::bigint)
  ON CONFLICT DO NOTHING`,[userId]);
}
async function load(pool,userId){
 if(!ID.test(String(userId)))return {items:[],unread:0};
 const [items,unread]=await Promise.all([
  pool.query(`SELECT n."Notification_ID",n."Title",n."Body",n."Read_At",n."Created_At",n."Target_Type",n."Target_Reference" FROM sdc."NOTIFICATION" n WHERE ${scope} ORDER BY n."Created_At" DESC,n."Notification_ID" DESC LIMIT 10`,[userId]),
  pool.query(`SELECT count(*)::int n FROM sdc."NOTIFICATION" n WHERE ${scope} AND n."Read_At" IS NULL`,[userId])
 ]);
 return {items:items.rows,unread:unread.rows[0]?.n||0};
}
async function change(pool,{userId,noticeId,action}){
 if(!ID.test(String(userId))||!ID.test(String(noticeId))||!['open','read','delete'].includes(action))return null;
 const column=action==='delete'?'"Dismissed_At"':'"Read_At"';
 const r=await pool.query(`UPDATE sdc."NOTIFICATION" n SET ${column}=COALESCE(n.${column},LOCALTIMESTAMP)
  WHERE ${scope} AND n."Notification_ID"=$2::bigint
  RETURNING n."Target_Type",n."Target_Reference"`,[userId,noticeId]);
 return r.rows[0]||null;
}
async function readAll(pool,userId){
 if(!ID.test(String(userId)))return;
 await pool.query(`UPDATE sdc."NOTIFICATION" n SET "Read_At"=LOCALTIMESTAMP
  WHERE ${scope} AND n."Read_At" IS NULL`,[userId]);
}
module.exports={synchronize,load,change,readAll,target,scope};
