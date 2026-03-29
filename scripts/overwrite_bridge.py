#!/usr/bin/env python3
"""overwrite_bridge.py — clean-rewrite editor-bridge.js (2 features only)"""
content = r"""/**
 * editor-bridge.js  v3  (clean rewrite)
 *
 * Injected into the rendered template iframe by GET /api/tenant/preview.
 *
 * Two features only:
 *   1. Click-to-select  — hover highlight + click captures CSS selector
 *   2. Inline text edit — contenteditable on text nodes; INLINE_CHANGE debounced
 *
 * postMessage protocol
 *   parent -> iframe:  'EDITOR_ACTIVATE' | 'EDITOR_DEACTIVATE'
 *                      'EDITOR_INLINE_ENABLE' | 'EDITOR_INLINE_DISABLE'
 *   iframe -> parent:  { type:'EDITOR_READY' }
 *                      { type:'ELEMENT_SELECTED', selector, tagName, currentValue }
 *                      { type:'INLINE_CHANGE', selector, value }
 */
(function () {
  'use strict';

  var ORIGIN     = window.location.origin;
  var selectMode = false;
  var inlineMode = false;
  var _hovered   = null;
  var _timers    = {};

  function send(payload) {
    try { window.parent.postMessage(payload, ORIGIN); } catch (_) {}
  }

  // -- CSS selector builder --------------------------------------------------
  function getSelector(el) {
    var parts = [];
    var node  = el;
    while (node && node.nodeType === 1 &&
           node !== document.body && node !== document.documentElement) {
      if (node.id && /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(node.id)) {
        parts.unshift('#' + node.id);
        return parts.join(' > ');
      }
      var tag = node.tagName.toLowerCase();
      var cls = Array.from(node.classList)
        .filter(function (c) { return /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(c); })
        .slice(0, 2);
      var seg = cls.length ? tag + '.' + cls.join('.') : tag;
      if (node.parentElement) {
        var sibs = Array.from(node.parentElement.children)
          .filter(function (s) { return s.tagName === node.tagName; });
        if (sibs.length > 1)
          seg += ':nth-of-type(' + (sibs.indexOf(node) + 1) + ')';
      }
      parts.unshift(seg);
      node = node.parentElement;
    }
    return parts.join(' > ') || el.tagName.toLowerCase();
  }

  // == Feature 1: Click-to-select ============================================
  function onOver(e) {
    if (_hovered === e.target) return;
    if (_hovered) _hovered.style.outline = '';
    _hovered = e.target;
    _hovered.style.outline = '2px dashed #6366f1';
  }
  function onOut() {
    if (_hovered) { _hovered.style.outline = ''; _hovered = null; }
  }
  function onClick(e) {
    e.preventDefault(); e.stopPropagation();
    var el = e.target;
    if (_hovered) _hovered.style.outline = '2px solid #10b981';
    deactivateSelect();
    send({
      type:         'ELEMENT_SELECTED',
      selector:     getSelector(el),
      tagName:      el.tagName,
      currentValue: el.textContent.trim()
    });
  }

  function activateSelect() {
    selectMode = true;
    document.body.style.cursor = 'crosshair';
    document.addEventListener('mouseover', onOver,  true);
    document.addEventListener('mouseout',  onOut,   true);
    document.addEventListener('click',     onClick, true);
  }
  function deactivateSelect() {
    selectMode = false;
    document.body.style.cursor = '';
    if (_hovered) { _hovered.style.outline = ''; _hovered = null; }
    document.removeEventListener('mouseover', onOver,  true);
    document.removeEventListener('mouseout',  onOut,   true);
    document.removeEventListener('click',     onClick, true);
  }

  // == Feature 2: Inline text editing ========================================
  var TAGS = 'h1,h2,h3,h4,p,span,a,li,button,label,td,th,caption';

  function activateInlineEditing() {
    inlineMode = true;
    document.querySelectorAll(TAGS).forEach(function (el) {
      if (el.getAttribute('data-ve-inline')) return;
      if (!el.textContent.trim()) return;

      el.setAttribute('contenteditable', 'true');
      el.setAttribute('data-ve-inline', '1');

      function onInput() {
        var sel = getSelector(el);
        clearTimeout(_timers[sel]);
        _timers[sel] = setTimeout(function () {
          send({ type: 'INLINE_CHANGE', selector: sel, value: el.textContent });
          delete _timers[sel];
        }, 800);
      }
      function onFocus() { el.style.outline = '2px solid #f59e0b'; }
      function onBlur() {
        el.style.outline = '';
        var sel = getSelector(el);
        clearTimeout(_timers[sel]);
        send({ type: 'INLINE_CHANGE', selector: sel, value: el.textContent });
        delete _timers[sel];
      }

      el.addEventListener('input', onInput);
      el.addEventListener('focus', onFocus);
      el.addEventListener('blur',  onBlur);
      el._ve = { onInput: onInput, onFocus: onFocus, onBlur: onBlur };
    });

    // Suppress navigation on all links while editing
    document.querySelectorAll('a[href]').forEach(function (a) {
      if (!a._veNav) {
        a._veNav = function (e) { e.preventDefault(); };
        a.addEventListener('click', a._veNav, true);
      }
    });
  }

  function deactivateInlineEditing() {
    inlineMode = false;
    document.querySelectorAll('[data-ve-inline]').forEach(function (el) {
      el.removeAttribute('contenteditable');
      el.removeAttribute('data-ve-inline');
      el.style.outline = '';
      if (el._ve) {
        el.removeEventListener('input', el._ve.onInput);
        el.removeEventListener('focus', el._ve.onFocus);
        el.removeEventListener('blur',  el._ve.onBlur);
        delete el._ve;
      }
    });
    document.querySelectorAll('a[href]').forEach(function (a) {
      if (a._veNav) {
        a.removeEventListener('click', a._veNav, true);
        delete a._veNav;
      }
    });
  }

  // == Message listener ======================================================
  window.addEventListener('message', function (e) {
    if (e.origin !== ORIGIN) return;
    var msg = e.data;
    if      (msg === 'EDITOR_ACTIVATE')       activateSelect();
    else if (msg === 'EDITOR_DEACTIVATE')     deactivateSelect();
    else if (msg === 'EDITOR_INLINE_ENABLE')  { deactivateInlineEditing(); activateInlineEditing(); }
    else if (msg === 'EDITOR_INLINE_DISABLE') deactivateInlineEditing();
  });

  // == Auto-init =============================================================
  function init() {
    activateInlineEditing();
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
    f.write(content.lstrip())

import subprocess
r = subprocess.run(['node', '--check', 'public/editor-bridge.js'], capture_output=True)
if r.returncode == 0:
    print('editor-bridge.js: SYNTAX OK')
else:
    print('SYNTAX ERROR:', r.stderr.decode())
