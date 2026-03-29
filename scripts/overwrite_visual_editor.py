#!/usr/bin/env python3
"""overwrite_visual_editor.py — write a clean visual-editor.html"""

HTML = """<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Visual Editor — Site Studio</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  /* ── Layout ───────────────────────────────────────────────────── */
  html, body { height: 100%; overflow: hidden; background: #0a0f1e; color: #e2e8f0;
               font-family: ui-sans-serif, system-ui, sans-serif; font-size: 13px; }

  .app       { display: flex; flex-direction: column; height: 100vh; }

  /* ── Topbar ───────────────────────────────────────────────────── */
  .topbar {
    display: flex; align-items: center; gap: 10px;
    height: 48px; min-height: 48px; padding: 0 14px;
    background: #0f172a; border-bottom: 1px solid #1e293b;
    flex-shrink: 0;
  }
  .topbar-title { font-size: 13px; font-weight: 700; color: #6366f1; letter-spacing: .04em; margin-right: 4px; }
  .topbar input[type=text] {
    background: #1e293b; border: 1px solid #334155; border-radius: 7px;
    color: #e2e8f0; font-size: 12px; padding: 5px 10px; outline: none; width: 180px;
    font-family: inherit;
  }
  .topbar input:focus { border-color: #6366f1; }
  .btn {
    display: inline-flex; align-items: center; gap: 5px;
    border: none; border-radius: 7px; cursor: pointer; font-family: inherit;
    font-size: 12px; font-weight: 600; padding: 6px 14px; transition: all .13s;
  }
  .btn-primary   { background: #6366f1; color: #fff; }
  .btn-primary:hover   { background: #5253cc; }
  .btn-success   { background: #10b981; color: #fff; }
  .btn-success:hover   { background: #059669; }
  .btn-ghost     { background: transparent; border: 1px solid #334155; color: #94a3b8; }
  .btn-ghost:hover { border-color: #6366f1; color: #c7d2fe; }
  .btn-danger  { background: transparent; border: 1px solid #ef4444; color: #ef4444; }
  .btn-danger:hover { background: rgba(239,68,68,.12); }
  .btn:disabled { opacity: .4; pointer-events: none; }
  .topbar-sep { width: 1px; height: 22px; background: #1e293b; margin: 0 4px; }
  .badge-select {
    font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 20px;
    background: #1e3a5f; color: #60a5fa; border: 1px solid #334155;
  }
  .badge-select.active { background: #f59e0b22; color: #f59e0b; border-color: #f59e0b; }

  /* ── Workspace ────────────────────────────────────────────────── */
  .workspace   { display: flex; flex: 1; overflow: hidden; }

  /* ── Sidebar ──────────────────────────────────────────────────── */
  .sidebar {
    width: 270px; min-width: 270px; overflow-y: auto;
    background: #0a0f1e; border-right: 1px solid #1e293b;
    display: flex; flex-direction: column;
  }
  .sidebar::-webkit-scrollbar { width: 4px; }
  .sidebar::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 2px; }
  .sb-section { padding: 14px 14px 6px; border-bottom: 1px solid #1e293b; }
  .sb-section:last-child { border-bottom: none; flex: 1; }
  .sb-label {
    font-size: 9px; font-weight: 800; text-transform: uppercase;
    letter-spacing: .08em; color: #475569; margin-bottom: 10px;
  }
  .field  { margin-bottom: 9px; }
  .field label { display: block; font-size: 10px; font-weight: 600; color: #64748b; margin-bottom: 4px; }
  .field input, .field textarea, .field select {
    width: 100%; background: #0f172a; border: 1px solid #1e293b; border-radius: 7px;
    color: #e2e8f0; font-size: 12px; padding: 6px 9px; outline: none; font-family: inherit;
    transition: border-color .12s;
  }
  .field textarea   { resize: vertical; min-height: 60px; line-height: 1.5; }
  .field input:focus, .field textarea:focus, .field select:focus { border-color: #6366f1; }
  .field select     { appearance: none; cursor: pointer; }
  .color-row        { display: flex; gap: 6px; }
  .color-row input[type=text] { flex: 1; }
  .color-row input[type=color] {
    width: 34px; height: 34px; padding: 2px; border: 1px solid #1e293b;
    border-radius: 6px; background: #0f172a; cursor: pointer;
  }
  .status-bar {
    font-size: 11px; padding: 5px 9px; border-radius: 6px; margin-top: 6px;
    line-height: 1.5; display: none;
  }
  .status-bar.ok  { background: #052e16; color: #6ee7b7; border: 1px solid #059669; display: block; }
  .status-bar.err { background: #1f0a0a; color: #fca5a5; border: 1px solid #ef4444; display: block; }

  /* Selected element panel */
  .sel-panel { display: none; }
  .sel-panel.visible { display: block; }
  .sel-code {
    font-family: ui-monospace, monospace; font-size: 10px;
    background: #0f172a; border: 1px solid #334155; border-radius: 5px;
    padding: 4px 7px; color: #a5b4fc; word-break: break-all; margin-bottom: 8px;
  }

  /* ── Preview pane ─────────────────────────────────────────────── */
  .preview-pane  { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
  .preview-bar   {
    display: flex; align-items: center; gap: 8px; height: 36px; min-height: 36px;
    padding: 0 12px; background: #0f172a; border-bottom: 1px solid #1e293b; flex-shrink: 0;
  }
  .preview-bar-url { flex: 1; font-size: 11px; color: #475569; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .preview-empty {
    flex: 1; display: flex; flex-direction: column; align-items: center;
    justify-content: center; gap: 14px; color: #334155;
  }
  .preview-empty svg { opacity: .3; }
  .preview-empty p   { font-size: 13px; }
  #preview-frame {
    flex: 1; border: none; display: none;
    background: #fff;
  }
</style>
</head>
<body>
<div class="app">

  <!-- Topbar -->
  <header class="topbar">
    <span class="topbar-title">⚡ Site Studio</span>

    <input type="text" id="tenant-input" placeholder="Tenant ID" autocomplete="off">

    <button class="btn btn-primary" id="load-btn">▶ Load</button>

    <div class="topbar-sep"></div>

    <button class="btn btn-ghost" id="select-btn" disabled>⊕ Select</button>
    <span class="badge-select" id="mode-badge">● Idle</span>

    <div class="topbar-sep"></div>

    <button class="btn btn-success" id="save-btn" disabled>💾 Save</button>
    <button class="btn btn-ghost"   id="reload-btn" disabled>↺ Reload</button>
  </header>

  <!-- Workspace -->
  <div class="workspace">

    <!-- Sidebar -->
    <aside class="sidebar">

      <!-- Brand & Content config -->
      <div class="sb-section" id="config-section" style="display:none">
        <div class="sb-label">Brand</div>
        <div class="field">
          <label for="cfg-name">Agency Name</label>
          <input type="text" id="cfg-name" placeholder="Sunset Travel">
        </div>
        <div class="field">
          <label for="cfg-color">Primary Color</label>
          <div class="color-row">
            <input type="text"  id="cfg-color"        placeholder="#6366f1">
            <input type="color" id="cfg-color-picker">
          </div>
        </div>
        <div class="field">
          <label for="cfg-logo">Logo URL</label>
          <input type="text" id="cfg-logo" placeholder="https://…/logo.png">
        </div>

        <div class="sb-label" style="margin-top:12px">Content</div>
        <div class="field">
          <label for="cfg-hero-title">Hero Title</label>
          <input type="text" id="cfg-hero-title" placeholder="Discover Vietnam">
        </div>
        <div class="field">
          <label for="cfg-hero-desc">Hero Description</label>
          <textarea id="cfg-hero-desc" placeholder="Handcrafted tours…"></textarea>
        </div>
        <div class="field">
          <label for="cfg-phone">Contact Phone</label>
          <input type="text" id="cfg-phone" placeholder="+84 xxx xxx xxx">
        </div>

        <button class="btn btn-success" id="config-save-btn" style="width:100%;margin-top:4px">💾 Save Config</button>
        <div class="status-bar" id="config-status"></div>
      </div>

      <!-- Click-selection panel -->
      <div class="sb-section">
        <div class="sb-label">Element Editor</div>
        <p style="font-size:11px;color:#475569;margin-bottom:8px">
          Click <strong style="color:#94a3b8">⊕ Select</strong> in the toolbar, then click any element in the preview.
        </p>
        <div class="sel-panel" id="sel-panel">
          <div class="sel-code" id="sel-code"></div>
          <div class="field">
            <label for="sel-value">New Value</label>
            <textarea id="sel-value" placeholder="New text or URL…" style="min-height:70px"></textarea>
          </div>
          <button class="btn btn-success" id="sel-save-btn" style="width:100%">Apply Change</button>
          <button class="btn btn-ghost"   id="sel-cancel-btn" style="width:100%;margin-top:6px">Cancel</button>
          <div class="status-bar" id="sel-status"></div>
        </div>
      </div>

      <!-- Inline edit status -->
      <div class="sb-section">
        <div class="sb-label">Inline Editing</div>
        <p style="font-size:11px;color:#475569;line-height:1.6">
          Click any text in the preview to edit it directly.<br>
          Changes save automatically after 0.8 s.
        </p>
        <div class="status-bar" id="inline-status"></div>
      </div>

    </aside>

    <!-- Preview pane -->
    <div class="preview-pane">
      <div class="preview-bar">
        <span style="font-size:11px;color:#475569">Preview</span>
        <span class="preview-bar-url" id="preview-url">—</span>
        <button class="btn btn-ghost" id="preview-reload-btn" disabled style="font-size:11px;padding:4px 10px">↺</button>
      </div>

      <div class="preview-empty" id="preview-empty">
        <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
          <path d="M3 9h18M9 21V9"/>
        </svg>
        <p>Enter a Tenant ID and press <strong>▶ Load</strong></p>
      </div>

      <iframe id="preview-frame"
              sandbox="allow-scripts allow-same-origin allow-forms"
              src="about:blank"></iframe>
    </div>

  </div><!-- /workspace -->
</div><!-- /app -->

<script>
(function () {
  'use strict';

  // ── DOM refs ────────────────────────────────────────────────────────────
  var tenantInput     = document.getElementById('tenant-input');
  var loadBtn         = document.getElementById('load-btn');
  var selectBtn       = document.getElementById('select-btn');
  var modeBadge       = document.getElementById('mode-badge');
  var saveBtn         = document.getElementById('save-btn');
  var reloadBtn       = document.getElementById('reload-btn');
  var frame           = document.getElementById('preview-frame');
  var previewEmpty    = document.getElementById('preview-empty');
  var previewUrl      = document.getElementById('preview-url');
  var previewReloadBtn = document.getElementById('preview-reload-btn');
  // Config
  var configSection   = document.getElementById('config-section');
  var cfgName         = document.getElementById('cfg-name');
  var cfgColor        = document.getElementById('cfg-color');
  var cfgColorPicker  = document.getElementById('cfg-color-picker');
  var cfgLogo         = document.getElementById('cfg-logo');
  var cfgHeroTitle    = document.getElementById('cfg-hero-title');
  var cfgHeroDesc     = document.getElementById('cfg-hero-desc');
  var cfgPhone        = document.getElementById('cfg-phone');
  var configSaveBtn   = document.getElementById('config-save-btn');
  var configStatus    = document.getElementById('config-status');
  // Selection panel
  var selPanel        = document.getElementById('sel-panel');
  var selCode         = document.getElementById('sel-code');
  var selValue        = document.getElementById('sel-value');
  var selSaveBtn      = document.getElementById('sel-save-btn');
  var selCancelBtn    = document.getElementById('sel-cancel-btn');
  var selStatus       = document.getElementById('sel-status');
  // Inline status
  var inlineStatus    = document.getElementById('inline-status');

  // ── State ───────────────────────────────────────────────────────────────
  var tenantId   = '';
  var frameReady = false;
  var selectMode = false;
  var _dirty     = {};  // { selector: value } from INLINE_CHANGE

  // ── Helpers ─────────────────────────────────────────────────────────────
  function showStatus(el, msg, isErr) {
    el.textContent = msg;
    el.className   = 'status-bar ' + (isErr ? 'err' : 'ok');
    clearTimeout(el._t);
    el._t = setTimeout(function () {
      el.className = 'status-bar';
    }, 4000);
  }

  function apiUrl(path) {
    return 'http://localhost:8787' + path;
  }

  function authHeaders() {
    return { 'Content-Type': 'application/json', 'X-Tenant-ID': tenantId };
  }

  function sendToFrame(msg) {
    if (!frame.contentWindow) return;
    frame.contentWindow.postMessage(msg, '*');
  }

  // ── Color picker sync ───────────────────────────────────────────────────
  cfgColor.addEventListener('input', function () {
    if (/^#[0-9a-fA-F]{6}$/.test(cfgColor.value)) cfgColorPicker.value = cfgColor.value;
  });
  cfgColorPicker.addEventListener('input', function () { cfgColor.value = cfgColorPicker.value; });

  // ── Load tenant preview ─────────────────────────────────────────────────
  loadBtn.addEventListener('click', loadTenant);
  tenantInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') loadTenant(); });

  async function loadTenant() {
    var id = tenantInput.value.trim();
    if (!id) { tenantInput.focus(); return; }
    tenantId = id;

    loadBtn.disabled = true;
    loadBtn.textContent = '…';

    try {
      // 1. Fetch config to populate sidebar
      var res = await fetch(apiUrl('/api/tenant/config'), { headers: { 'X-Tenant-ID': tenantId } });
      if (!res.ok) throw new Error('Config fetch failed: ' + res.status);
      var data = await res.json();
      populateConfig(data);

      // 2. Load iframe
      var previewSrc = apiUrl('/api/tenant/preview?tid=' + encodeURIComponent(tenantId));
      loadFrame(previewSrc);

    } catch (err) {
      alert('Load failed: ' + err.message);
    } finally {
      loadBtn.disabled = false;
      loadBtn.textContent = '▶ Load';
    }
  }

  function populateConfig(data) {
    var brand   = (data && data.brand)   || {};
    var content = (data && data.content) || {};
    cfgName.value       = brand.name         || '';
    cfgColor.value      = brand.primary_color || '#6366f1';
    cfgLogo.value       = brand.logo_url     || '';
    cfgHeroTitle.value  = content.hero_title  || '';
    cfgHeroDesc.value   = content.hero_desc   || '';
    cfgPhone.value      = content.contact_phone || '';
    if (/^#[0-9a-fA-F]{6}$/.test(cfgColor.value)) cfgColorPicker.value = cfgColor.value;
    configSection.style.display = 'block';
  }

  function loadFrame(src) {
    frameReady = false;
    frame.src = src;
    frame.style.display = 'block';
    previewEmpty.style.display = 'none';
    previewUrl.textContent = src;
    previewReloadBtn.disabled = false;
    selectBtn.disabled = false;
    saveBtn.disabled   = false;
    reloadBtn.disabled = false;
  }

  // ── Topbar buttons ───────────────────────────────────────────────────────
  selectBtn.addEventListener('click', function () {
    if (!tenantId) return;
    selectMode = !selectMode;
    if (selectMode) {
      sendToFrame('EDITOR_ACTIVATE');
      selectBtn.textContent = '✕ Cancel';
      modeBadge.textContent = '● Selecting';
      modeBadge.className   = 'badge-select active';
    } else {
      sendToFrame('EDITOR_DEACTIVATE');
      selectBtn.textContent = '⊕ Select';
      modeBadge.textContent = '● Idle';
      modeBadge.className   = 'badge-select';
    }
  });

  function cancelSelect() {
    selectMode = false;
    sendToFrame('EDITOR_DEACTIVATE');
    selectBtn.textContent = '⊕ Select';
    modeBadge.textContent = '● Idle';
    modeBadge.className   = 'badge-select';
  }

  reloadBtn.addEventListener('click', function () {
    if (!tenantId) return;
    frame.src = frame.src;
    frameReady = false;
  });
  previewReloadBtn.addEventListener('click', function () {
    if (tenantId) { frame.src = frame.src; frameReady = false; }
  });

  // ── Save button (batch-flush _dirty inline changes) ─────────────────────
  saveBtn.addEventListener('click', async function () {
    if (!tenantId || !Object.keys(_dirty).length) {
      showStatus(inlineStatus, 'No unsaved changes.', false);
      return;
    }
    await flushDirty();
  });

  async function flushDirty() {
    if (!Object.keys(_dirty).length) return;
    var payload = { custom_selectors: Object.assign({}, _dirty) };
    try {
      var res = await fetch(apiUrl('/api/tenant/config'), {
        method: 'PATCH', headers: authHeaders(), body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(await res.text());
      _dirty = {};
      saveBtn.textContent = '💾 Save';
      showStatus(inlineStatus, 'Saved ✓', false);
    } catch (err) {
      showStatus(inlineStatus, 'Save failed: ' + err.message, true);
    }
  }

  // ── Config save ──────────────────────────────────────────────────────────
  configSaveBtn.addEventListener('click', async function () {
    if (!tenantId) return;
    var payload = {
      brand: {
        name:          cfgName.value.trim(),
        primary_color: cfgColor.value.trim(),
        logo_url:      cfgLogo.value.trim(),
      },
      content: {
        hero_title:    cfgHeroTitle.value.trim(),
        hero_desc:     cfgHeroDesc.value.trim(),
        contact_phone: cfgPhone.value.trim(),
      }
    };
    configSaveBtn.disabled = true;
    try {
      var res = await fetch(apiUrl('/api/tenant/config'), {
        method: 'PATCH', headers: authHeaders(), body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(await res.text());
      showStatus(configStatus, 'Saved ✓', false);
      // Reload preview to reflect changes
      setTimeout(function () { frame.src = frame.src; }, 600);
    } catch (err) {
      showStatus(configStatus, 'Error: ' + err.message, true);
    } finally {
      configSaveBtn.disabled = false;
    }
  });

  // ── Selection panel ──────────────────────────────────────────────────────
  var _currentSel = null;

  selSaveBtn.addEventListener('click', async function () {
    if (!_currentSel || !tenantId) return;
    var val = selValue.value;
    selSaveBtn.disabled = true;
    try {
      var payload = { custom_selectors: {} };
      payload.custom_selectors[_currentSel] = val;
      var res = await fetch(apiUrl('/api/tenant/config'), {
        method: 'PATCH', headers: authHeaders(), body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(await res.text());
      showStatus(selStatus, 'Saved ✓', false);
      cancelSelect();
      selPanel.classList.remove('visible');
      // inject change into frame
      sendToFrame({ type: 'APPLY_VALUE', selector: _currentSel, value: val });
      _currentSel = null;
    } catch (err) {
      showStatus(selStatus, 'Error: ' + err.message, true);
    } finally {
      selSaveBtn.disabled = false;
    }
  });

  selCancelBtn.addEventListener('click', function () {
    selPanel.classList.remove('visible');
    cancelSelect();
    _currentSel = null;
  });

  // ── iframe messages ──────────────────────────────────────────────────────
  window.addEventListener('message', function (e) {
    var msg = e.data;
    if (!msg || !msg.type) return;

    if (msg.type === 'EDITOR_READY') {
      frameReady = true;

    } else if (msg.type === 'ELEMENT_SELECTED') {
      selectMode = false;
      selectBtn.textContent = '⊕ Select';
      modeBadge.textContent = '● Idle';
      modeBadge.className   = 'badge-select';
      _currentSel = msg.selector;
      selCode.textContent  = msg.selector;
      selValue.value       = msg.currentValue || '';
      selPanel.classList.add('visible');
      selValue.focus();

    } else if (msg.type === 'INLINE_CHANGE') {
      _dirty[msg.selector] = msg.value;
      saveBtn.textContent = '💾 Save*';
      showStatus(inlineStatus, 'Auto-saving…', false);
      // Auto-flush after a short idle
      clearTimeout(window._flushTimer);
      window._flushTimer = setTimeout(flushDirty, 2000);
    }
  });

}());
</script>
</body>
</html>
"""

with open('public/visual-editor.html', 'w', encoding='utf-8') as f:
    f.write(HTML.lstrip())
print('visual-editor.html written:', len(HTML), 'chars')
