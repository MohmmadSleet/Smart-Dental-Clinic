'use strict';
const express=require('express');
const router=express.Router();
const pages=require('../../config/page-map.json');
const {getPool}=require('../../db/pool');
const {sessionCsrf,validateSessionCsrf}=require('../auth/session');
const {can}=require('./policy');
const svc=require('./workspace-service');
const form=express.urlencoded({extended:false,limit:'20kb',parameterLimit:80});
router.use('/workspace',form);
const pool=()=>getPool();
function clinic(req){const c=String(req.sdcSession?.clinicId||'');return svc.id(c)&&req.sdcClinics?.some(v=>v.id===c)?c:null;}
function allowed(req,res,perm){return clinic(req)&&can(res.locals.staffPermissions,perm);}
function view(req,res,page,extras={}){
 const key=`staff/${page}.html`,p=pages[key];
 const css=(kind,url)=>p[kind+'ActiveClasses'][url]?' '+p[kind+'ActiveClasses'][url]:'';
 const aria=(kind,url)=>p[kind+'Aria'][url]==='page'?' aria-current="page"':'';
 res.set('Cache-Control','private, no-store');
 return res.render(`staff/${page}`,{currentPage:key,role:'staff',navVariant:p.navVariant,drawerVariant:p.drawerVariant,footerVariant:p.footerVariant,
  navActiveClass:url=>css('nav',url),navAriaCurrent:url=>aria('nav',url),drawerActiveClass:url=>css('drawer',url),drawerAriaCurrent:url=>aria('drawer',url),
  currentUser:res.locals.currentUser,activeClinic:res.locals.activeClinic,logoutCsrf:res.locals.logoutCsrf||'',
  staffPermissions:res.locals.staffPermissions||'',staffClinicRole:res.locals.staffClinicRole||'',
  hasStaffPermission:code=>can(res.locals.staffPermissions,code),csrfToken:sessionCsrf(req),...extras});
}
function get(page,permission,loader){router.get('/'+page,async(req,res,next)=>{
  if(!clinic(req))return res.sendStatus(403);
  if(permission&&!allowed(req,res,permission))return res.sendStatus(403);
  try{return view(req,res,page,await loader(req,res));}catch(e){console.error('[STAFF_'+page.toUpperCase()+']',e.code||e.message);next(e);}
 });}
get('index',null,async(req,res)=>({staffStats:await svc.stats(pool(),clinic(req),res.locals.staffPermissions)}));
get('patients','patients.page',async(req,res)=>({
 staffDirectory:can(res.locals.staffPermissions,'patients.view_directory')?
  await svc.listStaffDirectory(pool(),clinic(req),req.query):null,
 message:req.query.saved==='1'?'تم إنشاء ملف المريض بنجاح.':'',error:''
}));
get('invoices','invoices.view',async(req,res)=>({staffBills:await svc.finance.invoices(pool(),clinic(req)),
  candidates:can(res.locals.staffPermissions,'invoices.issue')?await svc.billing.invoiceCandidates(pool(),clinic(req)):[],message:req.query.saved==='1'?'تم حفظ العملية.':'',error:''}));
get('lab-cases','lab_orders.view',async req=>({staffLabs:await svc.lab.labs(pool(),clinic(req))}));
get('lab-details','lab_orders.view',async req=>{
 const staffLabDetail=await svc.lab.labDetails(pool(),clinic(req),req.query.lab);
 if(!staffLabDetail){const e=new Error('Lab is not linked to current clinic');e.status=404;throw e;}
 return {staffLabDetail};
});
get('profile',null,async(req)=>({
 staffAccount:await svc.account(pool(),req.sdcActor.userId),
 mfaView:await require('../security/mfa/profile-page').mfaViewFor(req),
 accountSessions:req.sdcSession?await require('../auth/session').listTrackedSessions(pool(),req.sdcActor.userId,req.sdcSession.sessionId):[],
 passwordChangeCsrf:sessionCsrf(req),sessionActionCsrf:sessionCsrf(req),
 passwordChangeError:require('../auth/password-reset/profile-destinations').passwordError(req.query?.password_error),
 passwordChangeReference:/^[A-F0-9]{8}$/.test(String(req.query?.password_reference||''))?req.query.password_reference:'',
 sessionActionMessage:req.query?.sessions==='updated'?'تم تحديث الجلسات بنجاح.':'',
 staffNotice:req.query?.saved==='1'?'تم حفظ رقم الهاتف بنجاح.':''
}));
function action(path,perm,handler){router.post('/workspace/'+path,async(req,res,next)=>{
 if(!clinic(req)||perm&&!allowed(req,res,perm))return res.sendStatus(403);
 if(!validateSessionCsrf(req))return res.status(403).send('انتهت صلاحية نموذج الحفظ. حدّث الصفحة.');
 try{return await handler(req,res);}catch(e){console.error('[STAFF_ACTION]',path,e.code||e.message);if(e.code==='23505')return res.status(409).send('هذه البيانات مستخدمة مسبقًا.');return res.status(503).send('تعذّر حفظ العملية، لم يتم تأكيد التغيير.');}
 });}
const outcome=(res,r,redirect)=>r.status==='ok'?res.redirect(303,redirect):res.status(r.status==='forbidden'?403:r.status==='not_found'?404:r.status==='invalid'?422:409).send('تعذّر تنفيذ الإجراء. تحقق من المدخلات والحالة والصلاحيات.');
action('patient','patients.create',async(req,res)=>outcome(res,await svc.patients.create(pool(),clinic(req),req.sdcActor.userId,svc.staffPatientInput(req.body)),'/staff/patients?saved=1'));
action('payment','payments.record',async(req,res)=>outcome(res,await svc.finance.recordPayment(pool(),clinic(req),req.sdcActor.userId,req.body),'/staff/invoices?saved=1'));
action('invoice-draft','invoices.issue',async(req,res)=>outcome(res,await svc.billing.saveDraft(pool(),clinic(req),req.sdcActor.userId,req.body),'/staff/invoices?saved=1'));
action('invoice-issue','invoices.issue',async(req,res)=>outcome(res,await svc.billing.issueDraft(pool(),clinic(req),req.sdcActor.userId,req.body),'/staff/invoices?saved=1'));
action('lab-action','lab_orders.update_delivery',async(req,res)=>{
 if(!['send','receive'].includes(req.body.action))return res.sendStatus(422);
 const r=await svc.lab.changeLabCase(pool(),clinic(req),req.sdcActor.userId,req.body.lab_id,req.body.order_id,req.body.action,null);
 return outcome(res,r,'/staff/lab-details?lab='+encodeURIComponent(req.body.lab_id)+'&saved=1');
});
action('profile',null,async(req,res)=>outcome(res,await svc.saveAccount(pool(),req.sdcActor.userId,req.body),'/staff/profile?saved=1'));

// Booking state machine shares the same doctor-slot locking and patient notices
// as the clinic UI; permission is verified again inside its transaction.
const appointments=require('../appointments/service');
action('appointment','appointments.manage',async(req,res)=>{
 const body={...req.body,clinic_id:clinic(req)};
 return outcome(res,await appointments.book(pool(),body,req.sdcActor,clinic(req)),'/staff/appointments?saved=1');
});
action('booking-action','appointments.manage',async(req,res)=>{
 if(!['confirm','reject','cancel','move','approve_change','reject_change'].includes(String(req.body.action||'')))return res.sendStatus(422);
 return outcome(res,await appointments.action(pool(),req.sdcActor,clinic(req),req.body),'/staff/appointments?saved=1');
});
module.exports=router;
