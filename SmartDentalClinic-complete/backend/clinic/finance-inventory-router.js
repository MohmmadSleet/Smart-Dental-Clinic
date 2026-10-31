'use strict';
const express=require('express');
const pages=require('../../config/page-map.json');
const {getPool}=require('../../db/pool');
const {clinicId}=require('./settings-service');
const {sessionCsrf,validateSessionCsrf}=require('../auth/session');
const svc=require('./finance-inventory-service');
const billing=require('./invoice-issuing-service');
const commissions=require('./commission-service');
const router=express.Router();
router.use(['/inventory/add','/inventory/move','/invoices/payment'],express.urlencoded({extended:false,limit:'10kb',parameterLimit:20}));
router.use(['/invoices/draft','/invoices/issue'],express.urlencoded({extended:false,limit:'15kb',parameterLimit:120}));
function view(req,res,slug,data){
 const item=pages['clinic/'+slug+'.html'];
 const css=(k,h)=>item[k+'ActiveClasses'][h]?' '+item[k+'ActiveClasses'][h]:'';
 const aria=(k,h)=>item[k+'Aria'][h]==='page'?' aria-current="page"':'';
 res.set('Cache-Control','private, no-store');
 return res.render('clinic/'+slug,{currentPage:'clinic/'+slug+'.html',role:'clinic',navVariant:item.navVariant,drawerVariant:item.drawerVariant,footerVariant:item.footerVariant,
  navActiveClass:h=>css('nav',h),navAriaCurrent:h=>aria('nav',h),drawerActiveClass:h=>css('drawer',h),drawerAriaCurrent:h=>aria('drawer',h),
  currentUser:res.locals.currentUser||null,activeClinic:res.locals.activeClinic||null,logoutCsrf:res.locals.logoutCsrf||'',csrfToken:sessionCsrf(req),...data});
}
function scoped(req,res){const id=clinicId(req);if(!id)res.status(403).send('غير مصرح لعيادة أخرى.');return id;}
function err(next){return e=>{console.error('[CLINIC_FINANCE_STOCK]',e.code||'UNKNOWN');next(e);};}
router.get('/inventory',async(req,res,next)=>{const id=scoped(req,res);if(!id)return;
 try{return view(req,res,'inventory',{stock:await svc.inventory(getPool(),id,req.query.page),feedback:req.query.saved==='1'?'تم الحفظ بنجاح.':'',error:''});}catch(e){err(next)(e);}
});
router.post('/inventory/add',async(req,res,next)=>{const id=scoped(req,res);if(!id)return;
 if(!validateSessionCsrf(req))return res.sendStatus(403);
 try{const r=await svc.addItem(getPool(),id,req.sdcActor.userId,req.body);
  if(r.status==='ok')return res.redirect(303,'/clinic/inventory?saved=1');
  return res.status(r.status==='invalid'?422:409).send(r.status==='duplicate'?'هذه المادة موجودة بالاسم والوحدة نفسها.':r.status==='forbidden'?'العيادة غير فعالة.':'راجع بيانات المادة والكمية وتاريخ الصلاحية.');
 }catch(e){err(next)(e);}
});
router.post('/inventory/move',async(req,res,next)=>{const id=scoped(req,res);if(!id)return;
 if(!validateSessionCsrf(req))return res.sendStatus(403);
 try{const r=await svc.moveStock(getPool(),id,req.sdcActor.userId,req.body);
  if(r.status==='ok')return res.redirect(303,'/clinic/inventory?saved=1');
  return res.status(r.status==='invalid'?422:r.status==='not_found'?404:409).send(({insufficient:'لا يوجد رصيد كافٍ لإتمام الحركة.',unchanged:'الرصيد المطلوب مطابق للرصيد الحالي.',not_found:'هذه المادة غير موجودة في العيادة.',invalid:'الكمية أو الحركة غير صالحة.'})[r.status]||'تعذّر تنفيذ حركة المخزون.');
 }catch(e){err(next)(e);}
});
router.get('/invoices',async(req,res,next)=>{const id=scoped(req,res);if(!id)return;
 try{
  // Isolate query failures: invoice listing must remain usable when eligibility preview fails.
  // Both failures are logged with a precise stage, but raw SQL errors are never sent to the browser.
  const results=await Promise.allSettled([
   svc.invoices(getPool(),id),
   billing.invoiceCandidates(getPool(),id)
  ]);
  const [financeResult,candidatesResult]=results;
  const financeLoadFailed=financeResult.status==='rejected';
  const invoiceCandidatesFailed=candidatesResult.status==='rejected';
  function logQueryFailure(phase,result){
   if(result.status!=='rejected')return;
   const e=result.reason||{};
   console.error('[CLINIC_INVOICES_LOAD_FAILED]',{
    phase,code:e.code||'UNKNOWN',constraint:e.constraint||'',
    message:e.message||String(e),detail:e.detail||'',hint:e.hint||''
   });
  }
  logQueryFailure('existing_invoices',financeResult);
  logQueryFailure('completed_visit_candidates',candidatesResult);
  const finance=financeLoadFailed?{items:[],stats:{count:0,paid:0,partial:0,unpaid:0}}:financeResult.value;
  const candidates=invoiceCandidatesFailed?[]:candidatesResult.value;
  const notices={payment:'تم تسجيل الدفعة بنجاح.',draft:'تم حفظ مسودة الفاتورة. راجع البنود ثم أصدرها عند التأكد.',issued:'تم إصدار الفاتورة بنجاح.'};
  const problems={invalid:'راجع بيانات الفاتورة والخصم.',forbidden:'لا تملك صلاحية إصدار الفواتير لهذه العيادة.',not_found:'الزيارة أو الفاتورة لا تتبع العيادة المختارة.',not_completed:'لا يمكن إصدار فاتورة قبل اكتمال الموعد والزيارة.',finalized:'هذه الفاتورة صادرة أو ملغاة ولا يمكن تعديلها.',stale_procedures:'تغيّرت حالة الإجراءات؛ حدّث الصفحة واختر الإضافات المنفذة فقط.',invalid_amount:'الخصم يتجاوز المبلغ أو هناك قيمة غير صحيحة.',no_billable_procedures:'لا يمكن إنشاء فاتورة دون إجراءات مكتملة قابلة للفوترة. وثّق الخدمة المنفذة أو اختر إجراءً بديلًا.',not_confirmed:'يرجى تأكيد مطابقة بنود الفاتورة للإجراءات المنفذة قبل إصدارها.',stale_draft:'تغيرت بيانات الزيارة أو الإجراءات؛ أعد حفظ المسودة قبل الإصدار.'};
  if(financeLoadFailed)res.status(503);
  return view(req,res,'invoices',{
   finance,invoiceCandidates:candidates,financeLoadFailed,invoiceCandidatesFailed,
   feedback:financeLoadFailed||invoiceCandidatesFailed?'':notices[req.query.saved]||'',
   error:financeLoadFailed||invoiceCandidatesFailed?'':problems[req.query.error]||''
  });
 }catch(e){err(next)(e);}
});
router.post('/invoices/draft',async(req,res,next)=>{const id=scoped(req,res);if(!id)return;
 if(!validateSessionCsrf(req))return res.sendStatus(403);
 try{const result=await billing.saveDraft(getPool(),id,req.sdcActor.userId,req.body);
  if(result.status==='ok')return res.redirect(303,'/clinic/invoices?saved=draft#invoice'+result.id);
  if(result.status==='forbidden')return res.sendStatus(403);
  return res.redirect(303,'/clinic/invoices?error='+encodeURIComponent(result.status)+'#invoiceDrafts');
 }catch(e){err(next)(e);}
});
router.post('/invoices/issue',async(req,res,next)=>{const id=scoped(req,res);if(!id)return;
 if(!validateSessionCsrf(req))return res.sendStatus(403);
 try{const result=await billing.issueDraft(getPool(),id,req.sdcActor.userId,req.body);
  if(result.status==='ok')return res.redirect(303,'/clinic/invoices?saved=issued#invoice'+result.id);
  if(result.status==='forbidden')return res.sendStatus(403);
  return res.redirect(303,'/clinic/invoices?error='+encodeURIComponent(result.status)+'#invoiceDrafts');
 }catch(e){err(next)(e);}
});
router.post('/invoices/payment',async(req,res,next)=>{const id=scoped(req,res);if(!id)return;
 if(!validateSessionCsrf(req))return res.sendStatus(403);
 try{const r=await svc.recordPayment(getPool(),id,req.sdcActor.userId,req.body);
  if(r.status==='ok')return res.redirect(303,'/clinic/invoices?saved=payment');
  return res.status(r.status==='invalid'?422:r.status==='not_found'?404:409).send(({invalid:'تحقق من المبلغ وطريقة الدفع.',not_found:'الفاتورة غير موجودة في هذه العيادة.',not_issued:'لا يمكن دفع فاتورة غير مُصدرة أو ملغاة.',excess:'المبلغ أعلى من الرصيد المتبقي.'})[r.status]||'تعذّر تسجيل الدفعة.');
 }catch(e){err(next)(e);}
});
router.get('/settlements',async(req,res,next)=>{const id=scoped(req,res);if(!id)return;
 try{
  const pool=getPool();
  // The card shows the platform's *current* rate, not rates in past settlements.
  // The same stored policy is used when BOOKING rows are created (migration 009).
  const [data,currentRate]=await Promise.all([
   commissions.list(pool,id),
   pool.query(`SELECT commission_rate::text AS rate
    FROM sdc.platform_finance_settings WHERE settings_id=1`)
  ]);
  if(!currentRate.rowCount)throw new Error('Missing platform finance settings (migration 008)');
  const messages={};
  const errors={};
  return view(req,res,'settlements',{...data,currentCommissionRate:currentRate.rows[0].rate,feedback:messages[req.query.saved]||'',error:errors[req.query.error]||''});
 }catch(e){err(next)(e);} 
});
// Legacy clinic payment endpoint: fail closed, even if an old client submits a form.
router.post('/settlements/payment',(req,res)=>res.status(403).send('تسجيل دفعات التسوية متاح للمشرف العام فقط.'));
module.exports=router;
