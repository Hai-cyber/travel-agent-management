/**
 * editor-bridge.js  v5  (Site Studio)
 *
 * Auto-injected into every preview iframe.
 *
 * Features:
 *   1. Inline text editing — click text → contenteditable, debounced INLINE_CHANGE
 *   2. Image click         — sends IMAGE_CLICK to parent (opens image editor)
 *   3. Apply image changes — parent sends APPLY_IMG { selector, src, posX, posY, scale }
 *   4. Preview mode        — strips all editing UI for clean in-place preview
 *   5. Append section live — parent sends APPEND_SECTION { sectionId, html }
 *   6. Section delete      — hover [data-ve-section] → trash button → SECTION_DELETED
 *
 * iframe → parent:
 *   { type: 'EDITOR_READY' }
 *   { type: 'INLINE_CHANGE',        selector, value }
 *   { type: 'IMAGE_CLICK',          selector, src, sectionId, w, h }
 *   { type: 'SECTION_HTML_UPDATED', sectionId, html }
 *   { type: 'PREVIEW_MODE_ACTIVE' }
 *   { type: 'SECTION_APPENDED',     sectionId }
 *   { type: 'SECTION_DELETED',      sectionId }
 *
 * parent → iframe:
 *   'INLINE_ENABLE'
 *   'INLINE_DISABLE'
 *   'PREVIEW_MODE'
 *   { type: 'APPLY_IMG',       selector, src, posX, posY, scale }
 *   { type: 'APPEND_SECTION',  sectionId, html }
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

      // [SEC] Strip <script> blocks and inline event handlers before storing
      //       innerHTML.  Content is tenant-admin-only (X-Tenant-ID gated) so
      //       the risk is self-XSS, but we sanitise anyway as defence-in-depth.
      function _sanitizeHtml(html) {
        return html
          .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<!--[\s\S]*?-->/g, '')            // strip HTML comments
          .replace(/\s+on[a-z]+\s*=\s*(["']).*?\1/gi, '') // on*="..." attrs
          .replace(/\s+on[a-z]+\s*=\s*[^\s>]*/gi, '')     // on*=value (unquoted)
          .replace(/\s+href\s*=\s*(["'])\s*javascript:[^]*?\1/gi, '') // js: hrefs
          .trim();
      }

      function onInput() {
        clearTimeout(_timers[s]);
        _timers[s] = setTimeout(function () {
          send({ type: 'INLINE_CHANGE', selector: s, htmlValue: _sanitizeHtml(el.innerHTML) });
          delete _timers[s];
        }, 800);
      }
      function onFocus() {
        // Mark the element as active so theme-presets.css can apply the
        // [data-theme] [data-ve-active] neon glow in the current --p colour.
        el.setAttribute('data-ve-active', '1');
        // Also highlight the nearest [data-ve-section] ancestor to make the
        // active block boundary crystal-clear.
        var sec = el.closest('[data-ve-section]');
        if (sec && !sec._veActiveMark) {
          sec._veActiveMark = true;
          // Neon border using the --p CSS variable from the live document.
          var pColor = getComputedStyle(document.documentElement)
                         .getPropertyValue('--p').trim() || '#6366f1';
          sec._veActiveStyle = sec.style.cssText;
          sec.style.outline       = '2px solid ' + pColor;
          sec.style.outlineOffset = '-1px';
          sec.style.boxShadow     = '0 0 0 4px ' + pColor + '33'; // 20% opacity glow
        }
      }
      function onBlur()  {
        el.removeAttribute('data-ve-active');
        // Remove active-block highlight once focus leaves the element.
        var sec = el.closest('[data-ve-section]');
        if (sec && sec._veActiveMark) {
          // Only clear if no other child inside the section still has focus.
          setTimeout(function () {
            if (sec.contains(document.activeElement)) return;
            sec._veActiveMark = false;
            sec.style.outline       = '';
            sec.style.outlineOffset = '';
            sec.style.boxShadow     = '';
          }, 80);
        }
        el.style.outline = ''; el.style.outlineOffset = '';
        clearTimeout(_timers[s]);
        send({ type: 'INLINE_CHANGE', selector: s, htmlValue: _sanitizeHtml(el.innerHTML) });
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
      el.removeAttribute('data-ve-active');
      el.style.outline = ''; el.style.outlineOffset = '';
      if (el._veH) {
        el.removeEventListener('input', el._veH.i);
        el.removeEventListener('focus', el._veH.f);
        el.removeEventListener('blur',  el._veH.b);
        delete el._veH;
      }
    });
    // Clear any active-block section highlights.
    document.querySelectorAll('[data-ve-section]').forEach(function (sec) {
      if (sec._veActiveMark) {
        sec._veActiveMark  = false;
        sec.style.outline  = '';
        sec.style.outlineOffset = '';
        sec.style.boxShadow = '';
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

  // ── Feature 2b: Button / link click → open link editor in sidebar ─────────
  // Targets any <a data-ve-btn="1"> (injected by syncAllSnippets.mjs).
  // Falls back to matching common Cruip button patterns even without the attr.
  var _BTN_SEL = 'a[data-ve-btn], a.btn, a[class*="btn-"], a[class*="button"]';

  function onBtnClick(e) {
    if (_preview) return;
    var btn = e.currentTarget;
    // If the element is currently contenteditable, let the caret land normally.
    if (btn.getAttribute('contenteditable') === 'true') return;
    e.preventDefault(); e.stopPropagation();
    var secEl = btn.closest('[data-ve-section]');
    send({
      type:      'BUTTON_CLICK',
      selector:  sel(btn),
      text:      btn.textContent.trim(),
      href:      btn.getAttribute('href') || '',
      sectionId: secEl ? secEl.getAttribute('data-ve-section') : null
    });
  }

  function wireBtns() {
    document.querySelectorAll(_BTN_SEL).forEach(function (btn) {
      if (btn._veBtn) return;
      btn._veBtn = true;
      if (!_preview) btn.style.cursor = 'text';
      btn.addEventListener('click', onBtnClick, true);
    });
  }

  function unwireBtns() {
    document.querySelectorAll(_BTN_SEL).forEach(function (btn) {
      if (!btn._veBtn) return;
      btn._veBtn = false;
      btn.style.cursor = '';
      btn.removeEventListener('click', onBtnClick, true);
    });
  }

  // Apply a link/text update sent from the parent's button editor panel.
  function applyBtn(msg) {
    var btn = document.querySelector(msg.selector);
    if (!btn) return;
    if (msg.text != null) btn.textContent = msg.text;
    if (msg.href != null) btn.setAttribute('href', msg.href);
    var secEl = btn.closest('[data-ve-section]');
    if (secEl) {
      send({
        type:      'SECTION_HTML_UPDATED',
        sectionId: secEl.getAttribute('data-ve-section'),
        html:      secEl.innerHTML
      });
    }
  }

  // ── Feature 3: Apply image from parent ───────────────────────────────────
  //
  // Throttled via requestAnimationFrame so rapid slider events from the
  // parent (many postMessages per second) never queue more than one DOM
  // write per paint frame — eliminates jank on the iframe.
  var _pendingImg    = null;   // latest msg waiting to be painted
  var _imgRafPending = false;  // true if an rAF is already scheduled

  function _doApplyImg() {
    _imgRafPending = false;
    var msg = _pendingImg;
    _pendingImg = null;
    if (!msg) return;

    var img = document.querySelector(msg.selector);
    if (!img || img.tagName !== 'IMG') return;
    if (msg.src) img.src = msg.src;
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

  function applyImg(msg) {
    _pendingImg = msg;
    if (!_imgRafPending) {
      _imgRafPending = true;
      requestAnimationFrame(_doApplyImg);
    }
  }

  // ── Feature 4: Preview mode ───────────────────────────────────────────────
  function enterPreview() {
    _preview = true;
    deactivateInline();
    unwireSections();
    document.querySelectorAll('img').forEach(function (img) { img.style.cursor = ''; });
    unwireBtns();
    document.querySelectorAll('[data-ve-overlay]').forEach(function (el) {
      if (el.parentNode) el.parentNode.removeChild(el);
    });    // Remove drop zone from the DOM entirely in preview mode.
    _dropZoneEl = null;    send({ type: 'PREVIEW_MODE_ACTIVE' });
  }

  // ── Feature 5: Append section live ───────────────────────────────────────
  // Parent sends: { type: 'APPEND_SECTION', sectionId: string, html: string }
  // We wrap in the data-ve-section sentinel div (mirrors siteStudio.js) and
  // append to <main id="canvas"> if present, otherwise to <body>.
  //
  // Header Offset:
  //   On the FIRST snippet insertion, we measure the header/nav height and set
  //   padding-top on the first section wrapper so it clears the fixed header.
  //   Subsequent inserts don't need adjustment because they stack below.
  //
  // Offset is applied via a CSS custom property --ve-header-h so it can be
  //   overridden by templates that have their own spacing logic.
  // ── Z-Index Guard + Header Offset ────────────────────────────────────────
  //
  // Strategy (based on user suggestion — CSS-first, no margin-collapse risk):
  //
  //   siteStudio.js already injects a CSS block that covers the common case:
  //     body { display:flex; flex-direction:column }
  //     body > header { position:sticky !important; top:0; z-index:9999 }
  //     #canvas { flex-grow:1 }
  //
  //   This JS layer is a belt-and-suspenders fallback for edge cases:
  //   1. Apply z-index + position:relative to ALL body-level headers so even
  //      static-positioned headers create a stacking context (user's suggestion).
  //   2. Apply padding-top on <main id="canvas"> — NOT marginTop on the first
  //      snippet. padding never collapses, margin does.
  //   3. Report the measured height to the parent (visual-editor.html) via
  //      HEADER_HEIGHT_MEASURED so it can be persisted in cfg.header_height and
  //      injected as server-side CSS on future loads (zero FOUC).
  //
  // _getHeaderEl() — find the body-level site header.
  //   Accepts ALL position values including static (user's request):
  //   even a static header may need z-index if snippets under it use
  //   transform/relative with conflicting z-index.
  function _getHeaderEl() {
    // Always prefer body's direct children first to avoid matching inner
    // <header> elements inside snippet sections.
    return document.querySelector('body > header')            ||
           document.querySelector('body > nav')               ||
           document.querySelector('[role="banner"]')          ||
           document.querySelector('body > [class*="header"]') ||
           document.querySelector('body > [id*="header"]')    ||
           document.querySelector('header')                   ||
           null;
  }

  function _getHeaderHeight() {
    var el = _getHeaderEl();
    if (!el) return 0;
    var r = el.getBoundingClientRect();
    return r.height > 0 ? r.height : el.offsetHeight;
  }

  // ── Z-Index Guard ────────────────────────────────────────────────────────
  var _headerZIndexDone = false;

  function _applyZIndexToHeader(el) {
    // Force a stacking context even on static headers (user's advice).
    var pos = window.getComputedStyle(el).position;
    if (pos === 'static') el.style.position = 'relative';
    el.style.zIndex    = '9999';
    el.style.isolation = 'isolate';
    _headerZIndexDone  = true;
  }

  function _guardHeaderZIndex() {
    requestAnimationFrame(function () {
      var el = _getHeaderEl();
      if (el) { _applyZIndexToHeader(el); return; }
      setTimeout(function () {
        var el2 = _getHeaderEl();
        if (el2) _applyZIndexToHeader(el2);
      }, 300);
    });
  }

  // ── Header Offset ────────────────────────────────────────────────────────
  // Applies padding-top on <main id="canvas"> so snippets start below the
  // header. padding-top never collapses; margin-top on the first child can.
  //
  // Also fires HEADER_HEIGHT_MEASURED so the parent can persist the value in
  // site_config and inject it as server-side CSS on future page loads.
  var _headerOffsetApplied = false;

  function _applyHeaderOffset() {
    if (_headerOffsetApplied) return;
    requestAnimationFrame(function () {
      var h = _getHeaderHeight();
      var canvas = document.getElementById('canvas');

      // If siteStudio's CSS already handles this via flex layout, the canvas
      // element will have no overlap with the header. We still persist the
      // measured height so the server can inject it deterministically.
      if (h > 0) {
        _headerOffsetApplied = true;
        document.documentElement.style.setProperty('--ve-header-h', h + 'px');

        // Only set padding-top if the CSS guard didn't already handle it.
        // Check: if canvas top is still behind the header (top < h after RAF).
        if (canvas) {
          var canvasTop = canvas.getBoundingClientRect().top;
          if (canvasTop < h) {
            canvas.style.paddingTop = h + 'px';
          }
        }

        send({ type: 'HEADER_HEIGHT_MEASURED', height: h });
        return;
      }

      // Retry once after 300 ms for async-injected headers/fonts.
      setTimeout(function () {
        if (_headerOffsetApplied) return;
        var h2 = _getHeaderHeight();
        if (h2 <= 0) return;

        _headerOffsetApplied = true;
        document.documentElement.style.setProperty('--ve-header-h', h2 + 'px');
        var canvas2 = document.getElementById('canvas');
        if (canvas2) {
          var canvasTop2 = canvas2.getBoundingClientRect().top;
          if (canvasTop2 < h2) {
            canvas2.style.paddingTop = h2 + 'px';
          }
        }
        send({ type: 'HEADER_HEIGHT_MEASURED', height: h2 });
      }, 300);
    });
  }

  // ── Empty-State Drop Zone ─────────────────────────────────────────────────
  // Shows a prominent centre overlay when the page has no [data-ve-section]
  // elements (i.e. only header + footer exist).
  var _dropZoneEl = null;

  function _ensureDropZone() {
    if (_dropZoneEl) return _dropZoneEl;
    var dz = document.createElement('div');
    dz.setAttribute('data-ve-overlay', '1');
    dz.setAttribute('id', 've-drop-zone');
    var s = dz.style;
    s.position        = 'fixed';
    s.top             = '0';
    s.left            = '0';
    s.width           = '100%';
    s.height          = '100%';
    s.display         = 'flex';
    s.flexDirection   = 'column';
    s.alignItems      = 'center';
    s.justifyContent  = 'center';
    s.gap             = '16px';
    s.zIndex          = '999998';   // below header guard (999999) but above page content
    s.pointerEvents   = 'none';     // transparent to clicks so normal page interactions still work
    s.background      = 'rgba(0,0,0,0.55)';
    s.backdropFilter  = 'blur(3px)';
    s.webkitBackdropFilter = 'blur(3px)';
    s.opacity         = '0';
    s.transition      = 'opacity .3s ease';
    s.display         = 'none';   // start hidden; _syncDropZone sets display:flex when needed

    var icon = document.createElement('div');
    icon.setAttribute('data-ve-icon', '1');
    icon.textContent  = '⬇';
    icon.style.fontSize    = '56px';
    icon.style.lineHeight  = '1';
    icon.style.opacity     = '0.8';
    icon.style.animation   = 've-bounce 1.6s ease-in-out infinite';
    icon.style.animationPlayState = 'paused'; // don't animate until visible

    var label = document.createElement('div');
    label.textContent = 'Kéo thả Snippet vào đây';
    label.style.color       = '#fff';
    label.style.fontSize    = '22px';
    label.style.fontWeight  = '800';
    label.style.fontFamily  = 'ui-sans-serif,system-ui,sans-serif';
    label.style.letterSpacing = '0.02em';
    label.style.textShadow  = '0 2px 12px rgba(0,0,0,0.8)';

    var sub = document.createElement('div');
    sub.textContent = 'Chọn một Snippet trong sidebar và nhấn để thêm';
    sub.style.color      = 'rgba(255,255,255,0.65)';
    sub.style.fontSize   = '13px';
    sub.style.fontFamily = 'ui-sans-serif,system-ui,sans-serif';
    sub.style.textShadow = '0 1px 6px rgba(0,0,0,0.7)';

    // Inject keyframes for the bounce animation once
    if (!document.getElementById('ve-dz-style')) {
      var style = document.createElement('style');
      style.id  = 've-dz-style';
      style.textContent = [
        '@keyframes ve-bounce {',
        '  0%,100% { transform:translateY(0); }',
        '  50%     { transform:translateY(-12px); }',
        '}'
      ].join('');
      document.head.appendChild(style);
    }

    dz.appendChild(icon);
    dz.appendChild(label);
    dz.appendChild(sub);
    document.body.appendChild(dz);
    _dropZoneEl = dz;
    return dz;
  }

  function _syncDropZone() {
    if (_preview) return;
    var hasSections = document.querySelectorAll('[data-ve-section]').length > 0;
    var dz = _ensureDropZone();

    if (hasSections) {
      // ── Hide path ──────────────────────────────────────────────────────
      // 1. Fade opacity to 0 (CSS transition plays).
      dz.style.opacity = '0';
      // 2. After transition ends, set display:none so the element is fully
      //    removed from the compositing tree and the bounce animation stops.
      //    Use a one-shot transitionend listener; fall back to setTimeout.
      var _hide = function () {
        dz.removeEventListener('transitionend', _hide);
        dz.style.display = 'none';
        // Also stop the CSS animation to save GPU compositing cost.
        var icon = dz.querySelector('[data-ve-icon]');
        if (icon) icon.style.animationPlayState = 'paused';
      };
      dz.addEventListener('transitionend', _hide, { once: true });
      // Fallback: transition may not fire if element was already opacity:0
      setTimeout(function () {
        if (dz.style.display !== 'none') _hide();
      }, 400);
    } else {
      // ── Show path ──────────────────────────────────────────────────────
      // 1. Make visible in layout (display:flex) with opacity still at 0.
      dz.style.display = 'flex';
      var icon2 = dz.querySelector('[data-ve-icon]');
      if (icon2) icon2.style.animationPlayState = 'running';
      // 2. On next rAF, set opacity:1 so the CSS fade-in transition plays.
      requestAnimationFrame(function () {
        dz.style.opacity = '1';
      });
    }
    // Always keep pointer-events:none so clicks pass through to page content.
    dz.style.pointerEvents = 'none';
  }

  function appendSection(msg) {
    if (_preview) return;
    var wrapper = document.createElement('div');
    var safeId  = String(msg.sectionId || '').replace(/[^a-zA-Z0-9_-]/g, '');
    wrapper.setAttribute('data-ve-section', safeId);
    wrapper.innerHTML = msg.html || '';
    var target = document.getElementById('canvas') || document.body;

    // Insert before the footer (last [data-ve-section] or <footer>) if present,
    // otherwise append at the end.
    var footer = document.querySelector('footer, [data-ve-section="footer"]');
    if (footer && footer.parentNode === target) {
      target.insertBefore(wrapper, footer);
    } else {
      target.insertAdjacentElement('beforeend', wrapper);
    }

    // Apply header clearance to the very first snippet inserted.
    _applyHeaderOffset();

    // Z-index guard: re-run now that CSS is definitely loaded.
    if (!_headerZIndexDone) _guardHeaderZIndex();

    // Wire editing + section controls on the newly added nodes.
    activateInline();
    wireImages();
    wireBtns();
    wireSections();

    // Hide the drop zone — page now has content.
    _syncDropZone();

    send({
      type:      'SECTION_APPENDED',
      sectionId: safeId
    });
  }

  // ── Feature 6: Section controls — Floating Pill (right-centre) ──────────
  //
  // A vertical floating pill is anchored to the MIDDLE of the right edge of
  // each [data-ve-section] block:
  //
  //   ┌─ section ──────────────────────────── │[↑]│ ─┐
  //   │  …content…                             │[↓]│   │
  //   │                                        │[🗑]│   │
  //   └────────────────────────────────────── ──────── ┘
  //
  // The pill uses position:absolute inside the section wrapper (which we set to
  // position:relative).  top:50% + translateY(-50%) centres it vertically
  // regardless of section height.
  //
  // Stability — linger-timer pattern (replaces immediate-hide on mouseleave):
  //   • mouseenter on section  → cancel pending hide, show pill
  //   • mouseleave on section  → schedule hide after LINGER_MS
  //   • mouseenter on pill     → cancel pending hide (cursor slid onto pill)
  //   • mouseleave on pill     → schedule hide after LINGER_MS
  //
  // This prevents Cruip hover effects (which may momentarily re-trigger
  // mouseleave on the section) from flickering the pill away.
  //
  // Z-index:  2147483647 — above all Cruip layers.
  // DOM cost: ONE shared pill element reused across all sections.

  var _toolbar        = null;    // shared pill element
  var _trashTarget    = null;    // section currently "hosting" the pill
  var _hideTimer      = null;    // linger timer
  var LINGER_MS       = 180;     // ms before pill auto-hides after cursor leaves

  function _cancelHide() {
    if (_hideTimer) { clearTimeout(_hideTimer); _hideTimer = null; }
  }

  function _scheduleHide(secEl) {
    _cancelHide();
    _hideTimer = setTimeout(function () {
      _hideTimer = null;
      _detachToolbar(secEl);
    }, LINGER_MS);
  }

  function _makeBtn(emoji, title, bg) {
    var b = document.createElement('button');
    b.setAttribute('data-ve-overlay', '1');
    b.title       = title;
    b.textContent = emoji;
    var s = b.style;
    s.width           = '30px';
    s.height          = '30px';
    s.padding         = '0';
    s.cursor          = 'pointer';
    s.border          = 'none';
    s.outline         = 'none';
    s.borderRadius    = '50%';
    s.background      = bg;
    s.color           = '#fff';
    s.fontSize        = '14px';
    s.lineHeight      = '1';
    s.display         = 'flex';
    s.alignItems      = 'center';
    s.justifyContent  = 'center';
    s.flexShrink      = '0';
    s.transition      = 'opacity .12s, transform .12s';
    s.opacity         = '0.92';
    b.addEventListener('mouseenter', function () { s.opacity = '1'; s.transform = 'scale(1.12)'; });
    b.addEventListener('mouseleave', function () { s.opacity = '0.92'; s.transform = ''; });
    return b;
  }

  function _ensureToolbar() {
    if (_toolbar) return _toolbar;

    var bar = document.createElement('div');
    bar.setAttribute('data-ve-overlay', '1');
    var bs = bar.style;
    // ── Position: middle of the right edge ──────────────────────────────────
    bs.position        = 'absolute';
    bs.top             = '50%';
    bs.right           = '10px';
    bs.transform       = 'translateY(-50%)';
    bs.zIndex          = '2147483647';
    // ── Pill layout: vertical stack ──────────────────────────────────────────
    bs.display         = 'flex';
    bs.flexDirection   = 'column';
    bs.gap             = '5px';
    bs.alignItems      = 'center';
    bs.padding         = '8px 6px';
    // ── Pill appearance ──────────────────────────────────────────────────────
    bs.background      = 'rgba(0,0,0,0.82)';
    bs.backdropFilter  = 'blur(10px) saturate(1.4)';
    bs.webkitBackdropFilter = 'blur(10px) saturate(1.4)';
    bs.border          = '1px solid rgba(255,255,255,0.14)';
    bs.borderRadius    = '999px';
    bs.boxShadow       = '0 6px 20px rgba(0,0,0,0.55), 0 1px 3px rgba(0,0,0,0.3)';

    var upBtn    = _makeBtn('↑', 'Move section up',     'rgba(99,102,241,0.9)');
    var downBtn  = _makeBtn('↓', 'Move section down',   'rgba(99,102,241,0.9)');
    var trashBtn = _makeBtn('🗑', 'Delete section',      'rgba(220,38,38,0.9)');

    upBtn.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      if (!_trashTarget) return;
      send({ type: 'MOVE_SECTION',
             sectionId: _trashTarget.getAttribute('data-ve-section'),
             direction: 'up' });
    });

    downBtn.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      if (!_trashTarget) return;
      send({ type: 'MOVE_SECTION',
             sectionId: _trashTarget.getAttribute('data-ve-section'),
             direction: 'down' });
    });

    trashBtn.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      if (!_trashTarget) return;
      _cancelHide();
      var sectionId = _trashTarget.getAttribute('data-ve-section');
      var secEl     = _trashTarget;
      _trashTarget  = null;
      if (secEl.parentNode) secEl.parentNode.removeChild(secEl);
      send({ type: 'SECTION_DELETED', sectionId: sectionId });
      // After deletion, re-check whether drop zone should reappear.
      _syncDropZone();
    });

    // ── Pill's own mouseenter/leave — keeps linger timer alive ──────────────
    // Without these, moving the cursor from the section edge into the pill
    // triggers mouseleave on the section and the pill would vanish before
    // the user reaches the buttons.
    bar.addEventListener('mouseenter', function () { _cancelHide(); });
    bar.addEventListener('mouseleave', function () {
      if (_trashTarget) _scheduleHide(_trashTarget);
    });

    bar.appendChild(upBtn);
    bar.appendChild(downBtn);
    bar.appendChild(trashBtn);
    _toolbar = bar;
    return bar;
  }

  function _attachToolbar(secEl) {
    if (_preview) return;
    // Ensure the section is a positioning context for position:absolute pill.
    var pos = window.getComputedStyle(secEl).position;
    if (pos === 'static') secEl.style.position = 'relative';
    // Subtle dashed outline to indicate the active section boundary.
    secEl.style.outline       = '2px dashed rgba(99,102,241,0.4)';
    secEl.style.outlineOffset = '-2px';
    var bar = _ensureToolbar();
    _trashTarget = secEl;
    secEl.appendChild(bar);
  }

  function _detachToolbar(secEl) {
    if (!secEl) return;
    secEl.style.outline       = '';
    secEl.style.outlineOffset = '';
    var bar = _ensureToolbar();
    if (bar.parentNode === secEl) secEl.removeChild(bar);
    if (_trashTarget === secEl) _trashTarget = null;
  }

  function wireSections() {
    document.querySelectorAll('[data-ve-section]').forEach(function (secEl) {
      if (secEl._veSec) return;
      secEl._veSec = true;

      secEl.addEventListener('mouseenter', function () {
        // Cancel any pending hide and (re-)attach the pill to this section.
        _cancelHide();
        // Detach from any previous section first.
        if (_trashTarget && _trashTarget !== secEl) _detachToolbar(_trashTarget);
        _attachToolbar(secEl);
      });

      secEl.addEventListener('mouseleave', function (e) {
        // If the cursor moved directly onto the pill itself, do nothing —
        // the pill's own mouseenter handler already cancelled the timer.
        if (e.relatedTarget && _toolbar && _toolbar.contains(e.relatedTarget)) return;
        _scheduleHide(secEl);
      });
    });
  }

  function unwireSections() {
    _cancelHide();
    document.querySelectorAll('[data-ve-section]').forEach(function (secEl) {
      secEl.style.outline       = '';
      secEl.style.outlineOffset = '';
      if (secEl._veSec) secEl._veSec = false;
    });
    if (_toolbar && _toolbar.parentNode) _toolbar.parentNode.removeChild(_toolbar);
    _trashTarget = null;
  }

  // ── Message listener ──────────────────────────────────────────────────────
  window.addEventListener('message', function (e) {
    if (e.origin !== ORIGIN) return;
    var msg = e.data;
    if      (msg === 'INLINE_ENABLE')            { if (!_preview) { deactivateInline(); activateInline(); } }
    else if (msg === 'INLINE_DISABLE')           deactivateInline();
    else if (msg === 'PREVIEW_MODE')             enterPreview();
    else if (msg && msg.type === 'APPLY_IMG')    applyImg(msg);
    else if (msg && msg.type === 'APPLY_BTN')    applyBtn(msg);
    else if (msg && msg.type === 'APPEND_SECTION') appendSection(msg);
  });

  // ── Init ──────────────────────────────────────────────────────────────────
  function init() {
    activateInline();
    wireImages();
    wireBtns();
    wireSections();
    // Z-index guard: header must float above snippet content.
    _guardHeaderZIndex();
    // Measure header height, apply padding-top on #canvas if needed,
    // and report to parent for server-side persistence.
    _applyHeaderOffset();
    // Empty-state drop zone: show if page has no snippet sections yet.
    _syncDropZone();
    send({ type: 'EDITOR_READY' });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}());
