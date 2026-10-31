/* Smart Dental Clinic — opt-in bilingual interface.
 * Never sends patient information to any translation service.
 * Translates only known system interface strings, not arbitrary clinical notes,
 * names, user input, or unrecognized backend content.
 */
(() => {
  'use strict';
  const lang = document.documentElement.lang === 'en' ? 'en' : 'ar';
  const self = '/assets/i18n.js';
  const ARABIC = /[\u0600-\u06ff]/;
  const SKIP = 'script,style,noscript,code,pre,textarea,[contenteditable],[translate="no"],[data-no-translate],.sdc-language-switch';
  const ATTRS = ['title', 'placeholder', 'aria-label', 'alt', 'data-bs-title', 'data-bs-original-title'];
  let dict = Object.create(null);
  let observer;

  function switchLanguage(next) {
    if (!['ar','en'].includes(next) || next === lang) return;
    const returnTo = location.pathname + location.search + location.hash;
    window.location.assign('/language/' + next + '?next=' + encodeURIComponent(returnTo));
  }

  // Capturing prevents legacy "demo-only" controls from blocking real switching.
  document.addEventListener('click', event => {
    const control = event.target.closest('[data-language]');
    if (!control) return;
    const next = control.getAttribute('data-language');
    if (next !== 'ar' && next !== 'en') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    switchLanguage(next);
  }, true);

  function addLanguageControl() {
    const existing = Array.from(document.querySelectorAll('[data-language]'));
    existing.forEach(button => {
      const selected = button.dataset.language === lang;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
      button.removeAttribute('data-ui-pending');
    });
    document.querySelectorAll('.language-current').forEach(node => {
      node.textContent = lang.toUpperCase();
    });
    // The role's own language dropdown is the single language control.
    // Do not attach a second pill below the header (previous doctor bug).
    if (existing.length) return;
    const nav = document.querySelector('nav.navbar');
    const holder = nav && nav.querySelector(
      '.clinic-nav-actions, .doctor-nav-actions, .patient-nav-actions, .admin-original-actions, .nav-collapse-box > .d-flex.gap-2');
    if (holder) {
      const dropdown = document.createElement('div');
      dropdown.className = 'dropdown sdc-nav-language-dropdown';
      const trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'sdc-nav-language-trigger';
      trigger.setAttribute('data-bs-toggle', 'dropdown');
      trigger.setAttribute('aria-expanded', 'false');
      trigger.setAttribute('aria-label', lang === 'en' ? 'Choose language' : 'اختيار اللغة');
      trigger.innerHTML = '<i class="bi bi-globe2" aria-hidden="true"></i><span class="sdc-language-code">' + lang.toUpperCase() + '</span>';
      const menu = document.createElement('ul');
      menu.className = 'dropdown-menu dropdown-menu-end sdc-nav-language-menu';
      [['ar','العربية'],['en','English']].forEach(([code, label]) => {
        const item = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'dropdown-item' + (code === lang ? ' active' : '');
        button.dataset.language = code;
        button.setAttribute('aria-pressed', String(code === lang));
        button.textContent = label;
        item.appendChild(button);
        menu.appendChild(item);
      });
      dropdown.append(trigger, menu);
      holder.insertBefore(dropdown, holder.firstChild);
      return;
    }
    // Full-page forms without a header need one accessible control.
    const wrap = document.createElement('div');
    wrap.className = 'sdc-language-switch sdc-language-switch--floating';
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', 'Interface language / لغة الواجهة');
    wrap.innerHTML = '<button type="button" data-language="ar" aria-pressed="' + (lang === 'ar') + '">العربية</button>' +
      '<button type="button" data-language="en" aria-pressed="' + (lang === 'en') + '">English</button>';
    document.body.appendChild(wrap);
  }

  function clean(s) {
    return String(s || '').replace(/\u0640/g,'').replace(/[\u064b-\u065f]/g,'')
      .replace(/\s+/g,' ').trim();
  }
  function convertDigits(s) {
    return s.replace(/[\u0660-\u0669\u06f0-\u06f9]/g, d =>
      String('٠١٢٣٤٥٦٧٨٩'.indexOf(d) >= 0 ? '٠١٢٣٤٥٦٧٨٩'.indexOf(d) : '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
  }
  const suffixes = Object.freeze({
    '؟':'?', '؛':';', '،':',', '٪':'%', 'ـ':'',
  });
  // Dynamic notification templates: translate authored surrounding words while
  // preserving dates, clinic names, currency amounts, and patient-entered data.
  // Patterns are anchored to known system messages; never use machine translation
  // on arbitrary database content or clinical notes.
  const SYSTEM_TEMPLATES = [
    [/^استلمنا طلبك بتاريخ (.+?) الساعة (.+?)\. الموعد بانتظار تأكيد العيادة\.$/, m => `We received your booking request for ${m[1]} at ${m[2]}. It is awaiting clinic confirmation.`],
    [/^تم حجز موعدك بتاريخ (.+?) الساعة (.+?)\. افتح تفاصيل الموعد للمراجعة\.$/, m => `Your appointment was booked for ${m[1]} at ${m[2]}. Open appointment details to review it.`],
    [/^لديك موعد غدًا الساعة (.+?) في (.+?)\.$/, m => `You have an appointment tomorrow at ${m[1]} at ${m[2]}.`],
    [/^أوصى طبيبك بزيارة متابعة \((.+?)\) بتاريخ (.+?)\. افتح السجل الطبي للتفاصيل والحجز\.$/, m => `Your doctor recommended a follow-up (${m[1]}) on ${m[2]}. Open your medical record for details and booking.`],
    [/^تم تسجيل دفعة بقيمة (.+?) على فاتورتك\. يمكنك متابعة المبلغ المتبقي في فواتيري\.$/, m => `A payment of ${m[1]} was recorded on your invoice. You can check the remaining balance under My Invoices.`],
    [/^تم قبول طلب التوظيف (JA-\d+)$/, m => `Job application ${m[1]} was accepted.`],
    [/^(.+?) • متبقي (.+?) ₪$/, m => `${m[1]} • Remaining ${m[2]} ₪`],
    [/^تم رفض موعدك\. السبب: (.+)$/, m => `Your appointment was rejected. Reason: ${m[1]}`],
    [/^تم قبول طلب التوظيف (JA-[A-Za-z0-9-]+)$/, m => `Job application ${m[1]} was accepted.`],
    [/^تم حجز موعدك بتاريخ (.+?) الساعة (.+?)\. افتح تفاصيل الموعد للمراجعة\.$/, m => `Your appointment was booked for ${m[1]} at ${m[2]}. Open appointment details to review it.`],
    [/^لديك موعد غدًا الساعة (.+?) في (.+?)\.$/, m => `You have an appointment tomorrow at ${m[1]} at ${m[2]}.`],
    [/^فاتورة (\d+) • متبقي ([\d.,]+) ₪$/, m => `Invoice ${m[1]} • Remaining ${m[2]} ₪`],
    [/^تغيير حالة الحجز: (.+)$/, m => `Change booking status: ${m[1]}`],
    [/^تدخل إداري في حالة الحجز: (.+)$/, m => `Administrative booking status change: ${m[1]}`]
  ];
  // Only translate known system-generated text patterns. Captured names, free-text
  // service descriptions, and clinical content are kept verbatim.
  const UI_NUMBER_UNITS = Object.freeze({
    'طبيب':'doctors','أطباء':'doctors','موعد':'appointments','مواعيد':'appointments',
    'حجز':'bookings','حجوزات':'bookings','فاتورة':'invoices','فواتير':'invoices',
    'حالة':'cases','حالات':'cases','زيارة':'visits','زيارات':'visits',
    'مريض':'patients','مرضى':'patients','خدمة':'services','خدمات':'services',
    'مادة':'items','مواد':'items','دقيقة':'minutes','ساعة':'hours','ساعات':'hours',
    'يوم':'days','أيام':'days','سنة':'years','سنوات':'years',
    'متقدم':'applicants','متقدمين':'applicants','سجل':'records','سجلات':'records',
    'مرحلة':'stages','مراحل':'stages','عضوية':'memberships','صلاحيات':'permissions',
    'وثيقة':'documents','وثائق':'documents','طلب':'requests','طلبات':'requests',
    'مؤكدة':'confirmed','مكتملة':'completed','انتظار':'pending',
    'مقروءة':'read','غير مقروءة':'unread', 'غياب':'absences'
  });
  const PREFIXES = [
    ['أهلاً د.', 'Welcome Dr.'], ['اهلاً د.', 'Welcome Dr.'],
    ['أهلاً،', 'Hello,'], ['أهلا،', 'Hello,'],
    ['مرحباً،', 'Hello,'], ['مرحبًا،', 'Hello,'],
    ['د.', 'Dr.'], ['صورة د.', 'Photo of Dr.'],
    ['الطبيب:', 'Doctor:'], ['المريض:', 'Patient:'],
    ['العيادة:', 'Clinic:'], ['فاتورة #', 'Invoice #'],
    ['الفاتورة #', 'Invoice #'], ['رقم الحجز:', 'Booking number:'],
    ['الزيارة #', 'Visit #'], ['زيارة #', 'Visit #'],
    ['تقرير الزيارة #', 'Visit report #'],
    ['النتائج في هذه الصفحة:', 'Results on this page:'],
    ['عدد الفواتير:', 'Invoice count:'],
    ['السعر المحفوظ:', 'Saved price:'],
    ['تاريخ بدء العمل:', 'Employment start date:'],
    ['آخر موعد:', 'Deadline:'],
    ['الاستحقاق:', 'Amount due:'],
    ['تفاصيل التسوية #', 'Settlement details #'],
    ['سجل الحركات •', 'Movement history •'],
    ['عدد السجلات المطابقة:', 'Matching record count:'],
    ['متقدم لوظيفة', 'Applicant for job'],
    ['مرحباً', 'Welcome']
  ];
  const WEEKDAYS = {'السبت':'Saturday','الأحد':'Sunday','الاحد':'Sunday',
    'الاثنين':'Monday','الإثنين':'Monday','الثلاثاء':'Tuesday',
    'الأربعاء':'Wednesday','الاربعاء':'Wednesday','الخميس':'Thursday','الجمعة':'Friday'};
  const MONTHS = {'يناير':'January','فبراير':'February','مارس':'March','أبريل':'April',
    'ابريل':'April','مايو':'May','يونيو':'June','يوليو':'July','أغسطس':'August',
    'اغسطس':'August','سبتمبر':'September','أكتوبر':'October','اكتوبر':'October',
    'نوفمبر':'November','ديسمبر':'December'};
  function knownDynamic(key) {
    let m;
    // Safely translate app-generated counters, list metadata, and accessibility
    // labels without translating names, clinical notes or user-entered records.
    if ((m = key.match(/^تعديل عمولة المنصة إلى (\d+(?:\.\d+)?)%، دورية ([a-z_]+)، مهلة (\d+) يوما$/i)))
      return `Platform commission changed to ${m[1]}%, frequency ${m[2]}, grace period ${m[3]} days`;
    if ((m = key.match(/^رموز غير معروفة تحتاج مراجعة مدير العيادة:\s*(.+)$/)) && m[1].length < 300)
      return `Unknown permission codes require clinic manager review: ${m[1]}`;
    if ((m = key.match(/^الإشعارات\s+([0-9٠-٩۰-۹]+)$/)))
      return `Notifications ${m[1]}`;
    if ((m = key.match(/^فحص إمكانية حذف المستخدم رقم\s+([A-Za-z0-9-]+)$/)))
      return `Check whether user ${m[1]} can be safely deleted`;
    if ((m = key.match(/^صفحة\s+([0-9٠-٩۰-۹]+)\s*\/\s*([0-9٠-٩۰-۹]+)$/)))
      return `Page ${m[1]} of ${m[2]}`;
    if ((m = key.match(/^عدد السجلات المطابقة:\s*([0-9٠-٩۰-۹]+)\s*[—-]\s*الصفحة\s*([0-9٠-٩۰-۹]+)\s*من\s*([0-9٠-٩۰-۹]+)$/)))
      return `Matching records: ${m[1]} — page ${m[2]} of ${m[3]}`;
    if ((m = key.match(/^صفحة\s+([0-9٠-٩۰-۹]+)\s+من\s+([0-9٠-٩۰-۹]+)\s*[—-]\s*([0-9٠-٩۰-۹]+)\s+طلب مطابق$/)))
      return `Page ${m[1]} of ${m[2]} — ${m[3]} matching requests`;
    if ((m = key.match(/^عرض\s+([0-9٠-٩۰-۹]+)[–-]([0-9٠-٩۰-۹]+)\s+من\s+([0-9٠-٩۰-۹]+)\s+(موعد|موعدا|فاتورة)(?:\s*•\s*الصفحة\s+([0-9٠-٩۰-۹]+)\s+من\s+([0-9٠-٩۰-۹]+))?$/)))
      return `Showing ${m[1]}–${m[2]} of ${m[3]} ${m[4]==='فاتورة'?'invoices':'appointments'}` + (m[5]?` • page ${m[5]} of ${m[6]}`:'');
    if ((m = key.match(/^([0-9٠-٩۰-۹]+)\s+من\s+أصل\s+([0-9٠-٩۰-۹]+)\s+(مواد|مواعيد|حجوزات)$/)))
      return `${m[1]} of ${m[2]} ${m[3]==='مواد'?'items':m[3]==='حجوزات'?'bookings':'appointments'}`;
    if ((m = key.match(/^([0-9٠-٩۰-۹]+)\s+من\s+أصل\s+([0-9٠-٩۰-۹]+)\s+موعد$/)))
      return `${m[1]} of ${m[2]} appointments`;
    if ((m = key.match(/^([0-9٠-٩۰-۹]+)\s+من\s+أصل\s+([0-9٠-٩۰-۹]+)\s+مواد$/)))
      return `${m[1]} of ${m[2]} items`;
    if ((m = key.match(/^عرض\s+المنخفضة\s+والنافدة\s*\(([0-9٠-٩۰-۹]+)\)$/)))
      return `Low or out-of-stock items (${m[1]})`;
    if ((m = key.match(/^عرض\s+قريبة\s+أو\s+منتهية\s+الصلاحية\s*\(([0-9٠-٩۰-۹]+)\)$/)))
      return `Items near or past expiration (${m[1]})`;
    if ((m = key.match(/^الحجوزات\s+المعلقة\s*\(([0-9٠-٩۰-۹]+)\)$/)))
      return `Pending bookings (${m[1]})`;
    if ((m = key.match(/^طلبات\s+التعديل\s*\(([0-9٠-٩۰-۹]+)\)$/)))
      return `Reschedule requests (${m[1]})`;
    if ((m = key.match(/^\(([0-9٠-٩۰-۹]+)\s+تقييم\)$/)))
      return `(${m[1]} reviews)`;
    if ((m = key.match(/^متوسط\s+التقييم\s+([\d.]+)\s+من\s+5\s+([0-9٠-٩۰-۹]+)\s+تقييم$/)))
      return `Average rating ${m[1]} of 5, ${m[2]} reviews`;
    if ((m = key.match(/^نتائج\s+الزيارة\s+وتقارير\s+الطبيب\s*\(([0-9٠-٩۰-۹]+)\)$/)))
      return `Visit results and doctor reports (${m[1]})`;
    if ((m = key.match(/^الزيارات\s+وتقارير\s+الطبيب\s*\(([0-9٠-٩۰-۹]+)\)$/)))
      return `Visits and doctor reports (${m[1]})`;
    if ((m = key.match(/^التقييمات\s+الأولية\s*\(([0-9٠-٩۰-۹]+)\)$/)))
      return `Initial assessments (${m[1]})`;
    if ((m = key.match(/^حساب\s+(.+?)\s*•\s*(.+)$/)) && m[1].length < 90 && m[2].length < 75)
      return `Account ${m[1]} • ${m[2]}`;
    if ((m = key.match(/^مدفوعة\s+(.+?)\s*•\s*متبقي\s+(.+)$/)))
      return `Paid ${m[1]} • Remaining ${m[2]}`;
    // Status counts and pagination are generated by system logic; translate
    // labels without touching the associated numeric values.
    if ((m = key.match(/^([0-9٠-٩۰-۹]+) (مؤكدة|انتظار|مكتملة) • ([0-9٠-٩۰-۹]+) (مؤكدة|انتظار|مكتملة) • ([0-9٠-٩۰-۹]+) (مؤكدة|انتظار|مكتملة)$/))) {
      return `${m[1]} ${UI_NUMBER_UNITS[m[2]]} • ${m[3]} ${UI_NUMBER_UNITS[m[4]]} • ${m[5]} ${UI_NUMBER_UNITS[m[6]]}`;
    }
    if ((m = key.match(/^([0-9٠-٩۰-۹]+) (.+)$/)) && UI_NUMBER_UNITS[m[2]]) {
      return `${m[1]} ${UI_NUMBER_UNITS[m[2]]}`;
    }
    if ((m = key.match(/^([0-9٠-٩۰-۹]+) (سنوات|أيام|ساعة|دقيقة)\+$/)))
      return `${m[1]}+ ${UI_NUMBER_UNITS[m[2]]}`;
    if ((m = key.match(/^صفحة\s+([0-9٠-٩۰-۹]+)\s+(?:من|\/)\s+([0-9٠-٩۰-۹]+)$/)))
      return `Page ${m[1]} of ${m[2]}`;
    if ((m = key.match(/^عرض\s+([0-9٠-٩۰-۹]+)\s+(موعد|عيادة معتمدة|فاتورة|خدمة)$/)))
      return `Showing ${m[1]} ${m[2]==='عيادة معتمدة'?'approved clinics':(UI_NUMBER_UNITS[m[2]]||m[2])}`;
    if ((m = key.match(/^فاتورة\s+([A-Za-z0-9-]+)\s*•\s*متبقي\s+([\d.,]+)\s*₪$/)))
      return `Invoice ${m[1]} • Remaining ${m[2]} ₪`;
    if ((m = key.match(/^([^•]+) • متبقي ([0-9٠-٩۰-۹.,]+) ₪$/)))
      return `${m[1]} • Remaining ${m[2]} ₪`;
    if ((m = key.match(/^مواعيدك ومهامك الفعلية في (.+?) ليوم (.+)\.$/)))
      return `Your appointments and tasks at ${m[1]} on ${m[2]}.`;
    if ((m = key.match(/^الإجمالي:\s*([\d.,]+)\s*₪\s*•\s*المدفوع:\s*([\d.,]+)\s*₪$/)))
      return `Total: ${m[1]} ₪ • Paid: ${m[2]} ₪`;
    if ((m = key.match(/^([\d.,]+)\s*₪\s*متبقي$/)))
      return `${m[1]} ₪ remaining`;
    if ((m = key.match(/^(.+?)\s*•\s*د\.\s*(.+)$/)) && m[1].length < 65 && m[2].length < 85)
      return `${m[1]} • Dr. ${m[2]}`;
    // Recognized date-only display strings are authored by the app, not
    // arbitrary user input or sensitive medical descriptions.
    if (/^(?:السبت|الأحد|الاحد|الاثنين|الإثنين|الثلاثاء|الأربعاء|الاربعاء|الخميس|الجمعة)[،, ]/.test(key)) {
      return key.replace(/السبت|الأحد|الاحد|الاثنين|الإثنين|الثلاثاء|الأربعاء|الاربعاء|الخميس|الجمعة|يناير|فبراير|مارس|أبريل|ابريل|مايو|يونيو|يوليو|أغسطس|اغسطس|سبتمبر|أكتوبر|اكتوبر|نوفمبر|ديسمبر/g,
        word => WEEKDAYS[word] || MONTHS[word] || word).replace(/،/g, ',');
    }
    for (const [source,target] of PREFIXES) {
      const normalizedSource = clean(source);
      if (key.startsWith(normalizedSource + ' ') && key.length > normalizedSource.length+1 && key.length < 180) {
        const rest = key.slice(normalizedSource.length).trim();
        // Avoid applying a short UI prefix to a long arbitrary clinical note.
        if (!rest.includes('。') && !/[\n.!؟]/.test(rest.slice(0, -1)))
          return `${target} ${rest}`;
      }
    }
    return null;
  }
  function translated(text) {
    if (lang !== 'en' || !ARABIC.test(text)) return text;
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
    if (!m) return text;
    const key = clean(m[2]);
    let result = dict[key] || dict[key.replace(/[.!؟]+$/,'')];
    if (result) {
      if (!dict[key] && /[!؟.]$/.test(key)) result += (key.endsWith('؟') ? '?' : key.slice(-1));
      return m[1] + convertDigits(result) + m[3];
    }
    const dynamic = knownDynamic(key);
    if (dynamic) return m[1] + convertDigits(dynamic) + m[3];
    for (const [pattern, render] of SYSTEM_TEMPLATES) {
      const found = key.match(pattern);
      if (found) return m[1] + render(found) + m[3];
    }
    // Unknown material may be a clinical note or user-supplied text.
    // Preserve it verbatim; never guess medical translations.
    return convertDigits(text);
  }
  function translateTextNode(node) {
    if (!node || !node.parentElement || node.parentElement.closest(SKIP)) return;
    const value = node.nodeValue;
    if (!value || !ARABIC.test(value)) return;
    const updated = translated(value);
    if (updated !== value) node.nodeValue = updated;
  }
  function translateElementAttributes(el) {
    if (!el || el.nodeType !== 1 || el.matches(SKIP) || el.closest('[translate="no"],[data-no-translate]')) return;
    for (const name of ATTRS) {
      const value = el.getAttribute(name);
      if (value && ARABIC.test(value)) {
        const updated = translated(value);
        if (value !== updated) el.setAttribute(name, updated);
      }
    }
  }
  function translateTree(root) {
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) return translateTextNode(root);
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
    if (root.nodeType === Node.ELEMENT_NODE) translateElementAttributes(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          return node.matches(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let node;
    while ((node = walker.nextNode())) {
      if (node.nodeType === Node.TEXT_NODE) translateTextNode(node);
      else translateElementAttributes(node);
    }
  }
  function start() {
    addLanguageControl();
    if (lang !== 'en') return;
    fetch('/assets/i18n-en.json', { credentials: 'same-origin', cache: 'no-cache' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error('Locale dictionary unavailable')))
      .then(data => {
        dict = Object.create(null);
        for (const [source, target] of Object.entries(data)) dict[clean(source)] = target;
        // Theme and page title must be translated together with the page body.
        document.title = translated(document.title);
        translateTree(document.body);
        // Native browser dialogs are not DOM nodes; localize recognized
        // system messages while preserving their original return values.
        const originalAlert = window.alert.bind(window);
        const originalConfirm = window.confirm.bind(window);
        const originalPrompt = window.prompt.bind(window);
        window.alert = message => originalAlert(translated(String(message)));
        window.confirm = message => originalConfirm(translated(String(message)));
        window.prompt = (message, initial) => originalPrompt(translated(String(message)), initial);
        observer = new MutationObserver(mutations => {
          for (const item of mutations) {
            if (item.type === 'characterData') translateTextNode(item.target);
            if (item.type === 'attributes') translateElementAttributes(item.target);
            for (const added of item.addedNodes) translateTree(added);
          }
        });
        observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:ATTRS});
      })
      .catch(error => { console.warn('[I18N_DICTIONARY_NOT_LOADED]', error.message); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true});
  else start();
})();
