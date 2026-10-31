'use strict';
// Generate genuine immutable PDFs using locally installed Chromium/Edge.
// Never serve output from /public. This module must fail closed if no renderer exists.
const fs=require('node:fs/promises');const path=require('node:path');const os=require('node:os');
const crypto=require('node:crypto');const {execFile}=require('node:child_process');
const {promisify}=require('node:util');const run=promisify(execFile);
// Set SDC_REPORT_DIR to a persistent private directory outside extracted ZIP builds.
const legacyRoot=path.resolve(__dirname,'../../../storage/approved-reports');
// New approved documents survive replacing the application ZIP on Windows/Linux.
// SDC_REPORT_DIR remains the explicit deployment override; legacy documents
// continue to work inside the old project's storage folder if still present.
const root=process.env.SDC_REPORT_DIR ? path.resolve(process.env.SDC_REPORT_DIR) : path.resolve(process.env.LOCALAPPDATA||path.join(os.homedir(),'.smart-dental-clinic'),'SmartDentalClinic','approved-reports');
function encode(v){return String(v??'—').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
const tr=(label,val)=>`<tr><th>${encode(label)}</th><td>${encode(val)}</td></tr>`;
const PDF_LABELS={"العيادة": "Clinic", "الطبيب": "Doctor", "المريض": "Patient", "رقم المريض": "Patient ID", "رقم الزيارة": "Visit ID", "تاريخ الموعد": "Appointment date", "بداية العلاج الفعلية": "Treatment start time", "نهاية العلاج الفعلية": "Treatment end time", "الخدمة": "Service", "الشكوى": "Chief complaint", "الفحص السريري": "Clinical examination", "نتائج الفحص المختارة": "Selected clinical findings", "ملاحظات أسطح الأسنان": "Tooth surface notes", "مخطط الأسنان": "Dental chart", "مراحل خطط العلاج": "Treatment plan stages", "ملفات مرفقة ومعتمدة بالإشارة": "Selected approved attachments", "التوصيات": "Recommendations", "اقتراح المتابعة": "Suggested follow-up", "التشخيصات": "Diagnoses", "الإجراءات المنفذة": "Performed procedures", "الوصفات": "Prescriptions", "لا يوجد": "None", "لا توجد حالات محفوظة": "No recorded conditions", "لا توجد مراحل": "No stages", "صور الأشعة والمرفقات المختارة": "Selected imaging and attachments", "مرفق طبي": "Medical attachment", "تقرير طبي معتمد": "Approved medical report", "مستخرج PDF من السجل الطبي": "PDF extract from medical record", "التقرير الطبي النهائي للزيارة": "Final medical visit report", "مستخرج لاحق من بيانات الزيارة المعتمدة في النظام (لا يحل محل ملف PDF الأصلي الصادر وقت الاعتماد).": "An extract of an approved visit record (not a replacement for the original PDF issued at approval).", "وثيقة طبية معتمدة من الطبيب المعالج، مبنية على السجلات المحفوظة وقت الاعتماد. لا يجوز تعديلها بعد اعتمادها.": "A medical document approved by the treating dentist, based on the records saved at approval. This report is immutable after approval.", "تاريخ إنشاء الوثيقة (UTC):": "Document created (UTC):", "تم توليد هذه الوثيقة تلقائيًا في Smart Dental Clinic.": "This document was generated automatically by Smart Dental Clinic.", "قد لا تتوفر بعض الصور الأصلية في هذا المستخرج. راجع ملفات الزيارة في النظام.": "Some original images may not be available in this extract. Review visit attachments in the system.", "سن": "Tooth", "السن": "Tooth", "مرحلة": "Stage"};
function pdfLabel(value,lang){return lang==='en'?(PDF_LABELS[value]||value):value;}
function content(data){const visit=data.visit;const lang=data.lang==='en'?'en':'ar';const trL=(label,val)=>tr(pdfLabel(label,lang),val);
const rows=[trL('العيادة',visit.clinic_name),trL('الطبيب',visit.doctor_name),trL('المريض',visit.patient_name),trL('رقم المريض',visit.patient_id),trL('رقم الزيارة',visit.id),trL('تاريخ الموعد',visit.date),trL('بداية العلاج الفعلية',visit.actual_start),trL('نهاية العلاج الفعلية',visit.actual_end),trL('الخدمة',visit.service),trL('الشكوى',visit.complaint),trL('الفحص السريري',visit.examination),trL('نتائج الفحص المختارة',(data.findings||[]).map(x=>x.finding).join('، ')||pdfLabel('لا يوجد',lang)),trL('ملاحظات أسطح الأسنان',(data.surfaces||[]).map(x=>`${pdfLabel('سن',lang)} ${x.tooth} (${x.surface}): ${x.note}`).join(' | ')||pdfLabel('لا يوجد',lang)),trL('مخطط الأسنان',(data.odontogram||[]).map(x=>`${pdfLabel('السن',lang)} ${x.tooth}: ${x.status}`).join(' | ')||pdfLabel('لا توجد حالات محفوظة',lang)),trL('مراحل خطط العلاج',(data.stages||[]).map(x=>`${x.plan} / ${pdfLabel('مرحلة',lang)} ${x.step}: ${x.description} (${x.status})${x.tooth?' - '+pdfLabel('سن',lang)+' '+x.tooth:''}`).join(' | ')||pdfLabel('لا توجد مراحل',lang)),trL('ملفات مرفقة ومعتمدة بالإشارة',(data.files||[]).map(x=>x.name).join('، ')||pdfLabel('لا يوجد',lang)),trL('التوصيات',visit.recommendations),trL('اقتراح المتابعة',visit.followup_type?`${visit.followup_type} - ${visit.followup_date||''} - ${visit.followup_notes||''}`:pdfLabel('لا يوجد',lang)),trL('التشخيصات',data.diagnoses.map(x=>`${pdfLabel('سن',lang)} ${x.tooth}: ${x.text}`).join(' | ')||pdfLabel('لا يوجد',lang)),trL('الإجراءات المنفذة',data.procedures.map(x=>`${x.service}${x.tooth?' - '+pdfLabel('سن',lang)+' '+x.tooth:''} (${x.quantity} × ${x.price} ₪)`).join(' | ')||pdfLabel('لا يوجد',lang)),trL('الوصفات',data.medications.map(x=>`${x.name}${lang==='en'?';':'؛'} ${x.dosage}${lang==='en'?';':'؛'} ${x.frequency}${lang==='en'?';':'؛'} ${x.duration}${lang==='en'?';':'؛'} ${x.route}`).join(' | ')||pdfLabel('لا يوجد',lang))];
const imageSection=(data.images||[]).length?`<section class="images"><h2>${pdfLabel('صور الأشعة والمرفقات المختارة',lang)}</h2>${data.images.map(x=>`<figure><figcaption>${encode(x.name)}</figcaption><img src="${x.src}" alt="${pdfLabel('مرفق طبي',lang)}"></figure>`).join('')}</section>`:'';
return `<!doctype html><html lang="${lang}" dir="${lang==='en'?'ltr':'rtl'}"><meta charset="utf-8"><title>${pdfLabel('تقرير طبي معتمد',lang)} - ${encode(visit.id)}</title><style>@page{size:A4;margin:18mm}body{font-family:'Arial','Segoe UI',sans-serif;font-size:12pt;color:#202939;direction:${lang==='en'?'ltr':'rtl'}}h1{color:#12577c;text-align:center;font-size:22pt}h2{font-size:13pt;margin:0 0 12px;text-align:center;color:#4b5563}.label{border:1px solid #cbd5e1;padding:9px;margin:15px 0;border-radius:5px;background:#f4f7fa}table{border-collapse:collapse;width:100%;table-layout:fixed}th,td{border:1px solid #cbd5e1;padding:8px;vertical-align:top;overflow-wrap:anywhere;text-align:${lang==='en'?'left':'right'}}th{background:#f2f6f9;width:27%;font-weight:bold}footer{font-size:9pt;margin-top:20px;border-top:1px solid #cbd5e1;padding-top:10px}.sub{color:#586779;font-size:10pt}.images{margin-top:22px}.images figure{break-inside:avoid;page-break-inside:avoid;border:1px solid #ccd5e0;padding:10px}.images img{width:auto;max-width:100%;max-height:200mm;object-fit:contain;display:block;margin:8px auto}figcaption{font-weight:bold;text-align:${lang==='en'?'left':'right'}}</style><h1>Smart Dental Clinic</h1><h2>${visit.extract_notice?pdfLabel('مستخرج PDF من السجل الطبي',lang):pdfLabel('التقرير الطبي النهائي للزيارة',lang)}</h2><div class="label">${visit.extract_notice ? pdfLabel('مستخرج لاحق من بيانات الزيارة المعتمدة في النظام (لا يحل محل ملف PDF الأصلي الصادر وقت الاعتماد).',lang): pdfLabel('وثيقة طبية معتمدة من الطبيب المعالج، مبنية على السجلات المحفوظة وقت الاعتماد. لا يجوز تعديلها بعد اعتمادها.',lang)}</div><table>${rows.join('')}</table>${visit.extract_attachments_notice?`<p class="label">${encode(pdfLabel(visit.extract_attachments_notice,lang))}</p>`:''}${imageSection}<footer>${pdfLabel('تاريخ إنشاء الوثيقة (UTC):',lang)} ${encode(new Date().toISOString())}<div class="sub">${pdfLabel('تم توليد هذه الوثيقة تلقائيًا في Smart Dental Clinic.',lang)}</div></footer></html>`;}
// Only use without sandbox after an explicit operator opt-in (isolated
// containers only). Keep Chromium's sandbox enabled by default.
function browserFlags(){return process.env.SDC_PDF_NO_SANDBOX==='1'?['--no-sandbox']:[];}
function browserCandidates(){const p=process.platform;const candidates=[];
if(process.env.SDC_PDF_BROWSER)candidates.push(process.env.SDC_PDF_BROWSER);
if(p==='win32')candidates.push(
'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
);else candidates.push('/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome','/opt/google/chrome/chrome');
return [...new Set(candidates)];}
async function renderer(){for(const file of browserCandidates()){try{await fs.access(file);return file;}catch{}}const e=new Error('تعذّر العثور على Edge أو Chrome لإنشاء PDF معتمد. حدّد SDC_PDF_BROWSER إلى المسار الكامل للمتصفح.');e.status=503;throw e;}
async function generate(data,visitId){if(!/^\d{1,18}$/.test(String(visitId)))throw Error('Invalid visit ID');const browser=await renderer();const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'sdc-medical-'));
const local=path.join(tmp,'draft.html'),pdf=path.join(tmp,'approved.pdf');try{
 await fs.writeFile(local,content(data),{encoding:'utf8',mode:0o600});
 const url=new URL('file://'+(process.platform==='win32'?'/':'')+local.split(path.sep).join('/')).href;
 try{await run(browser,['--headless',...browserFlags(),'--disable-gpu','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--no-pdf-header-footer','--disable-extensions',`--user-data-dir=${path.join(tmp,'browser-profile')}`,`--print-to-pdf=${pdf}`,url],{timeout:30000,windowsHide:true,maxBuffer:300000});}
 catch(e){const error=new Error('فشل محرك Edge/Chrome في توليد PDF، لذلك لم يُعتمد التقرير. تحقق من إعداد SDC_PDF_BROWSER على الخادم.');error.status=503;error.cause=e;throw error;}
 const buf=await fs.readFile(pdf).catch(()=>{const e=new Error('لم ينشئ المتصفح ملف PDF صالحًا، ولذلك لم يُعتمد التقرير.');e.status=503;throw e;});if(buf.length<700||buf.toString('ascii',0,5)!=='%PDF-')throw Error('PDF verification failed');
 const digest=crypto.createHash('sha256').update(buf).digest('hex');const name=`visit-${visitId}-${digest.slice(0,24)}.pdf`;
 await fs.mkdir(root,{recursive:true,mode:0o700});const location=path.join(root,name);
 // 'wx' prevents replacing any existing approved document.
 try{await fs.writeFile(location,buf,{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;}
 return {reference:name,path:location,hash:digest};
}finally{await fs.rm(tmp,{recursive:true,force:true}).catch(()=>{});}}
async function remove(generated){if(generated?.path)await fs.unlink(generated.path).catch(()=>{});}
async function find(name){
 if(!/^visit-\d+-[a-f0-9]{24}\.pdf$/.test(String(name||'')))return null;
 for(const folder of new Set([root,legacyRoot])){
  const file=path.join(folder,name);const st=await fs.stat(file).catch(()=>null);
  if(!st?.isFile()||st.size<700)continue;
  const handle=await fs.open(file,'r').catch(()=>null);if(!handle)continue;
  try{const header=Buffer.alloc(5);await handle.read(header,0,5,0);if(header.toString('ascii')==='%PDF-')return file;}finally{await handle.close();}
 }
 return null;
}

// Fallback for migrated installations where the original approved PDF file
// was not copied. The extracted copy is visibly labeled and never replaces
// the immutable file reference in the clinical database.
async function extractForDownload(data){
 const browser=await renderer();
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'sdc-patient-extract-'));
 try{
  const html=path.join(tmp,'extract.html'),dest=path.join(tmp,'extract.pdf');
  await fs.writeFile(html,content({...data,visit:{...data.visit,extract_notice:true}}),{encoding:'utf8',mode:0o600});
  const url=new URL('file://'+(process.platform==='win32'?'/':'')+html.split(path.sep).join('/')).href;
  try{await run(browser,['--headless',...browserFlags(),'--disable-gpu','--disable-dev-shm-usage','--no-first-run','--no-pdf-header-footer','--disable-extensions',`--user-data-dir=${path.join(tmp,'browser-profile')}`,`--print-to-pdf=${dest}`,url],{timeout:30000,windowsHide:true,maxBuffer:300000});}
  catch(cause){const error=new Error('فشل تشغيل Chrome/Edge لإنشاء مستخرج PDF؛ راجع إعدادات المتصفح وصلاحيات خادم التطبيق.');error.status=503;error.cause=cause;throw error;}
  const bytes=await fs.readFile(dest).catch(()=>null);
  if(!bytes){const e=new Error('تعذّر إنشاء ملف PDF على الخادم. تحقق من إعداد SDC_PDF_BROWSER وتشغيل Edge/Chrome بصلاحيات المستخدم.');e.status=503;throw e;}
  if(bytes.length<700||bytes.toString('ascii',0,5)!=='%PDF-')throw Error('PDF verification failed');
  return bytes;
 }finally{await fs.rm(tmp,{recursive:true,force:true}).catch(()=>{});}
}
module.exports={root,content,generate,find,remove,encode,extractForDownload};
