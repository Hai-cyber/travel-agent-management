#!/usr/bin/env python3
"""write_bridge_v4.py — writes public/editor-bridge.js (v4, clean)"""
import subprocess, sys

CONTENT = r"""/**
 * editor-bridge.js  v4  (Site Studio)
 *
 * Auto-injected into every preview iframe.
 *
 * Features:
 *   1. Inline text editing — click text → contenteditable, debounced INLINE_CHANGE
 *   2. Image click         — sends IMAGE_CLICK to parent (opens image editor)
 *   3. Apply image changes — parent sends APPLY_IMG { selector, src, posX, posY, scale }
 *   4. Preview mode        — strips all editing UI for clean in-place preview
 *
 * iframe → parent:
 *   { type: 'EDITOR_READY' }
 *   { type: 'INLINE_CHANGE',       selector, value }
 *   { type: 'IMAGE_CLICK',         selector, src, sectionId, w, h }
 *   { type: 'SECTION_HTML_UPDATED', sectionId, html }
 *   { type: 'PREVIEW_MODE_ACTIVE' }
 *
 * parent → iframe:
 *   'INLINE_ENABLE'
 *   'INLINE_DISABLE'
 *   'PREVIEW_MODE'
 *   { type: 'APPLY_IMG', selector, src, posX, posY, scale }
 */
(function () {
  'use strict';

  var ORIGIN   = window.location.origin;
  var _timers  = {};
  var _inline  = false;
  var _preview = false;

  function send(msg) {
    try { window.parent.postMessage(msg, ORIGIN); } catch (_) {}
  }

  // ── CSS selector builder ──────────────────────────────────────────────────
  function sel(el) {
    var parts = [], node = el;
    while (node && node.nodeType === 1 &&
           node !== document.body && node !== document.documentElement) {
      if (node.id && /^[a-zA-Z][\w-]*$/.test(node.id)) {
        parts.unshift('#' + node.id);
        return parts.join(' > ');
      }
      var tag = node.tagName.toLowerCase();
      var cls = Array.from(node.classList)
        .filter(function (c) { return /^[a-zA-Z][\w-]*$/.test(c); })
        .slice(0, 2);
      var seg = cls.length ? tag + '.' + cls.join('.') : tag;
      if (node.parentElement) {
        var sibs = Array.from(node.parentElement.children)
          .filter(function (s) { return s.tagName === node.tagName; });
        if (sibs.length > 1) seg += ':nth-of-type(' + (sibs.indexOf(node) + 1) + ')';
      }
      parts.unshift(seg);
      node = node.parentElement;
    }
    return parts.join(' > ') || el.tagName.toLowerCase();
  }

  // ── Feature 1: Inline text editing ───────────────────────────────────────
  var EDITABLE = 'h1,h2,h3,h4,p,span,li,button,label,td,th,caption';

  function activateInline() {
    _inline = true;
    document.querySelectorAll(EDITABLE).forEach(function (el) {
      if (el.hasAttribute('data-ve-inline')) return;
      if (!el.textContent.trim()) return;
      if (el.closest('script,style')) return;

      el.setAttribute('contenteditable', 'true');
      el.setAttribute('data-ve-inline', '1');

      var s = sel(el);
      function onInput() {
        clearTimeout(_timers[s]);
        _timers[s] = setTimeout(function () {
          send({ type: 'INLINE_CHANGE', selector: s, value: el.textContent });
          delete _timers[s];
        }, 800);
      }
      function onFocus() { el.style.outline = '2px solid #f59e0b'; el.style.outlineOffset = '1px'; }
      function onBlur()  {
        el.style.outline = ''; el.style.outlineOffset = '';
        clearTimeout(_timers[s]);
        send({ type: 'INLINE_CHANGE', selector: s, value: el.textContent });
        delete _timers[s];
      }
      el.addEventListener('input', onInput);
      el.addEventListener('focus', onFocus);
      el.addEventListener('blur',  onBlur);
      el._veH = { i: onInput, f: onFocus, b: onBlur };
    });

    // Suppress link navigation during editing
    document.querySelectorAll('a[href]').forEach(function (a) {
      if (!a._veNav) {
        a._veNav = function (e) { e.preventDefault(); };
        a.addEventListener('click', a._veNav, true);
      }
    });
  }

  function deactivateInline() {
    _inline = false;
    document.querySelectorAll('[data-ve-inline]').forEach(function (el) {
      el.removeAttribute('contenteditable');
      el.removeAttribute('data-ve-inline');
      el.style.outline = ''; el.style.outlineOffset = '';
      if (el._veH) {
        el.removeEventListener('input', el._veH.i);
        el.removeEventListener('focus', el._veH.f);
        el.removeEventListener('blur',  el._veH.b);
        delete el._veH;
      }
    });
    document.querySelectorAll('a[href]').forEach(function (a) {
      if (a._veNav) { a.removeEventListener('click', a._veNav, true); delete a._veNav; }
    });
  }

  // ── Feature 2: Image click ────────────────────────────────────────────────
  function onImgClick(e) {
    if (_preview) return;
    e.preventDefault(); e.stopPropagation();
    var img   = e.currentTarget;
    var secEl = img.closest('[data-ve-section]');
    send({
      type:      'IMAGE_CLICK',
      selector:  sel(img),
      src:       img.getAttribute('src') || img.src || '',
      sectionId: secEl ? secEl.getAttribute('data-ve-section') : null,
      w:         img.naturalWidth  || img.width  || 0,
      h:         img.naturalHeight || img.height || 0
    });
  }

  function wireImages() {
    document.querySelectorAll('img').forEach(function (img) {
      if (img._veImg) return;
      img._veImg = true;
      if (!_preview) img.style.cursor = 'zoom-in';
      img.addEventListener('click', onImgClick, true);
    });
  }

  // ── Feature 3: Apply image from parent ───────────────────────────────────
  function applyImg(msg) {
    var img = document.querySelector(msg.selector);
    if (!img || img.tagName !== 'IMG') return;
    if (msg.src)       img.src = msg.src;
    var posX  = msg.posX  != null ? msg.posX  : 50;
    var posY  = msg.posY  != null ? msg.posY  : 50;
    var scale = msg.scale != null ? msg.scale : 100;
    img.style.objectFit      = 'cover';
    img.style.objectPosition = posX + '% ' + posY + '%';
    img.style.transform      = scale !== 100 ? 'scale(' + (scale / 100) + ')' : '';

    var secEl = img.closest('[data-ve-section]');
    if (secEl) {
      send({
        type:      'SECTION_HTML_UPDATED',
        sectionId: secEl.getAttribute('data-ve-section'),
        html:      secEl.innerHTML
      });
    }
  }

  // ── Feature 4: Preview mode ───────────────────────────────────────────────
  function enterPreview() {
    _preview = true;
    deactivateInline();
    document.querySelectorAll('img').forEach(function (img) { img.style.cursor = ''; });
    document.querySelectorAll('[data-ve-overlay]').forEach(function (el) {
      if (el.parentNode) el.parentNode.removeChild(el);
    });
    send({ type: 'PREVIEW_MODE_ACTIVE' });
  }

  // ── Message listener ──────────────────────────────────────────────────────
  window.addEventListener('message', function (e) {
    if (e.origin !== ORIGIN) return;
    var msg = e.data;
    if      (msg === 'INLINE_ENABLE')         { if (!_preview) { deactivateInline(); activateInline(); } }
    else if (msg === 'INLINE_DISABLE')        deactivateInline();
    else if (msg === 'PREVIEW_MODE')          enterPreview();
    else if (msg && msg.type === 'APPLY_IMG') applyImg(msg);
  });

  // ── Init ──────────────────────────────────────────────────────────────────
  function init() {
    activateInline();
    wireImages();
    send({ type: 'EDITOR_READY' });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}());
"""

with open('public/editor-bridge.js', 'w', encoding='utf-8') as f:
    f.write(CONTENT)

r = subprocess.run(['node', '--check', 'public/editor-bridge.js'], capture_output=True)
if r.returncode == 0:
    print('editor-bridge.js: SYNTAX OK (' + str(len(CONTENT)) + ' chars)')
else:
    print('SYNTAX ERROR:', r.stderr.decode())
    sys.exit(1)
