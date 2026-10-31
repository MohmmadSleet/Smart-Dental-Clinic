'use strict';
// No database changes: the chosen interface language is stored in a minimal
// SameSite cookie, isolated from authentication/session cookies.
const LANG_COOKIE = 'sdc_lang';
const LANGS = new Set(['ar', 'en']);
function languageOf(req) {
  const header = String(req.headers.cookie || '');
  const match = header.match(/(?:^|;\s*)sdc_lang=(ar|en)(?:;|$)/);
  return match ? match[1] : 'ar';
}
function middleware(req, res, next) {
  const lang = languageOf(req);
  res.locals.lang = lang;
  res.locals.locale = lang === 'en' ? 'en-GB' : 'ar-PS';
  res.set('Content-Language', lang);
  res.vary('Cookie');
  next();
}
function switchLanguage(req, res) {
  const lang = String(req.params.lang || '');
  if (!LANGS.has(lang)) return res.status(400).send('Unsupported language');
  res.cookie(LANG_COOKIE, lang, {
    path: '/', httpOnly: false, sameSite: 'lax', secure: Boolean(req.secure),
    maxAge: 365 * 24 * 60 * 60 * 1000
  });
  // Local-path redirects only: prevent open redirects or arbitrary protocols.
  const dest = String(req.query.next || '/');
  const safe = dest.startsWith('/') && !dest.startsWith('//') && !/[\\\r\n]/.test(dest) ? dest : '/';
  res.set('Cache-Control', 'no-store');
  return res.redirect(303, safe);
}
module.exports = { middleware, switchLanguage, languageOf };
