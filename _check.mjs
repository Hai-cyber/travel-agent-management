import { readFileSync } from 'fs';
const ss = readFileSync('src/lib/siteStudio.js','utf8');
const tn = readFileSync('src/routes/tenants.js','utf8');
const pg = readFileSync('src/routes/pages.js','utf8');
const ve = readFileSync('public/visual-editor.html','utf8');

const checks = {
  'siteStudio: injectHeaderUiControls fn':   ss.includes('function injectHeaderUiControls'),
  'siteStudio: showPhone widget':            ss.includes('data-ve-nav-phone'),
  'siteStudio: showCart widget':             ss.includes('data-ve-nav-cart'),
  'siteStudio: showContactForm widget':      ss.includes('data-ve-nav-contact'),
  'siteStudio: navConfig param in canvas':   ss.includes('navConfig,'),
  'siteStudio: navConfig passed to canvas':  ss.includes('navConfig,\n      customSections,'),
  'siteStudio: navConfig read from cfg':     ss.includes('navigation_config && typeof cfg.navigation_config'),
  'siteStudio: injectHeaderUiControls call': ss.includes('injectHeaderUiControls(headerHtml, navConfig)'),
  'tenants: navigation_config in PATCH':     tn.includes("'navigation_config' in body"),
  'tenants: navigation_config in GET resp':  tn.includes('navigation_config: cfg.navigation_config'),
  'pages: blank sections JSON on create':    pg.includes("sections: [] }),"),
  'pages: sectionsKey defined':              pg.includes('sectionsKey ='),
  'VE: nav-phone-chk checkbox':              ve.includes('nav-phone-chk'),
  'VE: nav-cart-chk checkbox':               ve.includes('nav-cart-chk'),
  'VE: nav-contact-chk checkbox':            ve.includes('nav-contact-chk'),
  'VE: navUiSaveBtn handler':                ve.includes('navUiSaveBtn.addEventListener'),
  'VE: S.navConfig in state':                ve.includes('navConfig:      { showPhone'),
  'VE: patchConfig navigation_config call':  ve.includes('navigation_config: nc'),
};
let pass=0, fail=0;
for (const [k,v] of Object.entries(checks)) {
  console.log((v ? '✓' : '✗'), k);
  v ? pass++ : fail++;
}
console.log(`\n${pass}/${pass+fail} checks passed`);
