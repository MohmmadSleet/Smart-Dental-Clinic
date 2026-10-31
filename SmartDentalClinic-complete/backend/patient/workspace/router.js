'use strict';
const express=require('express');
const {getPool}=require('../../../db/pool');
const pages=require('../../../config/page-map.json');
const {sessionCsrf,validateSessionCsrf,listTrackedSessions}=require('../../auth/session');
const svc=require('./service');
const router=express.Router();
const body=express.urlencoded({extended:false,limit:'18kb',parameterLimit:25});
// Mounted after role guard, before existing booking routes so the shared header
// always has its genuine unread count (even on pages handled elsewhere).
async function locals(req,res,next){
 res.set('Cache-Control','private, no-store');
 try{const [count,notices]=await Promise.all([svc.unread(getPool(),req.sdcActor.userId),svc.notifications(getPool(),req.sdcActor.userId,12)]);res.locals.patientUnreadCount=count;res.locals.patientNotifications=notices;res.locals.patientReturnTo=svc.safeReturnTo(req.originalUrl);next();}catch(e){next(e);}
}
function page(req,res,name,extra={}){
 const item=pages[`patient/${name}.html`]||(name==='health-setup'?pages['patient/profile.html']:null);if(!item)throw Error('Patient template metadata missing: '+name);
 const css=(kind,href)=>item[kind+'ActiveClasses'][href]?' '+item[kind+'ActiveClasses'][href]:'';
 const aria=(kind,href)=>item[kind+'Aria'][href]==='page'?' aria-current="page"':'';
 res.set('Cache-Control','private, no-store');
 return res.render(`patient/${name}`,{currentPage:`patient/${name}.html`,role:'patient',navVariant:item.navVariant,drawerVariant:item.drawerVariant,footerVariant:item.footerVariant,
 navActiveClass:href=>css('nav',href),navAriaCurrent:href=>aria('nav',href),drawerActiveClass:href=>css('drawer',href),drawerAriaCurrent:href=>aria('drawer',href),
 currentUser:res.locals.currentUser,activeClinic:null,logoutCsrf:res.locals.logoutCsrf||'',csrfToken:sessionCsrf(req),passwordChangeCsrf:sessionCsrf(req),
 sessionActionCsrf:sessionCsrf(req),patientUnreadCount:res.locals.patientUnreadCount||0,patientNotifications:res.locals.patientNotifications||[],patientReturnTo:res.locals.patientReturnTo||'/patient/index',...extra});
}
function wrap(fn){return async(req,res,next)=>{try{await fn(req,res);}catch(e){console.error('[PATIENT_WORKSPACE]',req.method,req.path,e.code||e.message);next(e);}};}
// The first health questionnaire is a full SSR form: not a JS-only demo modal.
router.get('/health-setup',wrap(async(req,res)=>{
 return page(req,res,'health-setup',{setupError:'',setupValues:{}});
}));
router.post('/health-setup',body,wrap(async(req,res)=>{
 if(!validateSessionCsrf(req))return res.status(403).send('رمز الحماية منتهي. حدّث الصفحة وحاول مجددًا.');
 if(!svc.firstHealthInput(req.body)){
  return res.status(422).render('patient/health-setup',{...setupLocals(req,res),setupError:'يرجى استكمال الحقول الخمسة، أو كتابة «لا يوجد» / «غير معروف» عند عدم وجود معلومات.',setupValues:req.body});
 }
 const result=await svc.updateProfile(getPool(),req.sdcActor.userId,'health',req.body);
 if(result.status==='ok')return res.redirect(303,'/patient/index?health=completed');
 if(result.status==='not_found')return res.sendStatus(404);
 return res.status(422).render('patient/health-setup',{...setupLocals(req,res),setupError:'تعذّر حفظ المعلومات. تحقق من المدخلات وحاول مجددًا.',setupValues:req.body});
}));
function setupLocals(req,res){
 const meta=pages['patient/profile.html'];
 return {currentPage:'patient/profile.html',role:'patient',navVariant:meta.navVariant,drawerVariant:meta.drawerVariant,footerVariant:meta.footerVariant,
 navActiveClass:()=>'',navAriaCurrent:()=>'',drawerActiveClass:()=>'',drawerAriaCurrent:()=>'',
 currentUser:res.locals.currentUser,csrfToken:sessionCsrf(req),logoutCsrf:res.locals.logoutCsrf||'',
 patientUnreadCount:res.locals.patientUnreadCount||0,patientNotifications:res.locals.patientNotifications||[],patientReturnTo:'/patient/index'};
}
router.get('/profile',wrap(async(req,res)=>{
 const patient=await svc.profile(getPool(),req.sdcActor.userId);if(!patient)return res.sendStatus(404);
 const [mfaView,accountSessions]=await Promise.all([require('../../security/mfa/profile-page').mfaViewFor(req),listTrackedSessions(getPool(),req.sdcActor.userId,req.sdcSession.sessionId)]);
 const passwordMessages=require('../../auth/password-reset/profile-destinations');
 return page(req,res,'profile',{patient,mfaView,accountSessions,sessionActionMessage:req.query.sessions==='updated'?'تم تحديث الجلسات بنجاح.':'',passwordChangeError:passwordMessages.passwordError(req.query.password_error),passwordChangeReference:/^[A-F0-9]{8}$/.test(String(req.query.password_reference||''))?req.query.password_reference:'',saved:req.query.saved||'',profileError:req.query.error||''});
}));
router.post('/profile/:section',body,wrap(async(req,res)=>{
 if(!['account','health'].includes(req.params.section))return res.sendStatus(404);
 if(!validateSessionCsrf(req))return res.status(403).send('رمز حماية النموذج غير صالح. حدّث الصفحة.');
 const result=await svc.updateProfile(getPool(),req.sdcActor.userId,req.params.section,req.body);
 if(result.status==='not_found')return res.sendStatus(404);
 return res.redirect(303,`/patient/profile?${result.status==='ok'?'saved='+req.params.section:'error='+result.status}#${req.params.section==='health'?'healthSection':'accountInfo'}`);
}));
router.get('/notifications',(req,res)=>res.redirect(303,'/patient/index')); // Legacy links; no dedicated notifications page
router.post('/notifications/:action',body,wrap(async(req,res)=>{
 if(!validateSessionCsrf(req))return res.sendStatus(403);
 const result=await svc.readNotifications(getPool(),req.sdcActor.userId,req.params.action,req.body.notice_id,req.body.return_to);
 if(result.status==='invalid')return res.sendStatus(422);if(result.status!=='ok')return res.sendStatus(404);
 return res.redirect(303,result.url);
}));
router.get('/invoices',wrap(async(req,res)=>page(req,res,'invoices',{billing:await svc.invoices(getPool(),req.sdcActor.userId)})));
router.get('/diagnosis-history',wrap(async(req,res)=>page(req,res,'diagnosis-history',{history:await svc.visits(getPool(),req.sdcActor.userId)})));
router.get('/appointment-details',wrap(async(req,res)=>{
 const history=await svc.visits(getPool(),req.sdcActor.userId);const visit=history.visits.find(x=>x.id===String(req.query.visit_id||''));
 if(!visit)return res.sendStatus(404);
 const attachments=visit.approved?await svc.reportAttachments(getPool(),req.sdcActor.userId,visit.id):[];
 return page(req,res,'appointment-details',{visit,attachments});
}));
// Explicit private downloads for files selected by the doctor for an approved visit.
router.get('/visits/:visitId/attachments/:fileId',wrap(async(req,res)=>{
 const file=await svc.reportAttachmentFile(getPool(),req.sdcActor.userId,req.params.visitId,req.params.fileId);
 if(!file)return res.sendStatus(404);
 const inline=req.query.preview==='1'&&file.mime.startsWith('image/');
 const filename=encodeURIComponent(file.name);
 res.set({'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',
  'Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'",'Content-Type':file.mime,
  'Content-Disposition':`${inline?'inline':'attachment'}; filename="medical-file"; filename*=UTF-8''${filename}`});
 return res.sendFile(file.location,{dotfiles:'deny'},error=>{
  if(error){console.error('[PATIENT_ATTACHMENT_SEND]',error.code||error.message);if(!res.headersSent)res.status(503).end('تعذّر فتح الملف الطبي المحفوظ.');else res.destroy(error);}
 });
}));
router.get('/reports/:visitId.pdf',wrap(async(req,res)=>{
 let result;
 try{result=await svc.patientPdf(getPool(),req.sdcActor.userId,req.params.visitId,res.locals.lang);}
 catch(e){if(e.status===503||e.code==='ENOENT'){console.error('[PATIENT_PDF_RENDER]',e.message);return res.status(503).type('text/plain').send('تعذّر إنشاء ملف PDF على الخادم. تأكد من وجود Edge/Chrome ومسار SDC_PDF_BROWSER، أو استعادة ملفات التقارير الأصلية.');}throw e;}
 if(!result)return res.sendStatus(404);
 // Attachment + nosniff. Do not set CSP sandbox here: it prevents downloads in Chromium.
 res.set({'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',
  'Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'"});
 const name=result.type==='original'?`medical-report-${req.params.visitId}.pdf`:`medical-record-extract-${req.params.visitId}.pdf`;
 if(result.type==='original')return res.download(result.file,name,err=>{
  if(err&&!res.headersSent){console.error('[PATIENT_PDF_DOWNLOAD]',err.code||err.message);res.status(503).send('تعذر تنزيل التقرير المحفوظ. تحقق من مجلد الملفات الطبية الخاص بالخادم.');}
 });
 res.set('Content-Type','application/pdf');res.set('Content-Disposition',`attachment; filename="${name}"`);
 return res.end(result.buffer);
}));
const triage=require('./triage');
router.get('/ai-diagnosis',wrap(async(req,res)=>{
 const assessment=req.query.id?await triage.detail(getPool(),req.sdcActor.userId,req.query.id):null;
 if(req.query.id&&!assessment)return res.sendStatus(404);
 return page(req,res,'ai-diagnosis',{assessment,triageError:req.query.error||'',triageFollowup:null,triageValues:{},aiDemo:process.env.SDC_AI_MODE==='mock'&&process.env.NODE_ENV!=='production'});
}));
// Short-lived in-process rate guard; no model calls without authenticated patient session.
const aiAttempts=new Map();
function aiRateLimited(userId){
 const key=String(userId),now=Date.now(),old=(aiAttempts.get(key)||[]).filter(t=>now-t<60000);
 if(aiAttempts.size>5000)for(const [id,times] of aiAttempts)if(!times.some(t=>now-t<60000))aiAttempts.delete(id);
 if(old.length>=6){aiAttempts.set(key,old);return true;}
 aiAttempts.set(key,[...old,now]);return false;
}
router.post('/ai-diagnosis',body,wrap(async(req,res)=>{
 const jsonReply = String(req.get('accept')||'').includes('application/json');
 if(!validateSessionCsrf(req))return jsonReply?res.status(403).json({status:'error',error:'csrf'}):res.sendStatus(403);
 const aiDemo=process.env.SDC_AI_MODE==='mock'&&process.env.NODE_ENV!=='production';
 const renderError=(error,followup=null)=>jsonReply?res.status(error==='rate_limit'?429:422).json({status:'error',error}):res.status(422).render('patient/ai-diagnosis',{
  ...patientAiLocals(req,res),assessment:null,triageError:error,triageFollowup:followup,
  triageValues:{symptoms:String(req.body.symptoms||'').slice(0,1500),latitude:String(req.body.latitude||''),longitude:String(req.body.longitude||'')},aiDemo
 });
 if(aiRateLimited(req.sdcActor.userId))return renderError('rate_limit');
 let result;
 try{result=await triage.create(getPool(),req.sdcActor.userId,req.body,res.locals.lang);}
 catch(e){console.error('[PATIENT_AI_TRIAGE]',e.code||e.name||'error');
  return renderError(e.code==='AI_NOT_CONFIGURED'?'not_configured':'provider');
 }
 if(result.status==='followup')return jsonReply?res.json({status:'followup',question:result.question}):page(req,res,'ai-diagnosis',{
  assessment:null,triageError:'',triageFollowup:result,triageValues:{symptoms:result.symptoms,latitude:String(result.origin?.lat??''),longitude:String(result.origin?.lng??'')},aiDemo
 });
 if(result.status==='invalid')return renderError('invalid');
 if(result.status==='forbidden')return jsonReply?res.status(403).json({status:'error',error:'forbidden'}):res.sendStatus(403);
 if(result.status!=='ok')return renderError('provider');
 const url=`/patient/ai-diagnosis?id=${encodeURIComponent(result.id)}`;
 return jsonReply?res.json({status:'ok',url}):res.redirect(303,url);
}));
function patientAiLocals(req,res){
 const meta=pages['patient/ai-diagnosis.html'];
 return {currentPage:'patient/ai-diagnosis.html',role:'patient',navVariant:meta.navVariant,drawerVariant:meta.drawerVariant,footerVariant:meta.footerVariant,
 navActiveClass:href=>meta.navActiveClasses[href]?' '+meta.navActiveClasses[href]:'',navAriaCurrent:href=>meta.navAria[href]==='page'?' aria-current="page"':'',
 drawerActiveClass:href=>meta.drawerActiveClasses[href]?' '+meta.drawerActiveClasses[href]:'',drawerAriaCurrent:href=>meta.drawerAria[href]==='page'?' aria-current="page"':'',
 currentUser:res.locals.currentUser,activeClinic:null,logoutCsrf:res.locals.logoutCsrf||'',csrfToken:sessionCsrf(req),passwordChangeCsrf:sessionCsrf(req),sessionActionCsrf:sessionCsrf(req),
 patientUnreadCount:res.locals.patientUnreadCount||0,patientNotifications:res.locals.patientNotifications||[],patientReturnTo:res.locals.patientReturnTo||'/patient/index',
 lang:res.locals.lang,sdcT:res.locals.sdcT
 };
}
router.post('/ai-diagnosis/continue',body,wrap(async(req,res)=>{
 const jsonReply=String(req.get('accept')||'').includes('application/json');
 if(!validateSessionCsrf(req))return jsonReply?res.status(403).json({status:'error',error:'csrf'}):res.sendStatus(403);
 if(aiRateLimited(req.sdcActor.userId))return jsonReply?res.status(429).json({status:'error',error:'rate_limit'}):res.redirect(303,`/patient/ai-diagnosis?id=${encodeURIComponent(req.body.assessment_id||'')}&error=rate_limit`);
 let result;
 try{result=await triage.continueAssessment(getPool(),req.sdcActor.userId,req.body.assessment_id,req.body.message,res.locals.lang,req.body);}
 catch(error){console.error('[PATIENT_AI_CONTINUE]',error.code||error.name||'error');return jsonReply?res.status(503).json({status:'error',error:error.code==='AI_NOT_CONFIGURED'?'not_configured':'provider'}):res.redirect(303,`/patient/ai-diagnosis?id=${encodeURIComponent(req.body.assessment_id||'')}&error=provider`);}
 if(result.status==='not_found')return jsonReply?res.status(404).json({status:'error',error:'forbidden'}):res.sendStatus(404);
 if(result.status==='conflict')return jsonReply?res.status(409).json({status:'error',error:'conflict'}):res.redirect(303,`/patient/ai-diagnosis?id=${encodeURIComponent(req.body.assessment_id||'')}&error=conflict`);
 if(result.status!=='ok')return jsonReply?res.status(422).json({status:'error',error:'invalid'}):res.redirect(303,`/patient/ai-diagnosis?id=${encodeURIComponent(req.body.assessment_id||'')}&error=invalid`);
 return jsonReply?res.json(result):res.redirect(303,`/patient/ai-diagnosis?id=${encodeURIComponent(req.body.assessment_id)}`);
}));
router.post('/ai-diagnosis/book',body,wrap(async(req,res)=>{
 if(!validateSessionCsrf(req))return res.sendStatus(403);
 const assessment=await triage.detail(getPool(),req.sdcActor.userId,req.body.assessment_id);
 if(!assessment)return res.sendStatus(404);
 if(assessment.needsReassessment)return res.redirect(303,`/patient/ai-diagnosis?id=${assessment.id}&error=reassessment`);
 const option=assessment.recommendations.find(x=>x.id===String(req.body.recommendation_id||''));
 if(!option)return res.sendStatus(404);
 if(option.booking_id)return res.redirect(303,`/patient/booking-details?id=${option.booking_id}`);
 const result=await require('../../appointments/service').book(getPool(),{
  appointment_date:option.date,appointment_time:option.time,clinic_id:option.clinic_id,doctor_id:option.doctor_id,service_id:option.service_id,recommendation_id:option.id
 },req.sdcActor,null);
 if(result.status==='ok')return res.redirect(303,`/patient/booking-details?id=${result.id}&saved=1`);
 if(result.status==='forbidden')return res.sendStatus(403);
 return res.redirect(303,`/patient/ai-diagnosis?id=${assessment.id}&error=unavailable`);
}));
router.get('/index',wrap(async(req,res)=>page(req,res,'index',{dashboard:await svc.dashboard(getPool(),req.sdcActor.userId),healthSetupCompleted:req.query.health==='completed'})));
router.post('/booking/rate',body,async(req,res)=>{
 const id=String(req.body?.booking_id||'');
 const validId=svc.ID.test(id);const destination=validId?`/patient/booking-details?id=${encodeURIComponent(id)}`:'/patient/appointments';const withResult=key=>destination+(validId?'&':'?')+key;
 if(!validateSessionCsrf(req))return res.redirect(303,withResult('rating_error=csrf'));
 try{
  const r=await svc.rateBooking(getPool(),req.sdcActor.userId,id,req.body.doctor_rating,req.body.clinic_rating,req.body.comment||'');
  if(r.status==='ok')return res.redirect(303,withResult('rating_saved=1'));
  return res.redirect(303,withResult('rating_error='+encodeURIComponent(r.status==='invalid'?'invalid':'closed')));
 }catch(error){
  // Never send a raw SQL exception or the generic Page rendering error to a patient.
  console.error('[PATIENT_RATING_FAILED]',error.code||error.message,'booking',/^\d+$/.test(id)?id:'invalid');
  return res.redirect(303,withResult('rating_error=unavailable'));
 }
});
async function requireHealthSetup(req,res,next){
 try{
  // Serve public assets in express.static, and do not intercept its fallback.
  if(req.path.startsWith('/assets/'))return next();
  const pending=await svc.healthSetupPending(getPool(),req.sdcActor.userId);
  if(pending===null)return res.status(404).send('الملف الطبي غير موجود.');
  const isSetup=req.path==='/health-setup'||req.path==='/health-setup/';
  if(pending){
   if(isSetup&&['GET','POST'].includes(req.method))return next();
   if(req.method==='GET'||req.method==='HEAD')return res.redirect(303,'/patient/health-setup');
   return res.status(403).send('يجب استكمال المعلومات الصحية قبل استخدام هذه الوظيفة.');
  }
  if(isSetup)return res.redirect(303,'/patient/index');
  return next();
 }catch(error){console.error('[PATIENT_HEALTH_SETUP]',error.code||error.message);return res.status(503).send('تعذّر التحقق من استكمال الملف الصحي حاليًا.');}
}
module.exports={router,locals,page,requireHealthSetup};
