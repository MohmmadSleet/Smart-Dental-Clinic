'use strict';
// Event delivery and display for staff. Every notification is bound to the
// authenticated recipient AND the current clinic's real underlying record.
const express=require('express');
const router=express.Router();
const {getPool}=require('../../db/pool');
const {sessionCsrf,validateSessionCsrf}=require('../auth/session');
const ID=/^[1-9]\d{0,17}$/;
const {emit}=require('./event-notifications');
const scope=`n."User_ID"=$1::bigint AND (
 (n."Notification_Type" LIKE 'staff.booking.%' AND n."Target_Type"='Booking' AND EXISTS(SELECT 1 FROM sdc."STAFF_PERMISSIONS" sp WHERE sp."User_ID"=$1::bigint AND sp."Clinic_ID"=$2::bigint AND sp."Permission_Code" IN ('appointments.view','appointments.manage')) AND EXISTS(SELECT 1 FROM sdc."BOOKING" b WHERE b."Booking_ID"::text=n."Target_Reference" AND b."Clinic_ID"=$2::bigint))
 OR (n."Notification_Type" LIKE 'staff.invoice.%' AND n."Target_Type"='Invoice' AND EXISTS(SELECT 1 FROM sdc."STAFF_PERMISSIONS" sp WHERE sp."User_ID"=$1::bigint AND sp."Clinic_ID"=$2::bigint AND sp."Permission_Code" IN ('invoices.view','invoices.issue','payments.record')) AND EXISTS(SELECT 1 FROM sdc."INVOICE" i WHERE i."Invoice_ID"::text=n."Target_Reference" AND i."Clinic_ID"=$2::bigint))
 OR (n."Notification_Type" LIKE 'staff.lab.%' AND n."Target_Type"='Lab_Order' AND EXISTS(SELECT 1 FROM sdc."STAFF_PERMISSIONS" sp WHERE sp."User_ID"=$1::bigint AND sp."Clinic_ID"=$2::bigint AND sp."Permission_Code" IN ('lab_orders.view','lab_orders.update_delivery')) AND EXISTS(SELECT 1 FROM sdc."LAB_ORDER" o JOIN sdc."VISIT" v ON v."Visit_ID"=o."Visit_ID" JOIN sdc."BOOKING" b ON b."Booking_ID"=v."Booking_ID" WHERE o."Lab_Order_ID"::text=n."Target_Reference" AND b."Clinic_ID"=$2::bigint))
)`;
const context=req=>{
 const clinic=String(req.sdcSession?.clinicId||'');
 return ID.test(clinic)&&req.sdcClinics?.some(c=>c.id===clinic)?[String(req.sdcActor.userId),clinic]:null;
};
const redirect=n=>n.Target_Type==='Booking'?'/staff/appointments':n.Target_Type==='Invoice'?'/staff/invoices':n.Target_Type==='Lab_Order'?'/staff/lab-cases':'/staff/index';
async function locals(req,res,next){
 res.locals.staffNotifications=[];res.locals.staffUnreadCount=0;res.locals.staffNotificationCsrf=sessionCsrf(req);
 const ctx=context(req);if(!ctx)return next();
 try{
 const [r,c]=await Promise.all([
  getPool().query(`SELECT n."Notification_ID",n."Title",n."Body",n."Created_At",n."Read_At",n."Target_Type" FROM sdc."NOTIFICATION" n WHERE ${scope} ORDER BY n."Created_At" DESC,n."Notification_ID" DESC LIMIT 8`,ctx),
  getPool().query(`SELECT count(*)::int AS count FROM sdc."NOTIFICATION" n WHERE ${scope} AND n."Read_At" IS NULL`,ctx)
 ]);res.locals.staffNotifications=r.rows;res.locals.staffUnreadCount=c.rows[0]?.count||0;return next();
 }catch(e){console.error('[STAFF_NOTIFICATIONS]',e.code||e.message);return next(e);}
}
router.use(['/notifications/read-all','/notifications/:id/:action'],express.urlencoded({extended:false,limit:'4kb',parameterLimit:5}));
const secure=(req,res)=>context(req)&&validateSessionCsrf(req);
router.post('/notifications/read-all',async(req,res,next)=>{
 if(!secure(req,res))return res.sendStatus(403);
 try{await getPool().query(`UPDATE sdc."NOTIFICATION" n SET "Read_At"=COALESCE(n."Read_At",LOCALTIMESTAMP) WHERE ${scope} AND n."Read_At" IS NULL`,context(req));return res.redirect(303,'/staff/index');}catch(e){next(e);}
});
router.post('/notifications/:id/:action',async(req,res,next)=>{
 if(!secure(req,res))return res.sendStatus(403);
 const {id,action}=req.params;if(!ID.test(id)||!['read','open','delete'].includes(action))return res.sendStatus(404);
 const args=[...context(req),id];
 try{
  if(action==='delete'){
   const r=await getPool().query(`DELETE FROM sdc."NOTIFICATION" n WHERE ${scope} AND n."Notification_ID"=$3::bigint RETURNING n."Notification_ID"`,args);
   return r.rowCount?res.redirect(303,'/staff/index'):res.sendStatus(404);
  }
  const r=await getPool().query(`UPDATE sdc."NOTIFICATION" n SET "Read_At"=COALESCE(n."Read_At",LOCALTIMESTAMP) WHERE ${scope} AND n."Notification_ID"=$3::bigint RETURNING n."Target_Type"`,args);
  return r.rowCount?res.redirect(303,action==='open'?redirect(r.rows[0]):'/staff/index'):res.sendStatus(404);
 }catch(e){next(e);}
});
module.exports={emit,scope,context,locals,router};
