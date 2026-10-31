'use strict';
const {config}=require('../../auth/password-reset/delivery');
async function deliverActivation(email,token,send=globalThis.fetch,lang="ar"){
  const settings=config();
  const origin=new URL(settings.origin);
  if(!['http:','https:'].includes(origin.protocol)||origin.username||origin.password||origin.search||origin.hash||origin.pathname!=='/')throw Error('Invalid APP_BASE_URL');
  if(settings.mode==='console'&&!['localhost','127.0.0.1'].includes(origin.hostname))throw Error('Console mode requires localhost');
  const url=new URL('/auth/activate/patient/finish',origin);url.searchParams.set('token',token);
  if(settings.mode==='console'){
    process.stdout.write(`[LOCAL DEVELOPMENT ONLY] Patient activation for ${email}: ${url.href}\n`);
    return;
  }
  const english=lang==='en';
  const response=await send('https://api.resend.com/emails',{
    method:'POST',headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json'},
    body:JSON.stringify({from:process.env.EMAIL_FROM,to:[email],subject:english?'Smart Dental Clinic — Activate your patient account':'Smart Dental Clinic — تفعيل حساب المريض',text:english?`If you requested activation of the patient account created by your clinic, open this link within 20 minutes:\n${url.href}\nIf you did not request this activation, ignore this email. Do not share the link with anyone.`:`إذا طلبت تفعيل حساب المريض الذي أنشأته العيادة، افتح الرابط التالي خلال 20 دقيقة:\n${url.href}\nإذا لم تطلب هذا التفعيل فتجاهل الرسالة. لا تشارك الرابط مع أحد.`}),
    signal:AbortSignal.timeout(10000)
  });
  if(!response.ok)throw Object.assign(new Error('Activation delivery rejected'),{code:'MAIL_DELIVERY_FAILED'});
}
module.exports={deliverActivation};
