/* تفاعلات العرض الخاصة بدور: العيادة.
 * للتعديل: ابحث عن التعليق أو data-ui-* المقابل للعنصر في HTML.
 * المحتوى والسجلات داخل HTML؛ لا يتعامل هذا الملف مع قاعدة بيانات أو حفظ أو مصادقة.
 */
(() => {
  'use strict';

  function initializeUI() {
    // اختصارات للوصول إلى عناصر الصفحة باستخدام محددات CSS.
    const find = (selector, root = document) => root?.querySelector(selector);
    const targetOf = (control, attribute) => find(control.getAttribute(attribute));

    // تنبيه HTML ثابت للعمليات التي تنتظر ربط الخادم؛ لا ينشئ أو يعدّل سجلات.
    function showPendingNotice() {
      const notice = find('#backendPendingNotice');
      if (notice && window.bootstrap) bootstrap.Toast.getOrCreateInstance(notice).show();
    }

    // منع إرسال النماذج غير المربوطة بالخادم عند الضغط على Enter أو زر الإرسال.
    document.addEventListener('submit', (event) => {
      if (!event.target.matches('form[data-ui-unbound]')) return;
      event.preventDefault();
      showPendingNotice();
    });

    // تفويض النقر يسمح باستمرار عمل أزرار النماذج المضافة من قوالب HTML.
    document.addEventListener('click', (event) => {
      const control = event.target.closest('button,a');
      if (!control) return;
      if (control.matches('[data-ui-add-template]')) {
        // إضافة صف إدخال فارغ من template داخل HTML، مثل صف إجراء طبي.
        event.preventDefault();
        const source = targetOf(control, 'data-ui-add-template');
        const slot = targetOf(control, 'data-ui-add-slot');
        if (source && slot) slot.append(source.content.cloneNode(true));
      } else if (control.matches('[data-ui-remove-draft]')) {
        // إزالة صف إدخال أضافه المستخدم قبل الحفظ؛ لا يحذف سجلًا محفوظًا.
        event.preventDefault();
        control.closest('[data-ui-draft]')?.remove();
      } else if (control.matches('[data-ui-open]')) {
        // فتح النافذة المطلوبة؛ وإن وجد قالب HTML ننسخه إلى مكان العرض.
        event.preventDefault();
        const modal = targetOf(control, 'data-ui-open');
        const template = control.getAttribute('data-ui-template');
        const slot = control.getAttribute('data-ui-template-slot');
        if (template && slot) {
          const source = find(template), destination = find(slot);
          if (source && destination) destination.replaceChildren(source.content.cloneNode(true));
        }
        if (modal && window.bootstrap) bootstrap.Modal.getOrCreateInstance(modal).show();
      } else if (control.matches('[data-ui-reveal]')) {
        // إظهار لوحة مخفية دون تغيير محتواها.
        event.preventDefault();
        const panel = targetOf(control, 'data-ui-reveal');
        if (panel) { panel.hidden = false; panel.classList.remove('d-none'); }
      } else if (control.matches('[data-ui-conceal]')) {
        // إخفاء لوحة العرض المطلوبة.
        event.preventDefault();
        const panel = targetOf(control, 'data-ui-conceal');
        if (panel) panel.hidden = true;
      } else if (control.matches('[data-ui-pending]')) {
        // إظهار تنبيه انتظار الربط عند طلب عملية تحتاج إلى الخادم.
        event.preventDefault();
        showPendingNotice();
      } else if (control.matches('[data-ui-print]')) {
        // فتح نافذة طباعة المتصفح.
        event.preventDefault();
        window.print();
      }
    });

    document.addEventListener('change', (event) => {
      const control = event.target;
      // تغيير أداة غير مربوطة بالخادم يعرض التنبيه فقط.
      if (control.matches('[data-ui-unbound-control]')) showPendingNotice();
    });

    // إظهار زر العودة للأعلى بعد التمرير وتنفيذ التمرير السلس.
    const topButton = find('.ux-top');
    topButton?.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    window.addEventListener('scroll', () => topButton?.classList.toggle('show', window.scrollY > 500), { passive: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeUI);
  } else {
    initializeUI();
  }
})();


/* UI alignment: local form interactions only. Server remains authoritative for
   authentication, scope permissions, record validation, persistence and transactions. */
(() => {
 'use strict';
 const ready = () => {
  const q=(s,r=document)=>r.querySelector(s), qa=(s,r=document)=>[...r.querySelectorAll(s)];
  const notice=()=>{const n=q('#backendPendingNotice');if(n&&window.bootstrap)bootstrap.Toast.getOrCreateInstance(n).show();};
  const fail=(e,msg)=>{e.setCustomValidity(msg);e.reportValidity();return false;};
  document.addEventListener('input',e=>{if(e.target.setCustomValidity)e.target.setCustomValidity('');});
  document.addEventListener('change',e=>{if(e.target.setCustomValidity)e.target.setCustomValidity('');});
  function clinicContext(){
   const s=q('[data-active-clinic]');if(!s)return;
   // Options come only from actual memberships; changing context requires server reauthorization.
   s.addEventListener('change',()=>{document.documentElement.dataset.clinicId=s.value;qa('[data-requires-permission]').forEach(x=>x.dataset.clinicId=s.value);notice();});
  }
  clinicContext();
  // Existing add-period modal doubles as edit-period modal; all values originate in server-rendered HTML.
  const scheduleModal=q('#schedulePeriodModal'),scheduleForm=q('#realScheduleForm');
  if(scheduleModal&&scheduleForm){
    const endsAtMidnight=q('#scheduleEndOfDay',scheduleForm),endInput=q('#scheduleEnd',scheduleForm);
    const syncEnd=()=>{endInput.disabled=endsAtMidnight.checked;endInput.required=!endsAtMidnight.checked;if(endsAtMidnight.checked)endInput.value='';};
    endsAtMidnight.addEventListener('change',syncEnd);
    scheduleModal.addEventListener('show.bs.modal',event=>{
      const edit=event.relatedTarget?.matches('[data-schedule-edit]')?event.relatedTarget:null;
      scheduleForm.reset();
      scheduleForm.elements.action.value=edit?'update_period':'add_period';
      scheduleForm.elements.original_day.value=edit?.dataset.day||'';
      scheduleForm.elements.original_start.value=edit?.dataset.start||'';
      scheduleForm.elements.original_end.value=edit?.dataset.end||'';
      if(edit){
        scheduleForm.elements.day.value=edit.dataset.day;
        scheduleForm.elements.start.value=edit.dataset.start;
        scheduleForm.elements.active.value=edit.dataset.active;
        endsAtMidnight.checked=edit.dataset.end==='24:00';
        if(!endsAtMidnight.checked)endInput.value=edit.dataset.end;
      }
      syncEnd();
      q('#schedulePeriodModalLabel').textContent=edit?'تعديل فترة دوام':'إضافة فترة دوام';
      q('#scheduleSaveBtn').textContent=edit?'حفظ التعديلات':'حفظ فترة الدوام';
    });
  }
  q('#catalogServiceId')?.addEventListener('change',e=>{
   const box=q('[data-new-service]'),n=q('#newCatalogServiceName');const yes=e.target.value==='__new__';box.hidden=!yes;n.disabled=!yes;n.required=yes;
  });
  q('[data-existing-doctor]')?.addEventListener('change',e=>{
   const o=e.target.selectedOptions[0];[['clinicDoctorName','name'],['clinicDoctorLicense','license'],['clinicDoctorEmail','email'],['clinicDoctorPhone','phone'],['clinicDoctorSpecialty','specialty']].forEach(([id,key])=>{const n=q('#'+id);if(n)n.value=o.dataset[key]||'';});
  });
  q('#existingStaffAccount')?.addEventListener('change',e=>{
   const o=e.target.selectedOptions[0];[['staffFormName','name'],['staffFormEmail','email'],['staffFormPhone','phone']].forEach(([id,key])=>{q('#'+id).value=o.dataset[key]||'';});
  });
  const staffPermissionLabels={
    'appointments.view':'عرض المواعيد','appointments.manage':'إدارة المواعيد',
    'patients.view_directory':'عرض دليل المرضى المحدود','patients.create':'إضافة مريض',
    'invoices.view':'عرض الفواتير','invoices.issue':'إصدار الفواتير',
    'payments.record':'تسجيل الدفعات',
    'lab_orders.view':'عرض الحالات المخبرية','lab_orders.update_delivery':'إرسال واستلام الحالات',
    
  };
  const refreshStaffPermissionCount=()=>{
    const count=document.querySelectorAll('.staff-permissions-grid input[type="checkbox"]:checked').length;
    const output=q('#staffPermissionCount');if(output)output.textContent=`${count} صلاحية محددة`;
  };
  q('.staff-permissions-grid')?.addEventListener('change',refreshStaffPermissionCount);
  q('#staffFormRole')?.addEventListener('change',()=>{
    const role=q('#staffFormRole')?.selectedOptions[0];
    const selected=new Set((role?.dataset.templatePermissions||'').split(',').filter(Boolean));
    qa('.staff-permissions-grid input[type="checkbox"]').forEach(box=>box.checked=selected.has(box.value));
    refreshStaffPermissionCount();
  });
  q('#applyRoleTemplate')?.addEventListener('click',()=>{
   const selected=q('#staffFormRole')?.selectedOptions[0];const values=(selected?.dataset.templatePermissions||'').split(',');
   qa('.staff-permissions-grid input[type="checkbox"]').forEach(e=>e.checked=values.includes(e.value));
   refreshStaffPermissionCount();
  });
  function total(editor){
   let amount=0;
   qa('[data-invoice-line]',editor).forEach(row=>{
    const qty=q('[data-line-quantity]',row),price=q('[data-line-price]',row),discount=q('[data-line-discount]',row);
    const gross=Number(qty.value)*Number(price.value);discount.max=String(Math.max(0,gross));amount+=Math.max(0,gross-Number(discount.value));
   });
   const paid=q('[data-initial-payment]',editor);if(paid)paid.max=amount.toFixed(2);
   q('[data-invoice-total]',editor).textContent=amount.toFixed(2);
   q('[data-invoice-remaining]',editor).textContent=(amount-Number(paid?.value||0)).toFixed(2);
  }
  qa('[data-invoice-editor]').forEach(e=>{total(e);e.addEventListener('input',()=>total(e));});
  let nextLine=1;
  document.addEventListener('click',e=>{
   const add=e.target.closest('[data-add-invoice-line]');
   if(add){
    const editor=add.closest('[data-invoice-editor]'),body=q('[data-invoice-lines]',editor),row=q('[data-invoice-line]',body).cloneNode(true),idx=nextLine++;
    qa('input',row).forEach(i=>{i.name=i.name.replace(/items\[\d+\]/,`items[${idx}]`);i.value=i.matches('[data-line-quantity]')?'1':i.type==='number'?'0':'';});body.append(row);total(editor);return;
   }
   const rem=e.target.closest('[data-remove-invoice-line]');
   if(rem){const editor=rem.closest('[data-invoice-editor]');if(qa('[data-invoice-line]',editor).length>1){rem.closest('tr').remove();total(editor);}return;}
   const rm=e.target.closest('[data-remove-medication]');if(rm){rm.closest('.dynamic-list-item')?.remove();return;}
  });
  // Each prescription keeps its own form, medicine list and lifecycle.
  let rxNumber=1;
  document.addEventListener('click',e=>{
   const add=e.target.closest('[data-add-prescription]');if(!add)return;
   const source=q('[data-prescription-card]'),copy=source.cloneNode(true),n=++rxNumber,formId='prescription-form-'+n;
   copy.dataset.prescriptionId='RX-DRAFT-'+n;q('[data-rx-title]',copy).textContent='وصفة '+n+' — مسودة';
   const mapping=new Map();qa('[id]',copy).forEach(el=>{mapping.set(el.id,el.id+'-rx'+n);el.id+='-rx'+n;});
   qa('[for]',copy).forEach(el=>{if(mapping.has(el.htmlFor))el.htmlFor=mapping.get(el.htmlFor);});
   qa('input,select,textarea,button',copy).forEach(el=>{
    if(el.hasAttribute('form'))el.setAttribute('form',formId);
    if(el.matches('input,textarea'))el.value='';
    if(el.matches('select'))el.value='draft';
   });
   const list=q('.dynamic-list-item',copy);qa('.dynamic-list-item',copy).slice(1).forEach(el=>el.remove());
   const addMed=q('[data-ui-add-template]',copy);if(addMed){addMed.removeAttribute('data-ui-add-template');addMed.removeAttribute('data-ui-add-slot');addMed.dataset.addRxMedicine='';}
   q('[data-rx-status]',copy).value='draft';
   const f=document.createElement('form');f.id=formId;f.method='post';f.hidden=true;f.dataset.uiUnbound='';f.dataset.visitId='V-001';f.dataset.prescriptionId='RX-DRAFT-'+n;document.body.append(f);
   q('#additionalPrescriptions').append(copy);
  });
  document.addEventListener('click',e=>{
   const b=e.target.closest('[data-add-rx-medicine]');if(!b)return;
   const card=b.closest('[data-prescription-card]'),list=q('[id^="medicationList"]',card),base=q('.dynamic-list-item',card)||q('.dynamic-list-item',q('[data-prescription-card]'));
   const row=base.cloneNode(true),formId=q('[data-rx-status]',card).getAttribute('form');
   qa('[id]',row).forEach(el=>el.removeAttribute('id'));qa('label[for]',row).forEach(el=>el.removeAttribute('for'));
   qa('input,textarea,select,button',row).forEach(el=>{if(el.hasAttribute('form'))el.setAttribute('form',formId);if(el.matches('input,textarea'))el.value='';});list.append(row);
  });
  function rxFields(card){
   const status=q('[data-rx-status]',card)?.value;
   qa('.dynamic-list-item input',card).forEach(el=>el.required=status==='issued'&&!el.matches('[data-field="instructions"]'));
   const reason=q('[data-field="voidReason"]',card);if(reason)reason.required=status==='voided';
  }
  document.addEventListener('change',e=>{if(e.target.matches('[data-rx-status]'))rxFields(e.target.closest('[data-prescription-card]'));});
  // Form validation runs before the original unbound-submit handler. No fake save.
  document.addEventListener('submit',e=>{
   const f=e.target;if(!(f instanceof HTMLFormElement))return;
   const editor=qa('[data-invoice-editor]').find(ed=>q('button[form="'+f.id+'"]',ed));
   if(editor){
    total(editor);
    const invalid=qa('input',editor).find(el=>!el.checkValidity());
    if(invalid){e.preventDefault();e.stopImmediatePropagation();invalid.reportValidity();return;}
   }
   const card=qa('[data-prescription-card]').find(c=>q('[data-rx-status]',c)?.getAttribute('form')===f.id);
   if(card){rxFields(card);const status=q('[data-rx-status]',card).value;
    if(status==='issued'&&!q('.dynamic-list-item',card)){e.preventDefault();e.stopImmediatePropagation();fail(q('[data-rx-status]',card),'أضف دواء واحدًا على الأقل قبل الإصدار.');return;}
    const invalid=qa('input',card).find(el=>!el.checkValidity());if(invalid){e.preventDefault();e.stopImmediatePropagation();invalid.reportValidity();return;}
   }
   const pass=f.querySelector('input[type="password"][autocomplete="new-password"]'),confirm=f.querySelector('#confirmPassword');
   if(pass&&confirm&&pass.value!==confirm.value){e.preventDefault();e.stopImmediatePropagation();fail(confirm,'كلمتا المرور غير متطابقتين.');return;}
   const catalog=q('#catalogServiceId');if(catalog?.form===f&&catalog.value==='__new__'){
    const name=q('#newCatalogServiceName');if(qa('option',catalog).some(o=>o.value!=='__new__'&&o.textContent.trim()===name.value.trim())){e.preventDefault();e.stopImmediatePropagation();fail(name,'الخدمة موجودة في الكتالوج؛ اخترها بدل تكرارها.');return;}
   }
  },true);
  // All save buttons submit the associated form so native validity can run.
  qa('button[type="submit"][form][data-ui-pending],form button[type="submit"][data-ui-pending]').forEach(b=>b.removeAttribute('data-ui-pending'));
  // Blank template IDs are not duplicated when adding rows.
  document.addEventListener('click',e=>{
   const b=e.target.closest('[data-ui-add-template]');if(!b)return;
   const template=q(b.dataset.uiAddTemplate);if(!template)return;
   qa('input',template.content).forEach(el=>{if(el.name==='quantity'){el.value='1';el.min='1';el.step='1';}});
  },true);
  // Filter only SSR patient rows here; finance and jobs have dedicated combined filters.
  [['#patientSearch','.patient-filter-item']].forEach(([inputSel,rowSel])=>{
   q(inputSel)?.addEventListener('input',e=>{const term=e.target.value.trim();qa(rowSel).forEach(row=>row.hidden=!row.textContent.includes(term));});
  });
 };
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready);else ready();
})();

(() => {
 'use strict';
 const init=()=>{
  const q=(s,r=document)=>r.querySelector(s),qa=(s,r=document)=>[...r.querySelectorAll(s)];
  [['#needsLab','#labFields'],['#needsFollowup','#followupFields']].forEach(([c,s])=>{
   const box=q(c),panel=q(s);if(box&&panel){const apply=()=>{panel.classList.toggle('d-none',!box.checked);};box.addEventListener('change',apply);apply();}
  });
  const role=q('#userFormRole');
  if(role){const apply=()=>qa('[data-user-role-fields]').forEach(section=>{
   const active=section.dataset.userRoleFields===role.value;section.classList.toggle('d-none',!active);qa('input,select,textarea',section).forEach(e=>e.disabled=!active);
  });role.addEventListener('change',apply);apply();}
  function bindRx(){qa('[data-prescription-card]').forEach(card=>{
   const formId=q('[data-rx-status]',card)?.getAttribute('form');
   qa('.dynamic-list-item',card).forEach((row,i)=>qa('input[data-medication-field]',row).forEach(e=>{e.name=`medications[${i}][${e.dataset.medicationField}]`;if(formId)e.setAttribute('form',formId);}));
  });}
  bindRx();const rx=q('#prescription');if(rx)new MutationObserver(bindRx).observe(rx,{childList:true,subtree:true});
  const money=()=>{
   const qty=q('[data-admin-quantity]'),price=q('[data-admin-price]'),total=q('[data-admin-invoice-total]'),paid=q('#invoiceFormPaid');
   if(qty&&price&&total){total.value=(Number(qty.value)*Number(price.value)).toFixed(2);if(paid)paid.max=total.value;}
  };
  qa('[data-admin-quantity],[data-admin-price]').forEach(e=>e.addEventListener('input',money));money();
  // Permission data must come from the authenticated clinic context; never invent a demo clinic ID.
 };
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();

/* Clinic creates employee credentials and membership in one server operation. */
(() => {
 const init=()=>{
  const form=document.querySelector('[data-staff-account-form]');if(!form)return;
  const mode=document.getElementById('staffAccountMode'),existing=document.getElementById('existingStaffAccount');
  const existingPanel=document.querySelector('[data-existing-staff-panel]'),passwordPanel=document.querySelector('[data-new-staff-password]');
  const pass=document.getElementById('staffAccountPassword'),confirm=document.getElementById('staffAccountPasswordConfirm');
  const button=document.getElementById('saveStaffBtn');
  function update(){
   const create=mode.value==='create';existingPanel.hidden=create;existing.disabled=create;existing.required=!create;passwordPanel.hidden=!create;
   [pass,confirm].forEach(e=>{e.disabled=!create;e.required=create;e.value='';e.setCustomValidity('');});
   document.querySelectorAll('[data-staff-identity]').forEach(e=>{e.readOnly=!create;e.required=create;e.value='';});
   existing.value='';button.textContent=create?'إنشاء الحساب وإضافته للعيادة':'ربط الحساب بالعيادة';
   form.dataset.backendOperation=create?'create-account-and-membership':'link-existing-account';
  }
  mode.addEventListener('change',update);update();
  function matching(){confirm.setCustomValidity(mode.value==='create'&&pass.value!==confirm.value?'كلمتا المرور غير متطابقتين.':'');}
  document.addEventListener('input',e=>{if(e.target===pass||e.target===confirm)matching();});
  document.addEventListener('click',e=>{const b=e.target.closest('[data-toggle-staff-password]');if(!b)return;const input=document.querySelector(b.dataset.toggleStaffPassword);input.type=input.type==='password'?'text':'password';b.setAttribute('aria-label',input.type==='password'?'إظهار كلمة المرور':'إخفاء كلمة المرور');});
  form.addEventListener('submit',e=>{
   matching();
   if(!form.reportValidity()){e.preventDefault();e.stopImmediatePropagation();return;}
   // Server handles the real save, including membership scope and CSRF.
  },true);
  document.getElementById('staffModal')?.addEventListener('hidden.bs.modal',()=>{pass.value='';confirm.value='';});
 };
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();

/* Clinic profile and services: browser interactions only. Real data is SSR, saving uses POST. */
(() => {
 'use strict';
 const ready=()=>{
  const q=(s,r=document)=>r.querySelector(s),qa=(s,r=document)=>[...r.querySelectorAll(s)];
  const hours=q('#clinicHoursForm');
  if(hours){
   function makePeriod(start='09:00',end='17:00'){
    const row=document.createElement('div');row.className='row g-2 align-items-end working-period-row mb-2';
    row.innerHTML='<div class="col-md-5"><label class="form-label small">من<input class="form-control working-period-input" type="time" required></label></div><div class="col-md-5"><label class="form-label small">إلى<input class="form-control working-period-input" type="time" required></label></div><div class="col-md-2"><button class="btn btn-outline-danger w-100 remove-working-period" type="button">حذف</button></div>';
    const [a,b]=qa('input',row);a.value=start;b.value=end;return row;
   }
   function makeFullDay(){
    const row=document.createElement('div');row.className='d-flex flex-wrap justify-content-between align-items-center gap-2 working-period-row border rounded-3 p-2 mb-2';
    row.dataset.fullDay='true';
    row.innerHTML='<span class="small fw-semibold"><i class="bi bi-clock-history ms-1"></i>دوام 24 ساعة (00:00 – 24:00)</span><button type="button" class="btn btn-outline-danger btn-sm remove-working-period">حذف</button>';
    return row;
   }
   function syncDay(day){
    const enabled=q('.working-day-toggle',day).checked;
    qa('input[type="time"]',day).forEach(i=>i.disabled=!enabled);
    const fullDay=Boolean(q('[data-full-day]',day));
    q('.add-working-period',day).disabled=fullDay;
    q('.set-day-24h',day).disabled=fullDay;
   }
   qa('.working-day-card',hours).forEach(syncDay);
   q('#setClinicWeek24h')?.addEventListener('click',()=>{
    if(!window.confirm('سيتم استبدال فترات الدوام المعروضة لكل أيام الأسبوع بدوام 24 ساعة. لن تُحفظ التغييرات حتى تضغط حفظ ساعات العمل. هل تريد المتابعة؟'))return;
    qa('.working-day-card',hours).forEach(day=>{
     q('.working-day-toggle',day).checked=true;
     q('.working-periods',day).replaceChildren(makeFullDay());
     syncDay(day);
    });
   });
   q('#clinicWorkingHoursEditor').addEventListener('click',e=>{
    const add=e.target.closest('.add-working-period'),del=e.target.closest('.remove-working-period'),full=e.target.closest('.set-day-24h');
    if(full){
     const day=full.closest('.working-day-card');q('.working-day-toggle',day).checked=true;
     q('.working-periods',day).replaceChildren(makeFullDay());syncDay(day);
     return;
    }
    if(add){
     const day=add.closest('.working-day-card');day.querySelector('.working-day-toggle').checked=true;
     q('.working-periods',day).append(makePeriod());syncDay(day);
     return;
    }
    if(del){const day=del.closest('.working-day-card');del.closest('.working-period-row').remove();syncDay(day);}
   });
   q('#clinicWorkingHoursEditor').addEventListener('change',e=>{
    if(e.target.matches('.working-day-toggle')){const day=e.target.closest('.working-day-card');if(e.target.checked&&!q('.working-period-row',day))q('.working-periods',day).append(makePeriod());syncDay(day);}
   });
   hours.addEventListener('submit',e=>{
    const periods=[];let ok=true;
    qa('.working-day-card',hours).forEach(day=>{
     if(!q('.working-day-toggle',day).checked)return;
     const dayNum=Number(day.dataset.workingDay);
     qa('.working-period-row',day).forEach(row=>{
      if(row.dataset.fullDay==='true'){periods.push({day:dayNum,start:'00:00',end:'24:00'});return;}
      const inp=qa('input[type="time"]',row),start=inp[0].value,end=inp[1].value;
      if(!start||!end||start>=end){ok=false;return;}periods.push({day:dayNum,start,end});});
    });
    if(!ok){e.preventDefault();alert('يرجى التأكد من بداية ونهاية كل فترة عمل.');return;}
    q('#clinicHoursJson').value=JSON.stringify(periods);
   });
  }
  const exceptionForm=q('#clinicExceptionsForm');
  if(exceptionForm){
   function makeException(){const outer=document.createElement('div');outer.className='sdc-item border rounded-3 p-3 mb-2';outer.dataset.exceptionRow='';
    outer.innerHTML='<div class="row g-2 align-items-end"><div class="col-md-3"><label class="form-label small">التاريخ<input class="form-control" data-field="date" type="date" required></label></div><div class="col-md-3"><label class="form-label small">النوع<select class="form-select" data-field="mode"><option value="closed">إغلاق كامل</option><option value="custom_hours">ساعات استثنائية</option></select></label></div><div class="col-md-3"><label class="form-label small">من<input class="form-control" data-field="start" type="time"></label></div><div class="col-md-3"><label class="form-label small">إلى<input class="form-control" data-field="end" type="time"></label></div><div class="col-md-10"><label class="form-label small">السبب<input class="form-control" maxlength="2000" data-field="reason" required></label></div><div class="col-md-2"><button class="btn btn-outline-danger btn-sm" data-remove-exception type="button">إزالة</button></div></div>';
    return outer;
   }
   const slot=q('#sdcExceptionItems');
   q('#sdcAddException').addEventListener('click',()=>{const row=makeException();slot.append(row);q('[data-field="date"]',row).focus();});
   slot.addEventListener('click',e=>{if(e.target.closest('[data-remove-exception]'))e.target.closest('[data-exception-row]').remove();});
   exceptionForm.addEventListener('submit',e=>{
    const items=qa('[data-exception-row]',slot).map(r=>{const get=n=>q('[data-field="'+n+'"]',r).value;return {date:get('date'),type:get('mode'),start:get('start'),end:get('end'),reason:get('reason')};});
    if(items.some(v=>!v.date||!v.reason.trim()||(v.type==='custom_hours'&&(!v.start||!v.end||v.start>=v.end)))){e.preventDefault();alert('راجع تواريخ وأسباب وساعات الاستثناءات.');return;}
    q('#clinicExceptionsJson').value=JSON.stringify(items);
   });
  }
  const modal=q('#clinicMapModal');
  if(modal){
   let map,marker;
   const lat=q('#clinicLatInput'),lng=q('#clinicLngInput'),mlat=q('#clinicMapLat'),mlng=q('#clinicMapLng'),feedback=q('#clinicMapFeedback');
   modal.addEventListener('show.bs.modal',()=>{mlat.value=lat.value;mlng.value=lng.value;});
   modal.addEventListener('shown.bs.modal',()=>{
    if(!window.L){feedback.textContent='الخريطة غير متاحة الآن. أدخل الإحداثيات يدويًا.';return;}
    const vlat=Number(mlat.value)||31.9,vlng=Number(mlng.value)||35.2;
    if(!map){map=L.map('clinicMapCanvas').setView([vlat,vlng],13);
     L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap contributors',maxZoom:19}).addTo(map);
     map.on('click',e=>{mlat.value=e.latlng.lat.toFixed(7);mlng.value=e.latlng.lng.toFixed(7);place(e.latlng.lat,e.latlng.lng);});
    }else map.setView([vlat,vlng]);
    place(vlat,vlng);setTimeout(()=>map.invalidateSize(),100);
   });
   function place(a,b){if(!map)return;if(marker)marker.setLatLng([a,b]);else marker=L.marker([a,b]).addTo(map);}
   q('#confirmClinicMap').addEventListener('click',()=>{
    const a=Number(mlat.value),b=Number(mlng.value);
    if(!mlat.value||!mlng.value||!Number.isFinite(a)||!Number.isFinite(b)||Math.abs(a)>90||Math.abs(b)>180){feedback.textContent='الإحداثيات غير صالحة.';return;}
    lat.value=a.toFixed(7);lng.value=b.toFixed(7);bootstrap.Modal.getOrCreateInstance(modal).hide();
    feedback.textContent='تم اختيار الموقع؛ اضغط حفظ البيانات لتثبيته في قاعدة البيانات.';
   });
  }
  const serviceModal=q('#serviceModal');
  if(serviceModal){
   const form=q('#clinicServiceForm'),catalog=q('#catalogServiceId'),newField=q('#newCatalogServiceName');
   const setFields=()=>{const yes=catalog.value==='__new__';const box=q('[data-new-service]',form);box.hidden=!yes;newField.disabled=!yes;newField.required=yes;};
   catalog.addEventListener('change',setFields);
   document.addEventListener('click',e=>{
    const btn=e.target.closest('[data-edit-service],[data-toggle-service],[data-service-new]');if(!btn)return;
    form.reset();newField.value='';
    const card=btn.closest('[data-service-id]');
    if(card){catalog.value=card.dataset.serviceId;q('#clinicServicePrice').value=card.dataset.price;q('#clinicServiceDuration').value=card.dataset.duration;q('#clinicServiceInstallments').value=card.dataset.installments;q('#clinicServiceAvailable').value=btn.hasAttribute('data-toggle-service')?(card.dataset.available==='true'?'false':'true'):card.dataset.available;
     let members=[];try{members=JSON.parse(card.dataset.doctors||'[]').map(String);}catch{};
     qa('[name="doctor_ids"]',form).forEach(c=>c.checked=members.includes(c.value));
     q('#serviceModalTitle').textContent='تعديل خدمة العيادة';
    }else{catalog.value='';q('#clinicServicePrice').value='';q('#clinicServiceDuration').value='';q('#serviceModalTitle').textContent='إضافة خدمة';}
    setFields();
   });
   const search=q('#serviceSearch'),status=q('#serviceStatus');
   const filter=()=>{const term=(search.value||'').trim().toLocaleLowerCase();qa('.service-item').forEach(row=>row.hidden=!(row.dataset.name||'').toLocaleLowerCase().includes(term)||(status.value!=='all'&&status.value!==row.dataset.status));};
   search.addEventListener('input',filter);status.addEventListener('change',filter);
  }
 };
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready);else ready();
})();

/* Clinic bookings: presentation-only filtering.
   Show ten appointments per page after applying the filters.
   Booking actions remain on protected server routes; pagination does not mutate bookings. */
(() => {
 'use strict';
 const ready=()=>{
  const list=document.getElementById('clinicAppointmentsList');
  if(!list)return;
  const cards=[...list.querySelectorAll('.appointment-item')];
  const search=document.getElementById('appointmentSearch');
  const dateFilter=document.getElementById('appointmentDateFilter');
  const reset=document.getElementById('appointmentResetFilters');
  const count=document.getElementById('appointmentCount');
  const empty=document.getElementById('appointmentEmpty');
  const pager=document.getElementById('appointmentPagination');
  const pageStatus=document.getElementById('appointmentPageStatus');
  const tabs=[...document.querySelectorAll('[data-appointment-filter]')];
  const today=list.dataset.today||'';
  const pageSize=10;
  let filter='all',currentPage=1;
  const renderPagination=(total,pages)=>{
   if(pageStatus){
    const first=total?(currentPage-1)*pageSize+1:0;
    const last=Math.min(currentPage*pageSize,total);
    pageStatus.textContent=total?`عرض ${first}–${last} من ${total} موعد • الصفحة ${currentPage} من ${pages}`:'لا توجد نتائج للعرض';
   }
   if(!pager)return;
   pager.hidden=pages<=1;
   if(typeof document.createElement!=='function')return;
   pager.replaceChildren();
   if(pages<=1)return;
   const button=(label,page,active=false,disabled=false)=>{
    const el=document.createElement('button');
    el.type='button';el.textContent=label;
    el.className=`btn btn-sm ${active?'btn-primary':'btn-outline-primary'}`;
    el.disabled=disabled;
    if(active)el.setAttribute('aria-current','page');
    el.setAttribute('aria-label',`صفحة ${page}`);
    el.addEventListener('click',()=>{if(page===currentPage||disabled)return;currentPage=page;apply();list.scrollIntoView?.({behavior:'auto',block:'start'});});
    pager.appendChild(el);
   };
   button('السابق',Math.max(1,currentPage-1),false,currentPage===1);
   // A bounded number window keeps navigation usable even with many appointments.
   const begin=Math.max(1,Math.min(currentPage-2,pages-4));
   const end=Math.min(pages,begin+4);
   if(begin>1){button('1',1);if(begin>2){const ell=document.createElement('span');ell.textContent='…';ell.setAttribute('aria-hidden','true');pager.appendChild(ell);}}
   for(let page=begin;page<=end;page++)button(String(page),page,page===currentPage);
   if(end<pages){if(end<pages-1){const ell=document.createElement('span');ell.textContent='…';ell.setAttribute('aria-hidden','true');pager.appendChild(ell);}button(String(pages),pages);}
   button('التالي',Math.min(pages,currentPage+1),false,currentPage===pages);
  };
  const apply=()=>{
   const term=String(search?.value||'').toLocaleLowerCase().trim();
   const period=dateFilter?.value||'all';
   const matched=[];
   for(const card of cards){
    const status=card.dataset.status||'';
    const requested=card.dataset.requestStatus==='pending';
    const date=card.dataset.date||'';
    const statusOK=filter==='all'||(filter==='reschedule'&&requested)||(filter==='pending'&&status==='pending'&&card.dataset.expired!=='true')||(filter==='closed'&&['cancelled','rejected'].includes(status))||(filter===status);
    const periodOK=period==='all'||(period==='today'&&date===today)||(period==='upcoming'&&date>=today)||(period==='past'&&date<today);
    const termOK=!term||String(card.dataset.search||'').toLocaleLowerCase().includes(term);
    if(statusOK&&periodOK&&termOK)matched.push(card);
   }
   const pages=Math.max(1,Math.ceil(matched.length/pageSize));
   currentPage=Math.min(Math.max(1,currentPage),pages);
   const first=(currentPage-1)*pageSize;
   const visible=new Set(matched.slice(first,first+pageSize));
   for(const card of cards)card.classList.toggle('d-none',!visible.has(card));
   if(count)count.textContent=`${matched.length} من أصل ${cards.length} موعد`;
   if(empty)empty.classList.toggle('d-none',matched.length!==0||cards.length===0);
   renderPagination(matched.length,pages);
   for(const btn of tabs){
    const active=btn.dataset.appointmentFilter===filter;
    btn.classList.toggle('active',active);
    if(btn.classList.contains('btn')){
     if(btn.classList.contains('clinic-appt-stat'))continue;
     btn.classList.toggle('btn-primary',active);
     btn.classList.toggle('btn-light',!active);
    }
    btn.setAttribute('aria-pressed',String(active));
   }
  };
  search?.addEventListener('input',()=>{currentPage=1;apply();});
  dateFilter?.addEventListener('change',()=>{currentPage=1;apply();});
  for(const btn of tabs)btn.addEventListener('click',()=>{filter=btn.dataset.appointmentFilter||'all';currentPage=1;apply();});
  reset?.addEventListener('click',()=>{filter='all';currentPage=1;if(search)search.value='';if(dateFilter)dateFilter.value='all';apply();search?.focus();});
  apply();
 };
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready);else ready();
})();

/* The patient belongs to the POST booking form, while availability is a GET form.
   Mirror only the selected patient ID into GET so it survives refreshing available times. */
(() => {
 'use strict';
 const ready=()=>{
  const patient=document.getElementById('clinicBookingPatient');
  const selectedForAvailability=document.getElementById('clinicSearchPatientId');
  const availabilityForm=document.getElementById('searchClinicSlots');
  if(!patient||!selectedForAvailability||!availabilityForm)return;
  const sync=()=>{selectedForAvailability.value=patient.value||'';};
  patient.addEventListener('change',sync);
  availabilityForm.addEventListener('submit',sync);
  sync();
 };
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready);else ready();
})();

/* Doctors grid filters act only on server-rendered doctor cards. */
(()=>{'use strict';const init=()=>{
 const grid=document.querySelector('.doctors-responsive-grid');if(!grid)return;
 const cards=[...grid.querySelectorAll('.doctor-item')],search=document.getElementById('doctorSearch'),specialty=document.getElementById('doctorSpecialty'),availability=document.getElementById('doctorAvailability'),count=document.getElementById('doctorCount');
 const apply=()=>{let visible=0;for(const c of cards){const q=(search?.value||'').toLowerCase().trim(),yes=(!q||(c.dataset.name+' '+c.dataset.specialtyName).toLowerCase().includes(q))&&(!specialty||specialty.value==='all'||c.dataset.specialtyName.includes(specialty.value))&&(!availability||availability.value==='all'||c.dataset.availability===availability.value);c.classList.toggle('d-none',!yes);visible+=Number(yes);}if(count)count.textContent=visible+' طبيب';document.getElementById('doctorEmpty')?.classList.toggle('d-none',visible!==0);};
 search?.addEventListener('input',apply);[specialty,availability].forEach(e=>e?.addEventListener('change',apply));document.getElementById('clearDoctorFilters')?.addEventListener('click',()=>{if(search)search.value='';if(specialty)specialty.value='all';if(availability)availability.value='all';apply();});apply();
 };if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();})();

/* Fill existing doctor invitation modal with server-rendered verified-doctor attributes. */
(()=>{'use strict';const init=()=>{
 const select=document.getElementById('clinicExistingDoctor');if(!select)return;
 const mapping={clinicDoctorName:'name',clinicDoctorSpecialty:'specialty',clinicDoctorLicense:'license',clinicDoctorEmail:'email',clinicDoctorPhone:'phone'};
 const render=()=>{const opt=select.selectedOptions?.[0];for(const [id,key] of Object.entries(mapping)){const input=document.getElementById(id);if(input)input.value=opt?.value?String(opt.dataset[key]||''):'';}const submit=document.getElementById('saveClinicDoctorBtn');if(submit)submit.disabled=!select.value;};
 select.addEventListener('change',render);render();
 };if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();})();

/* Staff UI: reuse the original table and modal; all data comes from server HTML.
   Never hard-code staff records in JS or bypass server-side permission checks. */
(() => {
 'use strict';
 const start=()=>{
  const form=document.querySelector('[data-staff-account-form]');if(!form)return;
  const modal=document.getElementById('staffModal'), view=document.getElementById('staffViewModal');
  const q=(id)=>document.getElementById(id);
  const editor=()=>form.elements;
  const prepareCreate=()=>{
   form.reset();editor().action.value='create';editor().staff_id.value='';
   q('staffModalTitle').textContent='إضافة موظف';q('saveStaffBtn').textContent='إنشاء الحساب وإضافته للعيادة';
   q('staffAccountMode').value='create';q('staffAccountMode').disabled=false;
   document.querySelector('[data-new-staff-password]').hidden=false;
   for(const i of [q('staffAccountPassword'),q('staffAccountPasswordConfirm')]){i.required=true;i.disabled=false;i.value='';}
   for(const i of document.querySelectorAll('[data-staff-identity]')){i.readOnly=false;i.required=true;i.value='';}
   q('staffFormRole').value='reception';q('staffFormStatus').value='active';
   const template=new Set((q('staffFormRole')?.selectedOptions[0]?.dataset.templatePermissions||'').split(','));
   document.querySelectorAll('.staff-permissions-grid input[type="checkbox"]').forEach(e=>e.checked=template.has(e.value));
   refreshStaffPermissionCount();
  };
  document.addEventListener('click',event=>{
   const button=event.target.closest('[data-staff-new],[data-staff-edit],[data-staff-view]');if(!button)return;
   const row=button.closest('[data-staff-row]');
   if(button.hasAttribute('data-staff-new')){prepareCreate();return;}
   if(!row)return;
   if(button.hasAttribute('data-staff-edit')){
    prepareCreate();editor().action.value='update';editor().staff_id.value=row.dataset.id;
    q('staffModalTitle').textContent='تعديل الموظف والصلاحيات';q('saveStaffBtn').textContent='حفظ التعديلات';
    q('staffAccountMode').disabled=true;
    for(const i of document.querySelectorAll('[data-staff-identity]')){i.readOnly=true;i.required=false;}
    q('staffFormName').value=row.dataset.name;q('staffFormEmail').value=row.dataset.email;q('staffFormPhone').value=row.dataset.phone;
    const passPanel=document.querySelector('[data-new-staff-password]');passPanel.hidden=true;
    for(const i of [q('staffAccountPassword'),q('staffAccountPasswordConfirm')]){i.required=false;i.disabled=true;i.value='';}
    q('staffFormRole').value=row.dataset.role;q('staffFormStatus').value=row.dataset.status;
    const selected=new Set((row.dataset.permissions||'').split(',').filter(Boolean));
    document.querySelectorAll('.staff-permissions-grid input[type="checkbox"]').forEach(e=>e.checked=selected.has(e.value));
    refreshStaffPermissionCount();
   }
   if(button.hasAttribute('data-staff-view')){
    q('staffViewName').textContent=row.dataset.name;q('staffViewEmail').textContent=row.dataset.email;
    q('staffViewRole').textContent=row.querySelector('[data-staff-role-label]').textContent.trim();
    q('staffViewStatus').textContent=row.querySelector('[data-staff-badge]').textContent.trim();
    const box=q('staffViewPermissions');box.replaceChildren();
    for(const value of (row.dataset.permissions||'').split(',').filter(Boolean)){
     const label=document.createElement('span');label.className='badge text-bg-light border';label.textContent=staffPermissionLabels[value]||value;box.appendChild(label);
    }
   }
  },true);
  // Existing filters are UI-only; server-side data stays authoritative.
  const updateFilter=()=>{
   const term=q('staffSearch').value.trim().toLowerCase(),role=q('staffRoleFilter').value,status=q('staffStatusFilter').value;
   let shown=0;
   for(const row of document.querySelectorAll('[data-staff-row]')){
    const show=(!term||(row.dataset.search||'').toLowerCase().includes(term))&&(role==='all'||row.dataset.role===role)&&(status==='all'||row.dataset.status===status);
    row.hidden=!show;if(show)shown++;
   }
   q('staffEmpty')?.classList.toggle('d-none',shown>0);
  };
  q('staffSearch')?.addEventListener('input',updateFilter);
  q('staffRoleFilter')?.addEventListener('change',updateFilter);
  q('staffStatusFilter')?.addEventListener('change',updateFilter);
  prepareCreate();updateFilter();
 };
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();

/* Batch 2: client-only filtering of SSR-provided clinic clinical records.
 * This never fetches or constructs medical data; PostgreSQL is the source. */
(()=>{
 'use strict';
 const init=()=>{
  const search=document.getElementById('treatmentPlanSearch');
  const doctor=document.getElementById('treatmentPlanDoctor');
  const status=document.getElementById('treatmentPlanStatus');
  const planRows=Array.from(document.querySelectorAll('#treatmentPlansTable .treatment-plan-filter-item'));
  if(search&&doctor&&status){
   const run=()=>{let visible=0;for(const row of planRows){
    const show=row.dataset.search?.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase())&&(doctor.value==='all'||row.dataset.doctor===doctor.value)&&(status.value==='all'||row.dataset.status===status.value);
    row.hidden=!show;if(show)visible++;
   }document.getElementById('treatmentPlanEmpty')?.classList.toggle('d-none',visible>0||planRows.length===0);};
   for(const el of [search,doctor,status])el.addEventListener(el===search?'input':'change',run);
   document.getElementById('clearTreatmentPlanFilters')?.addEventListener('click',()=>{search.value='';doctor.value='all';status.value='all';run();});
   run();
  }
  const recallSearch=document.getElementById('recallSearchV9');
  const recallButtons=Array.from(document.querySelectorAll('.recall-filter-btn[data-recall-status]'));
  const cards=Array.from(document.querySelectorAll('#recallGridV9 .recall-card-v9'));
  if(recallSearch&&recallButtons.length){let current='all';
   const run=()=>{let visible=0;for(const card of cards){
    const show=card.dataset.search?.toLocaleLowerCase().includes(recallSearch.value.trim().toLocaleLowerCase())&&(current==='all'||card.dataset.status===current);
    card.hidden=!show;if(show)visible++;
   }document.getElementById('recallEmptyV9')?.classList.toggle('d-none',visible>0||cards.length===0);};
   recallButtons.forEach(b=>b.addEventListener('click',()=>{
    current=b.dataset.recallStatus;for(const x of recallButtons){x.classList.toggle('active',x===b);x.classList.toggle('btn-primary',x===b);x.classList.toggle('btn-light',x!==b);}run();
   }));recallSearch.addEventListener('input',run);run();
  }
 };
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();

/* v21: modal field selection and local filtering only. Persistence is server-side. */
(() => {
 'use strict';
 const ready=()=>{
  document.addEventListener('click',e=>{
   const move=e.target.closest('button.move-item[data-item-id]');
   if(move){
    const id=document.getElementById('inventoryMoveItemId');
    const label=document.getElementById('inventoryMoveAvailable');
    if(id)id.value=move.dataset.itemId;
    if(label)label.textContent=move.dataset.itemName+' — المتاح: '+move.dataset.itemQty;
   }
   const pay=e.target.closest('button[data-invoice-id]');
   if(pay){
    const id=document.getElementById('paymentInvoiceId'),amt=document.getElementById('paymentAmount');
    if(id)id.value=pay.dataset.invoiceId;
    if(amt){amt.max=pay.dataset.invoiceRemaining;amt.value=pay.dataset.invoiceRemaining;}
   }
  });
  const filterInventory=()=>{
   const text=(document.getElementById('inventorySearch')?.value||'').trim().toLowerCase();
   const state=document.getElementById('inventoryFilter')?.value||'all';
   const rows=[...document.querySelectorAll('#inventoryRows tr')];let count=0;
   for(const r of rows){const expiry=r.dataset.expiry||'';
    const expiring=expiry&&expiry<=new Date(Date.now()+30*864e5).toISOString().slice(0,10);
    const visible=(!text||(r.dataset.search||'').toLowerCase().includes(text))&&(state==='all'||state==='low'&&r.dataset.state!=='available'||state==='available'&&r.dataset.state==='available'||state==='expired'&&expiring);
    r.hidden=!visible;if(visible)count++;
   }
   const empty=document.getElementById('inventoryEmpty');if(empty)empty.classList.toggle('d-none',count>0);
  };
  ['inventorySearch','inventoryFilter'].forEach(id=>{const el=document.getElementById(id);if(el){el.addEventListener('input',filterInventory);el.addEventListener('change',filterInventory);}});
  const filterInvoices=()=>{
   const text=(document.getElementById('invoiceSearch')?.value||'').trim().toLowerCase();
   const status=document.getElementById('invoiceStatusFilter')?.value||'all';let shown=0;
   const items=[...document.querySelectorAll('.invoice-filter-item')];
   items.forEach(el=>{
    const visible=(!text||(el.dataset.search||'').toLowerCase().includes(text))&&(status==='all'||status===el.dataset.status);
    el.hidden=!visible;if(visible)shown++;
   });
   const empty=document.getElementById('invoiceEmptyState');if(empty)empty.classList.toggle('d-none',shown!==0||items.length===0);
   const count=document.getElementById('invoiceResultCount');if(count)count.textContent=shown+' من أصل '+items.length+' فاتورة';
   document.querySelectorAll('[data-invoice-preset]').forEach(btn=>btn.setAttribute('aria-pressed',String(status===btn.dataset.invoicePreset)));
  };
  ['invoiceSearch','invoiceStatusFilter'].forEach(id=>{const el=document.getElementById(id);if(el){el.addEventListener('input',filterInvoices);el.addEventListener('change',filterInvoices);}});
  document.querySelectorAll('[data-invoice-preset]').forEach(button=>button.addEventListener('click',()=>{
   const filter=document.getElementById('invoiceStatusFilter');if(filter)filter.value=filter.value===button.dataset.invoicePreset?'all':button.dataset.invoicePreset;
   filterInvoices();
  }));
  document.getElementById('invoiceResetFilters')?.addEventListener('click',()=>{
   const search=document.getElementById('invoiceSearch'),status=document.getElementById('invoiceStatusFilter');
   if(search)search.value='';if(status)status.value='all';filterInvoices();search?.focus();
  });
  if(document.getElementById('clinicInvoiceTabs'))filterInvoices();
 };
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready);else ready();
})();


/* The profile keeps its established #basic/#settings/#booking and document links after tab organization. */
(() => {
 'use strict';
 const init=()=>{
  const nav=document.getElementById('clinicProfileTabs');
  if(!nav||!window.bootstrap?.Tab)return;
  const aliases={
   basic:'details',clinicDetailsForm:'details','clinic-profile-pane-details':'details',
   settings:'hours',clinicHoursForm:'hours',sdcClinicExceptions:'hours',clinicExceptionsForm:'hours','clinic-profile-pane-hours':'hours',
   sdcClinicFileVersions:'documents',clinicProfileMedia:'documents',clinicProfileDocumentsHeading:'documents','clinic-profile-pane-documents':'documents',
   booking:'booking','clinic-profile-pane-booking':'booking'
  };
  const choice=(hash)=>{let key=String(hash||'').replace(/^#/,'');try{key=decodeURIComponent(key);}catch{}return aliases[key];};
  const show=(group)=>{
   const button=document.getElementById('clinic-profile-tab-'+group);
   if(button)bootstrap.Tab.getOrCreateInstance(button).show();
  };
  const remember=(group)=>{
   try{sessionStorage.setItem('sdc-clinic-profile-last-tab',group);}catch{}
  };
  const initial=choice(location.hash);
  // On error rendering with no redirect, return to the form the manager was editing.
  let restored='';
  if(!initial){try{restored=sessionStorage.getItem('sdc-clinic-profile-last-tab')||'';sessionStorage.removeItem('sdc-clinic-profile-last-tab');}catch{}}
  if(initial){try{sessionStorage.removeItem('sdc-clinic-profile-last-tab');}catch{}show(initial);}
  else if(['details','hours','documents','booking'].includes(restored))show(restored);
  nav.addEventListener('shown.bs.tab',event=>{
   const group=String(event.target.id||'').replace('clinic-profile-tab-','');
   if(group && !choice(location.hash))remember(group);
  });
  document.querySelectorAll('#clinicProfileTabContent form').forEach(form=>{
   form.addEventListener('submit',()=>{
    const pane=form.closest('.tab-pane');if(pane)remember(pane.id.replace('clinic-profile-pane-',''));
   });
  });
  document.querySelectorAll('[data-clinic-profile-link]').forEach(link=>link.addEventListener('click',()=>show(link.dataset.clinicProfileLink)));
  window.addEventListener('hashchange',()=>{const group=choice(location.hash);if(group)show(group);});
  // Bootstrap's active pane is display:none until shown; keep old cross-page hash navigation valid.
  if(initial && location.hash){
   requestAnimationFrame(()=>{
    let key=location.hash.slice(1);try{key=decodeURIComponent(key);}catch{}
    const anchor=document.getElementById(key);
    if(anchor && !anchor.closest('.modal'))anchor.scrollIntoView({block:'start'});
   });
  }
 };
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();


/* Clinic inventory: tabs and alert shortcuts; stock actions continue to POST to the server. */
(() => {
 'use strict';
 const init=()=>{
  const nav=document.getElementById('inventoryTabs');
  if(!nav||!window.bootstrap?.Tab)return;
  const show=(group)=>{
   const button=document.getElementById('inventory-tab-'+group);
   if(button)bootstrap.Tab.getOrCreateInstance(button).show();
  };
  const fromHash=()=>{
   let hash=location.hash.slice(1);
   try{hash=decodeURIComponent(hash);}catch{}
   if(['inventory-pane-movements','inventoryHistory','inventoryHistoryTitle','inventoryHistoryPagination','inventoryHistoryRange'].includes(hash))return 'movements';
   if(['inventory-pane-items','inventoryRows','inventoryTitle','inventoryCount'].includes(hash))return 'items';
   return '';
  };
  const initial=fromHash();
  if(initial)show(initial);
  else if(new URLSearchParams(location.search).has('page'))show('movements');
  nav.addEventListener('shown.bs.tab',event=>{
   const group=String(event.target.id||'').replace('inventory-tab-','');
   if(!['items','movements'].includes(group))return;
   const target='#inventory-pane-'+group;
   if(location.hash!==target)history.replaceState(null,'',location.pathname+location.search+target);
  });
  window.addEventListener('hashchange',()=>{const group=fromHash();if(group)show(group);});
  document.querySelectorAll('[data-inventory-preset]').forEach(button=>button.addEventListener('click',()=>{
   const filter=document.getElementById('inventoryFilter');
   const search=document.getElementById('inventorySearch');
   if(!filter||!search)return;
   filter.value=button.dataset.inventoryPreset;
   search.value='';
   filter.dispatchEvent(new Event('change',{bubbles:true}));
   show('items');
   nav.scrollIntoView({block:'start',behavior:'auto'});
  }));
  const count=document.getElementById('inventoryCount');
  const rows=[...document.querySelectorAll('#inventoryRows tr')];
  const refreshCount=()=>{if(count)count.textContent=rows.filter(row=>!row.hidden).length+' من أصل '+rows.length+' مواد';};
  for(const id of ['inventorySearch','inventoryFilter']){
   const field=document.getElementById(id);
   if(field){field.addEventListener('input',refreshCount);field.addEventListener('change',refreshCount);}
  }
  refreshCount();
 };
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();

/* Clinic invoices: tabs only change presentation; preserve #invoiceDrafts, #invoice-editor-ID and #invoiceID redirects. */
(() => {
 'use strict';
 const init=()=>{
  const nav=document.getElementById('clinicInvoiceTabs');
  if(!nav||!window.bootstrap?.Tab)return;
  const showGroup=(group)=>{
   const btn=document.getElementById('clinic-invoice-tab-'+group);
   if(btn)window.bootstrap.Tab.getOrCreateInstance(btn).show();
  };
  const openHash=()=>{
   const raw=window.location.hash.slice(1);let hash=raw;
   try{hash=decodeURIComponent(raw);}catch{}
   if(!hash)return;
   const issue=hash==='invoiceDrafts'||hash==='clinic-invoice-pane-issue'||/^invoice-editor-\d+$/.test(hash)||/^reviewVisit\d+$/.test(hash);
   const listing=hash==='clinic-invoice-pane-list'||/^invoice\d+$/.test(hash);
   if(!issue&&!listing)return;
   const group=issue?'issue':'list';
   const tab=document.getElementById('clinic-invoice-tab-'+group);
   const reveal=()=>{
    if(/^invoice\d+$/.test(hash)||/^reviewVisit\d+$/.test(hash)){
     const el=document.getElementById(hash);
     if(el)window.bootstrap.Collapse?.getOrCreateInstance(el,{toggle:false}).show();
    }else if(/^invoice-editor-\d+$/.test(hash)){
     const editor=document.getElementById(hash);
     const collapse=editor?.querySelector('.accordion-collapse');
     if(collapse)window.bootstrap.Collapse?.getOrCreateInstance(collapse,{toggle:false}).show();
    }
    const focus=document.getElementById(hash);
    if(focus)requestAnimationFrame(()=>focus.scrollIntoView({block:'start',behavior:'smooth'}));
   };
   if(tab?.classList.contains('active'))reveal();
   else if(tab){tab.addEventListener('shown.bs.tab',reveal,{once:true});showGroup(group);}
  };
  document.querySelectorAll('[data-clinic-invoice-open]').forEach(link=>link.addEventListener('click',()=>{
   showGroup(link.dataset.clinicInvoiceOpen);
  }));
  window.addEventListener('hashchange',openHash);
  openHash();
 };
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
