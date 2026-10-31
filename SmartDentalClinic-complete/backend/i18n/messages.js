'use strict';
// Translate only known, authored system messages. Never translate arbitrary
// patient notes, medical records, database values, or user-provided content.
const dictionary = require('../../public/assets/i18n-en.json');
const normalize = value => String(value || '').replace(/\u0640/g,'').replace(/[\u064b-\u065f]/g,'').replace(/\s+/g,' ').trim();
const safe = Object.create(null);
for (const [ar,en] of Object.entries(dictionary)) {
  if (typeof en === 'string' && en && !/[\u0600-\u06ff]/.test(en)) safe[normalize(ar)] = en;
}
function translate(value, language='ar') {
  if (language !== 'en' || typeof value !== 'string') return value;
  const key=normalize(value);
  return Object.hasOwn(safe,key) ? safe[key] : value;
}
function middleware(req,res,next) {
  res.locals.t = value => translate(value,res.locals.lang);
  res.locals.sdcT = res.locals.t;
  const send=res.send;
  // Preserve response bodies and status codes; translate plain, standalone
  // system error messages only. Do not rewrite rendered HTML/JSON/downloads.
  res.send=function(body) {
    if (res.locals.lang==='en' && typeof body==='string' && body.length<1500 && /[\u0600-\u06ff]/.test(body)) {
      const ct=String(res.getHeader('Content-Type')||'').toLowerCase();
      if (!ct || ct.startsWith('text/plain')) body=translate(body,'en');
    }
    return send.call(this,body);
  };
  next();
}
module.exports={translate,middleware};
