'use strict';
const express=require('express');
const multer=require('multer');
const fs=require('node:fs');
const path=require('node:path');
const {getPool}=require('../../../db/pool');
const {sessionCsrf,validateSessionCsrf}=require('../../auth/session');
const svc=require('./service');
const router=express.Router();
const root='/onboarding/doctor/jobs';
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024,files:4,fields:18,parts:24}}).fields([{name:'applicant_cv',maxCount:1},{name:'applicant_certificates',maxCount:3}]);
function render(req,res,page,locals={}){res.set({'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});return res.render('onboarding/doctor/jobs/'+page,{
 csrfToken:sessionCsrf(req),currentUser:res.locals.currentUser||null,logoutCsrf:res.locals.logoutCsrf||'',...locals});}
function fail(res,status,text){return res.status(status).type('text/plain; charset=utf-8').send(text);}
router.get(['/', '/index'],async(req,res,next)=>{try{
 const data=await svc.list(getPool(),req.query);const applications=await svc.recentApplications(getPool(),req.sdcActor);
 return render(req,res,'index',{...data,applications});
}catch(error){next(error);}});
router.get('/details',async(req,res,next)=>{try{
 const job=await svc.detail(getPool(),req.query.id,req.sdcActor.doctorId);if(!job)return res.sendStatus(404);
 const profile=await svc.doctorProfile(getPool(),req.sdcActor);if(!profile)return res.sendStatus(403);
 return render(req,res,'details',{job,profile,canApply:!!(job.available&&job.specialty_match&&profile.license_status==='verified'&&!job.application_id)});
}catch(error){next(error);}});
router.get('/application-preview',async(req,res,next)=>{try{
 // The iframe preview is populated using same-origin postMessage from the original form.
 if(req.query.mode==='before')return render(req,res,'application-preview',{before:true,detail:null});
 const detail=await svc.application(getPool(),req.sdcActor,req.query.application);
 if(!detail)return res.sendStatus(404);return render(req,res,'application-preview',{before:false,detail});
}catch(error){next(error);}});
router.get('/application-status',async(req,res,next)=>{try{
 const applications=await svc.recentApplications(getPool(),req.sdcActor);
 const chosen=req.query.application?await svc.application(getPool(),req.sdcActor,req.query.application):null;
 if(req.query.application&&!chosen)return res.sendStatus(404);
 return render(req,res,'application-status',{applications,detail:chosen||null,saved:req.query.saved==='1',error:['expired','unavailable'].includes(req.query.error)?req.query.error:''});
}catch(error){next(error);}});
router.post('/:id/apply',(req,res,next)=>{
 upload(req,res,error=>{if(error)return fail(res,422,'المرفقات غير صالحة أو تتجاوز الحد: 5MB لكل ملف، سيرة ذاتية واحدة و3 شهادات بحد أقصى.');next();});
},async(req,res,next)=>{try{
 if(!validateSessionCsrf(req))return fail(res,403,'رمز الحماية منتهي؛ حدّث الصفحة وحاول من جديد.');
 const result=await svc.apply(getPool(),req.sdcActor,req.params.id,req.body,req.files);
 if(result.status==='ok')return res.status(201).json({applicationId:result.id,location:root+'/application-preview?application='+result.id});
 const responses={invalid:[422,'تحقق من بيانات التقديم والمرفقات والموافقة.'],forbidden:[403,'يجب اعتماد ترخيص الطبيب للتمكن من التقديم.'],not_found:[404,'الإعلان غير موجود.'],closed:[409,'الإعلان غير متاح للتقديم الآن.'],specialty:[403,'تخصصك غير مطابق للتخصص المطلوب في الإعلان.'],experience:[422,'سنوات الخبرة المدخلة أقل من الحد الأدنى المطلوب.'],duplicate:[409,'سبق أن أرسلت طلبًا لهذه الوظيفة؛ افتح صفحة طلباتك.']};
 const [code,message]=responses[result.status]||[409,'تعذّر حفظ الطلب.'];return fail(res,code,message);
 }catch(error){next(error);}});
router.post('/applications/:id/join',express.urlencoded({extended:false,limit:'4kb',parameterLimit:5}),async(req,res,next)=>{try{
 if(!validateSessionCsrf(req))return fail(res,403,'رمز الحماية منتهي. حدّث الصفحة وأعد المحاولة.');
 const result=await svc.decideJobInvitation(getPool(),req.sdcActor,req.params.id,req.body.action);
 const query=result.status==='ok'?'saved=1':`error=${result.status==='conflict'?'expired':'unavailable'}`;
 return res.redirect(303,root+'/application-status?application='+encodeURIComponent(req.params.id)+'&'+query);
}catch(error){next(error);}});
router.post('/applications/:id/withdraw',express.urlencoded({extended:false,limit:'4kb',parameterLimit:5}),async(req,res,next)=>{try{
 if(!validateSessionCsrf(req))return fail(res,403,'رمز الحماية غير صالح.');
 const result=await svc.withdraw(getPool(),req.sdcActor,req.params.id);
 if(result.status!=='ok')return fail(res,409,'لا يمكن سحب هذا الطلب بعد اتخاذ القرار.');
 return res.redirect(303,root+'/application-status?application='+req.params.id+'&saved=1');
}catch(error){next(error);}});
router.get('/applications/:id/attachments/:file',async(req,res,next)=>{try{
 const file=await svc.attachment(getPool(),req.sdcActor,req.params.id,req.params.file);if(!file)return res.sendStatus(404);
 const type={'.pdf':'application/pdf','.doc':'application/msword','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','.png':'image/png','.jpg':'image/jpeg'}[path.extname(file.filename)];
 if(!type||!fs.existsSync(file.filename))return res.sendStatus(404);
 const name=String(file.name).replace(/[\r\n"\\/]/g,'_').slice(0,180);
 res.set({'Cache-Control':'private, no-store','Content-Type':type,'X-Content-Type-Options':'nosniff','Content-Disposition':`attachment; filename="application-document${path.extname(file.filename)}"; filename*=UTF-8''${encodeURIComponent(name)}`});
 return res.sendFile(file.filename,error=>{if(error&&!res.headersSent)next(error);});
}catch(error){next(error);}});
module.exports=router;
