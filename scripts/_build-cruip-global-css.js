'use strict';
const fs   = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

// Source: mosaic-html/style.css — Tailwind CSS v4.0.1, 5553 lines, largest build.
// It contains the fullest utility set across all 20 Cruip templates.
const cruipCss   = fs.readFileSync(path.join(ROOT, 'templates/mosaic-html/style.css'), 'utf8');
const globalCss  = fs.readFileSync(path.join(ROOT, 'public/css/tailwind-global.css'), 'utf8');

// From tailwind-global.css keep only the editor chrome rules (from :root onwards).
// Strip the long header comment that referenced HTML5UP and Tailwind CDN notes.
const chromeStart = globalCss.indexOf(':root {');
const editorChrome = chromeStart !== -1 ? globalCss.slice(chromeStart) : '';

const header = [
  '/*!',
  ' * cruip-global.css',
  ' *',
  ' * Single shared stylesheet for all Cruip Tailwind v4 templates.',
  ' *',
  ' * Contents:',
  ' *   1. Tailwind CSS v4 compiled output — from mosaic-html/style.css',
  ' *      (largest / most complete utility set across all 20 Cruip templates)',
  ' *   2. Brand CSS custom properties  — :root tokens overridden at runtime',
  ' *      by site_config.brand.primary_color inline <style> injection',
  ' *   3. Visual Editor chrome         — section overlays, inline-edit rings,',
  ' *      add-block dividers, image-replace overlays',
  ' *',
  ' * Served at : /css/cruip-global.css  (static Worker asset in public/css/)',
  ' * Also in R2: shared/cruip-global.css  (for deploy-time consistency)',
  ' *',
  ' * Replaces  : /css/tailwind-global.css (retired)',
  ' *             per-template style.css links (stripped by siteStudio.js)',
  ' *',
  ' * Regenerate: node scripts/_build-cruip-global-css.js',
  ' */',
].join('\n');

const output = [header, '', cruipCss, '', '/* ── Visual Editor chrome ─────────────────────────────────────────────────── */', editorChrome].join('\n');

fs.mkdirSync(path.join(ROOT, 'public/css'), { recursive: true });
const dest = path.join(ROOT, 'public/css/cruip-global.css');
fs.writeFileSync(dest, output, 'utf8');

const lines = output.split('\n').length;
const kib   = Math.round(Buffer.byteLength(output, 'utf8') / 1024);
console.log('Written: public/css/cruip-global.css  (' + lines + ' lines, ' + kib + ' KiB)');
