'use strict';
const express=require('express');
const {getPool}=require('../../../db/pool');
const {issueCsrf,validateCsrf}=require('../../security/csrf');
const {config}=require('../../auth/password-reset/delivery');
const {requestActivation,isValidActivation,activatePatient,validPassword}=require('./service');
const {policyVersion}=require('../../legal/version');
const router=express.Router();
const body=express.urlencoded({extended:false,limit:'8kb',parameterLimit:10});
const attempts=new Map();
function allowed(req,action,max){
  const now=Date.now();for(const [key,state] of attempts)if(now-state.at>15*60*1000)attempts.delete(key);
  const key=action+':'+req.ip;const old=attempts.get(key);const n=old?old.n+1:1;
  attempts.set(key,{at:old?.at||now,n});return n<=max;
}
function page(res,name,data={},status=200){
  res.set('Cache-Control','no-store');res.set('Referrer-Policy','no-referrer');res.set('X-Robots-Tag','noindex, nofollow');
  return res.status(status).render(`auth/activate/${name}`,{csrfToken:issueCsrf(res,'login'),policyVersion:policyVersion(),...data});
}
router.get('/',(_req,res)=>page(res,'request'));
router.post('/',body,async(req,res)=>{
  if(!validateCsrf(req,'login'))return page(res,'request',{error:'انتهت صلاحية النموذج؛ حاول مجددًا.'},403);
  if(!allowed(req,'request',6))return page(res,'request',{error:'محاولات كثيرة. حاول بعد 15 دقيقة.'},429);
  try{
    config();
    await requestActivation(getPool(),req.body,{lang:res.locals.lang});
    return res.redirect(303,'/auth/activate/patient/sent');
  }catch(error){
    console.error('Patient activation request:',error.code||error.message);
    if(error.code==='MAIL_NOT_CONFIGURED')return page(res,'request',{error:'خدمة البريد غير مهيأة؛ يجب ضبط إعدادات الإرسال قبل التفعيل.'},503);
    // Avoid leaking account existence or matching medical demographic data.
    return res.redirect(303,'/auth/activate/patient/sent');
  }
});
router.get('/sent',(_req,res)=>page(res,'sent'));
router.get('/finish',async(req,res)=>{
  const token=typeof req.query?.token==='string'?req.query.token:'';
  try{const valid=await isValidActivation(getPool(),token);
    return page(res,'finish',{token:valid?token:'',valid,error:valid?'':'رابط التفعيل غير صالح أو انتهت صلاحيته. اطلب رابطًا جديدًا.'},valid?200:400);
  }catch(error){console.error('Patient activation link:',error.code||error.message);return page(res,'finish',{token:'',valid:false,error:'تعذّر التحقق من رابط التفعيل.'},503);}
});
router.post('/finish',body,async(req,res)=>{
  const token=typeof req.body?.token==='string'?req.body.token:'';
  if(!validateCsrf(req,'login'))return page(res,'finish',{token:'',valid:false,error:'انتهت صلاحية الصفحة، افتح رابط التفعيل مجددًا.'},403);
  if(!allowed(req,'finish',10))return page(res,'finish',{token:'',valid:false,error:'محاولات كثيرة. حاول لاحقًا.'},429);
  if(!validPassword(req.body?.password)||req.body.password!==req.body?.confirm_password||req.body.accept_policies!=='on')
    return page(res,'finish',{token,valid:true,error:'تحقق من كلمة المرور (8 أحرف، كبير وصغير ورقم)، وتأكيدها، والموافقة على الوثيقتين.'},422);
  try{
    const ok=await activatePatient(getPool(),token,req.body.password,req.body.accept_policies,policyVersion());
    if(!ok)return page(res,'finish',{token:'',valid:false,error:'الرابط مستخدم أو منتهي الصلاحية، أو إصدار سياسة التسجيل غير مهيّأ.'},400);
    return res.redirect(303,'/auth/activate/patient/completed');
  }catch(error){console.error('Patient activation finish:',error.code||error.message);return page(res,'finish',{token:'',valid:false,error:'تعذّر إكمال التفعيل الآن. حاول لاحقًا.'},503);}
});
router.get('/completed',(_req,res)=>page(res,'completed'));
module.exports=router;
