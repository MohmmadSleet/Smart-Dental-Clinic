// Smart Dental Clinic - SSR UI preview with clean URL routing.
// WARNING: These are preview pages with sample data. Authentication, authorization,
// database access and backend form handlers will be built incrementally.
'use strict';
const express = require('express');
const path = require('node:path');
const pages = require('./config/page-map.json');
const app = express();

app.disable('x-powered-by');
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// The allowlist maps stable public URLs to actual EJS templates.
// Never render a template using arbitrary user-provided paths.
const cleanRoutes = Object.create(null);
for (const legacyKey of Object.keys(pages)) {
  if (!legacyKey.endsWith('.html')) throw new Error(`Unexpected page-map key: ${legacyKey}`);
  const slug = legacyKey.slice(0, -'.html'.length);
  if (Object.prototype.hasOwnProperty.call(cleanRoutes, slug)) {
    throw new Error(`Duplicate clean route: ${slug}`);
  }
  cleanRoutes[slug] = legacyKey;
}

// Keep CSS, images and role-specific interaction JS in /public.
app.use(express.static(path.join(__dirname, 'public'), { index: false, dotfiles: 'deny' }));

// Old bookmarks continue to work, but canonical navigation uses clean URLs.
// Redirect only known pages (never redirect arbitrary .html paths).
app.get(/^\/.*\.html$/, (req, res, next) => {
  const legacyKey = req.path.slice(1);
  if (!Object.prototype.hasOwnProperty.call(pages, legacyKey)) return next();
  const cleanPath = '/' + legacyKey.slice(0, -'.html'.length);
  const queryIndex = req.originalUrl.indexOf('?');
  const queryString = queryIndex === -1 ? '' : req.originalUrl.slice(queryIndex);
  return res.redirect(301, cleanPath + queryString);
});

function renderPage(req, res, next) {
  // /index is the clean counterpart of /index.html; / is an additional home alias.
  const slug = req.path === '/' ? 'index' : req.path.slice(1);
  if (!Object.prototype.hasOwnProperty.call(cleanRoutes, slug)) return next();
  const key = cleanRoutes[slug];
  const item = pages[key];
  const css = (kind, href) => {
    const classes = item[kind + 'ActiveClasses'][href];
    return classes ? ' ' + classes : '';
  };
  const aria = (kind, href) => item[kind + 'Aria'][href] === 'page' ? ' aria-current="page"' : '';
  res.render(item.view, {
    currentPage: key,
    role: item.role,
    navVariant: item.navVariant,
    drawerVariant: item.drawerVariant,
    footerVariant: item.footerVariant,
    navActiveClass: href => css('nav', href),
    navAriaCurrent: href => aria('nav', href),
    drawerActiveClass: href => css('drawer', href),
    drawerAriaCurrent: href => aria('drawer', href),
  }, (error, html) => {
    if (error) return next(error);
    res.type('html').send(html);
  });
}
app.get(['/', /^\/(?:.+\/)?[^/]+$/], renderPage);
app.use((req, res) => res.status(404).type('text/plain').send('Page not found'));
app.use((err, req, res, next) => {
  console.error('SSR render error:', err.message);
  if (res.headersSent) return next(err);
  res.status(500).type('text/plain').send('Page rendering error');
});

const port = Number.parseInt(process.env.PORT || '3000', 10);
if (require.main === module) {
  app.listen(port, () => console.log(`Smart Dental Clinic preview: http://localhost:${port}`));
}
module.exports = app;
