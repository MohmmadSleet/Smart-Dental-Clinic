'use strict';
// Doctor notifications live in the existing NOTIFICATION table.
// Only the authenticated user can read/change their rows; booking/lab targets
// are additionally restricted to the doctor's selected clinic.
const express=require('express');
const {getPool}=require('../../db/pool');
const {sessionCsrf,validateSessionCsrf}=require('../auth/session');
const pages=require('../../config/page-map.json');
const router=express.Router();
const idRe=/^[1-9]\d{0,17}$/;
// An account may be both a treating doctor and a clinic manager.
// Filter by event audience, not merely recipient User_ID; never let a clinic
// management notification be read, marked read or deleted in doctor space.
const scoped=`n."User_ID"=$1::bigint AND (
 (n."Notification_Type"='booking' AND lower(coalesce(n."Target_Type",'')) IN ('booking','appointment') AND EXISTS(
  SELECT 1 FROM sdc."BOOKING" b WHERE b."Booking_ID"::text=n."Target_Reference"
   AND b."Doctor_ID"=$2::bigint AND b."Clinic_ID"=$3::bigint))
 OR (n."Notification_Type"='lab.order.status' AND lower(coalesce(n."Target_Type",'')) IN ('lab_order','laboratory') AND EXISTS(
  SELECT 1 FROM sdc."LAB_ORDER" o JOIN sdc."VISIT" v ON v."Visit_ID"=o."Visit_ID"
   JOIN sdc."BOOKING" b ON b."Booking_ID"=v."Booking_ID"
   WHERE o."Lab_Order_ID"::text=n."Target_Reference" AND b."Doctor_ID"=$2::bigint AND b."Clinic_ID"=$3::bigint))
 OR (n."Notification_Type"='job.application.status' AND n."Target_Type"='JobApplication'
     AND EXISTS(SELECT 1 FROM sdc."APPLIES_FOR" a WHERE a."Application_ID"::text=n."Target_Reference" AND a."Doctor_ID"=$2::bigint))
 OR (n."Notification_Type" IN ('doctor.clinic.invitation','doctor.clinic.membership')
     AND lower(coalesce(n."Target_Type",''))='clinic')
)`;
function context(req){
 const c=String(req.sdcSession?.clinicId||'');const doctor=String(req.sdcActor?.doctorId||'');const user=String(req.sdcActor?.userId||'');
 return idRe.test(doctor)&&idRe.test(user)&&req.sdcActor?.role==='doctor'?[user,doctor,idRe.test(c)&&req.sdcClinics?.some(x=>x.id===c)?c:'0']:null;
}
function safeTarget(n){
 const kind=String(n.Target_Type||'').toLowerCase(),ref=String(n.Target_Reference||'');
 if(['booking','appointment'].includes(kind)&&idRe.test(ref))return '/doctor/visit?booking_id='+ref;
 if(['lab_order','laboratory'].includes(kind)&&idRe.test(ref))return '/doctor/lab-cases';
 if(kind==='jobapplication'&&idRe.test(ref))return '/onboarding/doctor/jobs/application-status?application='+ref;
 if(kind==='clinic'||kind==='doctor')return '/doctor/profile#clinic-invitations';
 return '/doctor/index';
}
function safeReturn(value){
 const v=String(value||'');const match=/^\/(doctor\/[a-z-]+)(?:\?(?:booking_id|id)=([1-9]\d{0,17}))?$/.exec(v);
 return match&&pages[match[1]+'.html']?v:'/doctor/index';
}
async function load(pool,ctx){
 if(!ctx)return {items:[],unread:0};
 const [items,count]=await Promise.all([
  pool.query(`SELECT n."Notification_ID",n."Title",n."Body",n."Notification_Type",n."Created_At",n."Read_At",n."Target_Type",n."Target_Reference" FROM sdc."NOTIFICATION" n WHERE ${scoped} ORDER BY n."Created_At" DESC,n."Notification_ID" DESC LIMIT 8`,ctx),
  pool.query(`SELECT COUNT(*)::int AS unread FROM sdc."NOTIFICATION" n WHERE ${scoped} AND n."Read_At" IS NULL`,ctx)
 ]);
 return {items:items.rows.map(n=>({...n,link:safeTarget(n)})),unread:count.rows[0]?.unread||0};
}
async function locals(req,res,next){
 res.set('Cache-Control','private, no-store');
 res.locals.doctorNotifications=[];res.locals.doctorUnreadCount=0;res.locals.doctorNotificationCsrf=sessionCsrf(req);
 res.locals.doctorNotificationReturn=safeReturn(req.originalUrl);
 const ctx=context(req);if(!ctx)return next();
 try{const notifications=await load(getPool(),ctx);res.locals.doctorNotifications=notifications.items;res.locals.doctorUnreadCount=notifications.unread;next();}
 catch(e){console.error('[DOCTOR_NOTIFICATIONS_FAILED]',e.code||e.message);next(e);}
}
router.use(['/read-all','/:notice/:action'],express.urlencoded({extended:false,limit:'4kb',parameterLimit:5}));
function valid(req,res){if(!context(req))return res.sendStatus(403);if(!validateSessionCsrf(req))return res.sendStatus(403);return true;}
router.post('/read-all',async(req,res,next)=>{
 if(!valid(req,res))return;
 try{await getPool().query(`UPDATE sdc."NOTIFICATION" n SET "Read_At"=COALESCE(n."Read_At",LOCALTIMESTAMP) WHERE ${scoped} AND n."Read_At" IS NULL`,context(req));return res.redirect(303,safeReturn(req.body.return_to));}
 catch(e){next(e);}
});
router.post('/:notice/:action',async(req,res,next)=>{
 if(!valid(req,res))return;
 if(!idRe.test(req.params.notice)||!['open','read','delete'].includes(req.params.action))return res.sendStatus(404);
 const params=[...context(req),req.params.notice];
 try{
  if(req.params.action==='delete'){
   const removed=await getPool().query(`DELETE FROM sdc."NOTIFICATION" n WHERE ${scoped} AND n."Notification_ID"=$4::bigint RETURNING n."Notification_ID"`,params);
   return removed.rowCount?res.redirect(303,safeReturn(req.body.return_to)):res.sendStatus(404);
  }
  const changed=await getPool().query(`UPDATE sdc."NOTIFICATION" n SET "Read_At"=COALESCE(n."Read_At",LOCALTIMESTAMP) WHERE ${scoped} AND n."Notification_ID"=$4::bigint RETURNING n."Target_Type",n."Target_Reference"`,params);
  if(!changed.rowCount)return res.sendStatus(404);
  return res.redirect(303,req.params.action==='open'?safeTarget(changed.rows[0]):safeReturn(req.body.return_to));
 }catch(e){next(e);}
});
module.exports={router,load,locals,context,safeTarget,safeReturn,scoped};
