'use strict';
const express=require('express');
const router=express.Router();
// Clinic space shows clinic management events only. Doctor events stay in doctor space.
// The selected clinic is part of EVERY read/mark/delete scope.
const clinicScope=`n."User_ID"=$1::bigint AND (
 (lower(coalesce(n."Target_Type",''))='clinic' AND n."Target_Reference"=$2::text
  AND (n."Notification_Type" LIKE 'clinic.%' OR n."Notification_Type"='staff.account.created'))
 OR (n."Notification_Type"='doctor.clinic.invitation' AND lower(coalesce(n."Target_Type",''))='doctor'
  AND EXISTS(SELECT 1 FROM sdc."WORKS_AT" w WHERE w."Clinic_ID"=$2::bigint AND w."Doctor_ID"::text=n."Target_Reference"))
)`;
const {clinicId}=require('./settings-service');
const {getPool}=require('../../db/pool');
const {sessionCsrf,validateSessionCsrf}=require('../auth/session');
const pages=require('../../config/page-map.json');
// Only notification actions use this small form parser; never intercept other clinic POST forms.
router.use(['/notifications/read-all','/notifications/:notice/:action'], express.urlencoded({extended:false,limit:'4kb',parameterLimit:5}));
function safeTarget(x){
 const t=String(x.Target_Type||'').toLowerCase(),r=String(x.Target_Reference||'');
 // Exact allowlisted clinic views only, never redirect user supplied origins.
 if(/^\/clinic\/[a-z-]+$/.test(r)&&pages[r.slice(1)+'.html'])return r;
 const match=/^[1-9]\d{0,17}$/.test(r);
 if(['booking','appointment'].includes(t)&&match)return '/clinic/appointment-details?id='+r;
 if(['application','job_application'].includes(t)&&match)return '/clinic/application-details?id='+r;
 if(['laboratory','lab_order'].includes(t))return '/clinic/lab-cases';
 if(['payment','invoice'].includes(t))return '/clinic/invoices';
 if(t==='clinic'&&x.Notification_Type==='clinic.doctor.invitation.response')return '/clinic/doctors';
 if(t==='clinic'&&x.Notification_Type==='clinic.job.application')return '/clinic/job-applicants';
 if(t==='job')return '/clinic/jobs';
 if(t==='document')return '/clinic/profile#sdcClinicFileVersions';
 return '/clinic/index';
}
router.use(async(req,res,next)=>{
 const id=clinicId(req);
 res.locals.clinicNotifications=[];res.locals.clinicUnreadCount=0;res.locals.notificationCsrf=sessionCsrf(req);
 if(!id||!req.sdcActor?.userId)return next();
 try{const [items,count]=await Promise.all([
 getPool().query(`SELECT n."Notification_ID",n."Title",n."Body",n."Notification_Type",n."Created_At",n."Read_At",n."Target_Type",n."Target_Reference" FROM sdc."NOTIFICATION" n WHERE ${clinicScope} ORDER BY n."Created_At" DESC,n."Notification_ID" DESC LIMIT 8`,[req.sdcActor.userId,id]),
 getPool().query(`SELECT COUNT(*)::int AS unread FROM sdc."NOTIFICATION" n WHERE ${clinicScope} AND n."Read_At" IS NULL`,[req.sdcActor.userId,id])
 ]);res.locals.clinicNotifications=items.rows.map(row=>({...row,link:safeTarget(row)}));res.locals.clinicUnreadCount=count.rows[0].unread;next();}
 catch(e){console.error('[CLINIC_NOTIFICATIONS]',e.code||e.message);next(e);}
});
function valid(req,res){if(!clinicId(req)||!req.sdcActor?.userId)return res.sendStatus(403);if(!validateSessionCsrf(req))return res.sendStatus(403);return true;}
const idRe=/^[1-9]\d{0,17}$/;
router.post('/notifications/read-all',async(req,res,next)=>{if(!valid(req,res))return;try{await getPool().query(`UPDATE sdc."NOTIFICATION" n SET "Read_At"=COALESCE(n."Read_At",LOCALTIMESTAMP) WHERE ${clinicScope} AND n."Read_At" IS NULL`,[req.sdcActor.userId,clinicId(req)]);return res.redirect(303,req.get('Referer')?.startsWith(req.protocol+'://'+req.get('host')+'/clinic/')?req.get('Referer'):'/clinic/index');}catch(e){next(e);}});
router.post('/notifications/:notice/:action',async(req,res,next)=>{if(!valid(req,res))return;if(!idRe.test(req.params.notice)||!['open','read','delete'].includes(req.params.action))return res.sendStatus(404);
 try{const user=req.sdcActor.userId,n=req.params.notice,a=req.params.action;
  if(a==='delete'){const deleted=await getPool().query(`DELETE FROM sdc."NOTIFICATION" n WHERE ${clinicScope} AND n."Notification_ID"=$3::bigint RETURNING n."Notification_ID"`,[user,clinicId(req),n]);return deleted.rowCount?res.redirect(303,'/clinic/index'):res.sendStatus(404);}
  const r=await getPool().query(`UPDATE sdc."NOTIFICATION" n SET "Read_At"=COALESCE(n."Read_At",LOCALTIMESTAMP) WHERE ${clinicScope} AND n."Notification_ID"=$3::bigint RETURNING n."Notification_Type",n."Target_Type",n."Target_Reference"`,[user,clinicId(req),n]);if(!r.rowCount)return res.sendStatus(404);return res.redirect(303,a==='open'?safeTarget(r.rows[0]):'/clinic/index');
 }catch(e){next(e);}
});
module.exports=router;
module.exports.clinicScope=clinicScope;
module.exports.safeTarget=safeTarget;
