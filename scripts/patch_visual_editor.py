#!/usr/bin/env python3
# patch_visual_editor.py — replaces the snippets panel in visual-editor.html
import sys, re

FILE = 'public/visual-editor.html'
with open(FILE, 'r', encoding='utf-8') as f:
    content = f.read()

# ── Locate the snippets-panel by finding its id attribute ─────────────────
start_marker = 'id="snippets-panel"'
idx = content.find(start_marker)
if idx == -1:
    sys.exit('ERROR: id="snippets-panel" not found')

# Walk back to the opening < of its parent <div
div_start = content.rfind('<div', 0, idx)
if div_start == -1:
    sys.exit('ERROR: could not find opening <div of snippets-panel')

# Walk forward to the closing comment "Template Switcher Panel" to find the
# boundary of what we want to replace
end_marker = '<!-- \u2500\u2500 Template Switcher Panel'   # ── Template Switcher Panel
end_idx = content.find(end_marker, idx)
if end_idx == -1:
    sys.exit('ERROR: could not find end marker (Template Switcher Panel)')

old_block = content[div_start:end_idx]

new_block = '''      <!-- \u2500\u2500 Add Snippets Panel (shown when "Th\xeam Kh\u1ed1i" tab active) \u2500\u2500\u2500\u2500 -->
      <div id="snippets-panel" hidden style="margin-top:10px">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#64748b;margin-bottom:6px">
          \U0001f9e9 Kho Kh\u1ed1i N\u1ed9i Dung
        </div>
        <!-- Accordion groups injected dynamically by renderSnippetsPanel() -->
        <div id="snip-accordion">
          <div class="snip-empty">\u23f3 \u0110ang t\u1ea3i kh\u1ed1i\u2026</div>
        </div>
        <p style="font-size:10px;color:#334155;margin:6px 0 0;text-align:center">Click kh\u1ed1i \u2192 ch\u00e8n v\xe0o trang v\xe0 l\u01b0u ngay</p>
      </div>

      <!-- Hover-preview popover (shared, repositioned by JS) -->
      <div id="snip-popover" aria-hidden="true">
        <div id="snip-popover-img-wrap"></div>
        <div id="snip-popover-info">
          <div id="snip-popover-lbl"></div>
          <div id="snip-popover-dsc"></div>
          <div id="snip-popover-cat"></div>
        </div>
      </div>

      '''

result = content[:div_start] + new_block + content[end_idx:]

with open(FILE, 'w', encoding='utf-8') as f:
    f.write(result)
print(f'OK: replaced {len(old_block)} chars with {len(new_block)} chars')
print(f'  snip-accordion now at:', result.find('id="snip-accordion"'))
print(f'  snip-popover now at:', result.find('id="snip-popover"'))
