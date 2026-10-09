/* Smart Dental Clinic v1.2 — functional prototype contract.
 * This file models data shapes and transitions for later NestJS APIs.
 * It deliberately does NOT claim to persist demo data in PostgreSQL.
 */
(function () {
  'use strict';
  const currentPath = () => document.documentElement.dataset.sdcPath || location.pathname;
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));
  const html = (markup) => { const el = document.createElement('div'); el.innerHTML = markup.trim(); return el.firstElementChild; };
  const toast = (msg) => {
    if (window.AdminUI?.toast) return window.AdminUI.toast(msg);
    if (window.ClinicUI?.toast) return window.ClinicUI.toast(msg);
    const t=$('#appToast'); if(t && window.bootstrap) { const b=$('.toast-body',t); if(b)b.textContent=msg; bootstrap.Toast.getOrCreateInstance(t).show(); }
    else { const n=html('<div class="sdc-toast" role="status"></div>'); n.textContent=msg;document.body.append(n);setTimeout(()=>n.remove(),4300); }
  };
  const input=(label, key, type='text', value='',extra='')=>`<label class="sdc-field"><span>${label}</span><input class="form-control" data-field="${key}" type="${type}" value="${value}" ${extra}></label>`;
  const select=(label,key,values,selected)=>`<label class="sdc-field"><span>${label}</span><select class="form-select" data-field="${key}">${values.map(v=>{const a=Array.isArray(v)?v:[v,v];return `<option value="${a[0]}" ${a[0]===selected?'selected':''}>${a[1]}</option>`}).join('')}</select></label>`;
  const note=(s)=>`<p class="small text-secondary mb-2">${s}</p>`;
  const amount=(v)=>{const n=Number(v);return Number.isFinite(n)&&n>=0?n:0};
  const data=(root)=> Object.fromEntries($$('[data-field]',root).map(el=>[el.dataset.field,el.type==='checkbox'?el.checked:el.value]));
  const panelIcons = {
    sdcProcedure:'bi-clipboard2-pulse',sdcToothSurface:'bi-bullseye',sdcPrescriptionLifecycle:'bi-capsule',
    sdcReportAttachments:'bi-paperclip',sdcInvoice:'bi-receipt-cutoff',sdcLabCase:'bi-box-seam',
    sdcClinicExceptions:'bi-calendar2-week',sdcStaffInvitation:'bi-person-plus',sdcStaffPending:'bi-envelope-check',
    sdcMFA:'bi-shield-lock',
    sdcClinicFileVersions:'bi-file-earmark-check',sdcDoctorSpecialties:'bi-award',
    sdcDoctorInviteFlow:'bi-person-check',sdcReportImmutable:'bi-shield-check'
  };
  function panel(parent,id,title,description,markup,place='beforeend') {
    if(!parent)return null;
    const integrated=!!parent.closest('.clinical-card,.settings-section,.settings-card,.profile-section,.soft-card,.card,.modal-body');
    const iconName=Object.entries(panelIcons).find(([key])=>id.startsWith(key))?.[1]||'bi-grid';
    const el=html(`<section class="sdc-panel ${integrated?'sdc-panel--integrated':'sdc-panel--standalone'}" id="${id}" aria-label="${title}"><div class="sdc-panel-head"><span class="sdc-panel-icon" aria-hidden="true"><i class="bi ${iconName}"></i></span><div class="sdc-panel-head-copy"><h5>${title}</h5><p>${description}</p></div></div><div class="sdc-panel-body">${markup}</div></section>`);
    parent.insertAdjacentElement(place,el);
    return el;
  }
  function rows(parent,kind,renderer,initial=[{}]) {
    const list=html(`<div class="sdc-items" data-kind="${kind}"></div>`);parent.append(list);
    const renumber=()=>Array.from(list.children).forEach((el,i)=>{
      let tag=el.querySelector(':scope > .sdc-item-caption');
      if(!tag){tag=html('<div class="sdc-item-caption"><span class="sdc-item-number"></span><span class="sdc-item-count"></span></div>');el.prepend(tag);}
      tag.querySelector('.sdc-item-number').textContent=({'procedures':'إجراء','lab_order_items':'عمل مخبري'}[kind]||'بند')+' '+(i+1);
      tag.querySelector('.sdc-item-count').textContent=list.children.length===1?'عنصر واحد':`${list.children.length} عناصر`;
      const del=el.querySelector('[data-remove]');if(del){del.setAttribute('aria-label','إزالة '+tag.querySelector('.sdc-item-number').textContent);del.innerHTML='<i class="bi bi-trash3" aria-hidden="true"></i> <span>إزالة</span>';tag.append(del);}
    });
    const changed=()=>{renumber();list.dispatchEvent(new Event('change',{bubbles:true}));};
    function add(seed={}) {const el=html(renderer(seed));list.append(el);const del=el.querySelector('[data-remove]');if(del)del.onclick=()=>{if(list.children.length===1){toast('يلزم عنصر واحد على الأقل.');return;}el.remove();changed();};changed();return el;}
    initial.forEach(add);return {list,add,get:()=>Array.from(list.children).map(data)};
  }
  function visit() {
    if(!$('#doctorInvoiceCard'))return;
    // Every procedure maps to visit_procedures. Treatment-stage mapping is optional and server-validated.
    const procCard=$('#procedure');const procOld=$(':scope > .row.g-3',procCard);if(procOld)procOld.remove();
    const procedure=panel(procCard,'sdcProcedure','الإجراءات المسجلة','سجّل كل إجراء على حدة، وحدد السن والكمية والسعر والمرحلة العلاجية عند الحاجة.',`<div id="sdcProcedureItems"></div><button class="btn btn-outline-primary btn-sm mt-2" id="sdcAddProcedure" type="button"><i class="bi bi-plus-lg" aria-hidden="true"></i> إضافة إجراء آخر</button><div id="sdcProcedureTotal" class="small mt-2 fw-bold"></div>`);
    const services=[['فحص','فحص'],['تنظيف','تنظيف'],['حشوة','حشوة'],['علاج جذور','علاج جذور'],['خلع','خلع'],['تركيب تاج','تركيب تاج'],['جلسة تقويم','جلسة تقويم']];
    const procTemplate=(d={})=>`<div class="sdc-item"><div class="sdc-grid four">${select('الخدمة','work',services,d.work||'علاج جذور')}${input('السن','tooth','text',d.tooth||'46')}${input('الكمية','quantity','number',d.quantity||'1','min="0.01" step="0.01"')}${input('سعر الوحدة ₪','price','number',d.price||'500','min="0" step="0.01"')}</div><div class="sdc-grid three mt-2">${select('حالة الإجراء','status',[['completed','منفذ'],['in_progress','قيد التنفيذ'],['stopped','متوقف']],d.status||'completed')}${select('بند خطة العلاج','planItem',[['','غير مرتبط'],['plan-step-1','المرحلة 1 — فتح وتنظيف القنوات'],['plan-step-2','المرحلة 2 — حشو الجذور']],d.planItem||'')}${input('تفاصيل / ملاحظات','notes','text',d.notes||'')}</div><button type="button" class="btn btn-link text-danger btn-sm" data-remove>إزالة هذا الإجراء</button></div>`;
    const procs=rows($('#sdcProcedureItems'), 'procedures', procTemplate,[{work:'علاج جذور',tooth:'46',price:500,quantity:1,planItem:'plan-step-1'}]);
    $('#sdcAddProcedure').onclick=()=>procs.add({work:'حشوة',tooth:'',price:0,quantity:1});
    // Odontogram: explicit optional surface; old tooth selector remains operational.
    panel($('#odontogram'),'sdcToothSurface','تحديد سطح السن (اختياري)','يحفظ سطح السن منفصلاً عندما يكون الإجراء على جزء من السن، مع بقاء حالة السن الكاملة.',`<div class="sdc-grid three">${input('السن المختار','tooth','text','46','readonly')}${select('السطح','surface',[['','كامل السن'],['M','Mesial'],['D','Distal'],['O','Occlusal'],['B','Buccal'],['L','Lingual']], '')}${input('ملاحظة السطح','surfaceNote','text','')}</div>`);
    $$('.tooth[data-tooth]',$('#odontogram')).forEach(btn=>btn.addEventListener('click',()=>{const x=$('#sdcToothSurface [data-field="tooth"]');if(x)x.value=btn.dataset.tooth;}));
    // Prescription per-item route & instructions; separately-issued document state.
    const medicine=$('#medicationList');
    function addMedicineFields(item){if(!item||item.dataset.sdcEnriched)return;item.dataset.sdcEnriched='1';const row=$('.row',item);if(!row)return;const div=html(`<div class="col-12"><div class="sdc-grid two">${input('طريق الاستعمال (route)','route','text','فموي')}${input('تعليمات منفصلة لكل دواء','instructions','text','بعد الطعام')}</div></div>`);row.append(div);}
    $$('.dynamic-list-item',medicine).forEach(addMedicineFields);
    new MutationObserver(()=>$$('.dynamic-list-item',medicine).forEach(addMedicineFields)).observe(medicine,{childList:true});
    panel($('#prescription'),'sdcPrescriptionLifecycle','حالة الوصفة الطبية','يمكن إعداد الوصفة كمسودة قبل إصدارها. بعد الإصدار، تُحمى من التعديل غير الموثق.',`${select('حالة الوصفة المقصودة','prescriptionStatus',[['draft','مسودة'],['issued','إصدار الوصفة'],['voided','إبطال بسبب موثق']],'draft')}<div class="mt-2">${input('سبب الإبطال (عند الحاجة)','voidReason','text','')}</div><p class="small text-muted mt-2">الإصدار والإبطال يتطلبان صلاحية طبيب وتحقق خادم. هذا اختيار تخطيطي وليس إصداراً حقيقياً.</p>`);
    // Lab order header contains lab/date/note/files; work items are independent rows.
    const lab=$('#labFields'); if(lab){lab.innerHTML='';lab.insertAdjacentHTML('beforeend',`<div class="sdc-grid three">${select('المختبر','lab',[['elite','Elite Dental Lab — نابلس'],['smile','Smile Lab — رام الله'],['ortho','Ortho Lab — جنين']],'elite')}${input('التسليم المتوقع','due','date','2026-10-12')}${input('ملاحظات الطلب العامة','labNotes','text','')}</div><div class="mt-2">${input('مرفق طلب (اختياري)','labFile','file','')}</div><div class="sdc-subsection-title"><span><i class="bi bi-layers me-1"></i> الأعمال المطلوبة داخل الطلب</span><small>يمكن إضافة أكثر من عمل</small></div><div id="sdcLabItems"></div><button id="sdcAddLab" class="btn btn-outline-primary btn-sm mt-2" type="button"><i class="bi bi-plus-lg" aria-hidden="true"></i> إضافة عمل مخبري</button>${note('إرسال الطلب واستلامه يتمان على مستوى lab_orders. التركيب السريري يُسجل لكل عمل مخبري بشكل مستقل.')} `);
      const works=[['تاج Zirconia','تاج Zirconia'],['جسر','جسر'],['Veneer','Veneer'],['Retainer','Retainer'],['طقم','طقم'],['عمل آخر','عمل آخر']];
      const itemTemplate=d=>`<div class="sdc-item"><div class="sdc-grid four">${select('نوع العمل','work_type',works,d.work_type||'تاج Zirconia')}${input('السن','tooth_code','text',d.tooth_code||'46')}${input('المنطقة / مجموعة الأسنان','area_text','text',d.area_text||'')}${input('الكمية','quantity','number',d.quantity||1,'min="1" step="1"')}</div><div class="sdc-grid three mt-2">${input('المادة','material','text',d.material||'Zirconia')}${input('درجة اللون','shade','text',d.shade||'A2')}${input('تعليمات العمل','instructions','text',d.instructions||'')}</div><button type="button" class="btn btn-link text-danger btn-sm" data-remove>إزالة العمل</button></div>`;
      const labItems=rows($('#sdcLabItems'),'lab_order_items',itemTemplate,[{tooth_code:'46',material:'Zirconia',shade:'A2'}]);
      $('#sdcAddLab').onclick=()=>labItems.add({tooth_code:'',material:'',shade:''});
      window.SDCV12LabItems=labItems;
    }
    // Report: links visit_files before approval into immutable medical_report_files.
    panel($('#report'),'sdcReportAttachments','ملفات التقرير الرسمي','حدّد الملفات الداخلة في نسخة التقرير المعتمدة؛ تبقى بقية ملفات الزيارة في visit_files.',`<label class="sdc-check"><input type="checkbox" data-report-file="xray_tooth_46_before.jpg" checked> تضمين أشعة السن 46 في التقرير المعتمد</label><p class="small text-muted mt-2">بعد الاعتماد لا يجوز تغيير هذه القائمة عبر عمليات التعديل المعتادة.</p>`);
    // Invoice documents separate from computed payment status; items originate from visit procedures.
    const invoice=$('#doctorInvoiceCard');$$(':scope > .row.g-3, :scope > .alert, :scope > button',invoice).forEach(el=>el.remove());
    panel(invoice,'sdcInvoice','مستند الفاتورة وبنودها','حدد حالة الفاتورة وبنودها؛ يظهر إجماليها والمبلغ المدفوع والمتبقي بشكل مستقل.',`<div class="sdc-grid three">${select('حالة المستند','invoiceStatus',[['draft','مسودة'],['issued','إصدار'],['cancelled','ملغاة']],'draft')}${input('المدفوع عند الإصدار ₪','paid','number','0','min="0" step="0.01"')}${select('طريقة الدفع','payMethod',[['cash','نقداً'],['card','بطاقة'],['bank_transfer','تحويل']],'cash')}</div><div class="mt-3"><h6 class="fw-bold">بنود الفاتورة من الإجراءات</h6><div id="sdcInvoiceItems"></div><button type="button" class="btn btn-outline-primary btn-sm mt-2" id="sdcSyncInvoice">تحديث من إجراءات الزيارة</button></div><div class="alert alert-light border mt-3 mb-0" id="sdcInvoiceSummary"></div>${note('لا تُعدّل بنود الفاتورة بعد الإصدار. المدفوعات تحفظ في invoice_payments، ولا تخزن paid داخل invoices.status.')}`);
    function syncInvoice(){const list=$('#sdcInvoiceItems');list.replaceChildren();procs.get().forEach((proc,i)=>{const el=html(`<div class="sdc-grid five sdc-item">${input('البند','name','text','','readonly')}${input('الكمية','quantity','number',proc.quantity,'min="0.01" step="0.01"')}${input('السعر ₪','price','number',proc.price,'min="0" step="0.01"')}${input('الخصم ₪','discount','number','0','min="0" step="0.01"')}<span class="small text-muted">بند ${i+1}</span></div>`);$('[data-field="name"]',el).value=proc.work;list.append(el);});updateTotal();}
    function invoiceLines(){return $$('#sdcInvoiceItems .sdc-item').map(data);}
    function total(){return invoiceLines().reduce((n,l)=>n+Math.max(0,amount(l.price)*amount(l.quantity)-amount(l.discount)),0);}
    function updateTotal(){const sum=total(),paid=amount($('#sdcInvoice [data-field="paid"]').value);const result=$('#sdcInvoiceSummary');if(result){const bad=paid>sum;result.classList.toggle('sdc-payment-error',bad);result.innerHTML=`<div class="sdc-money-item"><span>الإجمالي</span><strong>${sum.toFixed(2)} <small>₪</small></strong></div><div class="sdc-money-item"><span>المدفوع</span><strong>${paid.toFixed(2)} <small>₪</small></strong></div><div class="sdc-money-item sdc-money-due"><span>المتبقي</span><strong>${Math.max(0,sum-paid).toFixed(2)} <small>₪</small></strong></div><div class="sdc-payment-state">${sum===0?'لا توجد بنود':bad?'المبلغ المدفوع يتجاوز الإجمالي':paid===0?'غير مدفوعة':paid<sum?'مدفوعة جزئياً':'مدفوعة'}</div>`;}const p=$('#sdcProcedureTotal');if(p)p.textContent=`مجموع الإجراءات قبل الخصومات: ${procs.get().reduce((n,x)=>n+amount(x.quantity)*amount(x.price),0).toFixed(2)} ₪`;}
    procedure.addEventListener('input',updateTotal);$('#sdcInvoice').addEventListener('input',updateTotal);$('#sdcSyncInvoice').onclick=syncInvoice;syncInvoice();
    // One public serialization layer for later API integration, independent of mock persistence.
    window.SDCV12 = {...(window.SDCV12||{}),getVisitPayload:()=>({visit_procedures:procs.get().map((d,i)=>({sequence_no:i+1,...d})),lab_order:$('#needsLab')?.checked?{...data(lab),items:window.SDCV12LabItems?.get().map((x,i)=>({sequence_no:i+1,...x}))}:null,invoice:{...data($('#sdcInvoice')),items:invoiceLines(),total:total()},prescription:{...data($('#sdcPrescriptionLifecycle')),items:$$('#medicationList .dynamic-list-item').map(row=>({...data(row),medicine_name:$('input',row)?.value||''}))},odontogram:data($('#sdcToothSurface')),report_file_names:$$('[data-report-file]:checked').map(n=>n.dataset.reportFile)})};
  }
  function labCases(){
    const cases=$$('[data-lab-row]');if(!cases.length||!$('#doctorLabFilter'))return;
    cases.forEach((row,i)=>{
      const cell=row.lastElementChild; if(!cell)return;
      // Replace previous button node to avoid legacy order-wide installed click handler.
      const legacy=$('[data-mark-installed]',cell);if(legacy)legacy.remove();
      const installed=row.dataset.status==='installed';const received=row.dataset.status==='received';
      const orderItems= i===0?[{label:'تاج Zirconia • سن 46',done:installed},{label:'عنصر ثانٍ توضيحي • سن 47 (بيانات وهمية)',done:false}]:[{label:row.children[3]?.textContent.trim()||'عمل مخبري',done:installed}];
      const p=panel(cell,`sdcLabCase${i}`,'أعمال الطلب المخبري','سجّل التركيب لكل عمل بعد الاستلام.',`<div class="sdc-lab-actions"></div><p class="sdc-lab-summary" data-order-summary></p>`);
      const expander=html(`<details class="sdc-lab-expander"><summary><i class="bi bi-list-check" aria-hidden="true"></i><span>الأعمال المخبرية (${orderItems.length})</span><i class="bi bi-chevron-down sdc-expander-chevron" aria-hidden="true"></i></summary></details>`);
      p.replaceWith(expander);expander.append(p);
      const box=$('.sdc-lab-actions',p);
      function draw(){box.replaceChildren();orderItems.forEach((x,n)=>{const unit=html(`<div class="d-flex justify-content-between align-items-center gap-2 border-bottom py-1"><span class="small"></span><button type="button" class="btn btn-sm ${x.done?'btn-light':'btn-outline-success'}"></button></div>`);$('span',unit).textContent=x.label;const b=$('button',unit);b.textContent=x.done?'تم التركيب':'تسجيل تركيب';b.disabled=x.done||!received;if(!received&&!x.done)b.title='لا يُركب العنصر قبل الاستلام';b.onclick=()=>{x.done=true;draw();toast('تسجيل تركيب العنصر — نموذج تجريبي بدون حفظ.');};box.append(unit);});
        const all=orderItems.every(x=>x.done);row.dataset.status=all?'installed':received?'received':row.dataset.status;
        const badge=$('[data-lab-status]',row);if(badge){badge.textContent=all?'تم تركيب كل العناصر':received?(orderItems.some(x=>x.done)?'تم الاستلام — تركيب جزئي':'تم الاستلام — بانتظار التركيب'):'تم الإرسال';badge.className='badge '+(all?'text-bg-dark':received?'text-bg-success':'text-bg-info');}
        $('[data-order-summary]',p).textContent=`تم تركيب ${orderItems.filter(x=>x.done).length} من ${orderItems.length} عناصر. ${all?'الحالة مكتملة':'الطلب غير مكتمل التركيب'}`;
      }
      draw();
    });
  }
  function exceptions(){
    const target=$('#clinicWorkingHoursEditor')?.closest('.profile-section')||$('#clinicWorkingHoursEditor')?.parentElement;
    if(!target)return;
    const root=panel(target,'sdcClinicExceptions','استثناءات دوام العيادة','أضف أيام الإغلاق والساعات الخاصة دون تغيير جدول الدوام الأسبوعي.',`<div id="sdcExceptionItems"></div><button type="button" class="btn btn-outline-primary btn-sm mt-2" id="sdcAddException">+ إضافة إغلاق / فترة استثنائية</button><div class="small text-secondary mt-2">إغلاق كامل لليوم يختلف عن ساعات استثنائية. لا يجوز جمع الإغلاق والفترات في اليوم نفسه.</div>`);
    const template=d=>`<div class="sdc-item"><div class="sdc-grid four">${input('التاريخ','date','date',d.date||'2026-10-15')}${select('النوع','mode',[['closed','إغلاق كامل'],['special','ساعات استثنائية']],d.mode||'closed')}${input('بداية الفترة','start','time',d.start||'09:00')}${input('نهاية الفترة','end','time',d.end||'13:00')}</div><div class="mt-2">${input('السبب','reason','text','')}</div><button type="button" class="btn btn-link text-danger btn-sm" data-remove>إزالة الاستثناء</button></div>`;
    const ex=rows($('#sdcExceptionItems'),'schedule_exceptions',template,[{}]);$('#sdcAddException').onclick=()=>ex.add({mode:'special',date:''});
    function validate(){const entries=ex.get(),bad=[];entries.forEach((x,i)=>{const n=$$('#sdcExceptionItems .sdc-item')[i];const start=$('[data-field="start"]',n),end=$('[data-field="end"]',n);start.disabled=end.disabled=x.mode==='closed';n.classList.remove('sdc-invalid');if(!x.date||(x.mode==='special'&&(!x.start||!x.end||x.start>=x.end))){n.classList.add('sdc-invalid');bad.push(i);}});
      entries.forEach((a,i)=>entries.forEach((b,j)=>{if(i>=j||a.date!==b.date||!a.date)return;if(a.mode==='closed'||b.mode==='closed'||(a.start<b.end&&b.start<a.end)){[$$('#sdcExceptionItems .sdc-item')[i],$$('#sdcExceptionItems .sdc-item')[j]].forEach(n=>n?.classList.add('sdc-invalid'));bad.push(i,j);}}));return bad.length===0;}
    root.addEventListener('change',validate);$('#sdcExceptionItems').addEventListener('input',validate);
    window.SDCV12={...(window.SDCV12||{}),getClinicExceptions:()=>({valid:validate(),rows:ex.get()})};validate();
  }
  function reports(){
    const admin=$('#medicalAdminEditModal');if(!admin)return;
    const selectEl=$('select',admin);if(selectEl)selectEl.innerHTML='<option value="administrative_clarification">توضيح إداري</option><option value="document_review">مراجعة وثيقة</option><option value="data_access">طلب وصول للسجل</option>';
    $('#saveAdministrativeNoteV12')?.addEventListener('click',(e)=>{e.preventDefault();e.stopPropagation();const txt=$('#administrativeNoteContent')?.value.trim(),reason=$('#medicalAdminReason')?.value.trim();if(!txt||!reason){toast('أدخل الملاحظة والسبب. لا تُغيّر معلومات التقرير المعتمد.');return;}const holder=$('#sdcAdministrativeNotes')||panel($('main'),'sdcAdministrativeNotes','سجل الملاحظات الإدارية','يُعرض منفصلاً عن التشخيص والتقرير المعتمد.','');const entry=html('<div class="alert alert-light border"></div>');entry.textContent=`ملاحظة إدارية تجريبية: ${txt} | السبب: ${reason}`;holder.append(entry);bootstrap.Modal.getOrCreateInstance(admin).hide();toast('تمت محاكاة إضافة ملاحظة دون تعديل التقرير المعتمد.');});
  }
  function staffInvites(){
    const modal=$('#staffModal'),btn=$('#saveStaffBtn');if(!modal||!btn)return;
    const body=$('.modal-body',modal);panel(body,'sdcStaffInvitation','مرحلة الدعوة','الصلاحيات المختارة محفوظة مع الدعوة المعلقة؛ لا تصبح فعالة قبل قبول صاحب البريد.',`<div class="alert alert-info mb-0">الحالة عند الإرسال: <strong>بانتظار قبول الدعوة (pending)</strong>. كلمة المرور ينشئها المستخدم بنفسه، وليست مسؤولية مدير العيادة.</div>`,'afterbegin');
    // Intercept new staff invitations, preserve original edit behavior.
    btn.addEventListener('click',e=>{const title=$('#staffModalTitle')?.textContent.trim()||'';if(/تعديل/.test(title))return;e.stopImmediatePropagation();e.preventDefault();const email=$('#staffFormEmail')?.value.trim(),name=$('#staffFormName')?.value.trim();if(!email||!name){toast('الاسم والبريد مطلوبان لإرسال الدعوة.');return;}const perms=$$('.staff-permissions-grid input:checked').map(x=>x.value);const target=$('#sdcStaffPending')||panel($('#staffTableBody')?.closest('section')||$('.page-shell'),'sdcStaffPending','الدعوات المعلقة','لم تُنشأ عضويات أو صلاحيات فعالة بعد.','');const card=html('<div class="alert alert-info mb-2"></div>');card.textContent=`دعوة تجريبية معلقة: ${name} — ${email} | الصلاحيات بعد القبول: ${perms.join('، ')||'بدون صلاحيات'}`;target.append(card);bootstrap.Modal.getOrCreateInstance(modal).hide();toast('تم عرض الدعوة المعلقة فقط؛ لا يوجد API للإرسال بعد.');},true);
  }
  function security(){ return; /* replaced by sdc-v19 security UI */
    const path=currentPath();
    if(!/\/(doctor\/settings|clinic\/account-settings|admin\/settings)\.html$/.test(path))return;
    const checkbox=($$('.setting-toggle,.settings-toggle,.security-toggle,.setting-row').find(x=>x.textContent.includes('التحقق بخطوتين'))?.querySelector('input[type=checkbox]'))||$$('input[type=checkbox]').find(x=>x.closest('.setting-toggle,.form-check')?.textContent.includes('التحقق بخطوتين'));
    if(!checkbox)return;
    const host=checkbox.closest('.form-check,.setting-row')||checkbox.parentElement;
    panel(host.parentElement||host,'sdcMFA','إعداد التحقق بخطوتين','فعّل طبقة حماية إضافية لحسابك بخطوات تحقق واضحة.',`${input('رمز المصادقة TOTP (6 أرقام)','otp','text','','maxlength="6" pattern="[0-9]{6}" autocomplete="one-time-code"')}<button type="button" class="btn btn-outline-primary btn-sm mt-2" id="sdcMFAStart">بدء إعداد عامل جديد</button><div id="sdcMFAInfo" class="small mt-2 text-secondary">يجب أن يعيد الـBackend سر TOTP/QR مؤقتاً. لا يُنشأ سر أو رموز استرداد في المتصفح.</div>`);
    checkbox.disabled=true;checkbox.title='تُفعّل هذه الخاصية بعد تحقق TOTP من الخادم';$('#sdcMFAStart').onclick=()=>{$('#sdcMFAInfo').textContent='هذه معاينة فقط؛ سيكتمل إعداد التحقق عند ربط الخدمة.';};
  }
  function consent(){
    if(!/\/auth\/register\/(patient|doctor)\.html$/.test(currentPath()))return;
    const cb=$$('input[type=checkbox]').find(x=>x.parentElement?.textContent.includes('أوافق')||x.closest('label')?.textContent.includes('أوافق'));if(!cb)return;
    const near=cb.closest('label,.form-check')||cb.parentElement;
    near.insertAdjacentElement('afterend',html('<p class="small text-secondary mt-2">بالموافقة، تقرّ بالاطلاع على أحدث نسخة من الشروط وسياسة الخصوصية. سيُحفظ إصدار الموافقة عند تفعيل النظام.</p>'));
  }
  function clinicFiles(){
    const path=currentPath();if(!/\/(clinic\/profile|admin\/clinic-details)\.html$/.test(path))return;
    const main=$('main > section.container')||$('main > .container')||$('main');if(!main)return;
    panel(main,'sdcClinicFileVersions','سجل مستندات العيادة','اعرض النسخة الحالية واحتفظ بالإصدارات السابقة للرجوع إليها عند الحاجة.',`<div class="table-responsive"><table class="table table-sm"><thead><tr><th>المستند</th><th>الإصدار</th><th>الحالة</th><th>التاريخ</th></tr></thead><tbody><tr><td>ترخيص العيادة</td><td>V2</td><td><span class="badge text-bg-success">الحالي</span></td><td>2026-09-01</td></tr><tr><td>ترخيص العيادة</td><td>V1</td><td><span class="badge text-bg-secondary">مؤرشف</span></td><td>2025-09-01</td></tr></tbody></table></div>${input('رفع إصدار جديد للمراجعة','newLicense','file','','accept=".pdf,.png,.jpg,.jpeg"')}<p class="small text-secondary mt-2">المثال أعلاه بيانات وهمية؛ اعتماد نسخة جديدة وتحديث current يتمان في معاملة خادم واحدة.</p>`,'beforeend');
  }
  function doctorSpecialties(){
    if(!currentPath().endsWith('/auth/register/doctor.html'))return;
    const form=$('form');if(!form)return;
    const primary=$$('.col-md-6',form).find(el=>el.querySelector('label')?.textContent.includes('التخصص'));
    const slot=html('<div class="col-12"></div>');
    if(primary&&primary.parentElement){primary.insertAdjacentElement('afterend',slot);}else{form.insertAdjacentElement('afterbegin',slot);}
    panel(slot,'sdcDoctorSpecialties','تخصصات الطبيب المهنية','يمكن بدء التسجيل بتخصص واحد ثم إضافة التخصصات المهنية الأخرى بعد إثبات الأهلية، دون اعتباره تخصصاً وحيداً دائماً.',`<div class="sdc-specialties" aria-label="التخصصات الإضافية (اختيارية)"><p class="sdc-field-title">يمكنك اختيار أكثر من تخصص إضافي</p>${[['endodontics','علاج جذور'],['orthodontics','تقويم الأسنان'],['oral_surgery','جراحة الفم'],['prosthodontics','التركيبات السنية']].map(([v,t])=>`<label class="sdc-specialty"><input type="checkbox" value="${v}" name="extraSpecialties"><span>${t}</span><i class="bi bi-check2" aria-hidden="true"></i></label>`).join('')}</div>${note('اختيار التخصصات اختياري، ويُتحقق من الأهلية قبل تفعيلها.')}`);
  }
  function doctorInvites(){
    if(!currentPath().endsWith('/clinic/doctors.html'))return;
    const target=$('main section')||$('main');if(!target)return;
    panel(target,'sdcDoctorInviteFlow','دورة دعوة الطبيب','إرسال الدعوة لا يفعّل الطبيب تلقائياً ضمن clinic_doctors.',`<ol class="small mb-0"><li>إنشاء دعوة بحالة pending، وتحديد التخصص المخطط.</li><li>قبول الطبيب الدعوة قبل انتهاء صلاحيتها.</li><li>يتحقق الخادم من الحساب ورقم الترخيص والتخصص.</li><li>إنشاء علاقة الطبيب بالعيادة مرة واحدة، ثم تفعيل ظهوره وحجوزه وفق الصلاحيات.</li></ol>`,'afterbegin');
  }
  function reportCurrent(){
    if(!currentPath().endsWith('/doctor/report-current-visit.html'))return;
    const report=$('main > section.container')||$('main > .container')||$('main');if(!report)return;
    panel(report,'sdcReportImmutable','اعتماد التقرير وملفاته','يختار الطبيب مرفقات التقرير قبل الاعتماد. بعده يبقى التقرير والمرفقات المعتمدة ثابتة، ويكون التصحيح عبر إبطال موثق أو ملحق منفصل.',`<label class="sdc-check"><input type="checkbox" checked> تضمين الأشعة المرتبطة بالزيارة في التقرير المعتمد</label><div class="alert alert-light border small mt-2 mb-0">الـPDF المولّد يجب ربطه عبر عملية خادم محمية، ولا يمكن تبديل الملفات المعتمدة بصمت.</div>`,'afterbegin');
  }
  document.addEventListener('DOMContentLoaded',()=>{
    [visit,labCases,exceptions,reports,staffInvites,security,consent,clinicFiles,doctorSpecialties,doctorInvites,reportCurrent].forEach(fn=>{try{fn();}catch(e){console.error('SDC contract enhancement:',fn.name,e);}});
  });
})();
