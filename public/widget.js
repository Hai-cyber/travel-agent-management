/**
 * widget.js — Tour Booking Price-Check Widget
 *
 * Embeds a "Book Now" button + price calculator on any Agent website.
 * Calls GET /api/pricing/calculate against the platform Workers API.
 *
 * Usage (paste before </body>):
 *   <script
 *     src="https://your-worker.workers.dev/widget.js"
 *     data-tenant-id="ten-demo-001"
 *     data-tour-id="tour-001"
 *     data-api-base="https://your-worker.workers.dev"
 *     data-lang="vi"
 *     data-button-label="Đặt Tour Ngay"
 *     data-accent="#e85d26"
 *   ></script>
 */
(function () {
  'use strict';

  // ── Config from data-* attributes ──────────────────────────────────────────
  const script     = document.currentScript || document.querySelector('script[data-tenant-id]');
  const TENANT_ID  = script?.dataset?.tenantId  || '';
  const TOUR_ID    = script?.dataset?.tourId    || '';
  const API_BASE   = (script?.dataset?.apiBase  || '').replace(/\/$/, '');
  const LANG       = script?.dataset?.lang      || 'vi';
  const BTN_LABEL  = script?.dataset?.buttonLabel || (LANG === 'vi' ? 'Đặt Tour Ngay' : 'Book Now');
  const ACCENT     = script?.dataset?.accent    || '#e85d26';

  if (!TENANT_ID || !TOUR_ID) {
    console.warn('[widget.js] Missing required data-tenant-id or data-tour-id attributes.');
    return;
  }

  // ── i18n strings ─────────────────────────────────────────────────────────
  const T = {
    en: {
      title:          'Check Price & Book',
      date_label:     'Travel Date',
      pax_label:      'Number of Guests',
      segment_label:  'Package',
      all_segments:   'Compare all packages',
      check_btn:      'Check Price',
      checking:       'Checking...',
      book_btn:       'Proceed to Book',
      error_api:      'Could not load price. Please try again.',
      error_fields:   'Please fill in all required fields.',
      per_person:     '/ person',
      close:          '×',
      total:          'Total estimate',
      includes_note:  'Final price confirmed at booking.',
    },
    vi: {
      title:          'Kiểm Tra Giá & Đặt Tour',
      date_label:     'Ngày khởi hành',
      pax_label:      'Số khách',
      segment_label:  'Gói dịch vụ',
      all_segments:   'So sánh tất cả gói',
      check_btn:      'Xem Giá',
      checking:       'Đang tính...',
      book_btn:       'Đặt Tour Ngay',
      error_api:      'Không tải được giá. Vui lòng thử lại.',
      error_fields:   'Vui lòng điền đầy đủ thông tin.',
      per_person:     '/ khách',
      close:          '×',
      total:          'Tổng ước tính',
      includes_note:  'Giá chính xác sẽ được xác nhận khi đặt tour.',
    },
  };
  const t = (key) => (T[LANG] || T.en)[key] || key;

  // ── Inject minimal CSS ────────────────────────────────────────────────────
  const CSS = `
    .wbk-btn {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 12px 24px; border: none; border-radius: 8px;
      background: ${ACCENT}; color: #fff; font-size: 1rem; font-weight: 600;
      cursor: pointer; transition: opacity .2s;
    }
    .wbk-btn:hover { opacity: .88; }
    .wbk-overlay {
      position: fixed; inset: 0; background: rgba(0,0,0,.55);
      display: flex; align-items: center; justify-content: center;
      z-index: 99990; animation: wbkFadeIn .18s ease;
    }
    .wbk-modal {
      background: #fff; border-radius: 16px; padding: 28px 32px;
      width: min(480px, 94vw); max-height: 90vh; overflow-y: auto;
      box-shadow: 0 20px 60px rgba(0,0,0,.25);
      animation: wbkSlideUp .22s ease;
    }
    .wbk-modal h2 {
      margin: 0 0 20px; font-size: 1.25rem; color: #111;
      display: flex; justify-content: space-between; align-items: center;
    }
    .wbk-close {
      background: none; border: none; font-size: 1.5rem;
      cursor: pointer; color: #888; line-height: 1; padding: 0 4px;
    }
    .wbk-close:hover { color: #333; }
    .wbk-field { margin-bottom: 16px; }
    .wbk-field label { display: block; font-size: .875rem; font-weight: 600; margin-bottom: 6px; color: #444; }
    .wbk-field input, .wbk-field select {
      width: 100%; padding: 10px 12px; border: 1.5px solid #ddd;
      border-radius: 8px; font-size: 1rem; box-sizing: border-box;
      transition: border-color .15s;
    }
    .wbk-field input:focus, .wbk-field select:focus {
      outline: none; border-color: ${ACCENT};
    }
    .wbk-pax-row {
      display: flex; align-items: center; gap: 12px;
    }
    .wbk-pax-btn {
      width: 36px; height: 36px; border-radius: 50%;
      border: 1.5px solid #ddd; background: #f7f7f7;
      font-size: 1.2rem; cursor: pointer; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
      transition: border-color .15s, background .15s;
    }
    .wbk-pax-btn:hover { border-color: ${ACCENT}; background: #fff4ee; }
    .wbk-pax-count { font-size: 1.1rem; font-weight: 700; min-width: 28px; text-align: center; }
    .wbk-check-btn {
      width: 100%; padding: 13px; border: none; border-radius: 10px;
      background: ${ACCENT}; color: #fff; font-size: 1rem; font-weight: 700;
      cursor: pointer; margin-top: 4px; transition: opacity .2s;
    }
    .wbk-check-btn:hover { opacity: .88; }
    .wbk-check-btn:disabled { opacity: .5; cursor: not-allowed; }
    .wbk-result {
      margin-top: 20px; padding: 16px; border-radius: 10px;
      background: #f9f9f9; border: 1.5px solid #eee;
    }
    .wbk-price-row {
      display: flex; justify-content: space-between; align-items: center;
      margin-bottom: 8px; font-size: .95rem; color: #555;
    }
    .wbk-price-row:last-child { margin-bottom: 0; }
    .wbk-price-row.wbk-total {
      font-size: 1.15rem; font-weight: 700; color: #111;
      border-top: 1.5px solid #e0e0e0; padding-top: 10px; margin-top: 8px;
    }
    .wbk-price-row.wbk-total .wbk-usd { color: ${ACCENT}; }
    .wbk-segment-tag {
      display: inline-block; padding: 3px 10px; border-radius: 20px;
      background: ${ACCENT}22; color: ${ACCENT}; font-size: .8rem; font-weight: 600;
      margin-bottom: 12px;
    }
    .wbk-error {
      margin-top: 16px; padding: 12px; border-radius: 8px;
      background: #fff3f3; color: #c00; font-size: .9rem; border: 1px solid #fcc;
    }
    .wbk-note { font-size: .8rem; color: #888; margin-top: 10px; }
    .wbk-book-btn {
      display: block; width: 100%; padding: 14px; margin-top: 16px;
      border: none; border-radius: 10px;
      background: #222; color: #fff; font-size: 1rem; font-weight: 700;
      cursor: pointer; text-align: center; text-decoration: none;
      transition: background .2s;
    }
    .wbk-book-btn:hover { background: #000; }
    .wbk-compare-card {
      border: 1.5px solid #e5e5e5; border-radius: 10px; padding: 14px;
      margin-bottom: 10px; cursor: pointer; transition: border-color .15s;
    }
    .wbk-compare-card:hover { border-color: ${ACCENT}; }
    .wbk-compare-title { font-weight: 700; margin-bottom: 4px; font-size: .95rem; }
    .wbk-compare-price { font-size: 1.1rem; color: ${ACCENT}; font-weight: 700; }
    @keyframes wbkFadeIn   { from { opacity: 0; }          to { opacity: 1; } }
    @keyframes wbkSlideUp  { from { transform: translateY(24px); opacity: 0; }
                              to   { transform: translateY(0);    opacity: 1; } }
  `;

  const styleEl = document.createElement('style');
  styleEl.textContent = CSS;
  document.head.appendChild(styleEl);

  // ── State ─────────────────────────────────────────────────────────────────
  let paxCount   = 2;
  let priceResult = null;

  // ── DOM helpers ───────────────────────────────────────────────────────────
  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'class') node.className = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    });
    children.forEach(c => {
      if (c == null) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  function fmt(usd) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(usd);
  }

  // ── Price result renderer ─────────────────────────────────────────────────
  function renderPrice(data) {
    const div = el('div', { class: 'wbk-result' });

    if (data.mode === 'compare') {
      // Multiple segment compare cards — click to select
      data.segments.forEach(seg => {
        const card = el('div', { class: 'wbk-compare-card',
          onclick: () => {
            document.getElementById('wbk-segment').value = seg.segment_id || '';
            div.replaceWith(renderPrice({ ...seg, mode: 'single' }));
          }
        },
          el('div', { class: 'wbk-compare-title' }, seg.segment_name || seg.segment_id || ''),
          el('div', { class: 'wbk-compare-price' },
            fmt(seg.totals?.grand_total ?? seg.grand_total ?? 0)
          ),
        );
        div.appendChild(card);
      });
      return div;
    }

    // Single segment result
    const totals = data.totals || {};
    if (data.segment_name) {
      div.appendChild(el('div', { class: 'wbk-segment-tag' }, data.segment_name));
    }

    if (totals.adult_shared_subtotal > 0) {
      div.appendChild(el('div', { class: 'wbk-price-row' },
        el('span', {}, `${paxCount} × Shared Room`),
        el('span', {}, fmt(totals.adult_shared_subtotal))
      ));
    }
    if (totals.child_subtotal > 0) {
      div.appendChild(el('div', { class: 'wbk-price-row' },
        el('span', {}, 'Children'),
        el('span', {}, fmt(totals.child_subtotal))
      ));
    }

    div.appendChild(el('div', { class: 'wbk-price-row wbk-total' },
      el('span', {}, t('total')),
      el('span', { class: 'wbk-usd' }, fmt(totals.grand_total ?? 0))
    ));
    div.appendChild(el('p', { class: 'wbk-note' }, t('includes_note')));

    // Book button — links to full booking page (agent can configure via data-book-url)
    const bookUrl = script?.dataset?.bookUrl || '#';
    const bookBtn = el('a', { href: bookUrl, class: 'wbk-book-btn' }, t('book_btn'));
    div.appendChild(bookBtn);

    priceResult = data;
    return div;
  }

  // ── Open modal ────────────────────────────────────────────────────────────
  function openModal() {
    const today = new Date().toISOString().split('T')[0];

    const paxDisplay = el('span', { class: 'wbk-pax-count' }, String(paxCount));

    const paxRow = el('div', { class: 'wbk-pax-row' },
      el('button', { class: 'wbk-pax-btn', type: 'button', onclick: () => {
        if (paxCount > 1) { paxCount--; paxDisplay.textContent = paxCount; }
      }}, '−'),
      paxDisplay,
      el('button', { class: 'wbk-pax-btn', type: 'button', onclick: () => {
        if (paxCount < 50) { paxCount++; paxDisplay.textContent = paxCount; }
      }}, '+')
    );

    const segmentSelect = el('select', { id: 'wbk-segment' },
      el('option', { value: '' }, t('all_segments'))
    );

    const resultArea  = el('div', { id: 'wbk-result-area' });
    const errorArea   = el('div', { id: 'wbk-error-area' });

    const checkBtn = el('button', { class: 'wbk-check-btn', type: 'button',
      onclick: async () => {
        const dateVal = document.getElementById('wbk-date')?.value;
        if (!dateVal) { showError(t('error_fields')); return; }
        resultArea.innerHTML = '';
        errorArea.innerHTML  = '';
        checkBtn.disabled    = true;
        checkBtn.textContent = t('checking');

        try {
          const segId = segmentSelect.value;
          const params = new URLSearchParams({
            tour_id:               TOUR_ID,
            date:                  dateVal,
            adult_shared_room_count: String(paxCount),
            ...(segId ? { segment_id: segId } : {}),
          });
          const res = await fetch(`${API_BASE}/api/pricing/calculate?${params}`, {
            headers: { 'X-Tenant-ID': TENANT_ID, 'Accept-Language': LANG },
          });
          const json = await res.json();
          if (!res.ok || !json.ok) throw new Error(json.error || t('error_api'));
          resultArea.appendChild(renderPrice(json));
        } catch (err) {
          showError(err.message || t('error_api'));
        } finally {
          checkBtn.disabled    = false;
          checkBtn.textContent = t('check_btn');
        }
      }
    }, t('check_btn'));

    function showError(msg) {
      errorArea.innerHTML = '';
      errorArea.appendChild(el('div', { class: 'wbk-error' }, msg));
    }

    const modal = el('div', { class: 'wbk-modal' },
      el('h2', {},
        t('title'),
        el('button', { class: 'wbk-close', type: 'button',
          onclick: () => overlay.remove()
        }, t('close'))
      ),
      el('div', { class: 'wbk-field' },
        el('label', {}, t('date_label')),
        el('input', { type: 'date', id: 'wbk-date', min: today })
      ),
      el('div', { class: 'wbk-field' },
        el('label', {}, t('pax_label')),
        paxRow
      ),
      el('div', { class: 'wbk-field' },
        el('label', {}, t('segment_label')),
        segmentSelect
      ),
      checkBtn,
      errorArea,
      resultArea,
    );

    const overlay = el('div', { class: 'wbk-overlay',
      onclick: (e) => { if (e.target === overlay) overlay.remove(); }
    }, modal);

    document.body.appendChild(overlay);

    // Load segment list from pricing metadata (best-effort — no segments = still works)
    fetch(`${API_BASE}/api/pricing/metadata`, {
      headers: { 'X-Tenant-ID': TENANT_ID },
    })
      .then(r => r.json())
      .then(data => {
        const segs = data?.segments || [];
        segs.forEach(s => {
          const opt = el('option', { value: s.id }, s.name || s.code || s.id);
          segmentSelect.appendChild(opt);
        });
      })
      .catch(() => { /* silent — segment dropdown stays as "compare all" */ });
  }

  // ── Inject trigger button ─────────────────────────────────────────────────
  const triggerBtn = el('button', {
    class: 'wbk-btn',
    type:  'button',
    onclick: openModal,
  },
    '🗓 ',
    BTN_LABEL
  );

  // Insert after the <script> tag if possible, else append to body
  if (script && script.parentNode) {
    script.parentNode.insertBefore(triggerBtn, script.nextSibling);
  } else {
    document.body.appendChild(triggerBtn);
  }
})();
