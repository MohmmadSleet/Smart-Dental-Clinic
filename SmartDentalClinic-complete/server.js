// Smart Dental Clinic - authenticated Express/EJS SSR with PostgreSQL-backed workflows.
// Role-specific modules are developed incrementally; do not treat legacy UI-only prototypes as persisted features.
'use strict';
const fs = require('node:fs');
const envPath = require('node:path').join(__dirname, '.env');
if (fs.existsSync(envPath)) process.loadEnvFile(envPath);
const express = require('express');
const path = require('node:path');
const pages = require('./config/page-map.json');
const app = express();


app.disable('x-powered-by');
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
// Public role assets must be served before clinic-context guards.
// Otherwise /doctor/assets/styles.css is redirected when the doctor has no clinic.
app.use(express.static(path.join(__dirname, 'public'), { index: false, dotfiles: 'deny' }));

// Locale selection applies to all authenticated roles and public pages.
app.use(require('./backend/i18n/locale').middleware);
app.use(require('./backend/i18n/messages').middleware);
app.get('/language/:lang', require('./backend/i18n/locale').switchLanguage);

// Enforce central session revocation before serving protected or auth routes.
app.use(async (req,res,next)=>{
  try{
    if (req.path.startsWith('/assets/') || !String(req.headers.cookie||'').includes('sdc_session=')) return next();
    await require('./backend/auth/session').restoreTrackedSession(req,res,require('./db/pool').getPool());
    return next();
  } catch (error){console.error('[SESSION_STORE_UNAVAILABLE]',error.code||'UNKNOWN');return res.status(503).send('تعذّر التحقق من الجلسة حاليًا.');}
});
// Unified credential verification and server-side role authorization.
app.use('/media',require('./backend/media/public-profile-media').router);
app.use('/legal',require('./backend/legal/router'));
app.use('/auth/activate/patient',require('./backend/patient/activation/router'));
app.use('/auth/password',require('./backend/auth/password-reset/router'));
app.use('/auth/change-password',require('./backend/auth/password-reset/change-router'));
app.use('/auth/security',require('./backend/security/mfa/router'));
app.use('/account/sessions',require('./backend/auth/sessions-router'));
app.use('/auth', require('./backend/auth/router'));
app.get('/account/doctor-profile',(req,res)=>res.redirect(303,'/doctor/profile')); // retired duplicate UI
// Doctor account settings are account-scoped, accessible even before joining a clinic.
app.use('/doctor/settings',require('./backend/doctor/account-settings/router'));
app.use('/account/context', require('./backend/auth/context-router'));
app.use('/onboarding/doctor/clinic',require('./backend/clinic/onboarding/router'));
const {guard}=require('./backend/auth/guard');
app.use('/patient',guard('patient'));
// All patient pages, booking actions, and medical downloads require completed
// first-entry health data. Server-side enforcement; no route can bypass it.
app.use('/patient',require('./backend/patient/workspace/router').requireHealthSetup);
// Doctor profile is account-scoped: verified doctors need it before joining a clinic.
// Use the existing original /doctor/profile template, never the extra account page.
app.get('/doctor/profile',async(req,res,next)=>{
 try{
  const {resolveSession}=require('./backend/auth/guard');
  const actor=await resolveSession(req,res);
  if(!actor)return res.redirect(303,'/auth/login');
  if(actor.role!=='doctor')return res.status(403).send('هذا القسم للأطباء فقط.');
  const profile=await require('./backend/account/doctor-profile-service').loadDoctorProfile(require('./db/pool').getPool(),actor.userId,actor.doctorId);
  if(!profile)return res.sendStatus(404);
  const item=pages['doctor/profile.html'];
  const css=(kind,href)=>item[kind+'ActiveClasses'][href]?' '+item[kind+'ActiveClasses'][href]:'';
  const aria=(kind,href)=>item[kind+'Aria'][href]==='page'?' aria-current="page"':'';
  const {sessionCsrf}=require('./backend/auth/session');
  res.set('Cache-Control','no-store');
  await new Promise((resolve,reject)=>require('./backend/doctor/notifications-router').locals(req,res,error=>error?reject(error):resolve()));
  return res.render('doctor/profile',{
   doctorAccount:profile,clinicInvitations:await require('./backend/clinic/doctors/service').invites(require('./db/pool').getPool(),actor.doctorId),clinicInvitationMessage:req.query?.clinic_invitation==='updated'?'تم تحديث طلب الانضمام بنجاح.':'',currentPage:'doctor/profile.html',role:'doctor',
   navVariant:item.navVariant,drawerVariant:item.drawerVariant,footerVariant:item.footerVariant,
   navActiveClass:href=>css('nav',href),navAriaCurrent:href=>aria('nav',href),
   drawerActiveClass:href=>css('drawer',href),drawerAriaCurrent:href=>aria('drawer',href),
   currentUser:actor,activeClinic:res.locals.activeClinic||null,
   logoutCsrf:res.locals.logoutCsrf||'',
   passwordChangeCsrf:sessionCsrf(req)
  });
 }catch(error){next(error);}
});
// Invite decision must work even when a verified doctor has no active clinic.
app.post('/doctor/profile/membership',require('express').urlencoded({extended:false,limit:'4kb',parameterLimit:6}),async(req,res,next)=>{
 try{
  const actor=await require('./backend/auth/guard').resolveSession(req,res);
  if(!actor)return res.redirect(303,'/auth/login');
  if(actor.role!=='doctor')return res.sendStatus(403);
  if(!require('./backend/auth/session').validateSessionCsrf(req))return res.sendStatus(403);
  const r=await require('./backend/clinic/doctors/service').decide(require('./db/pool').getPool(),actor.doctorId,actor.userId,req.body.clinic_id,req.body.action);
  if(r.status!=='ok')return res.status(409).send('تعذّر معالجة الدعوة. ربما تم إلغاؤها؛ حدّث صفحة الملف الشخصي.');
  return res.redirect(303,'/doctor/profile?clinic_invitation=updated#clinic-invitations');
 }catch(e){next(e);}
});
// Notification actions also work for a verified doctor who has not yet joined
// a clinic (e.g. marking an invitation read from the account profile).
app.use('/doctor/notifications',async(req,res,next)=>{
 try{
  const actor=await require('./backend/auth/guard').resolveSession(req,res);
  if(!actor)return res.status(401).send('يجب تسجيل الدخول أولًا.');
  if(actor.role!=='doctor')return res.sendStatus(403);
  return next();
 }catch(error){return next(error);}
},require('./backend/doctor/notifications-router').router);
app.use('/doctor',guard('doctor'));
// Shared live notification locals for every protected doctor page.
app.use('/doctor',require('./backend/doctor/notifications-router').locals);
app.use('/clinic',guard('clinic'));
// All original clinic header variants share the same live user notifications.
app.use('/clinic',require('./backend/clinic/notifications-router'));
const patientWorkspace=require('./backend/patient/workspace/router');
app.use('/patient',patientWorkspace.locals);
const appointmentRoutes=require('./backend/appointments/router');
app.use('/patient',appointmentRoutes.patientRouter);
app.use('/patient',patientWorkspace.router);
app.use('/doctor',appointmentRoutes.doctorRouter);
app.use('/clinic',appointmentRoutes.clinicRouter);
// Daily operations reuse clinic/operations and doctor/visit; no duplicate UI pages.
const dailyRoutes=require('./backend/operations/router');
app.use('/clinic',dailyRoutes.clinicRouter);
app.use('/doctor',dailyRoutes.doctorRouter);
// Doctor batch 1: real dashboard, scoped patient files and follow-up read models.
app.use('/doctor',require('./backend/doctor/workspace/router'));
// v26 clinical forms and authentic visit reports in existing original templates.
app.use('/doctor',require('./backend/doctor/workspace/clinical-router'));
// Unified staff notifications, scoped to selected clinic.
app.use('/staff',guard('staff'),require('./backend/staff/notifications').locals);
app.use('/staff',guard('staff'),require('./backend/staff/notifications').router);
app.use('/staff',guard('staff'),dailyRoutes.staffRouter);
// v27.18: appointment listing must be guarded BEFORE its route, not only by the fallback staff middleware.
app.use('/staff',guard('staff'),appointmentRoutes.staffRouter);
app.use('/clinic',require('./backend/clinic/dashboard/router'));
app.use('/clinic',require('./backend/clinic/account-settings/router'));
app.use('/clinic',require('./backend/clinic/settings-router'));
app.use('/clinic',require('./backend/clinic/documents-router'));
app.use('/clinic',require('./backend/clinic/patients/router'));
app.use('/clinic',require('./backend/clinic/staff/router'));
// Read-only clinic clinical summaries in the original page templates.
app.use('/clinic',require('./backend/clinic/clinical-router'));
// v21: original inventory, invoice and settlement pages bound to clinic-scoped PostgreSQL records.
app.use('/clinic',require('./backend/clinic/finance-inventory-router'));
app.use('/clinic',require('./backend/clinic/laboratories-jobs-router'));
app.use('/staff/choose-clinic',guard('staff'),require('./backend/auth/context-router'));
// Live staff workspaces. Guard must run before every read/write handler.
app.use('/staff',guard('staff'),require('./backend/staff/workspace-router'));
app.use('/staff',guard('staff'));
// Doctor onboarding after login is visible only to a verified doctor. The
// pending / rejected license status pages remain public information pages.
app.use('/onboarding/doctor', async(req,res,next)=>{
  if(['/verification-pending','/license-status','/approval-pending'].includes(req.path))return next();
  try{
    const {resolveSession}=require('./backend/auth/guard');
    const actor=await resolveSession(req,res);
    if(!actor)return res.redirect(303,'/auth/login');
    if(actor.role!=='doctor')return res.status(403).send('هذا القسم للأطباء المعتمدين فقط.');
    return next();
  }catch(err){return next(err);}
});
// Real physician job search, application submission and personal status (registered before generic SSR fallback).
app.use('/onboarding/doctor/jobs',require('./backend/doctor/jobs/router'));
app.use('/auth/register/patient', require('./backend/auth/registration/router'));
app.use('/auth/register/doctor', require('./backend/doctor/registration/router'));
// All /admin pages now require an authenticated Super Admin.
app.use('/admin', require('./backend/admin/router'));

// The allowlist maps stable public URLs to actual EJS templates.
// Never render a template using arbitrary user-provided paths.
const cleanRoutes = Object.create(null);
for (const legacyKey of Object.keys(pages)) {
  if (!legacyKey.endsWith('.html')) throw new Error(`Unexpected page-map key: ${legacyKey}`);
  const slug = legacyKey.slice(0, -'.html'.length);
  if (Object.prototype.hasOwnProperty.call(cleanRoutes, slug)) {
    throw new Error(`Duplicate clean route: ${slug}`);
  }
  cleanRoutes[slug] = legacyKey;
}


// Old bookmarks continue to work, but canonical navigation uses clean URLs.
// Redirect only known pages (never redirect arbitrary .html paths).
app.get(/^\/.*\.html$/, (req, res, next) => {
  const legacyKey = req.path.slice(1);
  if (!Object.prototype.hasOwnProperty.call(pages, legacyKey)) return next();
  const cleanPath = '/' + legacyKey.slice(0, -'.html'.length);
  const queryIndex = req.originalUrl.indexOf('?');
  const queryString = queryIndex === -1 ? '' : req.originalUrl.slice(queryIndex);
  return res.redirect(301, cleanPath + queryString);
});

async function renderPage(req, res, next) {
  // /index is the clean counterpart of /index.html; / is an additional home alias.
  const slug = req.path === '/' ? 'index' : req.path.slice(1);
  if (!Object.prototype.hasOwnProperty.call(cleanRoutes, slug)) return next();
  const key = cleanRoutes[slug];
  const item = pages[key];
  const css = (kind, href) => {
    const classes = item[kind + 'ActiveClasses'][href];
    return classes ? ' ' + classes : '';
  };
  const aria = (kind, href) => item[kind + 'Aria'][href] === 'page' ? ' aria-current="page"' : '';
  const showSessions=new Set(['patient/profile','doctor/profile','staff/profile','clinic/account-settings','admin/settings']);
  let accountSessions=[];
  if(showSessions.has(slug) && res.locals?.currentUser && req.sdcSession){
    try {accountSessions=await require('./backend/auth/session').listTrackedSessions(require('./db/pool').getPool(),
      req.sdcActor.userId,req.sdcSession.sessionId);}
    catch(error){return next(error);}
    res.set('Cache-Control','no-store');
  }
  const mfaPages=new Set(['patient/profile','doctor/profile','staff/profile','clinic/account-settings','admin/settings']);
  const mfaView=mfaPages.has(slug)&&req.sdcActor?await require('./backend/security/mfa/profile-page').mfaViewFor(req):null;
  // The existing settings page keeps its MFA and session controls, and now
  // reads the persisted financial policy instead of showing demo defaults.
  let adminFinanceSettings=null;
  let adminPlatformSettings=null;
  if(slug==='admin/settings'){
    try{adminPlatformSettings=await require('./backend/admin/platform-settings-service').read(require('./db/pool').getPool(),req.adminUserId);}
    catch(error){return next(error);}
    try{adminFinanceSettings=await require('./backend/admin/finance-automation-service').settings(require('./db/pool').getPool());}
    catch(error){return next(error);}
  }
  res.render(item.view, {
    adminPlatformSettings,adminSettingsSection: slug==='admin/settings'&&['general','registration','financeSettings','notificationsSettings','security','account'].includes(req.query?.section)?req.query.section:'general',
    adminSettingsNotice: ['saved','invalid','failed'].includes(req.query?.result)?req.query.result:'',
    adminFinanceSettings,adminFinanceNotice: ['saved','invalid','failed'].includes(req.query?.result)?req.query.result:'',
    financeTabSelected: slug==='admin/settings'&&req.query?.section==='financeSettings',
    mfaView,accountSessions,sessionActionCsrf:req.sdcSession?.csrf||'',
    sessionActionMessage:req.query?.sessions==='updated'?'تم تحديث الجلسات بنجاح.':'',
    currentPage: key,
    adminCsrfToken: item.role === 'admin' ? require('./backend/security/csrf').issueCsrf(res,'admin') : '',
    pendingClinicCount: res.locals?.adminPendingClinics || 0,
    logoutCsrf: res.locals?.logoutCsrf || '',
    currentUser: res.locals?.currentUser || null,
    passwordChangeCsrf: require('./backend/auth/session').sessionCsrf(req),
    passwordChangeError: require('./backend/auth/password-reset/profile-destinations').passwordError(req.query?.password_error),
    passwordChangeReference: /^[A-F0-9]{8}$/.test(String(req.query?.password_reference||'')) ? req.query.password_reference : '',
    activeClinic: res.locals?.activeClinic || null,
    staffPermissions: res.locals?.staffPermissions || '',
    staffClinicRole: res.locals?.staffClinicRole || '',
    hasStaffPermission: code => require('./backend/staff/policy').can(res.locals?.staffPermissions,code),
    role: item.role,
    navVariant: item.navVariant,
    drawerVariant: item.drawerVariant,
    footerVariant: item.footerVariant,
    navActiveClass: href => css('nav', href),
    navAriaCurrent: href => aria('nav', href),
    drawerActiveClass: href => css('drawer', href),
    drawerAriaCurrent: href => aria('drawer', href),
  }, (error, html) => {
    if (error) return next(error);
    res.type('html').send(html);
  });
}
app.get(['/', /^\/(?:.+\/)?[^/]+$/], renderPage);
app.use((req, res) => res.status(404).type('text/plain').send('Page not found'));
app.use((err, req, res, next) => {
  // Body-parser errors are request errors, not EJS/SSR failures.
  // Keep detailed diagnostics server-side without logging form contents or tokens.
  if (err.type === 'parameters.too.many' || err.type === 'entity.too.large') {
    console.warn('[REQUEST_BODY_REJECTED]', req.method, req.path, err.type);
    if (res.headersSent) return next(err);
    return res.status(413).type('text/plain').send('تعذّر معالجة الطلب: بيانات النموذج أكبر من الحد المسموح.');
  }
  if (err.type === 'entity.parse.failed') {
    console.warn('[INVALID_REQUEST_BODY]', req.method, req.path);
    if (res.headersSent) return next(err);
    return res.status(400).type('text/plain').send('بيانات النموذج غير صالحة.');
  }
  console.error('SSR render error:', err.message);
  if (res.headersSent) return next(err);
  res.status(500).type('text/plain').send('Page rendering error');
});

const port = Number.parseInt(process.env.PORT || '3000', 10);
if (require.main === module) {
  app.listen(port, () => {
    console.log(`Smart Dental Clinic preview: http://localhost:${port}`);
    require('./backend/admin/finance-automation-service').start(require('./db/pool').getPool());
    require('./backend/patient/workspace/event-notifications').start(require('./db/pool').getPool());
    require('./backend/appointments/service').startExpiration(require('./db/pool').getPool());
  });
}
module.exports = app;
