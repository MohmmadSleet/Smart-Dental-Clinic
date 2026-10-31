'use strict';
const express=require('express');
const multer=require('multer');
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {getPool}=require('../../../db/pool');
const pages=require('../../../config/page-map.json');
const {resolveSession}=require('../../auth/guard');
const {sessionCsrf,validateSessionCsrf,listTrackedSessions}=require('../../auth/session');
const {passwordError}=require('../../auth/password-reset/profile-destinations');
const {mfaViewFor}=require('../../security/mfa/profile-page');
const notifications=require('../notifications-router');
const service=require('./service');
const router=express.Router();
const parse=express.urlencoded({extended:false,limit:'8kb',parameterLimit:12});
const feedback={
 photo:'تم حفظ الصورة المهنية بنجاح.',
 contact:'تم حفظ بيانات الحساب بنجاح.',professional:'تم حفظ بياناتك المهنية بنجاح.',language:'تم حفظ اللغة المفضلة لحسابك.',
 invalid:'راجع الحقول المدخلة وتأكد من صحة القيم.',password:'كلمة المرور الحالية غير صحيحة.',
 duplicate:'هذا البريد الإلكتروني مستخدم في حساب آخر.',not_found:'هذا الحساب غير متاح.',
 csrf:'انتهت صلاحية النموذج. حدّث الصفحة وأعد المحاولة.',unavailable:'تعذّر حفظ التغيير حاليًا. لم تُحفظ البيانات.'
};
const success=new Set(['contact','professional','language','photo']);
const anchors={contact:'account',professional:'professional',language:'preferences'};
function returnUrl(code,action){return '/doctor/settings?account_result='+encodeURIComponent(code)+'#'+(anchors[action]||'account');}
router.use(async(req,res,next)=>{
 try{
  const actor=await resolveSession(req,res);
  if(!actor)return res.redirect(303,'/auth/login');
  if(actor.role!=='doctor'||!actor.doctorId)return res.sendStatus(403);
  return next();
 }catch(error){next(error);}
});
router.get('/',async(req,res,next)=>{
 try{
  const accountUser=await service.load(getPool(),req.sdcActor.userId,req.sdcActor.doctorId);
  if(!accountUser)return res.sendStatus(404);
  const map=pages['doctor/settings.html'];
  const css=(k,h)=>map[k+'ActiveClasses'][h]?' '+map[k+'ActiveClasses'][h]:'';
  const aria=(k,h)=>map[k+'Aria'][h]==='page'?' aria-current="page"':'';
  await new Promise((resolve,reject)=>notifications.locals(req,res,e=>e?reject(e):resolve()));
  const code=String(req.query.account_result||'');
  res.set('Cache-Control','private, no-store');
  return res.render('doctor/settings',{
   accountUser,accountSettingsAlert:feedback[code]||'',accountSettingsOk:success.has(code),
   currentPage:'doctor/settings.html',role:'doctor',navVariant:map.navVariant,drawerVariant:map.drawerVariant,footerVariant:map.footerVariant,
   navActiveClass:h=>css('nav',h),navAriaCurrent:h=>aria('nav',h),drawerActiveClass:h=>css('drawer',h),drawerAriaCurrent:h=>aria('drawer',h),
   currentUser:req.sdcActor,activeClinic:res.locals.activeClinic||null,logoutCsrf:res.locals.logoutCsrf||'',
   passwordChangeCsrf:sessionCsrf(req),passwordChangeError:passwordError(req.query.password_error),
   passwordChangeReference:/^[A-F0-9]{8}$/.test(String(req.query.password_reference||''))?req.query.password_reference:'',
   mfaView:await mfaViewFor(req),
   accountSessions:await listTrackedSessions(getPool(),req.sdcActor.userId,req.sdcSession.sessionId),
   sessionActionCsrf:sessionCsrf(req),sessionActionMessage:req.query.sessions==='updated'?'تم تحديث الجلسات بنجاح.':''
  });
 }catch(error){next(error);}
});
const photoUpload=multer({storage:multer.memoryStorage(),limits:{fileSize:2*1024*1024,files:1,fields:2,parts:3}}).single('photo');
router.post('/photo',(req,res,next)=>photoUpload(req,res,e=>e?res.redirect(303,returnUrl('invalid','professional')):next()),async(req,res)=>{
 if(!validateSessionCsrf(req))return res.redirect(303,returnUrl('csrf','professional'));
 const {docType}=require('../../clinic/onboarding/service');
 const kind=docType(req.file?.buffer);
 if(!req.file?.size||!kind||!['.jpg','.png'].includes(kind.extension))return res.redirect(303,returnUrl('invalid','professional'));
 const {doctorPhotoPath}=require('../../media/public-profile-media');
 const dest=doctorPhotoPath(req.sdcActor.doctorId);if(!dest)return res.sendStatus(403);
 const tmp=dest+'.'+crypto.randomUUID()+'.tmp';let written=false;
 try{
  const owns=await getPool().query(`SELECT 1 FROM sdc."DOCTOR" WHERE "Doctor_ID"=$1::bigint AND "User_ID"=$2::bigint`,[req.sdcActor.doctorId,req.sdcActor.userId]);
  if(!owns.rowCount)return res.sendStatus(403);
  await fs.mkdir(path.dirname(dest),{recursive:true,mode:0o700});
  await fs.writeFile(tmp,req.file.buffer,{flag:'wx',mode:0o600});written=true;
  await fs.rename(tmp,dest);written=false;
  await getPool().query(`INSERT INTO sdc."AUDIT_LOG"("Occurred_At","Action_Type","Target_Type","Target_Reference","Description","User_ID") VALUES(LOCALTIMESTAMP,'doctor.photo.updated','Doctor',$1::varchar(512),'تحديث صورة الطبيب المهنية',$2::bigint)`,[String(req.sdcActor.doctorId),req.sdcActor.userId]).catch(e=>console.warn('[DOCTOR_PHOTO_AUDIT_FAILED]',e.code||e.message));
  return res.redirect(303,'/doctor/settings?account_result=photo#professional');
 }catch(e){console.error('[DOCTOR_PHOTO_FAILED]',e.code||e.message);return res.redirect(303,returnUrl('unavailable','professional'));}
 finally{if(written)await fs.unlink(tmp).catch(()=>{});}
});
router.post('/',parse,async(req,res)=>{
 const action=String(req.body?.action||'');
 if(!['contact','professional','language'].includes(action))return res.sendStatus(422);
 if(!validateSessionCsrf(req))return res.redirect(303,returnUrl('csrf',action));
 try{
  const pool=getPool(),user=req.sdcActor.userId,doc=req.sdcActor.doctorId;
  const result=action==='contact'?await service.changeContact(pool,user,doc,req.body):
               action==='professional'?await service.changeProfessional(pool,user,doc,req.body):
               await service.changeLanguage(pool,user,doc,req.body.language);
  if(result.status==='not_found')return res.sendStatus(403);
  return res.redirect(303,returnUrl(result.status==='ok'?action:result.status,action));
 }catch(error){console.error('[DOCTOR_ACCOUNT_SETTINGS_FAILED]',action,error.code||'UNKNOWN');return res.redirect(303,returnUrl('unavailable',action));}
});
module.exports=router;
