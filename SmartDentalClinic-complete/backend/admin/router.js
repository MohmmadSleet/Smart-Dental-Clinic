'use strict';
const express = require('express');
const {guard}=require('../auth/guard');
const {logoutTracked}=require('../auth/session');
const {getPool} = require('../../db/pool');
const pages = require('../../config/page-map.json');
const {issueCsrf,validateCsrf} = require('../security/csrf');
const {listDoctors,findDoctor,reviewDoctor} = require('./service');
const adminDoctors=require('./doctors-management-service');
const adminJobs=require('./jobs-management-service');
const adminStaff=require('./staff-permissions-service');
const {listAudit,exportAudit,auditTypeLabel,auditTypeIcon} = require('./audit-service');
const router = express.Router();
const BODY = express.urlencoded({extended:false,limit:'12kb',parameterLimit:20});

function adminPageLocals(name,res,more={}) {
  const item=pages[`admin/${name}.html`];
  if(!item) throw new Error('Admin page missing from allowlist');
  const css=(kind,href)=>item[kind+'ActiveClasses'][href]?' '+item[kind+'ActiveClasses'][href]:'';
  const aria=(kind,href)=>item[kind+'Aria'][href]==='page'?' aria-current="page"':'';
  return {currentPage:`admin/${name}.html`,role:'admin',navVariant:item.navVariant,
    drawerVariant:item.drawerVariant,footerVariant:item.footerVariant,
    navActiveClass:href=>css('nav',href),navAriaCurrent:href=>aria('nav',href),
    drawerActiveClass:href=>css('drawer',href),drawerAriaCurrent:href=>aria('drawer',href),
    pendingClinicCount:res.locals.adminPendingClinics||0,
    adminNotifications:res.locals.adminNotifications||[],adminUnreadCount:res.locals.adminUnreadCount||0,
    adminCsrfToken:issueCsrf(res,'admin'),logoutCsrf:res.locals.logoutCsrf || '',
    currentUser:res.locals.currentUser||null,...more};
}
// Old admin entrypoint is retired; all accounts use the official login page.
router.get('/sign-in',(req,res)=>res.redirect(303,'/auth/login'));
router.post('/sign-in',(req,res)=>res.redirect(303,'/auth/login'));
const protectedAdmin=guard('admin');
function requireAdmin(req,res,next){return protectedAdmin(req,res,next);}
router.use(requireAdmin);
// Admin inbox: real pending approvals and settlements, persisted per Super Admin.
const adminNotifications=require('./notifications-service');
router.use(async(req,res,next)=>{
 try{
  const id=req.adminUserId;
  if(req.method==='GET')await adminNotifications.synchronize(getPool(),id);
  const inbox=await adminNotifications.load(getPool(),id);
  res.locals.adminNotifications=inbox.items;
  res.locals.adminUnreadCount=inbox.unread;
  // Keep the old local alias used by pre-existing admin pages.
  res.locals.adminPendingClinics=0;
  return next();
 }catch(e){console.error('[ADMIN_NOTIFICATIONS_FAILED]',e.code||'UNKNOWN');
  // Preserve access to platform pages if inbox migration has not yet run.
  res.locals.adminNotifications=[];res.locals.adminUnreadCount=0;
  res.locals.adminPendingClinics=0;return next();}
});
router.post('/notifications/read-all',BODY,async(req,res,next)=>{
 if(!validateCsrf(req,'admin'))return res.sendStatus(403);
 try{await adminNotifications.readAll(getPool(),req.adminUserId);return res.redirect(303,'/admin/index');}catch(e){next(e);}
});
router.post('/notifications/:id/:action',BODY,async(req,res,next)=>{
 if(!validateCsrf(req,'admin'))return res.sendStatus(403);
 if(!['open','read','delete'].includes(req.params.action)||!/^\d+$/.test(req.params.id))return res.sendStatus(404);
 try{const notice=await adminNotifications.change(getPool(),{userId:req.adminUserId,noticeId:req.params.id,action:req.params.action});
  if(!notice)return res.sendStatus(404);
  return res.redirect(303,req.params.action==='open'?adminNotifications.target(notice):'/admin/index');
 }catch(e){next(e);}
});
require('../clinic/onboarding/admin-routes').attach(router,{adminPageLocals,getPool,validateCsrf});
// Backward-compatible route for the existing Admin header form.
router.post('/sign-out',BODY,async(req,res)=>{
 if(!validateCsrf(req,'admin'))return res.status(403).send('رمز حماية غير صالح.');
 try{await logoutTracked(req,res,getPool());return res.redirect(303,'/auth/login');}
 catch(e){console.error('[LOGOUT_FAILED]',e.code||'UNKNOWN');return res.status(503).send('تعذر إنهاء الجلسة.');}
});
// v27.25: dashboard is a live administrative summary, never the generic demo fallback.
router.get(['/', '/index'],async(req,res,next)=>{
 try {
  const dashboardSummary=await require('./dashboard-service').load(getPool());
  res.set('Cache-Control','no-store');
  return res.render('admin/index',adminPageLocals('index',res,{dashboardSummary}));
 } catch(error){return next(error);}
});
// Retired mock-only manager. Preserve existing bookmarks without exposing duplicate nonworking controls.
router.get('/management-center',(req,res)=>res.redirect(303,'/admin/index'));
// Audit log is a protected SSR page, not the original static demo placeholder.
router.get('/system-log',async(req,res,next)=>{
 try {
   const audit=await listAudit(getPool(),req.query);
   res.set('Cache-Control','no-store');
   return res.render('admin/system-log',adminPageLocals('system-log',res,{
     ...audit,auditTypeLabel,auditTypeIcon
   }));
 } catch(err){next(err);}
});
router.get('/system-log/export',async(req,res,next)=>{
 try {
   const result=await exportAudit(getPool(),req.query);
   if(result.tooMany)return res.status(422).type('text/plain').send('عدد السجلات كبير؛ يرجى تضييق الفلاتر قبل التصدير.');
   res.set('Cache-Control','no-store');
   res.set('Content-Disposition','attachment; filename="sdc-audit-log.csv"');
   return res.type('text/csv; charset=utf-8').send(result.csv);
 } catch(err){next(err);}
});
// Reuse the original detailed Super Admin clinic page instead of a sample/demo duplicate.
router.get('/clinic-details',async(req,res,next)=>{
 try {
   const id=req.query.id;
   if(!/^[1-9]\d{0,17}$/.test(String(id||'')))return res.redirect(303,'/admin/approvals');
   const clinic=await require('../clinic/onboarding/service').findClinic(getPool(),id);
   if(!clinic)return res.sendStatus(404);
   const requestedTab=String(req.query?.tab||'profile');
   const adminClinicTab=['profile','staff','doctors','appointments'].includes(requestedTab)?requestedTab:'profile';
   let clinicOperations=null,clinicOperationsError=false;
   if(adminClinicTab!=='profile'){
     try{clinicOperations=await require('./clinic-control-routes').loadClinicTab(getPool(),clinic,adminClinicTab,req.query);}
     catch(e){clinicOperationsError=true;console.error('[ADMIN_CLINIC_TAB_FAILED]',{tab:adminClinicTab,code:e?.code||'UNKNOWN',constraint:e?.constraint||'',message:String(e?.message||'').slice(0,250)});}
   }
   let clinicOverview={doctors:0,staff:0,bookings:0,services:0};
   if(adminClinicTab==='profile'){
    const [d,st,b,svc]=await Promise.all([
     getPool().query('SELECT COUNT(*)::int AS n FROM sdc."WORKS_AT" WHERE "Clinic_ID"=$1::bigint',[id]),
     getPool().query('SELECT COUNT(*)::int AS n FROM sdc."STAFF_AT" WHERE "Clinic_ID"=$1::bigint',[id]),
     getPool().query('SELECT COUNT(*)::int AS n FROM sdc."BOOKING" WHERE "Clinic_ID"=$1::bigint',[id]),
     getPool().query('SELECT COUNT(*)::int AS n FROM sdc."OFFERS" WHERE "Clinic_ID"=$1::bigint',[id])
    ]);
    clinicOverview={doctors:d.rows[0]?.n||0,staff:st.rows[0]?.n||0,bookings:b.rows[0]?.n||0,services:svc.rows[0]?.n||0};
   }
   res.set('Cache-Control','no-store');
   return res.render('admin/clinic-details',adminPageLocals('clinic-details',res,{liveClinic:clinic,adminClinicTab,clinicOverview,clinicOperations,clinicOperationsError,clinicStatusResult:String(req.query?.result||'')}));
 }catch(error){return next(error);}
});
// v27.13: supervised operational status change, never a deletion or re-approval.
router.post('/clinic-details/status',BODY,async(req,res)=>{
 if(!validateCsrf(req,'admin'))return res.status(403).send('رمز حماية النموذج غير صالح.');
 const id=String(req.body?.clinic_id||'');
 if(!/^[1-9]\d{0,17}$/.test(id))return res.sendStatus(400);
 try{
  const outcome=await require('../clinic/onboarding/service').changeClinicStatus(
   getPool(),req.sdcActor,id,req.body?.action,req.body?.reason);
  if(outcome.status==='forbidden')return res.sendStatus(403);
  if(outcome.status==='not_found')return res.sendStatus(404);
  return res.redirect(303,`/admin/clinic-details?id=${encodeURIComponent(id)}&result=${encodeURIComponent(outcome.status)}`);
 }catch(error){
  console.error('[ADMIN_CLINIC_STATUS_FAILED]',{
   code:error?.code||'UNKNOWN',constraint:error?.constraint||'',message:error?.message||String(error)
  });
  return res.redirect(303,`/admin/clinic-details?id=${encodeURIComponent(id)}&result=failed`);
 }
});
// Administrative corrections to clinic contact fields only. No changes to license or ownership.
router.post('/clinic-details/:id/update',BODY,async(req,res)=>{
 if(!validateCsrf(req,'admin'))return res.status(403).send('رمز حماية النموذج غير صالح.');
 const id=String(req.params.id||'');if(!/^[1-9]\d{0,17}$/.test(id))return res.sendStatus(404);
 try{
  const result=await clinicProfile.update(getPool(),{clinicId:id,adminId:req.adminUserId,body:req.body});
  if(result.status==='unauthorized')return res.sendStatus(403);
  if(result.status==='not_found')return res.sendStatus(404);
  return res.redirect(303,`/admin/clinic-details?id=${id}&result=${encodeURIComponent(result.status)}`);
 }catch(e){console.error('[ADMIN_CLINIC_PROFILE_FAILED]',e?.code||'UNKNOWN');return res.redirect(303,`/admin/clinic-details?id=${id}&result=failed`);}
});
router.post('/clinic-details/:id/delete-rejected',BODY,async(req,res)=>{
 if(!validateCsrf(req,'admin'))return res.status(403).send('رمز حماية النموذج غير صالح.');
 const id=String(req.params.id||'');if(!/^[1-9]\d{0,17}$/.test(id))return res.sendStatus(404);
 if(req.body?.confirmation!=='DELETE')return res.redirect(303,`/admin/clinic-details?id=${id}&result=invalid`);
 try{
  const result=await clinicProfile.deleteRejected(getPool(),{clinicId:id,adminId:req.adminUserId,reason:req.body?.reason});
  if(result.status==='unauthorized')return res.sendStatus(403);
  if(result.status==='not_found')return res.sendStatus(404);
  if(['ok','cleanup_pending'].includes(result.status))return res.redirect(303,`/admin/approvals?result=${result.status==='ok'?'deleted':'cleanup_pending'}`);
  return res.redirect(303,`/admin/clinic-details?id=${id}&result=${encodeURIComponent(result.status)}`);
 }catch(e){console.error('[ADMIN_CLINIC_DELETE_FAILED]',e?.code||'UNKNOWN');return res.redirect(303,`/admin/clinic-details?id=${id}&result=failed`);}
});
// v27.19 — booking oversight; clinic/patient still own booking decisions and scheduling.
const appointmentOversight=require('./appointments-oversight-service');
const clinicProfile=require('./clinic-profile-management-service');
router.get('/appointments',async(req,res,next)=>{
 try{const data=await appointmentOversight.list(getPool(),req.query);
  res.set('Cache-Control','no-store');return res.render('admin/appointments',adminPageLocals('appointments',res,data));
 }catch(e){next(e);}
});
router.get('/appointment-details',async(req,res,next)=>{
 try{const id=String(req.query.id||'');if(!appointmentOversight.validId(id))return res.sendStatus(404);
  const data=await appointmentOversight.detail(getPool(),id);if(!data)return res.sendStatus(404);
  const notice=['noted','updated','unchanged','invalid','failed','ok','closed','in_use','unavailable','forbidden','stale','conflict','reason_required'].includes(req.query.result)?req.query.result:'';
  res.set('Cache-Control','no-store');return res.render('admin/appointment-details',adminPageLocals('appointment-details',res,{...data,appointmentNotice:notice}));
 }catch(e){next(e);}
});
router.post('/appointment-details/:id/note',BODY,async(req,res)=>{
 if(!validateCsrf(req,'admin'))return res.status(403).send('رمز حماية النموذج غير صالح.');
 const id=String(req.params.id||'');if(!appointmentOversight.validId(id))return res.sendStatus(404);
 try{const result=await appointmentOversight.note(getPool(),{bookingId:id,adminId:req.adminUserId,reason:req.body?.reason});
  if(result.status==='unauthorized')return res.sendStatus(403);
  if(result.status==='not_found')return res.sendStatus(404);
  return res.redirect(303,`/admin/appointment-details?id=${id}&result=${result.status==='ok'?'noted':result.status}`);
 }catch(e){console.error('[ADMIN_APPOINTMENT_NOTE_FAILED]',{code:e?.code||'UNKNOWN'});
  return res.redirect(303,`/admin/appointment-details?id=${id}&result=failed`);}
});
router.post('/appointment-details/:id/update-admin-note',BODY,async(req,res)=>{
 if(!validateCsrf(req,'admin'))return res.status(403).send('رمز حماية النموذج غير صالح.');
 const id=String(req.params.id||'');if(!appointmentOversight.validId(id))return res.sendStatus(404);
 try{
  const r=await appointmentOversight.updateAdministrativeNote(getPool(),{bookingId:id,adminId:req.adminUserId,reason:req.body?.reason,note:req.body?.note});
  if(r.status==='unauthorized')return res.sendStatus(403);
  if(r.status==='not_found')return res.sendStatus(404);
  return res.redirect(303,`/admin/appointment-details?id=${id}&result=${encodeURIComponent(r.status==='ok'?'updated':r.status)}`);
 }catch(e){console.error('[ADMIN_BOOKING_NOTE_UPDATE_FAILED]',e?.code||'UNKNOWN');return res.redirect(303,`/admin/appointment-details?id=${id}&result=failed`);}
});
// v27.24 — genuine administration settings: protected save + audit log.
const platformSettings=require('./platform-settings-service');
router.post('/settings/profile',BODY,async(req,res)=>{
 if(!validateCsrf(req,'admin'))return res.status(403).send('رمز حماية النموذج غير صالح.');
 try{
  const result=await platformSettings.save(getPool(),req.adminUserId,'profile',req.body);
  if(result.status==='forbidden')return res.sendStatus(403);
  return res.redirect(303,`/admin/settings?section=account&result=${result.status==='ok'?'saved':'invalid'}`);
 }catch(e){console.error('[PLATFORM_SETTINGS_FAILED]',e.code||'UNKNOWN');
  return res.redirect(303,'/admin/settings?section=account&result=failed');}
});
// v27.21.2 — Finance settings + automatic settlement policy, platform-only.
const financeAutomation=require('./finance-automation-service');
router.post('/settings/finance',BODY,async(req,res)=>{
 if(!validateCsrf(req,'admin'))return res.status(403).send('رمز حماية النموذج غير صالح.');
 try{
  const result=await financeAutomation.save(getPool(),req.adminUserId,req.body);
  if(result.status==='forbidden')return res.sendStatus(403);
  return res.redirect(303,`/admin/settings?section=financeSettings&result=${result.status==='ok'?'saved':'invalid'}`);
 }catch(e){console.error('[ADMIN_FINANCE_SETTINGS_FAILED]',e.code||'UNKNOWN');
  return res.redirect(303,'/admin/settings?section=financeSettings&result=failed');}
});
// v27.22 — all metrics aggregated in SQL and scoped to authenticated admin.
const adminReports=require('./reports-service');
router.get('/reports',async(req,res,next)=>{
 try{const data=await adminReports.compute(getPool(),req.query);
  if(!data)return res.status(422).send('فترة التقرير غير صالحة.');
  res.set('Cache-Control','no-store');return res.render('admin/reports',adminPageLocals('reports',res,data));
 }catch(e){next(e);}
});
router.get('/reports/export',async(req,res,next)=>{
 try{const data=await adminReports.compute(getPool(),req.query);
  if(!data)return res.status(422).send('فترة التقرير غير صالحة.');
  res.set('Cache-Control','no-store');res.set('Content-Disposition','attachment; filename="sdc-platform-report.csv"');
  return res.type('text/csv; charset=utf-8').send(adminReports.csv(data));
 }catch(e){next(e);}
});
// v27.21 — platform financial oversight: one canonical workspace and read-only invoice details.
const financeOversight=require('./finance-oversight-service');
router.get('/finance',async(req,res,next)=>{
 try{const data=await financeOversight.list(getPool(),req.query);
  const notices=['created','received','invalid','overlap','empty','no_clinic','duplicate','settled','excess','not_found','failed'];
  res.set('Cache-Control','no-store');return res.render('admin/finance',adminPageLocals('finance',res,{
   ...data,financeRequestedSettlement:req.query.settlement||'',financeNotice:notices.includes(req.query.result)?req.query.result:''}));
 }catch(e){next(e);}
});
router.get('/finance/export',async(req,res,next)=>{
 try{const result=await financeOversight.exportData(getPool(),req.query);
  if(result.tooMany)return res.status(422).type('text/plain').send('عدد السجلات كبير؛ يرجى تضييق الفلاتر قبل التصدير.');
  res.set('Cache-Control','no-store');res.set('Content-Disposition','attachment; filename="sdc-admin-finance.csv"');
  return res.type('text/csv; charset=utf-8').send(result.csv);
 }catch(e){next(e);}
});
router.post('/finance/settlements/create',BODY,(req,res)=>{
 if(!validateCsrf(req,'admin'))return res.status(403).send('رمز حماية النموذج غير صالح.');
 return res.status(405).send('يتم إنشاء التسويات تلقائيًا من إعدادات المالية، وليس من النماذج اليدوية.');
});
// Only the Super Admin confirms actual receipt of a clinic commission payment.
router.post('/finance/settlements/payment',BODY,async(req,res)=>{
 if(!validateCsrf(req,'admin'))return res.status(403).send('رمز حماية النموذج غير صالح.');
 const requested=String(req.body?.settlement_id||'');
 if(!financeOversight.validId(requested))return res.status(422).send('رقم التسوية غير صالح.');
 try{
  const result=await financeOversight.commission.recordAdminPayment(getPool(),req.adminUserId,req.body||{});
  if(result.status==='forbidden')return res.sendStatus(403);
  const status=result.status==='ok'?'received':result.status;
  return res.redirect(303,`/admin/finance?tab=settlements&settlement=${encodeURIComponent(requested)}&result=${encodeURIComponent(status)}#settlementDetails`);
 }catch(e){console.error('[ADMIN_SETTLEMENT_PAYMENT_FAILED]',e?.code||'UNKNOWN');
  return res.redirect(303,`/admin/finance?tab=settlements&settlement=${encodeURIComponent(requested)}&result=failed#settlementDetails`);}
});
router.get('/invoice-details',async(req,res,next)=>{
 try{const id=String(req.query.id||'');if(!financeOversight.validId(id))return res.sendStatus(404);
  const data=await financeOversight.invoiceDetail(getPool(),id);if(!data)return res.sendStatus(404);
  const notice=['noted','updated','unchanged','invalid','failed'].includes(req.query.result)?req.query.result:'';
  res.set('Cache-Control','no-store');return res.render('admin/invoice-details',adminPageLocals('invoice-details',res,{...data,financeInvoiceNotice:notice}));
 }catch(e){next(e);}
});
router.post('/invoice-details/:id/note',BODY,async(req,res)=>{
 if(!validateCsrf(req,'admin'))return res.status(403).send('رمز حماية النموذج غير صالح.');
 const id=String(req.params.id||'');if(!financeOversight.validId(id))return res.sendStatus(404);
 try{const outcome=await financeOversight.note(getPool(),{invoiceId:id,adminId:req.adminUserId,reason:req.body?.reason});
  if(outcome.status==='unauthorized')return res.sendStatus(403);
  if(outcome.status==='not_found')return res.sendStatus(404);
  return res.redirect(303,`/admin/invoice-details?id=${id}&result=${outcome.status==='ok'?'noted':'invalid'}`);
 }catch(e){console.error('[ADMIN_INVOICE_NOTE_FAILED]',e?.code||'UNKNOWN');return res.redirect(303,`/admin/invoice-details?id=${id}&result=failed`);}
});
// v27.20 — privacy-preserving visit/report-status oversight; no clinical reads or report invalidation.
const medicalOversight=require('./medical-oversight-service');
router.get('/medical-records',async(req,res,next)=>{
 try{const data=await medicalOversight.list(getPool(),req.query);
  res.set('Cache-Control','no-store');return res.render('admin/medical-records',adminPageLocals('medical-records',res,data));
 }catch(e){next(e);}
});
router.get('/medical-record-details',async(req,res,next)=>{
 try{const id=String(req.query.id||'');if(!medicalOversight.validId(id))return res.sendStatus(404);
  const data=await medicalOversight.detail(getPool(),id);if(!data)return res.sendStatus(404);
  const notice=['noted','updated','unchanged','invalid','failed'].includes(req.query.result)?req.query.result:'';
  res.set('Cache-Control','no-store');return res.render('admin/medical-record-details',adminPageLocals('medical-record-details',res,{...data,medicalNotice:notice}));
 }catch(e){next(e);}
});
router.post('/medical-record-details/:id/note',BODY,async(req,res)=>{
 if(!validateCsrf(req,'admin'))return res.status(403).send('رمز حماية النموذج غير صالح.');
 const id=String(req.params.id||'');if(!medicalOversight.validId(id))return res.sendStatus(404);
 try{const result=await medicalOversight.note(getPool(),{visitId:id,adminId:req.adminUserId,reason:req.body?.reason});
  if(result.status==='unauthorized')return res.sendStatus(403);
  if(result.status==='not_found')return res.sendStatus(404);
  return res.redirect(303,`/admin/medical-record-details?id=${id}&result=${result.status==='ok'?'noted':result.status}`);
 }catch(e){console.error('[ADMIN_MEDICAL_OVERSIGHT_NOTE_FAILED]',{code:e?.code||'UNKNOWN'});
  return res.redirect(303,`/admin/medical-record-details?id=${id}&result=failed`);}
});
// v27.15 — real, paginated account directory. No static fallback or unguarded user mutation.
const adminUsers=require('./users-management-service');
router.get('/users',async(req,res,next)=>{
 try {const data=await adminUsers.list(getPool(),req.query);
  res.set('Cache-Control','no-store');return res.render('admin/users',adminPageLocals('users',res,{...data,userListNotice:req.query.result==='deleted'?'deleted':''}));
 }catch(e){next(e);}
});
router.get('/user-details',async(req,res,next)=>{
 try {const id=String(req.query.id||'');if(!adminUsers.validId(id))return res.sendStatus(404);
  const data=await adminUsers.detail(getPool(),id);if(!data)return res.sendStatus(404);
  if(data.user.role==='doctor'&&data.user.doctor_id)return res.redirect(303,`/admin/doctor-details?id=${data.user.doctor_id}`);
  const notice=['edit','delete','suspend','resume','not_deletable','in_use','self','role_owned','bookings','unchanged','invalid','credentials','failed','schema','permission'].includes(req.query.result)?req.query.result:'';
  res.set('Cache-Control','no-store');return res.render('admin/user-details',adminPageLocals('user-details',res,{...data,userNotice:notice}));
 }catch(e){next(e);}
});
router.post('/user-details/:id/:action',BODY,async(req,res)=>{
 if(!validateCsrf(req,'admin'))return res.status(403).send('رمز حماية النموذج غير صالح.');
 const id=String(req.params.id||''),action=req.params.action;
 if(!adminUsers.validId(id)||!['edit','delete','suspend','resume'].includes(action))return res.sendStatus(404);
 try {const result=await adminUsers.mutate(getPool(),{userId:id,adminId:req.adminUserId,action,body:req.body});
  if(result.status==='unauthorized')return res.sendStatus(403);
  if(result.status==='not_found')return res.sendStatus(404);
  if(result.status==='ok'&&action==='delete')return res.redirect(303,'/admin/users?result=deleted');
  return res.redirect(303,`/admin/user-details?id=${id}&result=${encodeURIComponent(result.status==='ok'?action:result.status)}`);
 }catch(e){console.error('[ADMIN_USER_MUTATION_FAILED]',{code:e?.code||'UNKNOWN',action});
  const code=e?.code==='42501'?'permission':e?.code==='23503'?'in_use':['42P01','42703','42883'].includes(e?.code)?'schema':'failed';
  return res.redirect(303,`/admin/user-details?id=${id}&result=${code}`);
 }
});
// v27.16 — platform-managed specialties and reusable services catalog.
// Prices, duration and doctor assignments remain strictly clinic-owned.
const adminCatalog=require('./catalog-management-service');
const catalogNotices=new Set(['created','updated','deleted','invalid','duplicate','reserved','in_use','history','unchanged','failed','schema','permission','constraint']);
router.get('/specialties',async(req,res,next)=>{
 try {const data=await adminCatalog.specialties(getPool());res.set('Cache-Control','no-store');
  return res.render('admin/specialties',adminPageLocals('specialties',res,{...data,catalogNotice:catalogNotices.has(req.query.result)?req.query.result:''}));
 }catch(e){next(e);}
});
router.get('/services',async(req,res,next)=>{
 try {const data=await adminCatalog.services(getPool());res.set('Cache-Control','no-store');
  return res.render('admin/services',adminPageLocals('services',res,{...data,catalogNotice:catalogNotices.has(req.query.result)?req.query.result:''}));
 }catch(e){console.error('[ADMIN_SERVICES_OPEN_FAILED]',{code:e?.code||'UNKNOWN',constraint:e?.constraint||'',message:String(e?.message||'').slice(0,300)});next(e);}
});
function catalogMutationError(e,kind,action){
 console.error('[ADMIN_CATALOG_MUTATION_FAILED]',{kind,action,code:e?.code||'UNKNOWN',constraint:e?.constraint||'',message:e?.message||String(e)});
 if(e?.code==='42501')return 'permission';
 if(['42P01','42703','42883'].includes(e?.code))return 'schema';
 if(e?.code==='23505')return 'duplicate';
 if(['23503','23514'].includes(e?.code))return 'constraint';
 return 'failed';
}
async function catalogPost(req,res,kind,action,id){
 if(!validateCsrf(req,'admin'))return res.status(403).send('رمز حماية النموذج غير صالح.');
 const slug=kind==='specialty'?'specialties':'services';
 try{const result=await adminCatalog.mutate(getPool(),{kind,action,id,adminId:req.adminUserId,body:req.body});
  if(result.status==='unauthorized')return res.sendStatus(403);
  if(result.status==='not_found')return res.sendStatus(404);
  const names={create:'created',update:'updated',delete:'deleted'};
  return res.redirect(303,`/admin/${slug}?result=${encodeURIComponent(result.status==='ok'?names[action]:result.status)}`);
 }catch(e){return res.redirect(303,`/admin/${slug}?result=${catalogMutationError(e,kind,action)}`);}
}
router.post('/specialties/create',BODY,(req,res)=>catalogPost(req,res,'specialty','create',null));
router.post('/specialties/:id/:action',BODY,(req,res)=>{
 if(!['update','delete'].includes(req.params.action)||!adminCatalog.validId(req.params.id))return res.sendStatus(404);
 return catalogPost(req,res,'specialty',req.params.action,req.params.id);
});
router.post('/services/create',BODY,(req,res)=>catalogPost(req,res,'service','create',null));
router.post('/services/:id/:action',BODY,(req,res)=>{
 if(!['update','delete'].includes(req.params.action)||!adminCatalog.validId(req.params.id))return res.sendStatus(404);
 return catalogPost(req,res,'service',req.params.action,req.params.id);
});
// v27.17: supervise real clinic-owned vacancy and job application records.
const jobNotices=new Set(['suspended','resumed','deleted','expired','in_use','noted','invalid','unchanged','failed','schema','permission','saved','admin_suspended']);
function adminJobsError(e,action){
 console.error('[ADMIN_JOBS_FAILED]',{action,code:e?.code||'UNKNOWN',message:e?.message||String(e)});
 return e?.code==='42501'?'permission':e?.code==='23503'?'in_use':['42P01','42703','42883'].includes(e?.code)?'schema':'failed';
}
router.get('/job-details',async(req,res,next)=>{
 try{const data=await adminJobs.detail(getPool(),String(req.query.id||''),req.query);if(!data)return res.sendStatus(404);
  res.set('Cache-Control','no-store');return res.render('admin/job-details',adminPageLocals('job-details',res,{...data,jobNotice:jobNotices.has(req.query.result)?req.query.result:''}));
 }catch(e){next(e);}
});
router.get('/job-application-details',async(req,res,next)=>{
 try{const data=await adminJobs.application(getPool(),String(req.query.id||''));if(!data)return res.sendStatus(404);
  res.set('Cache-Control','no-store');return res.render('admin/job-application-details',adminPageLocals('job-application-details',res,{...data,jobNotice:jobNotices.has(req.query.result)?req.query.result:''}));
 }catch(e){next(e);}
});
// Moderation is a separate protected flag, not the clinic's ordinary closed/archive workflow.
router.post('/job-details/:id/:action',BODY,async(req,res)=>{
 if(!validateCsrf(req,'admin'))return res.status(403).send('رمز حماية النموذج غير صالح.');
 const id=String(req.params.id||''),action=String(req.params.action||'');
 if(!adminJobs.validId(id)||!['suspend','resume','delete'].includes(action))return res.sendStatus(404);
 try{const result=await adminJobs.mutate(getPool(),{adminId:req.adminUserId,id,kind:action,body:req.body});
  if(result.status==='unauthorized')return res.sendStatus(403);
  if(result.status==='not_found')return res.sendStatus(404);
  if(result.status==='ok'&&action==='delete')return res.redirect(303,'/admin/jobs?result=deleted');
  return res.redirect(303,`/admin/job-details?id=${id}&result=${result.status==='ok'?{suspend:'suspended',resume:'resumed'}[action]:result.status}`);
 }catch(e){return res.redirect(303,`/admin/job-details?id=${id}&result=${adminJobsError(e,action)}`);}
});
router.post('/job-application-details/:id/note',BODY,async(req,res)=>{
 if(!validateCsrf(req,'admin'))return res.status(403).send('رمز حماية النموذج غير صالح.');
 const id=String(req.params.id||'');if(!adminJobs.validId(id))return res.sendStatus(404);
 try{const result=await adminJobs.mutate(getPool(),{adminId:req.adminUserId,id,kind:'note',body:req.body});
  if(result.status==='unauthorized')return res.sendStatus(403);
  if(result.status==='not_found')return res.sendStatus(404);
  return res.redirect(303,`/admin/job-application-details?id=${id}&result=${result.status==='ok'?'noted':result.status}`);
 }catch(e){return res.redirect(303,`/admin/job-application-details?id=${id}&result=${adminJobsError(e,'note')}`);}
});
router.get('/job-application-details/:id/attachment/:attachment',async(req,res,next)=>{
 const id=String(req.params.id||''),att=String(req.params.attachment||'');
 if(!adminJobs.validId(id)||!adminJobs.validId(att))return res.sendStatus(404);
 try{const record=await adminJobs.attachment(getPool(),id,att);if(!record)return res.sendStatus(404);
  const stored=require('../doctor/jobs/service').storedPath(record.ref);if(!stored)return res.sendStatus(404);
  const path=require('node:path'),ext=path.extname(stored).toLowerCase();
  if(!['.pdf','.jpg','.png','.doc','.docx'].includes(ext))return res.sendStatus(404);
  const mime={'.pdf':'application/pdf','.jpg':'image/jpeg','.png':'image/png','.doc':'application/msword','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}[ext];
  const name=String(record.name||'attachment').replace(/[\r\n"\\/]/g,'_').slice(0,180);
  res.set({'Cache-Control':'private, no-store','Content-Type':mime,'X-Content-Type-Options':'nosniff',
   'Content-Disposition':`attachment; filename="attachment${ext}"; filename*=UTF-8''${encodeURIComponent(name)}`});
  return res.sendFile(stored,error=>{if(error&&!res.headersSent)next(error);});
 }catch(e){next(e);}
});
// v27.18: staff access is clinic-owned. Super Admin may inspect and log notes,
// but never change a clinic role, permission, or membership from this page.
router.get('/staff-permissions',async(req,res,next)=>{
 try{
  const data=await adminStaff.list(getPool(),req.query);
  res.set('Cache-Control','private, no-store');
  const notice=['noted','invalid','not_found','failed'].includes(req.query.result)?req.query.result:'';
  return res.render('admin/staff-permissions',adminPageLocals('staff-permissions',res,{...data,staffNotice:notice}));
 }catch(error){next(error);}
});
router.post('/staff-permissions/:userId/:clinicId/note',BODY,async(req,res)=>{
 if(!validateCsrf(req,'admin'))return res.status(403).send('رمز حماية النموذج غير صالح.');
 const {userId,clinicId}=req.params;
 if(!adminStaff.validId(userId)||!adminStaff.validId(clinicId))return res.sendStatus(404);
 try{
  const result=await adminStaff.addNote(getPool(),{userId,clinicId,adminId:req.adminUserId,reason:req.body?.reason});
  if(result.status==='forbidden')return res.sendStatus(403);
  if(result.status==='not_found')return res.sendStatus(404);
  return res.redirect(303,`/admin/staff-permissions?result=${result.status==='ok'?'noted':'invalid'}`);
 }catch(error){
  console.error('[ADMIN_STAFF_OVERSIGHT_FAILED]',error?.code||'UNKNOWN');
  return res.redirect(303,'/admin/staff-permissions?result=failed');
 }
});
// v27.14 — live doctor directory and real doctor detail (no fallback to static demo).
router.get('/doctors',async(req,res,next)=>{
 try {if(req.query.tab==='jobs'||Object.keys(req.query).some(k=>k.startsWith('job_'))){
   const q=new URLSearchParams();for(const [key,value] of Object.entries(req.query)){if(key!=='tab'&&key.startsWith('job_')&&typeof value==='string')q.set(key,value);}
   return res.redirect(303,'/admin/jobs'+(q.size?'?'+q.toString():''));
  }
  const doctors=await adminDoctors.list(getPool());
  res.set('Cache-Control','no-store');return res.render('admin/doctors',adminPageLocals('doctors',res,{doctors,showJobs:false}));
 }catch(e){next(e);}
});
// Reuse the existing clinic jobs domain service for audited Super Admin corrections.
router.post('/jobs/save',express.urlencoded({extended:false,limit:'64kb',parameterLimit:45}),(req,res)=>res.status(403).send('إنشاء وتعديل إعلان الوظيفة من صلاحيات العيادة، وليس المشرف العام.'));
router.get('/jobs',async(req,res,next)=>{
 try {const jobData=await adminJobs.list(getPool(),req.query);
  res.set('Cache-Control','no-store');return res.render('admin/doctors',adminPageLocals('doctors',res,{...jobData,doctors:[],showJobs:true,currentPage:'admin/jobs.html',jobListNotice:['deleted','saved','invalid','failed'].includes(req.query.result)?req.query.result:''}));
 }catch(e){next(e);}
});
router.get('/doctor-details',async(req,res,next)=>{
 try{const data=await adminDoctors.detail(getPool(),req.query.id);
  if(!data)return res.sendStatus(404);
  const notice=['suspend','resume','edit','edit-profile','delete','not_deletable','in_use','bookings','manager','duplicate','invalid','unchanged','failed','schema','permission'].includes(req.query?.result)?req.query.result:'';
  res.set('Cache-Control','no-store');return res.render('admin/doctor-details',adminPageLocals('doctor-details',res,{...data,doctorNotice:notice}));
 }catch(e){next(e);}
});
router.post('/doctor-details/:id/:action',BODY,async(req,res,next)=>{
 if(!validateCsrf(req,'admin'))return res.status(403).send('رمز حماية النموذج غير صالح.');
 const id=String(req.params.id||''),action=req.params.action;
 if(!adminDoctors.validId(id)||!['suspend','resume','edit','edit-profile','delete'].includes(action))return res.sendStatus(404);
 try{const result=action==='edit-profile'
   ?await adminDoctors.mutateProfile(getPool(),{doctorId:id,adminId:req.adminUserId,body:req.body})
   :action==='delete'
   ?await adminDoctors.deleteUnusedRegistration(getPool(),{doctorId:id,adminId:req.adminUserId,reason:req.body?.reason})
   :await adminDoctors.mutate(getPool(),{doctorId:id,adminId:req.adminUserId,action,body:req.body});
  if(result.status==='unauthorized')return res.sendStatus(403);
  if(result.status==='not_found')return res.sendStatus(404);
  if(action==='delete'&&result.status==='ok')return res.redirect(303,'/admin/doctors?result=deleted');
  return res.redirect(303,`/admin/doctor-details?id=${id}&result=${encodeURIComponent(result.status==='ok'?action:result.status)}`);
 }catch(error){
  console.error('[ADMIN_DOCTOR_MUTATION_FAILED]',{action,code:error?.code||'UNKNOWN',message:error?.message||String(error)});
  const errorCode=error?.code==='42501'?'permission':(['42703','42883','42P01'].includes(error?.code)?'schema':'failed');
  return res.redirect(303,`/admin/doctor-details?id=${id}&result=${errorCode}`);
 }
});
router.get('/doctor-license-review',async(req,res,next)=>{
  try {
    const id=req.query.id;
    if(typeof id!=='string'|| !/^[1-9]\d{0,17}$/.test(id))return res.redirect(303,'/admin/doctors');
    const doctor=await findDoctor(getPool(),id);
    if(!doctor)return res.status(404).send('الطبيب غير موجود.');
    const result=req.query.result==='approved'?'approved':req.query.result==='rejected'?'rejected':null;
    res.set('Cache-Control','no-store');
    return res.render('admin/doctor-license-review',adminPageLocals('doctor-license-review',res,{doctor,result,formError:''}));
  }catch(e){next(e);}
});
router.post('/doctor-license-review',BODY,async(req,res,next)=>{
  if(!validateCsrf(req,'admin'))return res.status(403).send('انتهت صلاحية النموذج. ارجع لصفحة المراجعة وحاول من جديد.');
  try {
    const doctorId=req.body?.doctor_id;
    const result=await reviewDoctor(getPool(),{
      doctorId,adminUserId:req.adminUserId,decision:req.body?.decision,
      reason:req.body?.reason,checks:req.body
    });
    if(result.status==='ok')return res.redirect(303,`/admin/doctor-license-review?id=${doctorId}&result=${result.decision==='approve'?'approved':'rejected'}`);
    if(result.status==='unauthorized')return res.status(403).send('لا تملك صلاحية اعتماد الترخيص.');
    if(result.status==='not_found')return res.status(404).send('الطبيب غير موجود.');
    if(result.status==='already_reviewed')return res.status(409).send('تمت مراجعة هذا الترخيص بالفعل؛ حدّث الصفحة قبل أي إجراء.');
    const doctor=await findDoctor(getPool(),doctorId);
    if(!doctor)return res.status(404).send('الطبيب غير موجود.');
    return res.status(422).render('admin/doctor-license-review',adminPageLocals('doctor-license-review',res,{
      doctor,result:null,formError:result.status==='invalid_checks'?'يجب تأكيد صحة الرقم وتطابق الهوية والتخصص قبل الموافقة.':'اكتب سبب القرار من 8 إلى 1000 حرف وتحقق من المدخلات.'
    }));
  } catch(e) {next(e);}
});

// Report failures without exposing database details in the HTML response.
// The structured line allows a local PostgreSQL/schema issue to be diagnosed from CMD.
function labMutationError(error,action){
 console.error('[ADMIN_LAB_MUTATION_FAILED]',{
  action,code:error?.code||'UNKNOWN',constraint:error?.constraint||'',
  message:error?.message||String(error),detail:error?.detail||'',hint:error?.hint||''
 });
 if(error?.code==='42703'||error?.code==='42883')return 'schema';
 if(error?.code==='42501')return 'permission';
 if(error?.code==='23505')return 'duplicate';
 if(error?.code==='23503')return 'in_use';
 if(error?.code==='23514')return 'constraint';
 return 'failed';
}
// v27.12: real laboratory catalogue (platform-owned), using the original Admin pages.
const labAdmin=require('./lab-service');
router.get('/labs',async(req,res,next)=>{
 try{const data=await labAdmin.labList(getPool());res.set('Cache-Control','no-store');
  return res.render('admin/labs',adminPageLocals('labs',res,{...data,labNotice:req.query?.result||''}));
 }catch(e){next(e);}
});
router.get('/lab-details',async(req,res,next)=>{
 try{const data=await labAdmin.labDetail(getPool(),req.query.id);
  if(!data)return res.sendStatus(404);res.set('Cache-Control','no-store');
  return res.render('admin/lab-details',adminPageLocals('lab-details',res,{...data,labNotice:req.query?.result||''}));
 }catch(e){next(e);}
});
router.post('/labs/create',BODY,async(req,res,next)=>{
 if(!validateCsrf(req,'admin'))return res.status(403).send('رمز حماية النموذج غير صالح.');
 try{const result=await labAdmin.mutate(getPool(),req.adminUserId,'create',null,req.body);
  if(result.status==='unauthorized')return res.sendStatus(403);
  if(result.status==='ok')return res.redirect(303,`/admin/lab-details?id=${result.id}&result=created`);
  return res.redirect(303,`/admin/labs?result=${result.status}`);
 }catch(e){return res.redirect(303,`/admin/labs?result=${labMutationError(e,'create')}`);}
});
router.post('/lab-details/:id/:action',BODY,async(req,res,next)=>{
 if(!validateCsrf(req,'admin'))return res.status(403).send('رمز حماية النموذج غير صالح.');
 try{const action=req.params.action;if(!['update','activate','deactivate','delete'].includes(action))return res.sendStatus(404);
  const result=await labAdmin.mutate(getPool(),req.adminUserId,action,req.params.id,req.body);
  if(result.status==='unauthorized')return res.sendStatus(403);
  if(result.status==='not_found')return res.sendStatus(404);
  if(result.status==='ok'&&action==='delete')return res.redirect(303,'/admin/labs?result=deleted');
  if(result.status==='ok')return res.redirect(303,`/admin/lab-details?id=${result.id}&result=${action}`);
  return res.redirect(303,`/admin/lab-details?id=${encodeURIComponent(req.params.id)}&result=${result.status}`);
 }catch(e){return res.redirect(303,`/admin/lab-details?id=${encodeURIComponent(req.params.id)}&result=${labMutationError(e,req.params.action)}`);}
});
// v27.32: clinic-scoped operational management with the real Super Admin identity.
require('./clinic-control-routes').attach(router,{getPool,adminPageLocals});
module.exports=router;
