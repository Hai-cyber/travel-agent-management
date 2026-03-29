#!/usr/bin/env python3
"""patch_snippets_js.py — rewrites the snippets panel JS in visual-editor.html"""
import sys, re

FILE = 'public/visual-editor.html'
with open(FILE, 'r', encoding='utf-8') as f:
    content = f.read()

# ─────────────────────────────────────────────────────────────────────────────
# 1.  Replace DOM ref lines for snipGrid + snipCatBar  →  snipAccordion + popover
# ─────────────────────────────────────────────────────────────────────────────
OLD_REFS = "  var snipGrid        = document.getElementById('snip-grid');\n  var snipCatBar      = document.getElementById('snip-cat-bar');"
NEW_REFS = """\
  var snipAccordion   = document.getElementById('snip-accordion');
  var snipPopover     = document.getElementById('snip-popover');
  var snipPopImgWrap  = document.getElementById('snip-popover-img-wrap');
  var snipPopLbl      = document.getElementById('snip-popover-lbl');
  var snipPopDsc      = document.getElementById('snip-popover-dsc');
  var snipPopCat      = document.getElementById('snip-popover-cat');"""

if OLD_REFS in content:
    content = content.replace(OLD_REFS, NEW_REFS, 1)
    print('  [1] DOM refs replaced')
else:
    print('  [1] WARN: DOM refs not found, skipping')

# ─────────────────────────────────────────────────────────────────────────────
# 2.  Replace _snipActiveCat + loadSnippetsPanel + renderSnippetsPanel
#     + old snipCatBar event listener
# ─────────────────────────────────────────────────────────────────────────────
# Start marker: the comment + var declaration
START_SIG = "  // ── Add Snippets panel — sources from common-sections.html via loadSectionLibrary() ──"
# End marker: the line right after the snipCatBar event listener block, i.e. the first line of doInsertSnippet
END_SIG   = "  // ── Core insert function (sidebar snippets panel + section picker modal) ──"

idx_start = content.find(START_SIG)
idx_end   = content.find(END_SIG)

if idx_start == -1:
    sys.exit('ERROR: start marker not found')
if idx_end == -1:
    sys.exit('ERROR: end marker not found')

old_block = content[idx_start:idx_end]

# Category metadata: label, icon, hint
CATS = {
    'essential': ('\u2705 Essential',  '\u2705', 'Hero, Intro, Features'),
    'commerce':  ('\U0001f4b0 Commerce', '\U0001f4b0', 'Tours, Pricing, Booking'),
    'trust':     ('\u2b50 Trust',      '\u2b50', 'Testimonials, Partners, FAQ'),
    'contact':   ('\U0001f4ec Contact', '\U0001f4ec', 'Forms, Footer'),
}
# Build the JS literal for CAT_META
cats_js_lines = ['  var SNIP_CAT_META = {']
for k, (label, icon, hint) in CATS.items():
    cats_js_lines.append(f"    {k}: {{ label: '{label}', icon: '{icon}', hint: '{hint}' }},")
cats_js_lines.append('  };')
cats_js = '\n'.join(cats_js_lines)

new_block = r"""  // ── Add Snippets panel — Odoo-style accordion with hover preview ──────────────────
  // Sources from common-sections.html parsed by loadSectionLibrary().
""" + cats_js + r"""

  var _snipOpenCats = { essential: true, commerce: false, trust: false, contact: false };
  var _snipPopTimer = null;

  async function loadSnippetsPanel() {
    snipAccordion.innerHTML = '<div class="snip-empty">\u23f3 \u0110ang t\u1ea3i kh\u1ed1i\u2026</div>';
    try {
      await loadSectionLibrary();
      renderSnippetsPanel();
    } catch (err) {
      snipAccordion.innerHTML = '<div class="snip-empty" style="animation:none;color:#ef4444">\u26a0 T\u1ea3i th\u1ea5t b\u1ea1i: ' + escHtml(err.message) + '</div>';
    }
  }

  function renderSnippetsPanel() {
    var all = _sectionCache || [];
    snipAccordion.innerHTML = '';

    var CAT_ORDER = ['essential', 'commerce', 'trust', 'contact'];
    var anyFound  = false;

    CAT_ORDER.forEach(function (catKey) {
      var meta = SNIP_CAT_META[catKey] || { label: catKey, icon: '\u25a6', hint: '' };
      var items = all.filter(function (s) { return s.category === catKey; });
      if (!items.length) return;
      anyFound = true;

      var group = document.createElement('div');
      group.className = 'snip-acc-group';
      if (_snipOpenCats[catKey]) group.classList.add('open');
      group.setAttribute('data-cat', catKey);

      // Header button
      var hdr = document.createElement('button');
      hdr.className = 'snip-acc-hdr';
      hdr.innerHTML =
        '<span style="font-size:14px;flex-shrink:0">' + meta.icon + '</span>' +
        '<span class="snip-acc-hdr-title">' + escHtml(meta.label) + '</span>' +
        '<span class="snip-acc-hdr-count">' + items.length + '</span>' +
        '<span class="snip-acc-arrow">\u25b6</span>';
      hdr.addEventListener('click', function () {
        var isOpen = group.classList.toggle('open');
        _snipOpenCats[catKey] = isOpen;
      });
      group.appendChild(hdr);

      // Body
      var body = document.createElement('div');
      body.className = 'snip-acc-body';

      var grid = document.createElement('div');
      grid.className = 'snip-grid';

      items.forEach(function (snip) {
        var icon  = snip.icon  || '\u25a6';
        var label = snip.label || snip.type;

        var card = document.createElement('div');
        card.className = 'snip-card';
        card.setAttribute('data-snip-id', snip.type || '');

        var thumbHtml = snip.thumbnail
          ? '<img class="snip-thumb" src="' + snip.thumbnail + '" alt="" loading="lazy">'
          : '<div class="snip-thumb-ph">' + icon + '</div>';

        card.innerHTML =
          '<div class="snip-thumb-wrap">' + thumbHtml + '</div>' +
          '<div class="snip-footer">' +
            '<span class="snip-icon">' + icon + '</span>' +
            '<span class="snip-label">' + escHtml(label) + '</span>' +
          '</div>';

        // Hover: show popover
        card.addEventListener('mouseenter', function (e) {
          clearTimeout(_snipPopTimer);
          _snipPopTimer = setTimeout(function () { showSnipPopover(snip, card); }, 220);
        });
        card.addEventListener('mouseleave', function () {
          clearTimeout(_snipPopTimer);
          hideSnipPopover();
        });

        // Click: insert
        card.addEventListener('click', function () {
          if (!tenantId) { showStatus('T\u1ea3i preview tr\u01b0\u1edbc.', true); return; }
          hideSnipPopover();
          doInsertSnippet(snip, card);
        });

        grid.appendChild(card);
      });

      body.appendChild(grid);
      group.appendChild(body);
      snipAccordion.appendChild(group);
    });

    if (!anyFound) {
      snipAccordion.innerHTML = '<div class="snip-empty" style="animation:none">Kh\xf4ng t\xecm th\u1ea5y kh\u1ed1i n\xe0o.</div>';
    }
  }

  // ── Hover preview popover ─────────────────────────────────────────────────
  function showSnipPopover(snip, cardEl) {
    var label = snip.label || snip.type || '';
    var catMeta = SNIP_CAT_META[snip.category] || { label: snip.category || '', icon: '' };

    snipPopLbl.textContent = label;
    snipPopDsc.textContent = snip.desc || '';
    snipPopCat.textContent = catMeta.icon + ' ' + catMeta.label;

    if (snip.thumbnail) {
      snipPopImgWrap.innerHTML = '<img id="snip-popover-img" src="' + snip.thumbnail + '" alt="" loading="lazy">';
    } else {
      snipPopImgWrap.innerHTML = '<div id="snip-popover-ph">' + (snip.icon || '\u25a6') + '</div>';
    }

    // Position: right of the sidebar (popover has fixed position)
    var rect = cardEl.getBoundingClientRect();
    // Sidebar is on the left, so show the popover to the right of the sidebar's right edge
    var sidebarRight = (document.querySelector('.sidebar') || document.body).getBoundingClientRect().right;
    var left = sidebarRight + 8;
    var top  = Math.max(8, rect.top - 10);
    // clamp to window height
    var maxTop = window.innerHeight - 240;
    if (top > maxTop) top = maxTop;

    snipPopover.style.left = left + 'px';
    snipPopover.style.top  = top  + 'px';
    snipPopover.classList.add('visible');
  }

  function hideSnipPopover() {
    snipPopover.classList.remove('visible');
  }

  // ── Core insert function (sidebar snippets panel + section picker modal) ──
"""

content = content[:idx_start] + new_block + content[idx_end:]
print('  [2] loadSnippetsPanel / renderSnippetsPanel rewritten')

# ─────────────────────────────────────────────────────────────────────────────
# 3.  Save
# ─────────────────────────────────────────────────────────────────────────────
with open(FILE, 'w', encoding='utf-8') as f:
    f.write(content)

print(f'  Done. Wrote {len(content)} chars to {FILE}')
# Quick sanity checks
checks = ['snip-accordion', 'snip-popover', 'renderSnippetsPanel', 'showSnipPopover', 'SNIP_CAT_META']
for c in checks:
    present = c in content
    print(f'  {"OK" if present else "MISSING"}: {c}')
