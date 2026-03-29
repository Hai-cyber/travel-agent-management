#!/usr/bin/env python3
"""write_studio_v4.py — full Site Studio visual-editor.html rewrite (Odoo-style)"""
import sys

HTML = r"""<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Site Studio</title>
<style>
/* ── Variables ─────────────────────────────────────────────────────── */
:root {
  --bg0: #06080f; --bg1: #0a0f1e; --bg2: #0f172a; --bg3: #1e293b;
  --bd:  #1e293b; --bd2: #334155;
  --acc: #6366f1; --acc2: #5253cc;
  --grn: #10b981; --amb: #f59e0b; --red: #ef4444;
  --tx:  #e2e8f0; --tx2: #94a3b8; --tx3: #475569;
  --r:   7px;
}
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; overflow: hidden; background: var(--bg0);
             color: var(--tx); font: 13px/1.5 ui-sans-serif,system-ui,sans-serif; }
/* ── Layout ─────────────────────────────────────────────────────────── */
.app          { display: flex; flex-direction: column; height: 100vh; }
.mgmt-bar     { flex-shrink: 0; background: var(--bg2); border-bottom: 1px solid var(--bd); }
.mgmt-row     { display: flex; align-items: center; gap: 8px; padding: 0 14px; }
.mgmt-row-1   { height: 48px; }
.mgmt-row-2   { height: 36px; border-top: 1px solid var(--bd);
                overflow: hidden; transition: height .18s; }
.mgmt-row-2.collapsed { height: 0; }
.workspace    { display: flex; flex: 1; overflow: hidden; }
/* ── Sidebar ────────────────────────────────────────────────────────── */
.sidebar      { width: 272px; min-width: 272px; background: var(--bg1);
                border-right: 1px solid var(--bd); display: flex;
                flex-direction: column; overflow: hidden; }
.sb-tabs      { display: flex; flex-shrink: 0; border-bottom: 1px solid var(--bd);
                background: var(--bg2); }
.sb-tab       { flex: 1; padding: 8px 4px; font-size: 11px; font-weight: 700;
                text-align: center; cursor: pointer; user-select: none;
                border: none; background: transparent; color: var(--tx3);
                border-bottom: 2px solid transparent; transition: all .12s; }
.sb-tab:hover { color: var(--tx); }
.sb-tab.active{ color: var(--acc); border-bottom-color: var(--acc); }
.sb-body      { flex: 1; overflow-y: auto; }
.sb-body::-webkit-scrollbar { width: 4px; }
.sb-body::-webkit-scrollbar-thumb { background: var(--bg3); border-radius: 2px; }
/* ── Canvas ─────────────────────────────────────────────────────────── */
.canvas       { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.canvas-bar   { height: 34px; min-height: 34px; display: flex; align-items: center;
                gap: 8px; padding: 0 12px; background: var(--bg2);
                border-bottom: 1px solid var(--bd); flex-shrink: 0; }
.canvas-url   { flex: 1; font-size: 11px; color: var(--tx3);
                overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.canvas-empty { flex: 1; display: flex; flex-direction: column; align-items: center;
                justify-content: center; gap: 14px; color: var(--tx3); }
.canvas-empty svg { opacity: .25; }
#frame        { flex: 1; border: none; display: none; background: #fff; }
/* ── Components ─────────────────────────────────────────────────────── */
.btn { display: inline-flex; align-items: center; gap: 5px; border-radius: var(--r);
       cursor: pointer; font: 600 12px/1 ui-sans-serif,system-ui,sans-serif;
       padding: 6px 14px; border: none; transition: all .12s; white-space: nowrap; }
.btn:disabled { opacity: .4; pointer-events: none; }
.btn-p  { background: var(--acc); color: #fff; }
.btn-p:hover  { background: var(--acc2); }
.btn-g  { background: var(--grn); color: #fff; }
.btn-g:hover  { background: #059669; }
.btn-o  { background: transparent; border: 1px solid var(--bd2); color: var(--tx2); }
.btn-o:hover  { border-color: var(--acc); color: #c7d2fe; }
.btn-d  { background: transparent; border: 1px solid var(--red); color: var(--red); font-size: 11px; padding: 5px 10px; }
.btn-d:hover  { background: rgba(239,68,68,.12); }
.btn-sm { font-size: 11px; padding: 4px 10px; }
.inp  { background: var(--bg2); border: 1px solid var(--bd); border-radius: var(--r);
        color: var(--tx); font: 12px ui-sans-serif,system-ui,sans-serif;
        padding: 6px 9px; outline: none; transition: border-color .12s; }
.inp:focus { border-color: var(--acc); }
.inp-full { width: 100%; }
select.inp { cursor: pointer; appearance: none; }
textarea.inp { resize: vertical; min-height: 55px; line-height: 1.5; }
.sep { width: 1px; height: 22px; background: var(--bd); margin: 0 2px; flex-shrink: 0; }
.badge { font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 20px;
         background: var(--bg3); color: var(--tx2); border: 1px solid var(--bd2); }
.badge.amber { background: #451a03; color: var(--amb); border-color: var(--amb); }
.badge.green { background: #052e16; color: var(--grn); border-color: var(--grn); }
/* ── Toast ──────────────────────────────────────────────────────────── */
#toast { position: fixed; bottom: 18px; left: 50%; transform: translateX(-50%);
         padding: 9px 18px; border-radius: 10px; font-size: 12px; font-weight: 600;
         z-index: 9999; display: none; white-space: nowrap;
         box-shadow: 0 6px 24px rgba(0,0,0,.5); }
#toast.ok  { background: #052e16; color: #6ee7b7; border: 1px solid var(--grn); }
#toast.err { background: #1f0a0a; color: #fca5a5; border: 1px solid var(--red); }
#toast.inf { background: var(--bg2); color: var(--tx2); border: 1px solid var(--bd2); }
/* ── Snippet accordion ───────────────────────────────────────────────── */
.acc-group { border-bottom: 1px solid var(--bd); }
.acc-hdr   { display: flex; align-items: center; gap: 8px; padding: 9px 12px;
             background: var(--bg1); border: none; width: 100%; text-align: left;
             cursor: pointer; user-select: none; }
.acc-hdr:hover { background: var(--bg2); }
.acc-hdr-title { flex: 1; font-size: 10px; font-weight: 800; text-transform: uppercase;
                  letter-spacing: .07em; color: var(--tx3); }
.acc-hdr-count { font-size: 9px; font-weight: 700; background: #1e3060;
                  color: #93c5fd; border-radius: 10px; padding: 1px 6px; }
.acc-arrow     { font-size: 9px; color: var(--tx3); transition: transform .18s; }
.acc-group.open .acc-hdr        { background: var(--bg2); }
.acc-group.open .acc-hdr-title  { color: #c7d2fe; }
.acc-group.open .acc-arrow      { transform: rotate(90deg); color: var(--acc); }
.acc-body  { display: none; padding: 8px; }
.acc-group.open .acc-body { display: block; }
/* ── Snippet cards (2-col grid) ─────────────────────────────────────── */
.snip-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.snip-card { background: var(--bg2); border: 1.5px solid var(--bd2); border-radius: 8px;
             overflow: hidden; cursor: pointer; user-select: none;
             transition: border-color .12s, transform .12s, box-shadow .12s;
             display: flex; flex-direction: column; }
.snip-card:hover { border-color: var(--acc); transform: translateY(-1px);
                    box-shadow: 0 4px 14px rgba(99,102,241,.22); }
.snip-card.inserting { opacity: .4; pointer-events: none; }
.snip-card.inserted  { border-color: var(--grn); box-shadow: 0 0 0 2px rgba(16,185,129,.25); }
.snip-thumb  { width: 100%; height: 60px; object-fit: cover; display: block; background: var(--bg3); }
.snip-ph     { width: 100%; height: 60px; display: flex; align-items: center;
               justify-content: center; font-size: 20px;
               background: linear-gradient(135deg, #1e3a5f, var(--bg1)); }
.snip-foot   { padding: 5px 7px 6px; display: flex; align-items: center; gap: 4px; }
.snip-lbl    { font-size: 9px; font-weight: 700; color: var(--tx2);
               overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* ── Image editor panel ─────────────────────────────────────────────── */
.img-panel   { padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; }
.img-panel--hidden { display: none; }
.field       { display: flex; flex-direction: column; gap: 4px; }
.field label { font-size: 10px; font-weight: 600; color: var(--tx3); }
.range-row   { display: flex; align-items: center; gap: 8px; }
.range-row input[type=range] { flex: 1; accent-color: var(--acc); cursor: pointer; }
.range-row .range-val { font-size: 11px; color: var(--tx2); width: 32px; text-align: right; }
/* ── Nav builder row ────────────────────────────────────────────────── */
.nav-items   { display: flex; align-items: center; gap: 6px; flex: 1;
               overflow-x: auto; padding: 4px 0; }
.nav-items::-webkit-scrollbar { height: 3px; }
.nav-items::-webkit-scrollbar-thumb { background: var(--bg3); border-radius: 2px; }
.nav-chip    { display: inline-flex; align-items: center; gap: 4px;
               background: var(--bg3); border: 1px solid var(--bd2); border-radius: 20px;
               padding: 2px 8px; font-size: 11px; white-space: nowrap; }
.nav-chip-del{ background: transparent; border: none; color: var(--red);
               cursor: pointer; font-size: 12px; line-height: 1; padding: 0 2px; }
.nav-chip-del:hover { color: #fca5a5; }
/* ── Status rows ────────────────────────────────────────────────────── */
.status-line { font-size: 10px; padding: 4px 8px; border-radius: 5px; display: none; }
.status-line.ok  { background: #052e16; color: #6ee7b7; border: 1px solid var(--grn); display: block; }
.status-line.err { background: #1f0a0a; color: #fca5a5; border: 1px solid var(--red); display: block; }
/* ── Modal ──────────────────────────────────────────────────────────── */
.modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.7);
                   z-index: 1000; display: none; align-items: center; justify-content: center; }
.modal-backdrop.open { display: flex; }
.modal-box   { background: var(--bg2); border: 1px solid var(--bd2); border-radius: 12px;
               padding: 22px 24px; width: 360px; display: flex; flex-direction: column; gap: 14px; }
.modal-title { font-size: 14px; font-weight: 700; }
.modal-foot  { display: flex; gap: 8px; justify-content: flex-end; }
/* ── Preview FAB ──────────────────────────────────────────────────────── */
#edit-fab    { position: fixed; top: 14px; right: 14px; z-index: 900;
               background: var(--acc); color: #fff; border: none; border-radius: 30px;
               padding: 8px 18px; font: 700 13px ui-sans-serif,system-ui,sans-serif;
               cursor: pointer; box-shadow: 0 4px 20px rgba(99,102,241,.45);
               display: none; transition: all .15s; }
#edit-fab:hover { background: var(--acc2); transform: scale(1.04); }
/* ── Preview mode overlay ─────────────────────────────────────────────── */
.app.preview-mode .mgmt-bar { display: none; }
.app.preview-mode .sidebar  { display: none; }
.app.preview-mode .canvas   { width: 100%; }
.app.preview-mode #frame    { display: block !important; }
.app.preview-mode #edit-fab { display: block; }
</style>
</head>
<body>
<div class="app" id="app">

  <!-- ═══ Top Management Bar ═════════════════════════════════════════════ -->
  <div class="mgmt-bar" id="mgmt-bar">

    <!-- Row 1: Tenant | Pages | Actions -->
    <div class="mgmt-row mgmt-row-1">

      <!-- Zone: Branding + Tenant -->
      <span style="font-size:13px;font-weight:800;color:var(--acc);letter-spacing:.04em;margin-right:4px">⚡ Studio</span>
      <input class="inp" id="tenant-input" placeholder="Tenant ID" autocomplete="off" style="width:160px">
      <button class="btn btn-p btn-sm" id="load-btn">▶ Load</button>

      <div class="sep"></div>

      <!-- Zone: Page Manager -->
      <select class="inp" id="page-select" disabled style="width:160px">
        <option value="">🏠 Homepage</option>
      </select>
      <button class="btn btn-o btn-sm" id="new-page-btn" disabled title="New page">+ Page</button>
      <button class="btn btn-d btn-sm" id="del-page-btn" disabled title="Delete page">✕</button>

      <div class="sep"></div>

      <!-- Zone: Auto-menu tick -->
      <label style="display:flex;align-items:center;gap:5px;cursor:pointer;user-select:none;white-space:nowrap">
        <input type="checkbox" id="auto-menu-chk" style="accent-color:var(--acc);" checked>
        <span style="font-size:11px;color:var(--tx2)">Auto Menu</span>
      </label>
      <button class="btn btn-o btn-sm" id="nav-toggle-btn" title="Toggle Menu Builder">☰ Menu</button>

      <div class="sep"></div>

      <!-- Zone: Save / Publish -->
      <span class="badge" id="mode-badge">● Idle</span>
      <button class="btn btn-o btn-sm" id="save-draft-btn" disabled>💾 Save Draft</button>
      <button class="btn btn-g btn-sm" id="publish-btn" disabled>▶ Publish</button>
    </div>

    <!-- Row 2: Menu / Nav Builder -->
    <div class="mgmt-row mgmt-row-2 collapsed" id="nav-row">
      <span style="font-size:10px;font-weight:700;color:var(--tx3);white-space:nowrap">Nav:</span>
      <div class="nav-items" id="nav-items-list">
        <span style="font-size:11px;color:var(--tx3);font-style:italic">No items yet</span>
      </div>
      <button class="btn btn-o btn-sm" id="nav-add-btn">+ Add</button>
      <button class="btn btn-g btn-sm" id="nav-save-btn">Save Menu</button>
    </div>
  </div>

  <!-- ═══ Workspace ══════════════════════════════════════════════════════ -->
  <div class="workspace">

    <!-- Sidebar -->
    <aside class="sidebar" id="sidebar">
      <div class="sb-tabs">
        <button class="sb-tab active" id="tab-snip" data-tab="snip">📦 Snippets</button>
        <button class="sb-tab" id="tab-img"  data-tab="img">🖼 Image</button>
      </div>
      <div class="sb-body" id="sb-body">

        <!-- Panel: Snippets accordion -->
        <div id="panel-snip">
          <div style="padding:12px;font-size:11px;color:var(--tx3)">
            Load a tenant to browse snippets.
          </div>
        </div>

        <!-- Panel: Image editor -->
        <div id="panel-img" class="img-panel img-panel--hidden">
          <div style="font-size:11px;font-weight:700;color:var(--tx2)">🖼 Image Editor</div>
          <div class="field">
            <label>Image URL</label>
            <input class="inp inp-full" type="text" id="img-url" placeholder="https://…">
          </div>
          <div class="field">
            <label>Position X</label>
            <div class="range-row">
              <input type="range" id="img-pos-x" min="0" max="100" value="50">
              <span class="range-val" id="img-pos-x-val">50%</span>
            </div>
          </div>
          <div class="field">
            <label>Position Y</label>
            <div class="range-row">
              <input type="range" id="img-pos-y" min="0" max="100" value="50">
              <span class="range-val" id="img-pos-y-val">50%</span>
            </div>
          </div>
          <div class="field">
            <label>Scale</label>
            <div class="range-row">
              <input type="range" id="img-scale" min="50" max="200" value="100">
              <span class="range-val" id="img-scale-val">100%</span>
            </div>
          </div>
          <button class="btn btn-p" id="img-apply-btn" style="width:100%">Apply &amp; Preview</button>
          <button class="btn btn-g" id="img-save-btn"  style="width:100%">💾 Save Image</button>
          <button class="btn btn-o btn-sm" id="img-cancel-btn" style="width:100%">← Back to Snippets</button>
          <div class="status-line" id="img-status"></div>
          <div style="padding:6px 0;font-size:10px;color:var(--tx3);line-height:1.6">
            Click any image in the preview to edit it here.
          </div>
        </div>

      </div>
    </aside>

    <!-- Canvas -->
    <div class="canvas">
      <div class="canvas-bar">
        <span style="font-size:10px;color:var(--tx3);white-space:nowrap">Preview</span>
        <span class="canvas-url" id="canvas-url">—</span>
        <button class="btn btn-o btn-sm" id="canvas-reload-btn" disabled>↺</button>
      </div>
      <div class="canvas-empty" id="canvas-empty">
        <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
          <path d="M3 9h18M9 21V9"/>
        </svg>
        <p style="font-size:12px">Enter a Tenant ID and press <strong>▶ Load</strong></p>
      </div>
      <iframe id="frame" sandbox="allow-scripts allow-same-origin allow-forms" src="about:blank"></iframe>
    </div>
  </div><!-- /workspace -->

  <!-- Preview FAB -->
  <button id="edit-fab">✏ Exit Preview</button>

  <!-- Toast -->
  <div id="toast"></div>

  <!-- Modal: New Page -->
  <div class="modal-backdrop" id="modal-new">
    <div class="modal-box">
      <div class="modal-title">+ New Page</div>
      <div class="field">
        <label for="np-title">Page Title</label>
        <input class="inp inp-full" type="text" id="np-title" placeholder="About Us">
      </div>
      <div class="field">
        <label for="np-slug">URL Slug</label>
        <input class="inp inp-full" type="text" id="np-slug" placeholder="about-us">
      </div>
      <div class="status-line" id="np-status"></div>
      <div class="modal-foot">
        <button class="btn btn-o" id="np-cancel">Cancel</button>
        <button class="btn btn-p" id="np-create">Create Page</button>
      </div>
    </div>
  </div>

</div><!-- /app -->

<script>
(function () {
  'use strict';

  var API = window.location.origin;  // 'http://localhost:8787'

  // ── State ───────────────────────────────────────────────────────────────
  var S = {
    tenantId:       '',
    pages:          [],       // [{slug,title}]
    activePage:     null,     // null = homepage, else slug
    navigation:     [],       // [{label,url}]
    autoMenu:       true,
    snippets:       null,     // null = not loaded
    snipOpen:       { essential: true, commerce: false, trust: false, contact: false },
    customSections: [],       // current custom_sections
    sectionHtml:    {},       // { id: html } updated via iframe
    dirty:          {},       // { selector: value } inline changes
    imgEdit:        null,     // current image being edited
    frameReady:     false,
    previewMode:    false
  };

  // ── DOM refs ─────────────────────────────────────────────────────────────
  var app            = document.getElementById('app');
  var tenantInput    = document.getElementById('tenant-input');
  var loadBtn        = document.getElementById('load-btn');
  var pageSelect     = document.getElementById('page-select');
  var newPageBtn     = document.getElementById('new-page-btn');
  var delPageBtn     = document.getElementById('del-page-btn');
  var autoMenuChk    = document.getElementById('auto-menu-chk');
  var navToggleBtn   = document.getElementById('nav-toggle-btn');
  var navRow         = document.getElementById('nav-row');
  var navItemsList   = document.getElementById('nav-items-list');
  var navAddBtn      = document.getElementById('nav-add-btn');
  var navSaveBtn     = document.getElementById('nav-save-btn');
  var modeBadge      = document.getElementById('mode-badge');
  var saveDraftBtn   = document.getElementById('save-draft-btn');
  var publishBtn     = document.getElementById('publish-btn');
  var frame          = document.getElementById('frame');
  var canvasEmpty    = document.getElementById('canvas-empty');
  var canvasUrl      = document.getElementById('canvas-url');
  var canvasReload   = document.getElementById('canvas-reload-btn');
  var tabSnip        = document.getElementById('tab-snip');
  var tabImg         = document.getElementById('tab-img');
  var panelSnip      = document.getElementById('panel-snip');
  var panelImg       = document.getElementById('panel-img');
  var imgUrl         = document.getElementById('img-url');
  var imgPosX        = document.getElementById('img-pos-x');
  var imgPosY        = document.getElementById('img-pos-y');
  var imgScale       = document.getElementById('img-scale');
  var imgPosXVal     = document.getElementById('img-pos-x-val');
  var imgPosYVal     = document.getElementById('img-pos-y-val');
  var imgScaleVal    = document.getElementById('img-scale-val');
  var imgApplyBtn    = document.getElementById('img-apply-btn');
  var imgSaveBtn     = document.getElementById('img-save-btn');
  var imgCancelBtn   = document.getElementById('img-cancel-btn');
  var imgStatus      = document.getElementById('img-status');
  var editFab        = document.getElementById('edit-fab');
  var toast          = document.getElementById('toast');
  var modalNew       = document.getElementById('modal-new');
  var npTitle        = document.getElementById('np-title');
  var npSlug         = document.getElementById('np-slug');
  var npStatus       = document.getElementById('np-status');
  var npCancel       = document.getElementById('np-cancel');
  var npCreate       = document.getElementById('np-create');

  // ── Helpers ──────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function showToast(msg, type) {
    // type: 'ok' | 'err' | 'inf'
    toast.textContent = msg;
    toast.className   = 'toast ' + (type || 'ok');  // Note: class "toast" not defined = still hidden? We handle display
    toast.style.display = 'block';
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { toast.style.display = 'none'; }, 3200);
  }

  function setStatus(el, msg, isErr) {
    el.textContent = msg;
    el.className   = 'status-line ' + (isErr ? 'err' : 'ok');
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.className = 'status-line'; }, 4000);
  }

  function hdr() {
    return { 'Content-Type': 'application/json', 'X-Tenant-ID': S.tenantId };
  }

  function sendFrame(msg) {
    try { frame.contentWindow && frame.contentWindow.postMessage(msg, '*'); } catch (_) {}
  }

  function setEnabled(buttons, enabled) {
    buttons.forEach(function (b) { b.disabled = !enabled; });
  }

  function slugify(str) {
    return str.toLowerCase().trim()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-');
  }

  // ── Load tenant ───────────────────────────────────────────────────────────
  loadBtn.addEventListener('click', loadTenant);
  tenantInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') loadTenant(); });

  async function loadTenant() {
    var id = tenantInput.value.trim();
    if (!id) { tenantInput.focus(); return; }
    S.tenantId = id;
    loadBtn.disabled    = true;
    loadBtn.textContent = '…';
    try {
      await Promise.all([fetchConfig(), fetchPages()]);
      setEnabled([newPageBtn, delPageBtn, saveDraftBtn, publishBtn, canvasReload], true);
      loadFrame(null);
      await loadSnippets();
    } catch (err) {
      showToast('Load failed: ' + err.message, 'err');
    } finally {
      loadBtn.disabled    = false;
      loadBtn.textContent = '▶ Load';
    }
  }

  // ── Config ────────────────────────────────────────────────────────────────
  async function fetchConfig() {
    var res = await fetch(API + '/api/tenant/config', { headers: hdr() });
    if (!res.ok) throw new Error('Config ' + res.status);
    var data = await res.json();
    var cfg  = data.config || {};
    S.navigation     = Array.isArray(cfg.navigation)      ? cfg.navigation      : [];
    S.customSections = Array.isArray(cfg.custom_sections)  ? cfg.custom_sections : [];
    renderNavItems();
  }

  async function patchConfig(payload) {
    var res = await fetch(API + '/api/tenant/config', {
      method: 'PATCH', headers: hdr(), body: JSON.stringify(payload)
    });
    if (!res.ok) { var t = await res.text(); throw new Error(t); }
    return res.json();
  }

  // ── Pages ─────────────────────────────────────────────────────────────────
  async function fetchPages() {
    var res = await fetch(API + '/api/tenant/pages', { headers: hdr() });
    if (!res.ok) throw new Error('Pages ' + res.status);
    var data = await res.json();
    S.pages = Array.isArray(data.pages) ? data.pages : [];
    renderPageSelect();
  }

  function renderPageSelect() {
    pageSelect.disabled = false;
    pageSelect.innerHTML = '<option value="">🏠 Homepage</option>';
    S.pages.forEach(function (p) {
      var opt = document.createElement('option');
      opt.value       = p.slug;
      opt.textContent = p.title || p.slug;
      if (S.activePage === p.slug) opt.selected = true;
      pageSelect.appendChild(opt);
    });
  }

  pageSelect.addEventListener('change', function () {
    S.activePage = pageSelect.value || null;
    loadFrame(S.activePage);
  });

  newPageBtn.addEventListener('click', function () {
    npTitle.value = ''; npSlug.value = ''; npStatus.className = 'status-line';
    modalNew.classList.add('open');
    npTitle.focus();
  });

  npTitle.addEventListener('input', function () {
    npSlug.value = slugify(npTitle.value);
  });

  npCancel.addEventListener('click', function () { modalNew.classList.remove('open'); });
  modalNew.addEventListener('click', function (e) {
    if (e.target === modalNew) modalNew.classList.remove('open');
  });

  npCreate.addEventListener('click', async function () {
    var title = npTitle.value.trim();
    var slug  = npSlug.value.trim();
    if (!title || !slug) { setStatus(npStatus, 'Title and slug required.', true); return; }
    npCreate.disabled = true;
    try {
      var res = await fetch(API + '/api/tenant/pages', {
        method: 'POST', headers: hdr(),
        body: JSON.stringify({ title: title, slug: slug })
      });
      if (!res.ok) throw new Error(await res.text());
      showToast('Page "' + title + '" created', 'ok');
      modalNew.classList.remove('open');
      await fetchPages();
      if (S.autoMenu) autoSyncMenu();
    } catch (err) {
      setStatus(npStatus, 'Error: ' + err.message, true);
    } finally {
      npCreate.disabled = false;
    }
  });

  delPageBtn.addEventListener('click', async function () {
    var slug = S.activePage;
    if (!slug) { showToast('Select a sub-page to delete (cannot delete homepage)', 'inf'); return; }
    if (!confirm('Delete page "' + slug + '"? This cannot be undone.')) return;
    try {
      var res = await fetch(API + '/api/tenant/pages/' + encodeURIComponent(slug), {
        method: 'DELETE', headers: hdr()
      });
      if (!res.ok) throw new Error(await res.text());
      showToast('Page deleted', 'ok');
      S.activePage = null;
      await fetchPages();
      loadFrame(null);
      if (S.autoMenu) autoSyncMenu();
    } catch (err) {
      showToast('Delete failed: ' + err.message, 'err');
    }
  });

  // ── Navigation builder ────────────────────────────────────────────────────
  navToggleBtn.addEventListener('click', function () {
    navRow.classList.toggle('collapsed');
  });
  autoMenuChk.addEventListener('change', function () {
    S.autoMenu = autoMenuChk.checked;
  });

  function renderNavItems() {
    if (!S.navigation.length) {
      navItemsList.innerHTML = '<span style="font-size:11px;color:var(--tx3);font-style:italic">No items</span>';
      return;
    }
    navItemsList.innerHTML = '';
    S.navigation.forEach(function (item, i) {
      var chip = document.createElement('div');
      chip.className = 'nav-chip';
      chip.innerHTML =
        '<span>' + esc(item.label) + '</span>' +
        '<span style="color:var(--tx3);font-size:10px">' + esc(item.url) + '</span>' +
        '<button class="nav-chip-del" data-idx="' + i + '" title="Remove">✕</button>';
      navItemsList.appendChild(chip);
    });
  }

  navItemsList.addEventListener('click', function (e) {
    var btn = e.target.closest('.nav-chip-del');
    if (!btn) return;
    var idx = parseInt(btn.dataset.idx, 10);
    S.navigation.splice(idx, 1);
    renderNavItems();
  });

  navAddBtn.addEventListener('click', function () {
    var label = prompt('Link label:');
    if (!label) return;
    var url   = prompt('URL (e.g. /about-us or https://…):');
    if (!url) return;
    S.navigation.push({ label: label.slice(0,80), url: url.slice(0,200) });
    renderNavItems();
  });

  navSaveBtn.addEventListener('click', async function () {
    navSaveBtn.disabled = true;
    try {
      await patchConfig({ navigation: S.navigation });
      showToast('Menu saved', 'ok');
    } catch (err) {
      showToast('Save failed: ' + err.message, 'err');
    } finally {
      navSaveBtn.disabled = false;
    }
  });

  function autoSyncMenu() {
    S.navigation = [{ label: 'Home', url: '/' }];
    S.pages.forEach(function (p) {
      S.navigation.push({ label: p.title || p.slug, url: '/' + p.slug });
    });
    renderNavItems();
  }

  // ── Frame loading ─────────────────────────────────────────────────────────
  function frameUrl(slug) {
    if (!slug) return API + '/api/tenant/preview?tid=' + encodeURIComponent(S.tenantId);
    return API + '/api/tenant/pages/' + encodeURIComponent(slug) + '/preview?tid=' + encodeURIComponent(S.tenantId);
  }

  function loadFrame(slug) {
    S.activePage   = slug || null;
    S.frameReady   = false;
    var url        = frameUrl(slug);
    frame.src      = url;
    frame.style.display  = 'block';
    canvasEmpty.style.display = 'none';
    canvasUrl.textContent = url;
    canvasReload.disabled = false;
    modeBadge.textContent = '● Loading…';
    modeBadge.className   = 'badge';
  }

  canvasReload.addEventListener('click', function () {
    if (S.tenantId) loadFrame(S.activePage);
  });

  // ── Sidebar tabs ──────────────────────────────────────────────────────────
  function switchTab(tab) {
    if (tab === 'snip') {
      tabSnip.classList.add('active'); tabImg.classList.remove('active');
      panelSnip.style.display = 'block';
      panelImg.classList.add('img-panel--hidden');
    } else {
      tabImg.classList.add('active');  tabSnip.classList.remove('active');
      panelImg.classList.remove('img-panel--hidden');
      panelSnip.style.display = 'none';
    }
  }
  tabSnip.addEventListener('click', function () { switchTab('snip'); });
  tabImg.addEventListener('click',  function () { switchTab('img'); });
  imgCancelBtn.addEventListener('click', function () { switchTab('snip'); S.imgEdit = null; });

  // ── Snippet library ───────────────────────────────────────────────────────
  async function loadSnippets() {
    if (S.snippets !== null) { renderSnippets(); return; }
    panelSnip.innerHTML = '<div style="padding:16px;font-size:11px;color:var(--tx3)">⏳ Loading snippets…</div>';
    try {
      var res = await fetch('/common-sections.html');
      if (!res.ok) throw new Error(res.status);
      var html  = await res.text();
      var parser = new DOMParser();
      var doc    = parser.parseFromString(html, 'text/html');
      var templates = Array.from(doc.querySelectorAll('template[data-type]'));
      S.snippets = templates.map(function (t) {
        return {
          type:      t.getAttribute('data-type')      || '',
          label:     t.getAttribute('data-label')     || t.getAttribute('data-type') || '',
          icon:      t.getAttribute('data-icon')      || '▦',
          desc:      t.getAttribute('data-desc')      || '',
          thumbnail: t.getAttribute('data-thumbnail') || '',
          category:  t.getAttribute('data-category')  || 'essential',
          html:      t.innerHTML.trim()
        };
      });
      renderSnippets();
    } catch (err) {
      panelSnip.innerHTML = '<div style="padding:16px;font-size:11px;color:#ef4444">⚠ Failed to load snippets: ' + esc(err.message) + '</div>';
    }
  }

  var CAT_META = {
    essential: { label: 'Essential',  icon: '✅' },
    commerce:  { label: 'Commerce',   icon: '💰' },
    trust:     { label: 'Trust',      icon: '⭐' },
    contact:   { label: 'Contact',    icon: '📬' }
  };
  var CAT_ORDER = ['essential', 'commerce', 'trust', 'contact'];

  function renderSnippets() {
    if (!S.snippets || !S.snippets.length) {
      panelSnip.innerHTML = '<div style="padding:16px;font-size:11px;color:var(--tx3)">No snippets found.</div>';
      return;
    }
    panelSnip.innerHTML = '';
    CAT_ORDER.forEach(function (catKey) {
      var meta  = CAT_META[catKey] || { label: catKey, icon: '▦' };
      var items = S.snippets.filter(function (s) { return s.category === catKey; });
      if (!items.length) return;

      var group = document.createElement('div');
      group.className = 'acc-group';
      if (S.snipOpen[catKey]) group.classList.add('open');
      group.setAttribute('data-cat', catKey);

      var hdr = document.createElement('button');
      hdr.className = 'acc-hdr';
      hdr.innerHTML =
        '<span style="font-size:14px">' + meta.icon + '</span>' +
        '<span class="acc-hdr-title">' + esc(meta.label) + '</span>' +
        '<span class="acc-hdr-count">' + items.length + '</span>' +
        '<span class="acc-arrow">▶</span>';
      hdr.addEventListener('click', function () {
        var open = group.classList.toggle('open');
        S.snipOpen[catKey] = open;
      });

      var body = document.createElement('div');
      body.className = 'acc-body';
      var grid = document.createElement('div');
      grid.className = 'snip-grid';

      items.forEach(function (snip) {
        var card = document.createElement('div');
        card.className = 'snip-card';
        card.title     = snip.desc || snip.label;

        var thumbHtml = snip.thumbnail
          ? '<img class="snip-thumb" src="' + esc(snip.thumbnail) + '" alt="" loading="lazy">'
          : '<div class="snip-ph">' + snip.icon + '</div>';

        card.innerHTML =
          thumbHtml +
          '<div class="snip-foot">' +
            '<span style="font-size:13px">' + snip.icon + '</span>' +
            '<span class="snip-lbl">' + esc(snip.label) + '</span>' +
          '</div>';

        card.addEventListener('click', function () { insertSnippet(snip, card); });
        grid.appendChild(card);
      });

      body.appendChild(grid);
      group.appendChild(hdr);
      group.appendChild(body);
      panelSnip.appendChild(group);
    });
  }

  async function insertSnippet(snip, card) {
    if (!S.tenantId) { showToast('Load a tenant first', 'inf'); return; }
    card.classList.add('inserting');
    try {
      var newSec = {
        id:   'sec-' + Date.now().toString(36),
        type: snip.type,
        html: snip.html
      };
      S.customSections.push(newSec);
      await patchConfig({ custom_sections: S.customSections });
      card.classList.remove('inserting');
      card.classList.add('inserted');
      setTimeout(function () { card.classList.remove('inserted'); }, 1500);
      showToast('"' + snip.label + '" added', 'ok');
      loadFrame(S.activePage);
    } catch (err) {
      S.customSections.pop();
      card.classList.remove('inserting');
      showToast('Insert failed: ' + err.message, 'err');
    }
  }

  // ── Inline change queue ───────────────────────────────────────────────────
  var _flushTimer = null;

  function queueDirty(selector, value) {
    S.dirty[selector] = value;
    modeBadge.textContent = '● Unsaved';
    modeBadge.className   = 'badge amber';
    clearTimeout(_flushTimer);
    _flushTimer = setTimeout(flushDirty, 2500);
  }

  async function flushDirty() {
    if (!Object.keys(S.dirty).length) return;
    var payload = { custom_selectors: Object.assign({}, S.dirty) };
    try {
      await patchConfig(payload);
      S.dirty = {};
      modeBadge.textContent = '● Saved';
      modeBadge.className   = 'badge green';
      setTimeout(function () {
        modeBadge.textContent = '● Idle';
        modeBadge.className   = 'badge';
      }, 2000);
    } catch (err) {
      showToast('Auto-save failed: ' + err.message, 'err');
    }
  }

  // ── Image editor ──────────────────────────────────────────────────────────
  function openImageEditor(data) {
    S.imgEdit = data;
    imgUrl.value       = data.src || '';
    imgPosX.value  = 50; imgPosXVal.textContent = '50%';
    imgPosY.value  = 50; imgPosYVal.textContent = '50%';
    imgScale.value = 100; imgScaleVal.textContent = '100%';
    imgStatus.className = 'status-line';
    switchTab('img');
  }

  function rangeSync(inp, display, suffix) {
    inp.addEventListener('input', function () {
      display.textContent = inp.value + suffix;
      if (S.imgEdit) previewImgLive();
    });
  }
  rangeSync(imgPosX, imgPosXVal, '%');
  rangeSync(imgPosY, imgPosYVal, '%');
  rangeSync(imgScale, imgScaleVal, '%');
  imgUrl.addEventListener('input', function () { if (S.imgEdit) previewImgLive(); });

  function previewImgLive() {
    if (!S.imgEdit) return;
    sendFrame({
      type:     'APPLY_IMG',
      selector: S.imgEdit.selector,
      src:      imgUrl.value,
      posX:     parseInt(imgPosX.value, 10),
      posY:     parseInt(imgPosY.value, 10),
      scale:    parseInt(imgScale.value, 10)
    });
  }

  imgApplyBtn.addEventListener('click', previewImgLive);

  imgSaveBtn.addEventListener('click', async function () {
    if (!S.imgEdit) return;
    imgSaveBtn.disabled = true;
    try {
      var src = imgUrl.value.trim();
      // 1. Save URL via custom_imgs if it changed
      if (src && src.startsWith('https://')) {
        var imgsPatch = {};
        imgsPatch[S.imgEdit.selector] = src;
        await patchConfig({ custom_imgs: imgsPatch });
      }
      // 2. If it belongs to a section, update section HTML
      if (S.imgEdit.sectionId && S.sectionHtml[S.imgEdit.sectionId]) {
        var updatedSections = S.customSections.map(function (sec) {
          if (sec.id === S.imgEdit.sectionId) {
            return Object.assign({}, sec, { html: S.sectionHtml[S.imgEdit.sectionId] });
          }
          return sec;
        });
        S.customSections = updatedSections;
        await patchConfig({ custom_sections: S.customSections });
      }
      setStatus(imgStatus, 'Image saved ✓', false);
      showToast('Image saved', 'ok');
    } catch (err) {
      setStatus(imgStatus, 'Error: ' + err.message, true);
    } finally {
      imgSaveBtn.disabled = false;
    }
  });

  // ── Save Draft ────────────────────────────────────────────────────────────
  saveDraftBtn.addEventListener('click', async function () {
    saveDraftBtn.disabled = true;
    try {
      // 1. Flush inline text changes
      clearTimeout(_flushTimer);
      if (Object.keys(S.dirty).length) await flushDirty();

      // 2. If auto-menu is on, save navigation from pages
      if (S.autoMenu) {
        autoSyncMenu();
        await patchConfig({ navigation: S.navigation });
      }

      // 3. Tell frame to enter preview mode (strips all editing UI)
      sendFrame('PREVIEW_MODE');

      // 4. Enter preview mode in shell
      S.previewMode = true;
      app.classList.add('preview-mode');
      showToast('Draft saved — preview mode active', 'ok');

    } catch (err) {
      showToast('Save failed: ' + err.message, 'err');
    } finally {
      saveDraftBtn.disabled = false;
    }
  });

  // ── Publish ───────────────────────────────────────────────────────────────
  publishBtn.addEventListener('click', async function () {
    publishBtn.disabled = true;
    try {
      clearTimeout(_flushTimer);
      if (Object.keys(S.dirty).length) await flushDirty();
      // POST /api/tenant/publish if exists, else just save
      var res = await fetch(API + '/api/tenant/publish', {
        method: 'POST', headers: hdr(), body: JSON.stringify({})
      });
      if (!res.ok) throw new Error(await res.text());
      showToast('Published ✓', 'ok');
    } catch (err) {
      // Publish endpoint may not exist — silently save instead
      showToast('Config saved (publish: ' + err.message + ')', 'inf');
    } finally {
      publishBtn.disabled = false;
    }
  });

  // ── Exit preview mode ─────────────────────────────────────────────────────
  editFab.addEventListener('click', function () {
    S.previewMode = false;
    app.classList.remove('preview-mode');
    // Reload frame fresh with editing enabled
    loadFrame(S.activePage);
  });

  // ── iframe messages ───────────────────────────────────────────────────────
  window.addEventListener('message', function (e) {
    var msg = e.data;
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'EDITOR_READY') {
      S.frameReady = true;
      modeBadge.textContent = '● Editing';
      modeBadge.className   = 'badge green';

    } else if (msg.type === 'INLINE_CHANGE') {
      queueDirty(msg.selector, msg.value);

    } else if (msg.type === 'IMAGE_CLICK') {
      openImageEditor(msg);

    } else if (msg.type === 'SECTION_HTML_UPDATED') {
      S.sectionHtml[msg.sectionId] = msg.html;

    } else if (msg.type === 'PREVIEW_MODE_ACTIVE') {
      // Iframe confirmed preview mode
      modeBadge.textContent = '● Preview';
      modeBadge.className   = 'badge';
    }
  });

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      if (!S.previewMode && S.tenantId) saveDraftBtn.click();
    }
    if (e.key === 'Escape' && S.previewMode) {
      editFab.click();
    }
  });

}());
</script>
</body>
</html>
"""

with open('public/visual-editor.html', 'w', encoding='utf-8') as f:
    f.write(HTML.lstrip())
print('visual-editor.html written: ' + str(len(HTML)) + ' chars')
