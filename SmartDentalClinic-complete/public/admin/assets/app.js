/* تفاعلات العرض الخاصة بدور: الإدارة.
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
      if (control.matches('[data-ui-open]')) {
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
  q('#catalogServiceId')?.addEventListener('change',e=>{
   const box=q('[data-new-service]'),n=q('#newCatalogServiceName');const yes=e.target.value==='__new__';box.hidden=!yes;n.disabled=!yes;n.required=yes;
  });
  q('[data-existing-doctor]')?.addEventListener('change',e=>{
   const o=e.target.selectedOptions[0];[['clinicDoctorName','name'],['clinicDoctorLicense','license'],['clinicDoctorEmail','email'],['clinicDoctorPhone','phone'],['clinicDoctorSpecialty','specialty']].forEach(([id,key])=>{const n=q('#'+id);if(n)n.value=o.dataset[key]||'';});
  });
  q('#existingStaffAccount')?.addEventListener('change',e=>{
   const o=e.target.selectedOptions[0];[['staffFormName','name'],['staffFormEmail','email'],['staffFormPhone','phone']].forEach(([id,key])=>{q('#'+id).value=o.dataset[key]||'';});
  });
  q('#applyRoleTemplate')?.addEventListener('click',()=>{
   const selected=q('#staffFormRole')?.selectedOptions[0];const values=(selected?.dataset.templatePermissions||'').split(',');
   qa('.staff-permissions-grid input[type="checkbox"]').forEach(e=>e.checked=values.includes(e.value));
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
  // Internal filters operate on existing demo rows, without inventing records.
  [['#invoiceSearch','.invoice-filter-item'],['#jobSearch','.job-filter-item'],['#patientSearch','.patient-filter-item']].forEach(([inputSel,rowSel])=>{
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
  // Permission attributes are rendering/integration hooks; server authorization is mandatory.
  qa('[data-requires-permission]').forEach(e=>{if(!e.dataset.clinicId)e.dataset.clinicId='C-008';});
 };
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();

/* Settlement details show the selected row and its server-rendered payments. */
(()=>{document.addEventListener('click',e=>{const b=e.target.closest('[data-finance-details]');if(!b)return;const row=b.closest('[data-finance-row]');if(!row)return;const set=(id,text)=>{const n=document.getElementById(id);if(n)n.textContent=text;};set('financeDetailClinic',row.querySelector('[data-label="العيادة"]').textContent);set('financeDetailPeriod',row.querySelector('[data-label="الفترة"]').textContent);set('financeDetailDue',row.dataset.due+' ₪');set('financeDetailReceived',row.dataset.received+' ₪');set('financeDetailRemaining',(Number(row.dataset.due)-Number(row.dataset.received))+' ₪');set('financeDetailSettlementCode',row.dataset.settlementCode);const body=document.getElementById('financePaymentsBody');body.replaceChildren();const records=(b.dataset.payments||'').split(';').filter(Boolean);if(!records.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=4;td.textContent='لا توجد دفعات مسجلة لهذه التسوية.';tr.append(td);body.append(tr);}else records.forEach(record=>{const tr=document.createElement('tr');record.split('|').forEach(value=>{const td=document.createElement('td');td.textContent=value;tr.append(td);});body.append(tr);});});})();

/* Audit history modal: UI only. All records are rendered by EJS on the server. */
(() => {
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-audit-detail]');
    if (!button || !window.bootstrap) return;
    const template = document.getElementById(button.dataset.auditDetail);
    const slot = document.getElementById('viewBody');
    const modal = document.getElementById('viewModal');
    if (!template || !slot || !modal) return;
    slot.replaceChildren(template.content.cloneNode(true));
    bootstrap.Modal.getOrCreateInstance(modal).show();
  });
})();

/* UI only: after a session action, open the existing Security tab. */
(()=>{
  const reveal=()=>{
    if(window.location.hash!=='#sdc-sessions')return;
    const tab=document.getElementById('settings-security-tab');
    if(tab&&window.bootstrap&&window.bootstrap.Tab){
      window.bootstrap.Tab.getOrCreateInstance(tab).show();
      document.getElementById('sdc-sessions')?.scrollIntoView({block:'start'});
    }
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',reveal);else reveal();
})();

// Client-only filtering of server-rendered clinic review cards.
document.addEventListener('input',event=>{
 if(event.target?.id!=='approvalSearch')return;
 const needle=event.target.value.trim().toLocaleLowerCase();
 document.querySelectorAll('[data-approval-card]').forEach(card=>{
  card.hidden=!(card.getAttribute('data-search')||'').toLocaleLowerCase().includes(needle);
 });
});

// v27.12 - filtering only; admin lab mutations are authenticated POST requests.
(()=>{const setup=()=>{const q=id=>document.getElementById(id);
 const search=q('adminLabSearch'),status=q('adminLabStatusFilter'),grid=q('adminLabsGrid');
 const apply=()=>{if(!grid)return;let shown=0;grid.querySelectorAll('[data-admin-lab-card]').forEach(card=>{
  const term=(search?.value||'').trim().toLocaleLowerCase();const state=status?.value||'all';
  const ok=(!term||(card.dataset.search||'').includes(term))&&(state==='all'||card.dataset.status===state);
  card.hidden=!ok;if(ok)shown++;
 });const empty=q('adminLabsEmpty');if(empty)empty.classList.toggle('d-none',shown>0);};
 search?.addEventListener('input',apply);status?.addEventListener('change',apply);
 const caseInput=q('adminLabCaseSearch'),caseBody=q('adminLabCasesBody');
 caseInput?.addEventListener('input',()=>{if(!caseBody)return;let count=0;const term=caseInput.value.trim().toLocaleLowerCase();
  caseBody.querySelectorAll('[data-admin-lab-case]').forEach(row=>{const ok=row.textContent.toLocaleLowerCase().includes(term);row.hidden=!ok;if(ok)count++;});
  q('adminLabCasesEmpty')?.classList.toggle('d-none',count>0);
 });
 };if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup);else setup();
})();

/* v27.14 — client-side filter only; never changes persisted doctor data. */
(() => { 'use strict';
 const ready=()=>{
  const search=document.getElementById('doctorSearch');if(!search)return;
  const license=document.getElementById('doctorLicenseFilter'),status=document.getElementById('doctorStatusFilter');
  const rows=[...document.querySelectorAll('[data-doctor-row]')],empty=document.getElementById('doctorEmpty');
  function filter(){
   const q=search.value.trim().toLocaleLowerCase('ar');let count=0;
   for(const row of rows){const show=(!q||row.dataset.search.toLocaleLowerCase('ar').includes(q))&&(!license.value||row.dataset.license===license.value)&&(!status.value||row.dataset.status===status.value);
    row.hidden=!show;if(show)count++;
   }
   if(empty)empty.classList.toggle('d-none',count!==0||rows.length===0);
  }
  [search,license,status].forEach(el=>el?.addEventListener(el===search?'input':'change',filter));
 };
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready);else ready();
})();

/* v27.16 — modal prefilling and filtering only; all catalog writes are protected SSR POSTs. */
(()=>{'use strict';
 const ready=()=>{
  const byId=id=>document.getElementById(id),q=(s,r=document)=>r.querySelector(s);
  const status=byId('specialtyStatus'),specSearch=byId('specialtySearch');
  const filterSpecialties=()=>{
   const term=(specSearch?.value||'').trim().toLocaleLowerCase(),state=status?.value||'';
   let visible=0;
   document.querySelectorAll('[data-specialty-row]').forEach(row=>{
    const show=(!term||(row.dataset.search||'').toLocaleLowerCase().includes(term))&&(!state||row.dataset.status===state);
    row.hidden=!show;if(show)visible++;
   });
   byId('specialtyEmpty')?.classList.toggle('d-none',visible>0);
  };
  specSearch?.addEventListener('input',filterSpecialties);status?.addEventListener('change',filterSpecialties);
  const specForm=byId('specialtyForm');
  if(specForm){
   document.querySelector('[data-catalog-specialty-new]')?.addEventListener('click',()=>{
    specForm.reset();specForm.action='/admin/specialties/create';byId('specialtyModalTitle').textContent='إضافة تخصص';

   });
   document.querySelectorAll('[data-catalog-specialty-edit]').forEach(button=>button.addEventListener('click',()=>{
    specForm.reset();specForm.action='/admin/specialties/'+encodeURIComponent(button.dataset.id)+'/update';
    byId('specialtyModalTitle').textContent='تعديل تخصص';byId('specialtyAr').value=button.dataset.ar;
    byId('specialtyEn').value=button.dataset.en;

   }));
  }
  const srvSearch=byId('catalogSearch');
  srvSearch?.addEventListener('input',()=>{
   const term=srvSearch.value.trim().toLocaleLowerCase();let visible=0;
   document.querySelectorAll('[data-catalog-service-row]').forEach(row=>{const show=(row.dataset.search||'').toLocaleLowerCase().includes(term);row.hidden=!show;if(show)visible++;});
   byId('catalogServicesEmpty')?.classList.toggle('d-none',visible>0);
  });
  const serviceForm=byId('catalogServiceForm');
  if(serviceForm){
   document.querySelector('[data-catalog-service-new]')?.addEventListener('click',()=>{
    serviceForm.reset();serviceForm.action='/admin/services/create';byId('catalogServiceModalTitle').textContent='إضافة خدمة للكتالوج';
   });
   document.querySelectorAll('[data-catalog-service-edit]').forEach(button=>button.addEventListener('click',()=>{
    serviceForm.reset();serviceForm.action='/admin/services/'+encodeURIComponent(button.dataset.id)+'/update';
    byId('catalogServiceName').value=button.dataset.name;byId('catalogServiceModalTitle').textContent='تعديل اسم الخدمة';
   }));
  }
  const sensitiveForm=byId('catalogSensitiveForm');
  if(sensitiveForm){
   document.querySelectorAll('[data-catalog-sensitive]').forEach(button=>button.addEventListener('click',()=>{
    sensitiveForm.reset();const slug=button.dataset.kind==='service'?'services':'specialties';
    sensitiveForm.action='/admin/'+slug+'/'+encodeURIComponent(button.dataset.id)+'/'+button.dataset.action;
    const labels={delete:'حذف'};
    byId('catalogSensitiveTitle').textContent=(labels[button.dataset.action]||'إجراء')+' '+(button.dataset.kind==='service'?'الخدمة':'التخصص');
    byId('catalogSensitiveName').textContent=button.dataset.name;
   }));
  }
 };
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready);else ready();
})();


/* v27.18: read-only per-clinic staff permission inspection & audit-note modal.
   No change of permissions/status is permitted from this Admin UI. */
(() => {
  'use strict';
  document.addEventListener('click', event => {
    const view = event.target.closest('[data-staff-readonly]');
    if (view) {
      const label=document.getElementById('staffPermissionsName');
      if(label)label.textContent=`${view.dataset.name || ''} — ${view.dataset.clinicName || ''}`;
      const unknown=document.getElementById('staffUnknownPermissions');
      if(unknown){
        const codes=view.dataset.unknownPermissions||'';
        unknown.hidden=!codes;
        unknown.textContent=codes?`رموز غير معروفة تحتاج مراجعة مدير العيادة: ${codes}`:'';
      }
      const granted=new Set((view.dataset.permissions||'').split(',').filter(Boolean));
      document.querySelectorAll('[data-staff-permission-code]').forEach(checkbox=>{
        checkbox.checked=granted.has(checkbox.dataset.staffPermissionCode);
      });
    }
    const note = event.target.closest('[data-staff-note]');
    if (note) {
      const form=document.getElementById('staffOversightForm');
      if(form)form.action=note.dataset.noteUrl;
      const label=document.getElementById('sensitiveActionSubtitle');
      if(label)label.textContent=`${note.dataset.name || ''} — ${note.dataset.clinicName || ''}`;
      const reason=document.getElementById('sensitiveActionReason');
      if(reason)reason.value='';
    }
  });
})();

/* v27.18.1 — honour existing dashboard shortcuts after grouping legacy forms.
   Navigation only; demo forms remain unbound and cannot persist changes. */
(() => {
  'use strict';
  const openLegacyShortcut = () => {
    const panel = document.getElementById('legacyAdminForms');
    if (!panel) return;
    const action = new URLSearchParams(window.location.search).get('action');
    if (!new Set(['patient','doctor','appointment','schedule','absence','license','job','clinic']).has(action)) return;
    panel.open = true;
    const control = [...panel.querySelectorAll('[data-admin-create]')].find(node => node.dataset.adminCreate === action);
    if (control) {
      control.classList.add('admin-shortcut-target');
      control.scrollIntoView({block:'center',behavior:'auto'});
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', openLegacyShortcut);
  else openLegacyShortcut();
})();
