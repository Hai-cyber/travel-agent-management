/**
 * editor-bridge.js — Visual Editor iframe bridge
 *
 * Injected into the rendered template by GET /api/tenant/preview.
 * Enables click-to-select mode when activated by the parent editor window.
 *
 * Protocol (postMessage, same-origin only):
 *   Parent → iframe:  'EDITOR_ACTIVATE'      — enable hover highlight + click capture
 *   Parent → iframe:  'EDITOR_DEACTIVATE'    — disable, remove all highlights
 *   iframe → parent:  { type: 'ELEMENT_SELECTED', selector, tagName, currentValue }
 *
 * CSS selector generation strategy:
 *   1. If element has a valid ID → use #id (shortest, stops climbing)
 *   2. tag + up to 2 BEM-safe class names
 *   3. Append :nth-of-type(n) when siblings share the same tag
 *   4. Walk up to <body>, join parts with ' > '
 */
(function () {
  'use strict';

  let selectMode = false;
  let hoveredEl  = null;

  // ── Listen for activate/deactivate messages from the parent editor ─────────
  window.addEventListener('message', function (e) {
    if (e.origin !== window.location.origin) return;
    if (e.data === 'EDITOR_ACTIVATE') {
      selectMode = true;
      document.body.style.cursor = 'crosshair';
    } else if (e.data === 'EDITOR_DEACTIVATE') {
      selectMode = false;
      document.body.style.cursor = '';
      clearHighlight();
    }
  });

  // ── Hover highlight ────────────────────────────────────────────────────────
  function clearHighlight() {
    if (hoveredEl) {
      hoveredEl.style.outline       = '';
      hoveredEl.style.outlineOffset = '';
      hoveredEl = null;
    }
  }

  document.addEventListener('mouseover', function (e) {
    if (!selectMode) return;
    const el = e.target;
    if (el === document.body || el === document.documentElement) return;
    clearHighlight();
    hoveredEl                    = el;
    hoveredEl.style.outline      = '2px dashed #6366f1';
    hoveredEl.style.outlineOffset = '2px';
  }, true);

  document.addEventListener('mouseout', function (e) {
    if (!selectMode) return;
    if (hoveredEl && !hoveredEl.contains(e.relatedTarget)) clearHighlight();
  }, true);

  // ── Click capture ──────────────────────────────────────────────────────────
  document.addEventListener('click', function (e) {
    if (!selectMode) return;
    e.preventDefault();
    e.stopPropagation();
    clearHighlight();

    const el       = e.target;
    const selector = getCssSelector(el);

    // currentValue: src for images, trimmed text for everything else
    const currentValue = el.tagName === 'IMG'
      ? (el.getAttribute('src') ?? '')
      : el.textContent.trim().slice(0, 120);

    window.parent.postMessage(
      { type: 'ELEMENT_SELECTED', selector, tagName: el.tagName, currentValue },
      window.location.origin
    );
  }, true);

  // ── CSS selector generator ─────────────────────────────────────────────────
  /**
   * Generate the shortest reliable CSS selector for an element.
   * Stops climbing as soon as a unique ID segment is found.
   * Appends :nth-of-type to disambiguate siblings that share the same tag.
   */
  function getCssSelector(el) {
    const parts = [];
    let node = el;

    while (node && node.nodeType === 1 && node !== document.body && node !== document.documentElement) {
      const tag = node.tagName.toLowerCase();

      // ID wins — guarantees uniqueness, no need to go further up
      if (node.id && /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(node.id)) {
        parts.unshift('#' + node.id);
        return parts.join(' > ');
      }

      // Build: tag + up to 2 class names (alphanumeric/hyphen/underscore only)
      let segment = tag;
      const classes = Array.from(node.classList)
        .filter(function (c) { return /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(c); })
        .slice(0, 2);
      if (classes.length) segment += '.' + classes.join('.');

      // Disambiguate with :nth-of-type when same-tag siblings exist
      if (node.parentElement) {
        var sameTagSiblings = Array.from(node.parentElement.children)
          .filter(function (s) { return s.tagName === node.tagName; });
        if (sameTagSiblings.length > 1) {
          segment += ':nth-of-type(' + (sameTagSiblings.indexOf(node) + 1) + ')';
        }
      }

      parts.unshift(segment);
      node = node.parentElement;
    }

    return parts.join(' > ') || el.tagName.toLowerCase();
  }

}());
