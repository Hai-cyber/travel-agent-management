/**
 * booking-widget.js — Quote & Draft Side-Drawer Widget
 *
 * Embed anywhere in an HTML page (including static R2-hosted tour pages):
 *
 *   <script src="/booking-widget.js"
 *           data-tour-id="TOUR1"
 *           data-tenant-id="T001"
 *           data-api-base="https://your-worker.workers.dev"
 *           data-lang="en">
 *   </script>
 *
 * What it creates automatically:
 *   • A floating "I like this tour" trigger button (fixed, right side)
 *   • A full-height side drawer with:
 *       – DatePicker (min = today)
 *       – Pax inputs: Adults (Shared), Adults (Private), Children, Infants
 *       – Travel-style segment selector (auto-populated from compare API)
 *       – Live itemized invoice panel (debounced, recalcs on every change)
 *       – "Save this Plan" → POST /api/bookings/draft → shareable link
 *
 * Auto-load from share link:
 *   When opened with ?draft=XXXXX in the URL, the widget auto-opens,
 *   pre-fills the form from the saved draft, and shows the share link.
 *
 * [SEC] All API calls send X-Tenant-ID from data-tenant-id.
 *       Prices are always server-authoritative — client never submits a price.
 */
(function () {
  'use strict';

  // ── Configuration ─────────────────────────────────────────────────────────
  // document.currentScript is only valid synchronously at script parse time —
  // capture it before any async or deferred code runs.
  const _script   = document.currentScript;
  const TOUR_ID   = (_script?.dataset.tourId   ?? '').trim();
  const TENANT_ID = (_script?.dataset.tenantId ?? '').trim();
  const API_BASE  = (_script?.dataset.apiBase  ?? '').replace(/\/+$/, '');
  const LANG      = (_script?.dataset.lang     ?? 'en').toLowerCase();

  if (!TOUR_ID || !TENANT_ID) {
    console.warn('[BookingWidget] <script> tag must have data-tour-id and data-tenant-id.');
    return;
  }

  // ── i18n strings ──────────────────────────────────────────────────────────
  const STRINGS = {
    en: {
      trigger:       'I like this tour',
      title:         'Get Your Quote',
      date_label:    'Travel Date',
      shared_label:  'Adults (Shared Room)',
      private_label: 'Adults (Private Room)',
      child_label:   'Children (3–11)',
      infant_label:  'Infants (0–2)',
      segment_label: 'Travel Style',
      segment_all:   '— Compare all styles —',
      calculating:   'Calculating…',
      no_date:       'Please select a travel date.',
      no_pax:        'Please enter at least 1 adult.',
      err_generic:   'Could not fetch pricing. Please try again.',
      no_price:      'No pricing available for this combination.',
      grand_total:   'Grand Total',
      select_style:  'Choose this',
      season_label:  'Season applied:',
      style_label:   'Travel style:',
      band_label:    'Pax band:',
      disclaimer:    '⚠',
      preview_note:  'Estimated price — confirmed at booking.',
      save_btn:      'Save this Plan',
      saving:        'Saving…',
      share_label:   'Share this plan with your group:',
      copy_btn:      'Copy',
      copied:        'Copied!',
      close:         'Close',
    },
    vi: {
      trigger:       'Tôi thích tour này',
      title:         'Nhận báo giá',
      date_label:    'Ngày khởi hành',
      shared_label:  'Người lớn (Phòng đôi)',
      private_label: 'Người lớn (Phòng đơn)',
      child_label:   'Trẻ em (3–11 tuổi)',
      infant_label:  'Em bé (0–2 tuổi)',
      segment_label: 'Loại hình tour',
      segment_all:   '— So sánh tất cả —',
      calculating:   'Đang tính giá…',
      no_date:       'Vui lòng chọn ngày khởi hành.',
      no_pax:        'Vui lòng nhập ít nhất 1 người lớn.',
      err_generic:   'Không thể lấy giá. Vui lòng thử lại.',
      no_price:      'Không có giá cho lựa chọn này.',
      grand_total:   'Tổng chi phí',
      select_style:  'Chọn loại này',
      season_label:  'Mùa áp dụng:',
      style_label:   'Loại hình:',
      band_label:    'Nhóm hành khách:',
      disclaimer:    '⚠',
      preview_note:  'Giá tham khảo — xác nhận chính thức khi đặt tour.',
      save_btn:      'Lưu kế hoạch này',
      saving:        'Đang lưu…',
      share_label:   'Chia sẻ kế hoạch với mọi người:',
      copy_btn:      'Sao chép',
      copied:        'Đã sao chép!',
      close:         'Đóng',
    },
  };
  const L  = STRINGS[LANG] ?? STRINGS.en;
  const t  = (k) => L[k] ?? k;

  // ── CSS (scoped by #bw- prefix) ───────────────────────────────────────────
  const CSS = `
    #bw-trigger {
      position: fixed; right: 0; top: 50%;
      transform: translateY(-50%) rotate(-90deg) translateX(50%);
      transform-origin: right center;
      z-index: 9000;
      background: #0057b7; color: #fff; border: none;
      padding: 10px 22px; font-size: 14px; font-weight: 600;
      font-family: system-ui, sans-serif;
      border-radius: 8px 8px 0 0;
      cursor: pointer; white-space: nowrap;
      box-shadow: -2px 0 14px rgba(0,0,0,.28);
      transition: background .2s;
      user-select: none;
    }
    #bw-trigger:hover { background: #004a9f; }

    #bw-overlay {
      display: none; position: fixed; inset: 0;
      background: rgba(0,0,0,.45); z-index: 9001;
      backdrop-filter: blur(2px);
    }
    #bw-overlay.bw-open { display: block; }

    #bw-drawer {
      position: fixed; right: 0; top: 0; bottom: 0;
      width: 440px; max-width: 100vw;
      background: #fff; z-index: 9002;
      display: flex; flex-direction: column;
      box-shadow: -6px 0 32px rgba(0,0,0,.18);
      transform: translateX(110%);
      transition: transform .32s cubic-bezier(.4,0,.2,1);
      font-family: system-ui, -apple-system, sans-serif;
      overflow: hidden;
    }
    #bw-drawer.bw-open { transform: translateX(0); }

    #bw-dh {
      padding: 18px 20px 16px; flex-shrink: 0;
      background: #0057b7; color: #fff;
      display: flex; align-items: center; justify-content: space-between;
    }
    #bw-dh h2 { margin: 0; font-size: 17px; font-weight: 700; }
    #bw-close-btn {
      background: none; border: none; color: #fff;
      font-size: 24px; line-height: 1; cursor: pointer;
      padding: 0 4px; border-radius: 4px; opacity: .85;
    }
    #bw-close-btn:hover { opacity: 1; background: rgba(255,255,255,.15); }

    #bw-body {
      flex: 1; overflow-y: auto; padding: 20px 20px 8px;
      display: flex; flex-direction: column; gap: 14px;
    }

    .bw-field { display: flex; flex-direction: column; gap: 4px; }
    .bw-field label {
      font-size: 11px; font-weight: 700; color: #374151;
      text-transform: uppercase; letter-spacing: .06em;
    }
    .bw-field input, .bw-field select {
      border: 1.5px solid #d1d5db; border-radius: 7px;
      padding: 9px 12px; font-size: 15px; font-family: inherit;
      background: #fff; transition: border-color .15s, box-shadow .15s;
      width: 100%; box-sizing: border-box; color: #111;
    }
    .bw-field input:focus, .bw-field select:focus {
      outline: none; border-color: #0057b7;
      box-shadow: 0 0 0 3px rgba(0,87,183,.13);
    }
    .bw-field input.bw-err-field { border-color: #dc2626 !important; }

    .bw-pax-grid {
      display: grid; grid-template-columns: 1fr 1fr; gap: 12px;
    }

    #bw-invoice {
      background: #f8fafc; border: 1px solid #e2e8f0;
      border-radius: 9px; padding: 16px 16px 12px;
      font-size: 14px; min-height: 80px;
    }
    .bw-status {
      color: #94a3b8; font-style: italic;
      text-align: center; padding: 14px 0;
    }
    .bw-err {
      color: #b91c1c; background: #fef2f2;
      border: 1px solid #fca5a5; border-radius: 6px;
      padding: 9px 13px; font-size: 13px;
    }

    .bw-inv-table {
      width: 100%; border-collapse: collapse; font-size: 13px;
    }
    .bw-inv-table th {
      font-size: 11px; text-transform: uppercase;
      letter-spacing: .04em; color: #6b7280;
      text-align: left; padding: 3px 0 8px;
      border-bottom: 1px solid #e2e8f0;
    }
    .bw-inv-table th:last-child,
    .bw-inv-table td:last-child { text-align: right; }
    .bw-inv-table td {
      padding: 7px 0; color: #1f2937;
      border-bottom: 1px solid #f1f5f9; vertical-align: middle;
    }
    .bw-inv-table .bw-total-row td {
      font-weight: 700; font-size: 15px; color: #0057b7;
      border-top: 2px solid #cbd5e1; border-bottom: none;
      padding-top: 11px;
    }
    .bw-inv-meta {
      margin-top: 9px; font-size: 12px; color: #64748b;
      display: flex; flex-direction: column; gap: 3px;
    }
    .bw-disclaimer {
      margin-top: 9px; font-size: 12px; color: #92400e;
      background: #fffbeb; border: 1px solid #fcd34d;
      border-radius: 6px; padding: 8px 12px;
    }
    .bw-preview-note {
      margin-top: 10px; font-size: 11px;
      color: #94a3b8; text-align: center;
    }

    /* Compare cards */
    .bw-compare-grid { display: flex; flex-direction: column; gap: 8px; }
    .bw-ccard {
      border: 1.5px solid #e2e8f0; border-radius: 9px;
      padding: 12px 14px; display: flex;
      align-items: center; justify-content: space-between; gap: 10px;
      cursor: default; transition: border-color .15s, background .15s;
    }
    .bw-ccard:hover { border-color: #93c5fd; background: #f0f9ff; }
    .bw-ccard-name { font-weight: 600; font-size: 14px; color: #1e293b; }
    .bw-ccard-price { font-size: 15px; font-weight: 700; color: #0057b7; margin-top: 2px; }
    .bw-ccard-btn {
      background: #0057b7; color: #fff;
      border: none; border-radius: 6px;
      padding: 6px 13px; font-size: 12px; font-weight: 600;
      cursor: pointer; flex-shrink: 0;
      transition: background .15s;
    }
    .bw-ccard-btn:hover { background: #004a9f; }

    /* Footer */
    #bw-footer {
      padding: 16px 20px 20px; border-top: 1px solid #e5e7eb;
      flex-shrink: 0; background: #fff;
    }
    #bw-save-btn {
      width: 100%; padding: 13px; background: #059669;
      color: #fff; border: none; border-radius: 8px;
      font-size: 15px; font-weight: 700; font-family: inherit;
      cursor: pointer; transition: background .2s, opacity .2s;
    }
    #bw-save-btn:hover:not(:disabled) { background: #047857; }
    #bw-save-btn:disabled { opacity: .5; cursor: not-allowed; }

    #bw-share-box {
      margin-top: 12px; display: none;
      flex-direction: column; gap: 6px;
    }
    #bw-share-box.bw-visible { display: flex; }
    #bw-share-label {
      font-size: 12px; font-weight: 700; color: #065f46;
    }
    #bw-share-row { display: flex; gap: 6px; }
    #bw-share-input {
      flex: 1; border: 1.5px solid #6ee7b7;
      border-radius: 7px; padding: 8px 11px;
      font-size: 12px; font-family: monospace;
      background: #f0fdf4; color: #1f2937; cursor: text;
    }
    #bw-copy-btn {
      background: #059669; color: #fff; border: none;
      border-radius: 6px; padding: 8px 13px;
      font-size: 12px; font-weight: 700;
      font-family: system-ui, sans-serif;
      cursor: pointer; white-space: nowrap;
      transition: background .15s;
    }
    #bw-copy-btn:hover { background: #047857; }

    @media (max-width: 480px) {
      #bw-drawer { width: 100vw; }
      .bw-pax-grid { grid-template-columns: 1fr; }
    }
  `;

  // ── DOM builders ──────────────────────────────────────────────────────────
  function injectCSS() {
    const s = document.createElement('style');
    s.id = 'bw-styles';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  // Escape text for .innerHTML
  function esc(v) {
    return String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function buildDOM() {
    // Floating trigger
    const trigger = document.createElement('button');
    trigger.id = 'bw-trigger';
    trigger.innerHTML = `&#10084;&#xFE0F;&nbsp;${esc(t('trigger'))}`;
    trigger.setAttribute('aria-haspopup', 'dialog');

    // Overlay
    const overlay = document.createElement('div');
    overlay.id = 'bw-overlay';

    // Drawer
    const drawer = document.createElement('div');
    drawer.id = 'bw-drawer';
    drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('aria-modal', 'true');
    drawer.setAttribute('aria-labelledby', 'bw-title');
    drawer.innerHTML = `
      <div id="bw-dh">
        <h2 id="bw-title">${esc(t('title'))}</h2>
        <button id="bw-close-btn" aria-label="${esc(t('close'))}">&times;</button>
      </div>

      <div id="bw-body">

        <div class="bw-field">
          <label for="bw-date">${esc(t('date_label'))}</label>
          <input id="bw-date" type="date" autocomplete="off">
        </div>

        <div class="bw-pax-grid">
          <div class="bw-field">
            <label for="bw-shared">${esc(t('shared_label'))}</label>
            <input id="bw-shared"  type="number" min="0" max="99" value="2">
          </div>
          <div class="bw-field">
            <label for="bw-private">${esc(t('private_label'))}</label>
            <input id="bw-private" type="number" min="0" max="99" value="0">
          </div>
        </div>

        <div class="bw-pax-grid">
          <div class="bw-field">
            <label for="bw-children">${esc(t('child_label'))}</label>
            <input id="bw-children" type="number" min="0" max="99" value="0">
          </div>
          <div class="bw-field">
            <label for="bw-infants">${esc(t('infant_label'))}</label>
            <input id="bw-infants" type="number" min="0" max="99" value="0">
          </div>
        </div>

        <div class="bw-field">
          <label for="bw-segment">${esc(t('segment_label'))}</label>
          <select id="bw-segment">
            <option value="">${esc(t('segment_all'))}</option>
          </select>
        </div>

        <div id="bw-invoice">
          <div class="bw-status">&middot;&middot;&middot;</div>
        </div>

      </div><!-- /#bw-body -->

      <div id="bw-footer">
        <button id="bw-save-btn" disabled>${esc(t('save_btn'))}</button>
        <div id="bw-share-box">
          <div id="bw-share-label">${esc(t('share_label'))}</div>
          <div id="bw-share-row">
            <input id="bw-share-input" type="text" readonly>
            <button id="bw-copy-btn">${esc(t('copy_btn'))}</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(trigger);
    document.body.appendChild(overlay);
    document.body.appendChild(drawer);
    return { trigger, overlay, drawer };
  }

  // ── Panel helpers ─────────────────────────────────────────────────────────
  function setPanel(html) {
    const el = document.getElementById('bw-invoice');
    if (el) el.innerHTML = html;
  }

  function setSaveEnabled(yes) {
    const btn = document.getElementById('bw-save-btn');
    if (btn) btn.disabled = !yes;
  }

  // ── Drawer open/close ─────────────────────────────────────────────────────
  function openDrawer(overlay, drawer) {
    overlay.classList.add('bw-open');
    drawer.classList.add('bw-open');
    document.body.style.overflow = 'hidden';
    // Focus first interactive element for accessibility
    setTimeout(() => document.getElementById('bw-date')?.focus(), 80);
  }

  function closeDrawer(overlay, drawer) {
    overlay.classList.remove('bw-open');
    drawer.classList.remove('bw-open');
    document.body.style.overflow = '';
  }

  // ── State & form read ─────────────────────────────────────────────────────
  const state = {
    date:         '',
    adult_shared: 2,
    adult_private: 0,
    children:     0,
    infants:      0,
    segment_id:   '',
    lastResult:   null,   // last successful API response
    _inflight:    false,
  };

  function readForm() {
    state.date          = document.getElementById('bw-date')?.value        ?? '';
    state.adult_shared  = clampInt(document.getElementById('bw-shared')?.value    ?? 0);
    state.adult_private = clampInt(document.getElementById('bw-private')?.value   ?? 0);
    state.children      = clampInt(document.getElementById('bw-children')?.value  ?? 0);
    state.infants       = clampInt(document.getElementById('bw-infants')?.value   ?? 0);
    state.segment_id    = document.getElementById('bw-segment')?.value     ?? '';
  }

  function clampInt(v) {
    const n = parseInt(v, 10);
    return isNaN(n) ? 0 : Math.max(0, n);
  }

  function validate() {
    const dateEl = document.getElementById('bw-date');
    dateEl?.classList.remove('bw-err-field');
    if (!state.date) {
      dateEl?.classList.add('bw-err-field');
      return t('no_date');
    }
    if (state.adult_shared + state.adult_private === 0) return t('no_pax');
    return null;
  }

  // ── Formatting dual-currency values ──────────────────────────────────────
  // The API returns unit_price / subtotal as either a string or
  // { usd: '$10.00', local: '250,000 ₫' }
  function fmtDual(v) {
    if (!v) return '—';
    if (typeof v === 'string')  return v;
    if (typeof v === 'number') return v.toLocaleString();
    // object: show local currency when it differs from USD
    if (v.local && v.local !== v.usd) return `${v.usd}\u00a0(${v.local})`;
    return v.usd ?? JSON.stringify(v);
  }

  // ── Invoice renderers ─────────────────────────────────────────────────────
  function renderSingle(data) {
    const inv = data.invoice;
    if (!inv?.line_items?.length) {
      return `<div class="bw-status">${esc(t('no_price'))}</div>`;
    }

    const rows = inv.line_items.map(item => `
      <tr>
        <td>${esc(item.label)}</td>
        <td style="text-align:center">${item.qty}</td>
        <td>${esc(fmtDual(item.unit_price))}</td>
        <td>${esc(fmtDual(item.subtotal))}</td>
      </tr>`).join('');

    const totalDisplay = fmtDual(inv.grand_total_display);

    const metaParts = [
      data.applied_season_name ? `<span>${esc(t('season_label'))} <strong>${esc(data.applied_season_name)}</strong></span>` : '',
      data.segment_name        ? `<span>${esc(t('style_label'))} <strong>${esc(data.segment_name)}</strong></span>`        : '',
      data.pax_band_name       ? `<span>${esc(t('band_label'))} <strong>${esc(data.pax_band_name)}</strong></span>`        : '',
    ].filter(Boolean).join('');

    const disclaimerHtml = data.infant_disclaimer
      ? `<div class="bw-disclaimer">${esc(t('disclaimer'))} ${esc(data.infant_disclaimer)}</div>`
      : '';

    return `
      <table class="bw-inv-table">
        <thead>
          <tr>
            <th>Item</th>
            <th style="text-align:center">Qty</th>
            <th>Unit price</th>
            <th>Subtotal</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr class="bw-total-row">
            <td colspan="3">${esc(t('grand_total'))}</td>
            <td>${esc(totalDisplay)}</td>
          </tr>
        </tfoot>
      </table>
      ${metaParts ? `<div class="bw-inv-meta">${metaParts}</div>` : ''}
      ${disclaimerHtml}
      <p class="bw-preview-note">${esc(t('preview_note'))}</p>
    `;
  }

  function renderCompare(data) {
    const segs = data.segments ?? [];
    if (!segs.length) return `<div class="bw-status">${esc(t('no_price'))}</div>`;

    // Sync segment <select> options (preserve current selection)
    const sel   = document.getElementById('bw-segment');
    const prev  = sel?.value ?? '';
    if (sel) {
      while (sel.options.length > 1) sel.remove(1);
      segs.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.segment_id;
        opt.textContent = s.segment_name ?? s.segment_code ?? s.segment_id;
        sel.appendChild(opt);
      });
      if (prev) sel.value = prev;
    }

    const cards = segs.map(s => {
      const price = fmtDual(s.invoice?.grand_total_display ?? s.price_summary?.display);
      const name  = esc(s.segment_name ?? s.segment_code ?? s.segment_id ?? '?');
      return `
        <div class="bw-ccard">
          <div>
            <div class="bw-ccard-name">${name}</div>
            <div class="bw-ccard-price">${esc(price)}</div>
          </div>
          <button class="bw-ccard-btn" data-seg="${esc(s.segment_id)}"
                  aria-label="Select ${name}">
            ${esc(t('select_style'))}
          </button>
        </div>`;
    }).join('');

    return `
      <div class="bw-compare-grid">${cards}</div>
      <p class="bw-preview-note">${esc(t('preview_note'))}</p>
    `;
  }

  // ── API calls ─────────────────────────────────────────────────────────────
  async function apiCalculate() {
    const body = {
      tour_id:                 TOUR_ID,
      travel_date:             state.date,
      adult_shared_room_count: state.adult_shared,
      adult_single_room_count: state.adult_private,
      child_count:             state.children,
      infant_count:            state.infants,
    };
    if (state.segment_id) body.segment_id = state.segment_id;

    const res = await fetch(`${API_BASE}/api/pricing/calculate`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': TENANT_ID },
      body:    JSON.stringify(body),
    });
    return res.json();
  }

  async function apiSaveDraft() {
    const res = await fetch(`${API_BASE}/api/bookings/draft`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': TENANT_ID },
      body:    JSON.stringify({
        tour_id:     TOUR_ID,
        travel_date: state.date,
        segment_id:  state.segment_id,
        pax: {
          adult_shared_room_count: state.adult_shared,
          adult_single_room_count: state.adult_private,
          child_count:             state.children,
          infant_count:            state.infants,
        },
      }),
    });
    return res.json();
  }

  async function apiLoadDraft(draftId) {
    const res = await fetch(
      `${API_BASE}/api/bookings/draft/${encodeURIComponent(draftId)}`,
      { headers: { 'X-Tenant-ID': TENANT_ID } }
    );
    return res.json();
  }

  // ── Debounce ──────────────────────────────────────────────────────────────
  function debounce(fn, ms) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
  }

  // ── Core recalculate logic ────────────────────────────────────────────────
  async function recalculate() {
    if (state._inflight) return;
    state._inflight = true;

    readForm();

    const errMsg = validate();
    if (errMsg) {
      setPanel(`<div class="bw-err">${esc(errMsg)}</div>`);
      setSaveEnabled(false);
      state._inflight = false;
      return;
    }

    setPanel(`<div class="bw-status">${esc(t('calculating'))}</div>`);

    try {
      const data = await apiCalculate();

      if (!data.ok) {
        setPanel(`<div class="bw-err">${esc(data.error ?? t('err_generic'))}</div>`);
        setSaveEnabled(false);
        state._inflight = false;
        return;
      }

      state.lastResult = data;

      if (data.mode === 'compare') {
        setPanel(renderCompare(data));
        // Wire up "Choose this" buttons inside the compare grid
        document.querySelectorAll('.bw-ccard-btn').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const segId  = btn.dataset.seg;
            const segSel = document.getElementById('bw-segment');
            if (segSel) {
              segSel.value = segId;
              segSel.dispatchEvent(new Event('change'));
            }
          });
        });
        setSaveEnabled(false); // must pick a segment before saving
      } else {
        setPanel(renderSingle(data));
        // Only enable save when segment is known and pricing succeeded
        setSaveEnabled(!!state.segment_id);
      }

    } catch (err) {
      console.error('[BookingWidget] calculate error', err);
      setPanel(`<div class="bw-err">${esc(t('err_generic'))}</div>`);
      setSaveEnabled(false);
    }

    state._inflight = false;
  }

  const debouncedRecalc = debounce(recalculate, 380);

  // ── Share link ────────────────────────────────────────────────────────────
  function showShareLink(draftId) {
    const box   = document.getElementById('bw-share-box');
    const input = document.getElementById('bw-share-input');
    if (!box || !input) return;

    // Build share URL: current page + ?draft=XXX (strips any existing ?draft param)
    const base  = window.location.href.replace(/[?&]draft=[^&]*/g, '').replace(/\?$/, '');
    const sep   = base.includes('?') ? '&' : '?';
    const url   = `${base}${sep}draft=${encodeURIComponent(draftId)}`;
    input.value = url;
    box.classList.add('bw-visible');

    const copyBtn = document.getElementById('bw-copy-btn');
    if (!copyBtn) return;
    // Rebind each time (draft ID may change)
    copyBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        input.select();
        document.execCommand('copy');
      }
      const orig = copyBtn.textContent;
      copyBtn.textContent = t('copied');
      setTimeout(() => { copyBtn.textContent = orig; }, 2200);
    };
  }

  // ── Auto-load from ?draft= URL param ─────────────────────────────────────
  async function tryLoadDraftFromURL(overlay, drawer) {
    const draftId = new URLSearchParams(window.location.search).get('draft');
    if (!draftId) return;

    openDrawer(overlay, drawer);

    try {
      const data = await apiLoadDraft(draftId);
      if (!data.ok || !data.snapshot) return;

      const snap = data.snapshot;
      const pax  = snap.pax ?? {};

      const set = (id, val) => {
        const el = document.getElementById(id);
        if (el && val !== undefined && val !== null) el.value = String(val);
      };

      set('bw-date',     snap.travel_date);
      set('bw-shared',   pax.adult_shared_room_count ?? 2);
      set('bw-private',  pax.adult_single_room_count ?? 0);
      set('bw-children', pax.child_count             ?? 0);
      set('bw-infants',  pax.infant_count            ?? 0);

      if (snap.segment_id) {
        const segSel = document.getElementById('bw-segment');
        if (segSel) {
          // Add option if not already present (first recalc will refetch)
          if (!segSel.querySelector(`option[value="${snap.segment_id.replace(/"/g, '\\"')}"]`)) {
            const opt = document.createElement('option');
            opt.value = snap.segment_id;
            opt.textContent = snap.segment_name ?? snap.segment_id;
            segSel.appendChild(opt);
          }
          segSel.value = snap.segment_id;
        }
      }

      showShareLink(draftId); // already has a link since we're viewing a shared draft
      debouncedRecalc();

    } catch {
      // Draft expired or network error — silently ignore
    }
  }

  // ── Save handler ──────────────────────────────────────────────────────────
  async function handleSave() {
    const btn = document.getElementById('bw-save-btn');
    if (!btn || btn.disabled) return;

    btn.disabled = true;
    btn.textContent = t('saving');

    try {
      const result = await apiSaveDraft();
      if (result.ok && result.draft_id) {
        showShareLink(result.draft_id);
      } else {
        alert(result.error ?? t('err_generic'));
      }
    } catch {
      alert(t('err_generic'));
    } finally {
      btn.disabled = false;
      btn.textContent = t('save_btn');
      // Re-check whether save should still be enabled after the operation
      readForm();
      setSaveEnabled(!!state.segment_id);
    }
  }

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  function init() {
    injectCSS();
    const { trigger, overlay, drawer } = buildDOM();

    // Open / close
    trigger.addEventListener('click', () => openDrawer(overlay, drawer));
    overlay.addEventListener('click', () => closeDrawer(overlay, drawer));
    document.getElementById('bw-close-btn')
      ?.addEventListener('click', () => closeDrawer(overlay, drawer));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && drawer.classList.contains('bw-open')) {
        closeDrawer(overlay, drawer);
      }
    });

    // Set min date on the date picker
    const dateEl = document.getElementById('bw-date');
    if (dateEl) dateEl.min = new Date().toISOString().slice(0, 10);

    // All form inputs → debounced recalc
    ['bw-date', 'bw-shared', 'bw-private', 'bw-children', 'bw-infants', 'bw-segment']
      .forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input',  debouncedRecalc);
        el.addEventListener('change', debouncedRecalc);
      });

    // Save draft button
    document.getElementById('bw-save-btn')?.addEventListener('click', handleSave);

    // Auto-load draft from URL (e.g. shared link)
    tryLoadDraftFromURL(overlay, drawer);
  }

  // Run after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
