/* تفاعلات العرض الخاصة بدور: المريض.
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
      if (control.matches('[data-ui-reveal]')) {
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

    // اقتراحات الأعراض في واجهة المساعد الأصلية: تملأ الحقل فقط دون إنشاء بيانات وهمية.
    document.addEventListener('click', (event) => {
      const chip = event.target.closest('[data-fill-symptom]');
      if (!chip) return;
      const textarea = find('#patientSymptoms');
      if (textarea) { textarea.value = chip.getAttribute('data-fill-symptom') || ''; textarea.focus(); }
    });

    // The patient explicitly opts in to approximate distance sorting. Coordinates
    // travel only to our own backend, never to the AI provider.
    const aiLocationButton = find('#aiUseLocation');
    if (aiLocationButton) aiLocationButton.addEventListener('click', () => {
      const status = find('#aiLocationStatus'), lat = find('#aiLatitude'), lng = find('#aiLongitude');
      if (!navigator.geolocation) { if (status) status.textContent = 'المتصفح لا يدعم تحديد الموقع.'; return; }
      if (status) status.textContent = 'جارٍ طلب إذن مشاركة الموقع...';
      navigator.geolocation.getCurrentPosition(position => {
        if (lat && lng) { lat.value = position.coords.latitude.toFixed(6); lng.value = position.coords.longitude.toFixed(6); }
        if (status) status.textContent = 'تم تحديد موقع تقريبي لترتيب العيادات. يمكنك متابعة التقييم.';
      }, () => { if (status) status.textContent = 'تعذّر تحديد الموقع؛ يمكنك متابعة التقييم بدونه.'; },
      { enableHighAccuracy: false, timeout: 9000, maximumAge: 60000 });
    });

    document.addEventListener('change', (event) => {
      const control = event.target;
      // تغيير أداة غير مربوطة بالخادم يعرض التنبيه فقط.
      if (control.matches('[data-ui-unbound-control]')) showPendingNotice();
    });

    // إظهار أطباء العيادة المختارة في نموذج الحجز فقط؛ البيانات تبقى في EJS.
    const bookingClinic = find('#bookingClinicSelect');
    const bookingDoctor = find('#bookingDoctorSelect');
    if (bookingClinic && bookingDoctor) {
      const updateVisibleDoctors = () => {
        [...bookingDoctor.options].forEach((option) => {
          if (!option.value) return;
          const belongs = option.dataset.clinicId === bookingClinic.value;
          option.hidden = !belongs;
          option.disabled = !belongs;
        });
        const choice = bookingDoctor.selectedOptions[0];
        if (choice?.value && choice.disabled) bookingDoctor.value = '';
      };
      bookingClinic.addEventListener('change', () => {
        bookingDoctor.value = '';
        updateVisibleDoctors();
      });
      updateVisibleDoctors();
    }

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

/* Directory UI only: cards originate from SSR/PostgreSQL, no demo records. */
(() => {
  'use strict';
  const boot=()=>{
    const $=(s)=>document.querySelector(s);
    const $$=(s)=>[...document.querySelectorAll(s)];
    const text=(n)=>String(n||'').toLocaleLowerCase('ar').trim();
    const clinics=$('#clinicsGrid');
    if(clinics){
      const cards=$$('.clinic-filter-item');
      const count=$('#clinicResultCount');
      const q=$('#clinicSearch'),service=$('#clinicServiceFilter'),state=$('#clinicStatusFilter'),city=$('#manualCityLocation'),sort=$('#clinicSort');
      const radians=x=>x*Math.PI/180;
      let location=null;
      const haversine=(a,b,lat,lon)=>{const r=6371,dl=radians(lat-a),doLon=radians(lon-b),x=Math.sin(dl/2)**2+Math.cos(radians(a))*Math.cos(radians(lat))*Math.sin(doLon/2)**2;return 2*r*Math.asin(Math.min(1,Math.sqrt(x)));};
      const refresh=()=>{
        let visible=0;
        for(const card of cards){
          const serviceIds=String(card.dataset.serviceIds||'').split(',');
          const found=(!text(q?.value)||text(card.dataset.name+' '+card.dataset.location).includes(text(q?.value))) && (!state||state.value==='all'||state.value===card.dataset.status) &&(!service||service.value==='all'||serviceIds.includes(service.value)) &&(!city||!city.value||text(card.dataset.location).includes(text(city.value)));
          card.classList.toggle('d-none',!found);
          visible+=Number(found);
          if(location){
            const lat=Number(card.dataset.lat),lon=Number(card.dataset.lng);
            if(Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180){
              const km=haversine(location.lat,location.lon,lat,lon);card.dataset.distance=String(km);
              const target=card.querySelector('[data-real-distance]');if(target)target.textContent=km.toFixed(1)+' كم تقريبًا';
            }
          }
        }
        if(sort?.value==='distance'&&location){cards.slice().sort((a,b)=>Number(a.dataset.distance||Infinity)-Number(b.dataset.distance||Infinity)).forEach(c=>clinics.appendChild(c));}
        if(count)count.textContent='عرض '+visible+' عيادة من أصل '+cards.length;
        $('#clinicEmptyState')?.classList.toggle('d-none',visible!==0);
      };
      [q,service,state,city,sort].forEach(el=>el?.addEventListener(el===q?'input':'change',refresh));
      $('#clearClinicFilters')?.addEventListener('click',()=>{if(q)q.value='';if(service)service.value='all';if(state)state.value='all';if(city)city.value='';if(sort)sort.value='name';refresh();});
      $('#useClinicLocation')?.addEventListener('click',()=>{
        const status=$('#clinicLocationStatus');
        if(!navigator.geolocation){if(status)status.textContent='المتصفح لا يدعم مشاركة الموقع.';return;}
        navigator.geolocation.getCurrentPosition(position=>{location={lat:position.coords.latitude,lon:position.coords.longitude};if(status)status.textContent='تم حساب المسافات التقريبية من موقعك المسموح به.';if(sort)sort.value='distance';refresh();},()=>{if(status)status.textContent='تعذّر الوصول إلى الموقع. يمكن متابعة البحث بدون مشاركة الموقع.';},{enableHighAccuracy:false,timeout:12000,maximumAge:120000});
      });
      refresh();
    }
    const doctors=$('#doctorsGrid');
    if(doctors){
      const cards=$$('.doctor-filter-item'),q=$('#doctorSearch'),specialty=$('#doctorSpecialtyFilter'),clinic=$('#doctorClinicFilter'),availability=$('#doctorAvailabilityFilter'),count=$('#doctorResultCount');
      const refresh=()=>{let visible=0;for(const card of cards){const yes=(!text(q?.value)||text(card.dataset.name+' '+card.dataset.specialty+' '+card.dataset.clinicName).includes(text(q.value)))&&(!text(specialty?.value)||text(card.dataset.specialty).includes(text(specialty.value)))&&(!clinic||clinic.value==='all'||clinic.value===card.dataset.clinic)&&(!availability||availability.value==='all'||availability.value===card.dataset.availability);card.classList.toggle('d-none',!yes);visible+=Number(yes);}if(count)count.textContent='عرض '+visible+' طبيب/ارتباط بعيادة';$('#doctorEmptyState')?.classList.toggle('d-none',visible!==0);};
      [q,specialty,clinic,availability].forEach(el=>el?.addEventListener(el===q||el===specialty?'input':'change',refresh));
      $('#clearDoctorFilters')?.addEventListener('click',()=>{if(q)q.value='';if(specialty)specialty.value='';if(clinic)clinic.value='all';if(availability)availability.value='all';refresh();});refresh();
    }
    const appointmentItems=$$('.appointment-filter-item');
    if($('#appointmentsList')){
      const search=$('#appointmentSearch'),buttons=$$('[data-appointment-filter]'),count=$('#appointmentResultCount');
      const pagination=$('#appointmentPagination'),pageButtons=$('#appointmentPageButtons');
      let filter='all',page=1;
      const showPage=(matches)=>{
        const pageSize=10,pages=Math.max(1,Math.ceil(matches.length/pageSize));page=Math.max(1,Math.min(page,pages));
        appointmentItems.forEach(card=>card.classList.add('d-none'));
        matches.slice((page-1)*pageSize,page*pageSize).forEach(card=>card.classList.remove('d-none'));
        if(count)count.textContent=matches.length?'عرض '+((page-1)*pageSize+1)+'–'+Math.min(page*pageSize,matches.length)+' من '+matches.length+' موعد':'لا توجد مواعيد مطابقة';
        $('#appointmentEmptyState')?.classList.toggle('d-none',matches.length!==0||appointmentItems.length===0);
        if(pagination)pagination.classList.toggle('d-none',matches.length<=pageSize);
        if(!pageButtons)return;
        pageButtons.replaceChildren();
        const add=(label,target,active,disabled=false)=>{
          const b=document.createElement('button');b.type='button';b.className='btn btn-sm '+(active?'btn-primary':'btn-outline-secondary');b.textContent=label;b.disabled=disabled;
          if(active)b.setAttribute('aria-current','page');b.addEventListener('click',()=>{page=target;refresh(false);pagination?.scrollIntoView({block:'nearest',behavior:'smooth'});});pageButtons.append(b);
        };
        add('السابق',page-1,false,page===1);
        for(let n=1;n<=pages;n++){if(pages>9&&n!==1&&n!==pages&&Math.abs(n-page)>2)continue;add(String(n),n,n===page);}
        add('التالي',page+1,false,page===pages);
      };
      const refresh=(reset=true)=>{
        if(reset)page=1;
        const matches=appointmentItems.filter(card=>{const status=card.dataset.status||'';
          const match=filter==='all'||filter===status||(filter==='closed'&&['cancelled','rejected'].includes(status))||(filter==='reschedule'&&card.dataset.changeRequest==='true');
          return match&&(!text(search?.value)||text(card.dataset.search).includes(text(search.value)));
        });showPage(matches);
      };
      search?.addEventListener('input',()=>refresh());buttons.forEach(b=>b.addEventListener('click',()=>{
        filter=b.dataset.appointmentFilter;buttons.forEach(x=>{x.classList.toggle('active',x===b);x.classList.toggle('btn-primary',x===b);x.classList.toggle('btn-light',x!==b);x.setAttribute('aria-pressed',String(x===b));});refresh();
      }));refresh();
    }
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();


/* تنظيم صفحات المريض: فلترة فواتير محلية وترقيم، وتنقل أقسام الملف الشخصي. */
(() => {
  'use strict';
  const ready=()=>{
    const root=document.getElementById('invoiceAccordion');
    if(root){
      const items=[...root.querySelectorAll('.patient-invoice-item')],query=document.getElementById('patientInvoiceSearch'),filterButtons=[...document.querySelectorAll('[data-patient-invoice-filter]')],count=document.getElementById('patientInvoiceCount'),empty=document.getElementById('patientInvoiceEmptyState'),nav=document.getElementById('patientInvoicePagination'),buttons=document.getElementById('patientInvoicePageButtons');
      let filter='all',page=1;
      const normalize=v=>String(v||'').toLocaleLowerCase('ar').trim();
      const refresh=(reset=true)=>{
        if(reset)page=1;
        const q=normalize(query?.value),matches=items.filter(el=>(filter==='all'||el.dataset.invoiceStatus===filter)&&(!q||normalize(el.dataset.invoiceSearch).includes(q)));
        const pages=Math.max(1,Math.ceil(matches.length/10));page=Math.min(page,pages);
        items.forEach(el=>el.classList.add('d-none'));
        matches.slice((page-1)*10,page*10).forEach(el=>el.classList.remove('d-none'));
        if(count)count.textContent=matches.length?`عرض ${(page-1)*10+1}–${Math.min(page*10,matches.length)} من ${matches.length} فاتورة`:'لا توجد فواتير مطابقة';
        empty?.classList.toggle('d-none',matches.length!==0||items.length===0);nav?.classList.toggle('d-none',matches.length<=10);
        if(!buttons)return;buttons.replaceChildren();
        const add=(title,target,active,disabled=false)=>{const b=document.createElement('button');b.type='button';b.textContent=title;b.className='btn btn-sm '+(active?'btn-primary':'btn-outline-secondary');b.disabled=disabled;if(active)b.setAttribute('aria-current','page');b.addEventListener('click',()=>{page=target;refresh(false);nav?.scrollIntoView({block:'nearest',behavior:'smooth'});});buttons.append(b);};
        add('السابق',page-1,false,page===1);for(let i=1;i<=pages;i++){if(pages>9&&i!==1&&i!==pages&&Math.abs(i-page)>2)continue;add(String(i),i,i===page);}add('التالي',page+1,false,page===pages);
      };
      query?.addEventListener('input',()=>refresh());filterButtons.forEach(b=>b.addEventListener('click',()=>{filter=b.dataset.patientInvoiceFilter;filterButtons.forEach(other=>{const active=other===b;other.classList.toggle('active',active);other.classList.toggle('btn-primary',active);other.classList.toggle('btn-outline-secondary',!active);other.setAttribute('aria-pressed',String(active));});refresh();}));refresh();
      // Keep direct links to invoice details working when a page has more than ten invoices.
      const hash=decodeURIComponent(window.location.hash||'').slice(1);if(hash&&hash.startsWith('inv-')){
        const target=document.getElementById(hash),item=target?.closest('.patient-invoice-item');if(item){filter='all';query.value='';page=Math.max(1,Math.ceil((items.indexOf(item)+1)/10));refresh(false);if(window.bootstrap&&target)window.bootstrap.Collapse.getOrCreateInstance(target,{toggle:false}).show();}
      }
    }
    const tabs=[...document.querySelectorAll('.patient-profile-tabs [data-patient-profile-jump]')];
    if(tabs.length&&window.bootstrap){
      const select=(id)=>{const panel=document.getElementById(id);if(!panel)return;
        window.bootstrap.Collapse.getOrCreateInstance(panel,{toggle:false}).show();
        tabs.forEach(b=>{const active=b.dataset.patientProfileJump===id;b.classList.toggle('is-active',active);b.setAttribute('aria-pressed',String(active));});
      };
      tabs.forEach(btn=>btn.addEventListener('click',()=>select(btn.dataset.patientProfileJump)));
      const choose=location.hash==='#sdc-password'||document.querySelector('#sdc-password .alert-danger')?'passwordSection':document.querySelector('.patient-page-profile .alert-success')?.textContent.includes('الصحية')?'healthSection':'accountInfo';
      select(choose);
      ['accountInfo','healthSection','passwordSection'].forEach(id=>document.getElementById(id)?.addEventListener('shown.bs.collapse',()=>{tabs.forEach(b=>{const active=b.dataset.patientProfileJump===id;b.classList.toggle('is-active',active);b.setAttribute('aria-pressed',String(active));});}));
    }
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready);else ready();
})();

/* Patient AI chat: progressive enhancement. With JavaScript disabled, the same
 * form posts to the existing SSR routes. No medical content is stored in the browser. */
(() => {
  'use strict';
  function initializeAiChat() {
    const form=document.getElementById('aiSymptomsForm')||document.getElementById('aiContinuationForm');
    if(!form)return;
    const thread=document.getElementById('chatBody');
    const textarea=document.getElementById('patientSymptoms');
    const submit=document.getElementById('aiSendButton');
    const chips=document.getElementById('aiQuickChips');
    const consent=document.getElementById('aiConsentRow');
    const errorBox=document.getElementById('aiErrorBanner');
    const isEnglish=document.documentElement.lang==='en';
    const copy={
      ar:{user:'أنت',assistant:'المساعد الذكي',invalid:'يرجى إدخال وصف لا يقل عن 10 أحرف.',invalidAnswer:'اكتب إجابتك أولًا.',failed:'تعذّر إرسال الرسالة. تحقق من الاتصال وحاول مرة أخرى.',csrf:'انتهت صلاحية الجلسة؛ حدّث الصفحة ثم أعد المحاولة.',rate_limit:'عدد المحاولات كبير خلال دقيقة، حاول بعد قليل.',provider:'تعذّر الحصول على رد من خدمة الذكاء الاصطناعي حاليًا.',not_configured:'خدمة الذكاء الاصطناعي غير مهيأة بعد.',forbidden:'غير مسموح بإكمال هذا التقييم.',invalidServer:'تحقق من وصف الأعراض والإجابة.',other:'تعذّر إكمال التقييم. حاول مجددًا.',placeholder:'اكتب إجابتك هنا...',consent:'يرجى الموافقة على معالجة الأعراض أولًا.',done:'اكتمل التقييم ويمكنك متابعة المحادثة',restart:'بدء محادثة جديدة',continuePlaceholder:'اسألني عن التقييم أو احكيلي تفاصيل إضافية...',reassessment:'تعذّر تحديث التقييم مؤقتًا، ولا يمكن استخدام اقتراحات الحجز القديمة حتى ينجح التحديث.'},
      en:{user:'You',assistant:'Dental assistant',invalid:'Please describe your symptoms in at least 10 characters.',invalidAnswer:'Please answer the question first.',failed:'Could not send the message. Check your connection and try again.',csrf:'Your session has expired. Refresh the page and retry.',rate_limit:'Too many requests in one minute. Please try again shortly.',provider:'The AI service is unavailable right now.',not_configured:'The AI service has not been configured yet.',forbidden:'This assessment cannot be completed.',invalidServer:'Check your symptom description and answer.',other:'Could not complete the assessment. Please try again.',placeholder:'Write your answer here...',consent:'Please agree to symptom processing first.',done:'Assessment complete; you can keep chatting',restart:'Start new conversation',continuePlaceholder:'Ask about your assessment or share more details...',reassessment:'The assessment update is pending. Older appointment suggestions are paused until it succeeds.'}
    }[isEnglish?'en':'ar'];
    let pending=false;
    let isFollowup=form.dataset.aiFollowup==='1';
    function scrollToEnd(){thread.scrollTop=thread.scrollHeight;}
    function hideError(){errorBox?.classList.add('d-none');}
    function showError(message){
      if(errorBox){errorBox.querySelector('span').textContent=message;errorBox.classList.remove('d-none');}
    }
    function adjustHeight(){textarea.style.height='auto';textarea.style.height=Math.min(textarea.scrollHeight,145)+'px';}
    function addMessage(message,who){
      const line=document.createElement('div');line.className='ai-chat-line ai-chat-line--'+who;
      if(who==='assistant'){
        const avatar=document.createElement('div');avatar.className='ai-chat-avatar';avatar.setAttribute('aria-hidden','true');
        const icon=document.createElement('i');icon.className='bi bi-stars';avatar.append(icon);line.append(avatar);
      }
      const wrap=document.createElement('div');wrap.className='ai-chat-message-wrap';
      const label=document.createElement('span');label.className='ai-chat-sender';label.textContent=who==='user'?copy.user:copy.assistant;
      const bubble=document.createElement('div');bubble.className='ai-chat-bubble ai-chat-bubble--'+who;
      bubble.textContent=message;
      if(who==='user')bubble.setAttribute('translate','no');
      wrap.append(label,bubble);line.append(wrap);thread.append(line);scrollToEnd();
      return line;
    }
    function setBusy(yes){pending=yes;submit.disabled=yes;textarea.readOnly=yes;form.setAttribute('aria-busy',String(yes));}
    function setFollowup(question,original){
      isFollowup=true;form.dataset.aiFollowup='1';
      const hidden=(name,value)=>{let element=form.querySelector('input[type="hidden"][name="'+name+'"]');if(!element){element=document.createElement('input');element.type='hidden';element.name=name;form.append(element);}element.value=value;};
      hidden('symptoms',original);hidden('followup_question',question);hidden('ai_consent','1');
      textarea.name='followup_answer';textarea.maxLength=500;textarea.minLength=0;textarea.placeholder=copy.placeholder;
      textarea.value='';
      if(consent){consent.hidden=true;const check=consent.querySelector('input');if(check){check.required=false;check.disabled=true;}}
      if(chips)chips.hidden=true;
      adjustHeight();textarea.focus();
    }
    // Post-assessment chat uses the same saved assessment and persists messages.
    // It never silently modifies previously suggested services or appointments.
    function attachContinuation(nextForm){
      const nextText=nextForm.querySelector('textarea[name="message"]');
      const nextSend=nextForm.querySelector('button[type="submit"]');
      if(!nextText||!nextSend)return;
      function resize(){nextText.style.height='auto';nextText.style.height=Math.min(nextText.scrollHeight,145)+'px';}
      nextText.addEventListener('input',resize);
      nextText.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();if(!nextSend.disabled)nextForm.requestSubmit();}});
      resize();
      const locationBtn=nextForm.querySelector('#aiContinueUseLocation');
      locationBtn?.addEventListener('click',()=>{
        const status=nextForm.querySelector('#aiContinueLocationStatus');
        if(!navigator.geolocation){if(status)status.textContent=isEnglish?'Location not supported.':'الموقع غير مدعوم.';return;}
        if(status)status.textContent=isEnglish?'Requesting permission...':'بانتظار موافقتك...';
        navigator.geolocation.getCurrentPosition(pos=>{
          nextForm.querySelector('#aiContinueLatitude').value=String(pos.coords.latitude.toFixed(7));
          nextForm.querySelector('#aiContinueLongitude').value=String(pos.coords.longitude.toFixed(7));
          if(status)status.textContent=isEnglish?'Location will be used only for this request.':'سيُستخدم الموقع في هذا الطلب فقط.';
        },()=>{if(status)status.textContent=isEnglish?'No location shared.':'لم تتم مشاركة الموقع.';},{timeout:12000,enableHighAccuracy:false});
      });
      nextForm.addEventListener('submit',async event=>{
        if(!window.fetch)return;
        event.preventDefault();if(nextSend.disabled)return;
        const message=nextText.value.trim();
        if(message.length<2){showError(isEnglish?'Please write at least two characters.':'اكتب رسالة من حرفين على الأقل.');nextText.focus();return;}
        hideError();
        const data=new URLSearchParams(new FormData(nextForm));
        nextText.value='';resize();nextText.readOnly=true;nextSend.disabled=true;nextForm.setAttribute('aria-busy','true');
        const mine=addMessage(message,'user');
        const wait=addMessage('•••','assistant');const bubble=wait.querySelector('.ai-chat-bubble');bubble.textContent='';bubble.classList.add('ai-chat-typing');for(let n=0;n<3;n++)bubble.append(document.createElement('span'));
        try{
          const res=await fetch(nextForm.action,{method:'POST',headers:{Accept:'application/json','Content-Type':'application/x-www-form-urlencoded; charset=UTF-8'},credentials:'same-origin',body:data.toString()});
          let payload;try{payload=await res.json();}catch(_e){throw new Error(res.status===403?'csrf':'failed');}
          if(!res.ok||payload.status!=='ok'||typeof payload.reply!=='string')throw new Error(payload?.error||'failed');
          wait.remove();addMessage(payload.reply,'assistant');
          if(payload.updated){
            // New clinical data: re-render the revised assessment and verified offers.
            location.assign('/patient/ai-diagnosis?id='+encodeURIComponent(nextForm.querySelector('[name="assessment_id"]').value));
            return;
          }
          if(payload.needsReassessment){
            const warning=document.getElementById('aiReassessmentNotice');if(warning)warning.classList.remove('d-none');
            document.querySelectorAll('#aiFinalResponse form[action="/patient/ai-diagnosis/book"]').forEach(bookingForm=>{
              const disabled=document.createElement('button');disabled.type='button';disabled.disabled=true;disabled.className='btn btn-outline-secondary ai-chat-book-btn';disabled.textContent=isEnglish?'Suggestions temporarily paused':'التوصيات متوقفة مؤقتًا';bookingForm.replaceWith(disabled);
            });
            if(!warning)showError(copy.reassessment);
          }
        }catch(error){
          wait.remove();mine.remove();nextText.value=message;resize();
          const errors={csrf:copy.csrf,rate_limit:copy.rate_limit,provider:copy.provider,not_configured:copy.not_configured,forbidden:copy.forbidden,invalid:copy.invalidServer};
          showError(errors[error.message]||copy.failed);nextText.focus();
        }finally{nextText.readOnly=false;nextSend.disabled=false;nextForm.setAttribute('aria-busy','false');}
      });
    }
    function finish(url,html){
      const doc=new DOMParser().parseFromString(html,'text/html');
      const card=doc.getElementById('aiFinalResponse');
      const next=doc.getElementById('aiContinuationForm');
      if(!card||!next){location.assign(url);return;}
      thread.append(document.importNode(card,true));
      const composer=document.importNode(next,true);
      form.replaceWith(composer);
      attachContinuation(composer);
      try{history.replaceState(null,'',url);}catch(_ignored){}
      scrollToEnd();
      composer.querySelector('textarea')?.focus();
    }
    if(form.id==='aiContinuationForm'){
      attachContinuation(form);
      scrollToEnd();
      return;
    }
    textarea?.addEventListener('input',adjustHeight);
    textarea?.addEventListener('keydown',event=>{
      if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();if(!pending)form.requestSubmit();}
    });
    adjustHeight();scrollToEnd();
    form.addEventListener('submit',async event=>{
      if(!window.fetch||!window.DOMParser)return;
      event.preventDefault();
      if(pending)return;
      const message=textarea.value.trim();
      if((!isFollowup&&message.length<10)||!message){showError(isFollowup?copy.invalidAnswer:copy.invalid);textarea.focus();return;}
      if(!isFollowup&&(!document.getElementById('aiPrivacyConsent')?.checked)){
        showError(copy.consent);document.getElementById('aiPrivacyConsent')?.focus();return;
      }
      hideError();
      const symptomOriginal=isFollowup?form.querySelector('input[name="symptoms"]')?.value||'':message;
      const data=new URLSearchParams(new FormData(form));
      const mine=addMessage(message,'user');
      textarea.value='';adjustHeight();setBusy(true);
      const waiting=addMessage('•••','assistant');
      const bubble=waiting.querySelector('.ai-chat-bubble');
      bubble.textContent='';bubble.classList.add('ai-chat-typing');
      for(let n=0;n<3;n++)bubble.append(document.createElement('span'));
      try{
        const response=await fetch(form.action,{method:'POST',headers:{'Accept':'application/json','Content-Type':'application/x-www-form-urlencoded; charset=UTF-8'},credentials:'same-origin',body:data.toString()});
        let result;
        try{result=await response.json();}catch(_error){throw new Error(response.status===403?'csrf':'failed');}
        if(!response.ok||result.status==='error')throw new Error(result.error||'other');
        waiting.remove();
        if(result.status==='followup'&&typeof result.question==='string'&&result.question){addMessage(result.question,'assistant');setFollowup(result.question,symptomOriginal);return;}
        if(result.status==='ok'&&typeof result.url==='string'&&result.url.startsWith('/patient/ai-diagnosis?id=')){
          const view=await fetch(result.url,{headers:{'Accept':'text/html'},credentials:'same-origin'});
          if(!view.ok){location.assign(result.url);return;}
          finish(result.url,await view.text());return;
        }
        throw new Error('other');
      }catch(error){
        waiting.remove();mine.remove();textarea.value=message;adjustHeight();
        const key=error.message;
        const labels={csrf:copy.csrf,rate_limit:copy.rate_limit,provider:copy.provider,not_configured:copy.not_configured,forbidden:copy.forbidden,invalid:copy.invalidServer};
        showError(labels[key]||copy.failed);
        textarea.focus();
      }finally{if(document.contains(form))setBusy(false);}
    });
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initializeAiChat);
  else initializeAiChat();
})();
