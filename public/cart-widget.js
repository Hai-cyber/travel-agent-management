/**
 * cart-widget.js — Shopping Cart Widget
 * Real-time pricing via /api/pricing/calculate + draft save via /api/bookings/draft
 *
 * ── HTML Setup ──────────────────────────────────────────────────────────────
 * <div id="booking-cart"
 *      data-tour-id="TOUR1"
 *      data-date="2026-06-15"
 *      data-tenant-id="T001"
 *      data-api-base="https://your-worker.workers.dev">
 *
 *   <!-- Inputs (fire live recalc on change) -->
 *   <input  data-cart="adult_shared_room_count" type="number" value="2" min="0">
 *   <input  data-cart="adult_single_room_count" type="number" value="0" min="0">
 *   <input  data-cart="child_count"             type="number" value="0" min="0">
 *   <input  data-cart="infant_count"            type="number" value="0" min="0">
 *   <select data-cart="segment_id">
 *     <option value="">-- So sánh tất cả --</option>
 *     <option value="SEG1">Standard</option>
 *     <option value="SEG2">Boutique</option>
 *   </select>
 *
 *   <!-- Outputs (auto-updated) -->
 *   <span data-cart-out="grand_total_formatted"></span>
 *   <span data-cart-out="applied_season_name"></span>
 *   <div  data-cart-out="line_items_html"></div>
 *   <div  data-cart-out="segment_compare_html"></div>
 *   <span data-cart-out="infant_disclaimer"></span>
 *   <span data-cart-out="error_message"></span>
 *
 *   <!-- Actions -->
 *   <button data-cart-act="save_draft">Lưu nháp</button>
 * </div>
 *
 * ── Draft saved event ────────────────────────────────────────────────────────
 * container.addEventListener('cart:draft-saved', (e) => {
 *   // e.detail = { draft_id, expires_at }
 *   document.cookie = `draft_id=${e.detail.draft_id}; max-age=86400; path=/`;
 * });
 */

const DEBOUNCE_MS = 350;

function debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

class BookingCart {
  constructor(container) {
    this.container = container;
    this.tourId    = container.dataset.tourId;
    this.date      = container.dataset.date;
    this.tenantId  = container.dataset.tenantId;
    this.apiBase   = (container.dataset.apiBase ?? '').replace(/\/$/, '');
    this._last     = null;

    if (!this.tourId || !this.date || !this.tenantId) {
      console.error('[BookingCart] Missing data-tour-id, data-date, or data-tenant-id');
      return;
    }
    this._bindInputs();
    this._bindActions();
    this.refresh();
  }

  // ── Read all [data-cart] inputs/selects → params object ──────────────────
  _params() {
    const p = {};
    this.container.querySelectorAll('[data-cart]').forEach(el => {
      if (el.tagName !== 'BUTTON') p[el.dataset.cart] = el.value;
    });
    return p;
  }

  // ── Debounced input listeners ─────────────────────────────────────────────
  _bindInputs() {
    const onchange = debounce(() => this.refresh(), DEBOUNCE_MS);
    this.container.querySelectorAll('[data-cart]').forEach(el => {
      if (el.tagName === 'BUTTON') return;
      el.addEventListener('input',  onchange);
      el.addEventListener('change', onchange);
    });
  }

  _bindActions() {
    this.container.querySelectorAll('[data-cart-act]').forEach(btn => {
      if (btn.dataset.cartAct === 'save_draft') btn.addEventListener('click', () => this.saveDraft());
    });
  }

  // ── Write text/html to [data-cart-out] targets ───────────────────────────
  _out(key, value) {
    this.container.querySelectorAll(`[data-cart-out="${key}"]`).forEach(el => {
      if (key.endsWith('_html')) { el.innerHTML = String(value ?? ''); }
      else                       { el.textContent = String(value ?? ''); }
    });
  }

  // ── Render line_items list ────────────────────────────────────────────────
  _lineItemsHtml(items = []) {
    if (!items.length) return '';
    return `<ul class="cart-line-items">${
      items.map(item => `
        <li class="cart-li">
          <span class="cart-li-label">${item.label ?? item.type}</span>
          <span class="cart-li-x">×${item.count}</span>
          <span class="cart-li-unit">${item.unit_price?.formatted ?? ''}</span>
          <span class="cart-li-sub">${item.subtotal?.formatted ?? ''}</span>
        </li>`).join('')
    }</ul>`;
  }

  // ── Render segment compare cards ─────────────────────────────────────────
  _renderCompare(segments = []) {
    const out = this.container.querySelector('[data-cart-out="segment_compare_html"]');
    if (!out) return;

    out.innerHTML = `<div class="cart-compare">${
      segments.map(s => `
        <div class="cart-seg-card" data-segment-id="${s.segment_id}">
          <div class="cart-seg-badge">${s.segment_code ?? ''}</div>
          <div class="cart-seg-name">${s.segment_name ?? ''}</div>
          <div class="cart-seg-total">${s.price_summary?.display?.formatted ?? ''}</div>
          <div class="cart-seg-season">${s.applied_season_name ?? ''}</div>
          ${this._lineItemsHtml(s.line_items)}
          <button class="cart-seg-select btn" data-seg-id="${s.segment_id}">Chọn gói này</button>
        </div>`).join('')
    }</div>`;

    out.querySelectorAll('[data-seg-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const sel = this.container.querySelector('[data-cart="segment_id"]');
        if (sel) { sel.value = btn.dataset.segId; sel.dispatchEvent(new Event('change')); }
      });
    });
  }

  // ── Fetch price and update DOM ────────────────────────────────────────────
  async refresh() {
    const p  = this._params();
    const qs = new URLSearchParams({
      tour_id:                 this.tourId,
      date:                    this.date,
      adult_shared_room_count: p.adult_shared_room_count ?? '1',
      adult_single_room_count: p.adult_single_room_count ?? '0',
      child_count:             p.child_count  ?? '0',
      infant_count:            p.infant_count ?? '0',
      ...(p.segment_id ? { segment_id: p.segment_id } : {}),
    });

    this._setLoading(true);
    this._out('error_message', '');

    try {
      const res  = await fetch(`${this.apiBase}/api/pricing/calculate?${qs}`, {
        headers: { 'X-Tenant-ID': this.tenantId },
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        this._out('error_message', data.error ?? data.hint ?? 'Không thể tải giá');
        this._setLoading(false);
        return;
      }

      this._last = data;

      if (data.mode === 'compare') {
        // Clear single-segment outputs; render segment compare table
        this._out('grand_total_formatted', '');
        this._out('applied_season_name',   '');
        this._out('line_items_html',       '');
        this._renderCompare(data.segments ?? []);
      } else {
        // Single segment: update price summary and line items
        this._out('segment_compare_html', '');
        this._out('grand_total_formatted', data.price_summary?.display?.formatted ?? '');
        this._out('applied_season_name',   data.applied_season_name ?? '');
        this._out('line_items_html',       this._lineItemsHtml(data.line_items ?? []));
        this._out('infant_disclaimer',     data.infant_disclaimer ?? '');
      }
    } catch (err) {
      this._out('error_message', 'Lỗi kết nối. Vui lòng thử lại.');
      console.error('[BookingCart.refresh]', err);
    } finally {
      this._setLoading(false);
    }
  }

  // ── POST /api/bookings/draft ──────────────────────────────────────────────
  async saveDraft() {
    const p = this._params();
    if (!p.segment_id) {
      this._out('error_message', 'Vui lòng chọn gói dịch vụ trước khi lưu');
      return;
    }

    try {
      const res = await fetch(`${this.apiBase}/api/bookings/draft`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': this.tenantId },
        body: JSON.stringify({
          tour_id:     this.tourId,
          travel_date: this.date,
          segment_id:  p.segment_id,
          pax: {
            adult_shared_room_count: Number(p.adult_shared_room_count ?? 1),
            adult_single_room_count: Number(p.adult_single_room_count ?? 0),
            child_count:             Number(p.child_count   ?? 0),
            infant_count:            Number(p.infant_count  ?? 0),
          },
        }),
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        this._out('error_message', data.error ?? 'Không thể lưu draft');
        return;
      }

      // Let host page handle storage (cookie, localStorage, redirect, etc.)
      this.container.dispatchEvent(new CustomEvent('cart:draft-saved', {
        bubbles: true,
        detail:  { draft_id: data.draft_id, expires_at: data.expires_at },
      }));

      this._out('error_message', `✓ Đã lưu! Mã nháp: ${data.draft_id}`);

    } catch (err) {
      this._out('error_message', 'Lỗi kết nối khi lưu draft');
      console.error('[BookingCart.saveDraft]', err);
    }
  }

  _setLoading(on) { this.container.toggleAttribute('data-cart-loading', on); }
}

// ── Auto-init containers ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('#booking-cart, [data-booking-cart]').forEach(el => new BookingCart(el));
});

export { BookingCart };
