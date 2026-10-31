/* Smart Dental Clinic — progressive enhancement for native POST forms.
 * Errors remain on the current page; successes preserve server redirect behavior.
 * No form values are written to storage or logged. If JS is unavailable, forms remain native.
 */
(() => {
  'use strict';
  if (!window.fetch || !window.FormData || !window.URL) return;

  const urlErrorText = {
    csrf: 'انتهت صلاحية نموذج الحماية. حدّث الصفحة قبل إعادة المحاولة.',
    invalid: 'راجع البيانات المدخلة وتأكد من إكمال الحقول المطلوبة.',
    failed: 'تعذّر تنفيذ العملية. حاول مرة أخرى أو راجع حالة السجل.',
    forbidden: 'لا تملك صلاحية تنفيذ هذا الإجراء.',
    unauthorized: 'لا تملك صلاحية تنفيذ هذا الإجراء.',
    conflict: 'لا يمكن تنفيذ العملية بسبب تعارض مع البيانات أو الحالة الحالية.',
    duplicate: 'هذه البيانات موجودة مسبقًا.',
    unavailable: 'الخدمة أو الموعد المطلوب غير متاح حاليًا.',
    not_found: 'السجل المطلوب غير موجود أو لم يعد متاحًا.',
    state: 'لا يمكن تنفيذ العملية في الحالة الحالية للسجل.',
    closed: 'أُغلقت هذه العملية أو انتهت الفترة المتاحة لها.',
    expired: 'انتهت صلاحية الطلب. حدّث الصفحة وحاول من جديد.',
    blocked: 'لا يمكن تنفيذ الإجراء في الوقت الحالي.'
  };
  const failingResult = new Set(Object.keys(urlErrorText).concat(['error', 'rejected', 'denied', 'already_reviewed']));
  const failedCode = /^(?:error|failed|invalid|denied|blocked|conflict|expired|csrf|unavailable|forbidden|unauthorized|duplicate|not_found|closed|rejected|state)$/i;
  const errorPhrase = (code) => urlErrorText[String(code).toLowerCase()] || 'تعذّر إتمام العملية. راجع البيانات أو حالة السجل ثم حاول مجددًا.';

  function redirectFailure(response) {
    if (!response.redirected || !response.url) return null;
    let destination;
    try { destination = new URL(response.url, location.href); } catch { return null; }
    if (destination.origin !== location.origin) return null;
    const params = destination.searchParams;
    if (params.has('error') && params.get('error')) return errorPhrase(params.get('error'));
    if (params.has('rating_error') && params.get('rating_error')) return errorPhrase(params.get('rating_error'));
    if (params.has('password_error') && params.get('password_error')) return errorPhrase(params.get('password_error'));
    const status = params.get('result');
    if (status && (failingResult.has(status.toLowerCase()) || failedCode.test(status))) return errorPhrase(status);
    return null;
  }

  function banner() {
    let notice = document.getElementById('sdc-form-error-notice');
    if (notice) return notice;
    notice = document.createElement('div');
    notice.id = 'sdc-form-error-notice';
    notice.className = 'sdc-form-error-notice';
    notice.setAttribute('role', 'alert');
    notice.setAttribute('aria-live', 'assertive');
    notice.setAttribute('dir', 'rtl');
    notice.hidden = true;
    const message = document.createElement('span');
    message.className = 'sdc-form-error-message';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'sdc-form-error-dismiss';
    close.setAttribute('aria-label', 'إغلاق رسالة الخطأ');
    close.textContent = '×';
    close.addEventListener('click', () => { notice.hidden = true; });
    notice.append(message, close);
    document.body.appendChild(notice);
    return notice;
  }

  function show(message) {
    const notice = banner();
    notice.querySelector('.sdc-form-error-message').textContent = message;
    notice.hidden = false;
  }

  const defaultError = status => ({
    400: 'بيانات الطلب غير صالحة. راجع الحقول وحاول مجددًا.',
    401: 'انتهت جلسة الدخول. سجّل الدخول ثم أعد المحاولة.',
    403: 'العملية غير مسموحة أو انتهت صلاحية نموذج الحماية. تحقق من الصلاحيات.',
    404: 'السجل المطلوب غير موجود أو لم يعد متاحًا.',
    405: 'هذا الإجراء غير مسموح من الصفحة الحالية.',
    409: 'تعارض في حالة السجل أو البيانات. حدّث المعلومات قبل إعادة المحاولة.',
    413: 'حجم البيانات أو الملف أكبر من الحد المسموح.',
    422: 'راجع الحقول المطلوبة وتأكد من صحة البيانات المدخلة.',
    429: 'تم إرسال طلبات كثيرة. أعد المحاولة لاحقًا.',
    500: 'حدث خطأ غير متوقع في الخادم. لم نتمكن من تأكيد نتيجة العملية.',
    502: 'تعذّر الاتصال بالخدمة حاليًا. تحقق من نتيجة العملية لاحقًا.',
    503: 'الخدمة غير متاحة مؤقتًا. تحقق من نتيجة العملية قبل تكرار الطلب.'
  }[status] || 'تعذّر إتمام العملية. تحقق من البيانات وحاول مرة أخرى.');

  async function failureMessage(response) {
    const fallback = defaultError(response.status);
    try {
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const payload = await response.json();
        const message = payload && (payload.message || payload.error);
        // Never surface arbitrary backend objects or technical diagnostics.
        if (typeof message === 'string') return safeMessage(message, fallback);
      } else if (contentType.includes('text/plain')) {
        return safeMessage(await response.text(), fallback);
      } else if (contentType.includes('text/html')) {
        const html = await response.text();
        const page = new DOMParser().parseFromString(html, 'text/html');
        const alert = page.querySelector('.alert-danger, [data-form-error], [role="alert"], .text-danger');
        if (alert) return safeMessage(alert.textContent, fallback);
      }
    } catch { /* retain the human-readable fallback */ }
    return fallback;
  }
  function safeMessage(value, fallback) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text || text.length > 260 || /page rendering error|<!doctype|<html|\b(?:select|insert|update|delete)\s+.+\bfrom\b|stack trace|syntaxerror|syntax error at|sqlstate|exception| at .*\.js:\d+/i.test(text)) return fallback;
    return text;
  }

  // Window is the last bubbling phase: existing per-form and document validators
  // run first. If they handled an event, we deliberately do nothing.
  window.addEventListener('submit', async event => {
    if (event.defaultPrevented) return;
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (form.matches('[data-ui-unbound], [data-inline-form-errors="off"]')) return;
    const submitter = event.submitter || null;
    const method = (submitter?.getAttribute('formmethod') || form.getAttribute('method') || 'get').toLowerCase();
    if (method !== 'post') return;
    const target = submitter?.getAttribute('formtarget') || form.getAttribute('target') || '';
    if (target && target !== '_self') return;
    const enctype = (submitter?.getAttribute('formenctype') || form.getAttribute('enctype') || 'application/x-www-form-urlencoded').toLowerCase();
    if (!['application/x-www-form-urlencoded', 'multipart/form-data'].includes(enctype)) return;

    let destination;
    try { destination = new URL(submitter?.getAttribute('formaction') || form.getAttribute('action') || location.href, document.baseURI); }
    catch { return; }
    if (!/^https?:$/.test(destination.protocol) || destination.origin !== location.origin) return;
    if (!form.checkValidity() && !submitter?.formNoValidate && !form.noValidate) return;
    event.preventDefault();
    if (form.dataset.sdcSending === '1') return;
    form.dataset.sdcSending = '1';
    form.setAttribute('aria-busy', 'true');
    try {
      const payload = new FormData(form);
      if (submitter?.name && !submitter.disabled) {
        // Include the clicked button name/value, like a normal native submit.
        // Explicitly account for buttons outside the form via form="...".
        payload.append(submitter.name, submitter.value);
      }
      const options = {
        method: 'POST', credentials: 'same-origin', redirect: 'follow',
        headers: { 'X-SDC-Inline-Errors': '1', 'X-Requested-With': 'XMLHttpRequest' }, cache: 'no-store',
        body: enctype === 'multipart/form-data' ? payload : new URLSearchParams(payload)
      };
      const response = await fetch(destination.href, options);
      if (!response.ok) {
        show(await failureMessage(response));
        return;
      }
      const redirectError = redirectFailure(response);
      if (redirectError) { show(redirectError); return; }
      if (response.redirected && response.url) {
        const next = new URL(response.url, location.href);
        if (next.origin === location.origin) location.assign(next.href);
        else show('تعذّر فتح وجهة العملية بشكل آمن.');
        return;
      }
      // Non-redirect successful responses keep their original server result:
      // HTML is displayed; JSON/204 mutate the data and refresh the current view.
      const content = response.headers.get('content-type') || '';
      if (content.includes('text/html')) {
        const html = await response.text();
        document.open(); document.write(html); document.close();
      } else if (content.includes('application/json') || response.status === 204) {
        location.reload();
      } else {
        show('تم إرسال الطلب. تحقق من الصفحة قبل تكرار العملية.');
      }
    } catch (error) {
      // A connection failure does not prove the database write was rolled back.
      show('انقطع الاتصال أثناء تنفيذ الطلب. قد تكون العملية تمت؛ تحقّق من النتيجة قبل إعادة الإرسال.');
    } finally {
      delete form.dataset.sdcSending;
      form.removeAttribute('aria-busy');
    }
  });
})();
