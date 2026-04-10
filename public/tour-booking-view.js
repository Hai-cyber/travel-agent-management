(function () {
  'use strict';

  const VIEW_SELECTOR = '[data-public-booking-view]';
  const DRAWER_BREAKPOINT = '(max-width: 767px)';
  const DEFAULT_MESSAGES = {
    tour_config: {
      pricing: {
        booking_view: 'Booking View',
        live_price_calculator: 'live price calculator',
        live_price_notice: 'Prices are live and calculated based on your specific travel date and group size.',
        edit: 'Edit',
        pricing_tier: 'Pricing Tier',
        select_pricing_tier: 'Select a pricing tier above.',
        traveller_type: 'Traveller Type',
        price_per_person: 'Price / person',
        qty: 'Qty',
        subtotal: 'Subtotal',
        good_to_know: 'Good to Know',
        calculate_final_price: 'Calculate Final Price for my Group',
        phase1_travel_on: 'We plan to travel on',
        phase1_we_are: 'We are',
        phase1_adults_and: 'adults and',
        phase1_children: 'children,',
        phase1_staying_in: 'staying in',
        phase1_double_rooms_and: 'double rooms and',
        phase1_single_rooms: 'single rooms.',
        calculating: 'Calculating...',
        room_hint_single_supplement: 'Note: Single supplement applied for rooms with sole occupancy.',
        child_with_parents: 'Child (with parents)',
        add_travellers_above: 'Add travellers above to calculate',
        select_pricing_tier_short: 'Select a pricing tier',
        total_for_group: 'Total for your group',
        band_summary: 'Band: {{name}} ({{min}}-{{max}} pax)',
        band_current: 'Band: {{name}}',
        current_rate: 'Current Rate: {{season}}',
        no_segments_configured: 'No pricing tiers configured.',
      },
    },
    public_booking: {
      payment_title: 'Payment flow',
      payment_title_demo: 'Demo payment flow',
      payment_intro: 'Capture the guest identity, create the booking order, and hand off to the configured payment path.',
      payment_intro_demo: 'This tenant has no live electronic gateway yet. Show a premium demo checkout instead of a dead end.',
      guest_name: 'Guest name',
      guest_email: 'Email',
      guest_phone: 'Phone',
      guest_note: 'Notes',
      guest_note_placeholder: 'Optional request for the operator',
      guest_note_placeholder_demo: 'Optional note for the demo checkout story',
      payment_method: 'Payment method',
      payment_category_instant: 'instant',
      payment_category_manual: 'manual',
      payment_submit: 'Create booking order',
      payment_submit_demo: 'Run demo payment',
      payment_submit_loading: 'Creating order...',
      payment_submit_loading_demo: 'Running demo...',
      payment_cancel: 'Cancel',
      payment_portal: 'Open guest portal',
      payment_guest_required: 'Guest name and email are required.',
      payment_error_generic: 'Could not continue to payment.',
      payment_total: 'Total',
      payment_travel_date: 'Travel date',
      payment_guests: 'Guests',
      payment_summary_adults_children: '{{adults}} adults, {{children}} children',
      payment_demo_banner: 'Demo mode active.',
      payment_demo_message: 'No live gateway configured yet.',
      payment_demo_success: 'Demo payment completed. This tenant has not configured a live electronic gateway yet, so no real order or charge was created.',
      payment_success: 'Booking order created successfully.',
      payment_method_desc_instant: 'Creates the real booking order and prepares the checkout handoff for the selected gateway.',
      payment_method_desc_manual: 'Creates the real booking order and returns the manual payment / proof-upload next step.',
      payment_method_desc_demo: 'Demo payment experience only. No real gateway is active for this tenant yet.',
      payment_hook_cta: 'Continue to payment',
      payment_hook_note: 'Payment hook reserved for the future checkout flow.',
      method_bank_transfer: 'Bank transfer',
      method_cash_at_office: 'Pay at office',
      method_pay_on_arrival: 'Pay on arrival',
      method_credit_card: 'Credit card',
      method_stripe: 'Stripe',
      method_paypal: 'PayPal',
      method_momo: 'MoMo',
      method_zalopay: 'ZaloPay',
      method_vnpay: 'VNPay',
      method_grabpay: 'GrabPay',
      def_infant: 'Infant: Ages 0-2 - must be accompanied by a parent or legal guardian.',
      def_children: 'Children: Ages 2-14, sharing a room with parents.',
      def_teens: 'Teens: Ages 14 and up are treated as adults.',
      def_note: 'Note: If children stay in a separate room, adult shared rates will apply.',
    },
  };

  function getNestedValue(obj, path) {
    return String(path || '').split('.').reduce((node, part) => node?.[part], obj);
  }

  function applyVars(template, vars) {
    return String(template || '').replace(/\{\{(\w+)\}\}/g, (_, key) => vars?.[key] ?? `{{${key}}}`);
  }

  function normalizeLang(value) {
    const raw = String(value || '').trim().replace(/_/g, '-');
    return raw || 'en';
  }

  async function loadLocaleMessages(lang) {
    try {
      const response = await fetch(`/api/i18n/${encodeURIComponent(lang)}`, { headers: { 'Accept-Language': lang } });
      const data = await response.json();
      return data?.messages || DEFAULT_MESSAGES;
    } catch {
      return DEFAULT_MESSAGES;
    }
  }

  function injectStyles() {
    if (document.getElementById('tbv-styles')) return;
    const style = document.createElement('style');
    style.id = 'tbv-styles';
    style.textContent = `
      .tbv-hidden { display: none !important; }
      .tbv-overlay {
        position: fixed; inset: 0; background: rgba(15, 23, 42, 0.5);
        z-index: 9998; backdrop-filter: blur(2px);
      }
      .tbv-drawer {
        position: fixed; top: 0; right: 0; bottom: 0; width: min(540px, 100vw);
        background:
          radial-gradient(circle at top right, rgba(255,255,255,0.88), rgba(255,255,255,0.96) 42%),
          linear-gradient(180deg, color-mix(in srgb, var(--color-surface, #fbf6ef) 82%, white) 0%, white 100%);
        color: var(--color-text, #34241b); z-index: 9999; box-shadow: -12px 0 44px rgba(15, 23, 42, 0.18);
        transform: translateX(100%); transition: transform .28s ease; display: flex; flex-direction: column;
        border-left: 1px solid rgba(212, 175, 115, 0.18);
      }
      .tbv-drawer.is-open { transform: translateX(0); }
      .tbv-inline {
        border-radius: 30px;
        background:
          linear-gradient(180deg, rgba(255,255,255,0.82) 0%, rgba(255,255,255,0.96) 100%),
          linear-gradient(135deg, var(--color-surface, #fbf6ef), rgba(255,255,255,0.88));
        border: 1px solid rgba(212, 175, 115, 0.22);
        padding: 24px; box-shadow: 0 18px 40px rgba(15, 23, 42, 0.08);
        backdrop-filter: blur(10px);
      }
      .tbv-shell { display: flex; flex-direction: column; min-height: 0; height: 100%; }
      .tbv-header {
        display: flex; align-items: center; justify-content: space-between; gap: 12px;
        padding: 20px 22px; border-bottom: 1px solid rgba(212, 175, 115, 0.2); flex-shrink: 0;
        background: linear-gradient(135deg, color-mix(in srgb, var(--color-primary, #5a3b27) 18%, white), color-mix(in srgb, var(--color-secondary, #d4af73) 12%, white));
      }
      .tbv-header h2 { margin: 0; font-size: 30px; line-height: 1; letter-spacing: -.02em; color: var(--color-primary, #5a3b27); }
      .tbv-close {
        border: 1px solid rgba(90, 59, 39, 0.12); background: rgba(255,255,255,0.7); color: var(--color-primary, #5a3b27); width: 36px; height: 36px; border-radius: 999px;
        cursor: pointer; font-size: 20px; line-height: 1;
      }
      .tbv-body {
        flex: 1; min-height: 0; overflow-y: auto; padding: 22px;
      }
      .tbv-footer {
        padding: 16px 22px 22px; border-top: 1px solid rgba(212, 175, 115, 0.2); flex-shrink: 0; background: rgba(255,255,255,0.88);
      }
      .tbv-note {
        display: flex; gap: 9px; align-items: flex-start; background: rgba(255,255,255,0.72); border: 1px solid rgba(212, 175, 115, 0.2);
        border-radius: 16px; padding: 12px 14px; margin-bottom: 16px; font-size: 12px; color: color-mix(in srgb, var(--color-primary, #5a3b27) 82%, white); line-height: 1.7;
      }
      .tbv-compact { display: none; margin-bottom: 14px; font-size: 13px; color: #5b5147; }
      .tbv-compact.is-visible { display: block; }
      .tbv-compact button {
        margin-left: 8px; border: none; background: none; color: var(--color-primary, #5a3b27); font-weight: 700; cursor: pointer;
      }
      .tbv-sentence {
        font-size: 16px; line-height: 2.45; color: var(--color-text, #34241b); margin: 0 0 8px; font-weight: 500;
      }
      .tbv-input {
        display: inline-block; min-width: 96px; border: none; border-bottom: 2px solid rgba(212, 175, 115, 0.46);
        padding: 3px 8px; background: rgba(255,255,255,0.82); border-radius: 10px 10px 0 0; color: var(--color-text, #34241b); font: inherit;
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.72);
      }
      .tbv-input.tiny { min-width: 72px; }
      .tbv-input:focus { outline: none; border-bottom-color: var(--color-primary, #5a3b27); background: rgba(255,255,255,0.96); }
      .tbv-hint { display: none; font-size: 11.5px; padding: 6px 10px; border-radius: 6px; margin-bottom: 10px; }
      .tbv-primary {
        width: 100%; padding: 14px 0; font-size: 14px; font-weight: 700; border-radius: 999px; cursor: pointer;
        border: none; background: linear-gradient(135deg, var(--color-primary, #5a3b27), var(--color-secondary, #d4af73)); color: #fff;
        box-shadow: 0 10px 24px rgba(90, 59, 39, 0.18);
      }
      .tbv-primary:disabled { opacity: .5; cursor: not-allowed; }
      .tbv-payment-hook {
        margin-top: 10px; width: 100%; padding: 12px 0; font-size: 13px; font-weight: 700; border-radius: 999px; cursor: pointer;
        border: 1px dashed rgba(90, 59, 39, 0.24); background: rgba(255,255,255,0.72); color: var(--color-primary, #5a3b27);
      }
      .tbv-phase2 { display: none; }
      .tbv-phase2.is-visible { display: block; }
      .tbv-tier-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .07em; color: rgba(90, 59, 39, 0.56); margin-bottom: 7px; }
      .tbv-seg-tabs { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 12px; }
      .tbv-seg-tab {
        border: 1px solid rgba(212, 175, 115, 0.3); background: rgba(255,255,255,0.72); color: #5b5147; border-radius: 999px; padding: 8px 14px;
        cursor: pointer; font-size: 13px; font-weight: 600;
      }
      .tbv-seg-tab.active { background: linear-gradient(135deg, var(--color-primary, #5a3b27), var(--color-secondary, #d4af73)); color: #fff; border-color: transparent; }
      .tbv-table-wrap { overflow: auto; max-height: 320px; background: rgba(255,255,255,0.62); border: 1px solid rgba(212, 175, 115, 0.18); border-radius: 20px; padding: 0 14px; }
      .tbv-table { width: 100%; border-collapse: collapse; }
      .tbv-table thead { position: sticky; top: 0; background: rgba(251, 246, 239, 0.96); z-index: 1; }
      .tbv-table th { text-align: left; padding: 9px 0; font-size: 11px; color: rgba(90, 59, 39, 0.52); text-transform: uppercase; font-weight: 700; }
      .tbv-table th.align-right, .tbv-table td.align-right { text-align: right; }
      .tbv-table th.align-center, .tbv-table td.align-center { text-align: center; }
      .tbv-table tr { border-bottom: 1px solid rgba(212, 175, 115, 0.12); }
      .tbv-table td { padding: 12px 0; font-size: 14px; color: var(--color-text, #34241b); }
      .tbv-qty { display: inline-flex; align-items: center; gap: 8px; border: 1px solid rgba(212, 175, 115, 0.24); border-radius: 999px; padding: 3px 6px; background: rgba(255,255,255,0.84); }
      .tbv-qty button { border: none; background: rgba(251, 246, 239, 0.9); color: var(--color-primary, #5a3b27); width: 24px; height: 24px; border-radius: 999px; cursor: pointer; }
      .tbv-surplus, .tbv-status { display: none; margin-top: 8px; padding: 6px 10px; border-radius: 6px; font-size: 11.5px; }
      .tbv-good { background: #f0fdf4; border: 1px solid #bbf7d0; color: #15803d; }
      .tbv-warn { background: #fff7ed; border: 1px solid #fed7aa; color: #92400e; }
      .tbv-info { background: #eff6ff; border: 1px solid #bfdbfe; color: #1d4ed8; }
      .tbv-total-box {
        background: linear-gradient(180deg, rgba(255,255,255,0.92), rgba(255,255,255,0.98)); border: 1px solid rgba(212, 175, 115, 0.2); border-radius: 20px; padding: 16px 18px; text-align: center;
      }
      .tbv-total { font-size: 42px; font-weight: 900; color: var(--color-primary, #5a3b27); line-height: 1; letter-spacing: -.5px; }
      .tbv-meta { font-size: 11.5px; color: #6b625a; margin-top: 6px; display: flex; align-items: center; justify-content: center; gap: 4px; flex-wrap: wrap; }
      .tbv-rate-status {
        display: none; margin-top: 10px; padding: 4px 14px; background: rgba(255,255,255,0.86); border: 1px solid rgba(212, 175, 115, 0.24);
        border-radius: 20px; font-size: 11px; font-weight: 700; color: var(--color-primary, #5a3b27);
      }
      .tbv-hook-note {
        margin-top: 8px; font-size: 11px; line-height: 1.5; color: #7a7067; text-align: center;
      }
      .tbv-pay-overlay {
        position: fixed; inset: 0; z-index: 10020; background: rgba(15, 23, 42, 0.48); backdrop-filter: blur(4px);
        display: flex; align-items: center; justify-content: center; padding: 20px;
      }
      .tbv-pay-panel {
        width: min(560px, 100%); max-height: min(88vh, 920px); overflow: auto;
        border-radius: 28px; background: linear-gradient(180deg, rgba(255,255,255,0.95), rgba(255,255,255,0.98));
        border: 1px solid rgba(212, 175, 115, 0.22); box-shadow: 0 22px 50px rgba(15, 23, 42, 0.2);
        padding: 22px;
      }
      .tbv-pay-head { display: flex; align-items: start; justify-content: space-between; gap: 14px; margin-bottom: 16px; }
      .tbv-pay-head h3 { margin: 0; font-size: 26px; line-height: 1; color: var(--color-primary, #5a3b27); }
      .tbv-pay-head p { margin: 6px 0 0; font-size: 13px; color: #6b625a; }
      .tbv-pay-close {
        border: 1px solid rgba(90, 59, 39, 0.12); background: rgba(255,255,255,0.72); color: var(--color-primary, #5a3b27);
        width: 36px; height: 36px; border-radius: 999px; cursor: pointer; font-size: 20px; line-height: 1;
      }
      .tbv-pay-grid { display: grid; gap: 12px; grid-template-columns: 1fr 1fr; }
      .tbv-pay-field { display: grid; gap: 6px; }
      .tbv-pay-field.full { grid-column: 1 / -1; }
      .tbv-pay-field label { font-size: 12px; font-weight: 700; color: #6b625a; text-transform: uppercase; letter-spacing: .05em; }
      .tbv-pay-field input, .tbv-pay-field textarea, .tbv-pay-field select {
        width: 100%; box-sizing: border-box; padding: 12px 14px; border-radius: 16px;
        border: 1px solid rgba(212, 175, 115, 0.28); background: rgba(255,255,255,0.82); color: var(--color-text, #34241b); font: inherit;
      }
      .tbv-pay-field textarea { min-height: 84px; resize: vertical; }
      .tbv-pay-sum {
        margin: 16px 0; padding: 14px 16px; border-radius: 20px; background: rgba(251, 246, 239, 0.88);
        border: 1px solid rgba(212, 175, 115, 0.16);
      }
      .tbv-pay-sum strong { color: var(--color-primary, #5a3b27); }
      .tbv-pay-methods { display: grid; gap: 10px; margin: 14px 0; }
      .tbv-pay-method {
        border: 1px solid rgba(212, 175, 115, 0.24); background: rgba(255,255,255,0.78); border-radius: 18px; padding: 14px;
        cursor: pointer; transition: border-color .18s ease, transform .18s ease, box-shadow .18s ease;
      }
      .tbv-pay-method:hover { border-color: rgba(90, 59, 39, 0.36); transform: translateY(-1px); }
      .tbv-pay-method.active { border-color: var(--color-primary, #5a3b27); box-shadow: 0 10px 20px rgba(90, 59, 39, 0.1); }
      .tbv-pay-method-title { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-weight: 700; color: var(--color-text, #34241b); }
      .tbv-pay-badge { border-radius: 999px; padding: 4px 10px; font-size: 11px; font-weight: 700; }
      .tbv-pay-badge.instant { background: rgba(90, 59, 39, 0.12); color: var(--color-primary, #5a3b27); }
      .tbv-pay-badge.manual { background: rgba(212, 175, 115, 0.18); color: #7b5a29; }
      .tbv-pay-method p { margin: 8px 0 0; font-size: 12px; line-height: 1.55; color: #6b625a; }
      .tbv-pay-demo {
        margin: 14px 0; padding: 14px 16px; border-radius: 20px; background: linear-gradient(135deg, rgba(90,59,39,0.1), rgba(212,175,115,0.12));
        border: 1px dashed rgba(90, 59, 39, 0.22); color: var(--color-text, #34241b);
      }
      .tbv-pay-actions { display: flex; gap: 10px; margin-top: 18px; }
      .tbv-pay-actions button { flex: 1; padding: 13px 14px; border-radius: 999px; cursor: pointer; font-weight: 700; }
      .tbv-pay-submit {
        border: none; color: #fff; background: linear-gradient(135deg, var(--color-primary, #5a3b27), var(--color-secondary, #d4af73));
      }
      .tbv-pay-secondary {
        border: 1px solid rgba(212, 175, 115, 0.24); background: rgba(255,255,255,0.82); color: var(--color-primary, #5a3b27);
      }
      .tbv-pay-status {
        margin-top: 14px; padding: 14px 16px; border-radius: 18px; font-size: 13px; line-height: 1.65;
        border: 1px solid rgba(212, 175, 115, 0.24); background: rgba(255,255,255,0.82); color: var(--color-text, #34241b);
      }
      .tbv-pay-status.success { background: rgba(240, 253, 244, 0.95); border-color: #bbf7d0; color: #166534; }
      .tbv-pay-status.demo { background: rgba(255, 251, 235, 0.96); border-color: #fcd34d; color: #92400e; }
      .tbv-pay-status.error { background: rgba(254, 242, 242, 0.96); border-color: #fecaca; color: #b91c1c; }
      .tbv-pay-portal { display: inline-flex; margin-top: 10px; color: var(--color-primary, #5a3b27); font-weight: 700; }
      @media (max-width: 767px) {
        .tbv-drawer { width: 100vw; }
        .tbv-body { padding: 16px; }
        .tbv-footer { padding: 14px 16px 18px; }
        .tbv-pay-grid { grid-template-columns: 1fr; }
        .tbv-pay-panel { padding: 18px; }
      }
    `;
    document.head.appendChild(style);
  }

  function fmtMoney(value, currency) {
    if (value == null || value === '') return '—';
    const map = {
      EUR: { locale: 'de-DE', opts: { style: 'currency', currency: 'EUR' } },
      USD: { locale: 'en-US', opts: { style: 'currency', currency: 'USD' } },
      VND: { locale: 'vi-VN', opts: { style: 'currency', currency: 'VND', maximumFractionDigits: 0 } },
      CNY: { locale: 'zh-CN', opts: { style: 'currency', currency: 'CNY' } },
      JPY: { locale: 'ja-JP', opts: { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 } },
      KRW: { locale: 'ko-KR', opts: { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 } },
      GBP: { locale: 'en-GB', opts: { style: 'currency', currency: 'GBP' } },
      AUD: { locale: 'en-AU', opts: { style: 'currency', currency: 'AUD' } },
      SGD: { locale: 'en-SG', opts: { style: 'currency', currency: 'SGD' } },
      THB: { locale: 'th-TH', opts: { style: 'currency', currency: 'THB' } },
    };
    const cfg = map[currency] || map.EUR;
    try {
      return new Intl.NumberFormat(cfg.locale, cfg.opts).format(Number(value));
    } catch {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(Number(value));
    }
  }

  function esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function clampInt(value) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  }

  function createElement(tag, attrs, children) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([key, value]) => {
      if (value == null) return;
      if (key === 'className') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'html') node.innerHTML = value;
      else if (key.startsWith('data-')) node.setAttribute(key, value);
      else if (key === 'type') node.type = value;
      else if (key === 'value') node.value = value;
      else if (key === 'placeholder') node.placeholder = value;
      else node.setAttribute(key, value);
    });
    (Array.isArray(children) ? children : [children]).filter(Boolean).forEach((child) => {
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });
    return node;
  }

  function buildViewMarkup(mode, t, pricingDefinitions) {
    const closeButton = mode === 'drawer' ? '<button type="button" class="tbv-close" data-tbv-close="1" aria-label="Close">&times;</button>' : '';
    const defsMarkup = pricingDefinitions.map((item) => `<li style="display:flex;gap:8px;align-items:flex-start"><span style="color:var(--color-secondary,#d4af73);font-weight:700">•</span><span>${esc(item)}</span></li>`).join('');
    return `
      <div class="tbv-shell">
        <div class="tbv-header">
          <div>
            <h2>${esc(t('tour_config.pricing.booking_view'))}</h2>
            <div style="font-size:12px;color:#94a3b8">${esc(t('tour_config.pricing.live_price_calculator'))}</div>
          </div>
          ${closeButton}
        </div>
        <div class="tbv-body">
          <div class="tbv-note">${esc(t('tour_config.pricing.live_price_notice'))}</div>
          <div class="tbv-compact" data-tbv-compact="1">
            <span data-tbv-compact-text="1"></span>
            <button type="button" data-tbv-edit="1">${esc(t('tour_config.pricing.edit'))}</button>
          </div>
          <div data-tbv-phase1="1">
            <p class="tbv-sentence">
              ${esc(t('tour_config.pricing.phase1_travel_on'))}
              <input type="date" class="tbv-input" data-tbv-date="1" />.<br>
              ${esc(t('tour_config.pricing.phase1_we_are'))}
              <input type="number" min="0" value="" placeholder="0" class="tbv-input" data-tbv-adults="1" />
              ${esc(t('tour_config.pricing.phase1_adults_and'))}
              <input type="number" min="0" value="0" class="tbv-input tiny" data-tbv-children="1" />
              ${esc(t('tour_config.pricing.phase1_children'))}<span data-tbv-room-row="1"><br>
              ${esc(t('tour_config.pricing.phase1_staying_in'))}
              <input type="number" min="0" value="" placeholder="0" class="tbv-input tiny" data-tbv-doubles="1" />
              ${esc(t('tour_config.pricing.phase1_double_rooms_and'))}
              <input type="number" min="0" value="0" placeholder="0" class="tbv-input tiny" data-tbv-triples="1" />
              ${esc(t('tour_config.pricing.phase1_triple_rooms_and', {}, 'triple rooms and'))}
              <input type="number" min="0" value="" placeholder="0" class="tbv-input tiny" data-tbv-singles="1" />
              ${esc(t('tour_config.pricing.phase1_single_rooms'))}</span>
            </p>
            <div class="tbv-hint" data-tbv-room-hint="1"></div>
            <button type="button" class="tbv-primary" data-tbv-calc-button="1" disabled>${esc(t('tour_config.pricing.calculate_final_price'))}</button>
          </div>
          <div class="tbv-phase2" data-tbv-phase2="1">
            <div class="tbv-tier-label">${esc(t('tour_config.pricing.pricing_tier'))}</div>
            <div class="tbv-seg-tabs" data-tbv-seg-tabs="1"><span style="color:#94a3b8;font-size:13px">${esc(t('tour_config.pricing.select_tier_hint', {}, 'Select a tour to see pricing tiers.'))}</span></div>
            <div class="tbv-table-wrap">
              <table class="tbv-table">
                <thead>
                  <tr>
                    <th>${esc(t('tour_config.pricing.traveller_type'))}</th>
                    <th class="align-right">${esc(t('tour_config.pricing.price_per_person'))}</th>
                    <th class="align-center">${esc(t('tour_config.pricing.qty'))}</th>
                    <th class="align-right">${esc(t('tour_config.pricing.subtotal'))}</th>
                  </tr>
                </thead>
                <tbody data-tbv-pax-rows="1"><tr><td colspan="4" style="padding:16px 0;color:#94a3b8;font-size:13px">${esc(t('tour_config.pricing.select_pricing_tier'))}</td></tr></tbody>
              </table>
            </div>
            <div class="tbv-surplus tbv-warn" data-tbv-surplus="1"></div>
            <div style="margin-top:14px;padding-top:12px;border-top:1px dashed rgba(212,175,115,0.3)">
              <div class="tbv-tier-label">${esc(t('tour_config.pricing.good_to_know'))}</div>
              <ul data-tbv-defs style="list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:6px;color:#6b625a;font-size:12px;line-height:1.65">${defsMarkup}</ul>
            </div>
          </div>
        </div>
        <div class="tbv-footer">
          <div data-tbv-phase2-footer="1" class="tbv-hidden">
            <div class="tbv-status tbv-good" data-tbv-room-status="1"></div>
            <div class="tbv-total-box">
              <div class="tbv-total" data-tbv-total="1">—</div>
              <div class="tbv-meta"><span data-tbv-meta="1">${esc(t('tour_config.pricing.calculating'))}</span></div>
              <div class="tbv-rate-status" data-tbv-rate-status="1"></div>
              <button type="button" class="tbv-payment-hook" data-tbv-payment="1">${esc(t('public_booking.payment_hook_cta'))}</button>
              <div class="tbv-hook-note">${esc(t('public_booking.payment_hook_note'))}</div>
            </div>
          </div>
        </div>
      </div>`;
  }

  function createDrawerElements(root, t, pricingDefinitions) {
    const overlay = document.createElement('div');
    overlay.className = 'tbv-overlay tbv-hidden';
    overlay.setAttribute('data-tbv-overlay', '1');

    const drawer = document.createElement('aside');
    drawer.className = 'tbv-drawer';
    drawer.setAttribute('data-public-booking-view', '1');
    drawer.setAttribute('data-mode', 'drawer');
    drawer.setAttribute('data-tour-id', root.getAttribute('data-tour-id') || '');
    drawer.setAttribute('data-tenant-id', root.getAttribute('data-tenant-id') || '');
    drawer.setAttribute('data-currency', root.getAttribute('data-currency') || 'EUR');
    drawer.setAttribute('data-tour-type', root.getAttribute('data-tour-type') || 'package');
    drawer.innerHTML = buildViewMarkup('drawer', t, pricingDefinitions);

    document.body.appendChild(overlay);
    document.body.appendChild(drawer);
    root._tbvOverlay = overlay;
    root._tbvDrawer = drawer;
    drawer._tbvOverlay = overlay;
    drawer._tbvDrawer = drawer;
  }

  function initView(root, mode, messages) {
    const currency = root.getAttribute('data-currency') || 'EUR';
    const tourId = root.getAttribute('data-tour-id') || '';
    const tenantId = root.getAttribute('data-tenant-id') || '';
    const tourType = root.getAttribute('data-tour-type') || 'package';
    const isDayTour = tourType === 'day_tour';
    const t = (key, vars, fallback) => applyVars(getNestedValue(messages, key) ?? fallback ?? getNestedValue(DEFAULT_MESSAGES, key) ?? key, vars);
    const pricingDefinitions = [
      t('public_booking.def_infant'),
      t('public_booking.def_children'),
      t('public_booking.def_teens'),
      t('public_booking.def_note'),
    ].filter(Boolean);
    const phase1 = root.querySelector('[data-tbv-phase1]');
    const phase2 = root.querySelector('[data-tbv-phase2]');
    const phase2Footer = root.querySelector('[data-tbv-phase2-footer]');
    const compact = root.querySelector('[data-tbv-compact]');
    const compactText = root.querySelector('[data-tbv-compact-text]');
    const roomHint = root.querySelector('[data-tbv-room-hint]');
    const roomRow = root.querySelector('[data-tbv-room-row]');
    if (isDayTour && roomRow) roomRow.style.display = 'none';
    const roomStatus = root.querySelector('[data-tbv-room-status]');
    const surplusHint = root.querySelector('[data-tbv-surplus]');
    const segTabs = root.querySelector('[data-tbv-seg-tabs]');
    const paxRows = root.querySelector('[data-tbv-pax-rows]');
    const totalEl = root.querySelector('[data-tbv-total]');
    const metaEl = root.querySelector('[data-tbv-meta]');
    const rateStatusEl = root.querySelector('[data-tbv-rate-status]');
    const calcButton = root.querySelector('[data-tbv-calc-button]');
    const paymentButton = root.querySelector('[data-tbv-payment]');
    const closeButton = root.querySelector('[data-tbv-close]');
    const editButton = root.querySelector('[data-tbv-edit]');
    const dateInput = root.querySelector('[data-tbv-date]');
    const adultsInput = root.querySelector('[data-tbv-adults]');
    const childrenInput = root.querySelector('[data-tbv-children]');
    const doublesInput = root.querySelector('[data-tbv-doubles]');
    const triplesInput = root.querySelector('[data-tbv-triples]');
    const singlesInput = root.querySelector('[data-tbv-singles]');

    const PAX_TYPES = [
      { key: 'adult_shared_room_count', label: isDayTour ? t('public_booking.traveller_adult', {}, 'Adult') : t('public_booking.traveller_adult_shared'), priceField: 'adult_shared_room_price', step: isDayTour ? 1 : 2 },
      { key: 'adult_triple_room_count', label: t('public_booking.traveller_adult_triple', {}, 'Triple room (per person)'), priceField: 'adult_triple_room_price', step: 3 },
      { key: 'adult_single_room_count', label: t('public_booking.traveller_adult_private'), priceField: 'adult_single_room_price', step: 1 },
      { key: 'child_count', label: t('tour_config.pricing.child_with_parents'), priceField: 'child_shared_with_parents_price', step: 1 },
      { key: 'infant_count', label: t('public_booking.traveller_infant'), priceField: 'infant_price', step: 1 },
    ];

    const state = {
      dataLoaded: false,
      revealed: false,
      pricingData: { seasons: [], segments: [], paxBands: [], prices: [] },
      paymentSettings: null,
      calcState: {
        segmentId: null,
        pax: { adult_shared_room_count: 2, adult_triple_room_count: 0, adult_single_room_count: 0, child_count: 0, infant_count: 0 },
        date: new Date().toISOString().slice(0, 10),
      },
      lastQuote: null,
    };

    function emitEvent(name, detail) {
      const payload = { ...detail, source: 'tour-booking-view' };
      root.dispatchEvent(new CustomEvent(name, { detail: payload, bubbles: true }));
      document.dispatchEvent(new CustomEvent(name, { detail: payload }));
    }

    function buildPaymentPayload(total = null) {
      const activeSegment = state.pricingData.segments.find((segment) => String(segment.id) === String(state.calcState.segmentId)) || null;
      return {
        tenantId,
        tourId,
        segmentId: state.calcState.segmentId || '',
        travelDate: state.calcState.date || '',
        pax: { ...state.calcState.pax },
        currency,
        total,
        segmentName: activeSegment?.name || '',
        segmentCode: activeSegment?.code || '',
        paxBandId: '',
        paxBandName: '',
        seasonId: '',
        seasonName: '',
        unitPrices: {
          adult_shared_room: 0,
          adult_triple_room: 0,
          adult_single_room: 0,
          child_shared_with_parents: 0,
          infant: 0,
        },
        invoice: null,
        notes: '',
      };
    }

    function buildPaymentPayloadWithQuote(total, quoteResult = {}, priceData = {}) {
      const basePayload = buildPaymentPayload(total);
      const activeSegment = state.pricingData.segments.find((segment) => String(segment.id) === String(state.calcState.segmentId)) || null;
      const unitPrices = {
        adult_shared_room: Number(priceData.adult_shared_room ?? priceData.adult_shared_room_price ?? 0),
        adult_triple_room: Number(priceData.adult_triple_room ?? priceData.adult_triple_room_price ?? 0),
        adult_single_room: Number(priceData.adult_single_room ?? priceData.adult_single_room_price ?? 0),
        child_shared_with_parents: Number(priceData.child_shared_with_parents ?? priceData.child_shared_with_parents_price ?? 0),
        infant: Number(priceData.infant ?? priceData.infant_price ?? 0),
      };

      return {
        ...basePayload,
        segmentName: quoteResult.segment_name || activeSegment?.name || basePayload.segmentName,
        segmentCode: quoteResult.segment_code || activeSegment?.code || basePayload.segmentCode,
        paxBandId: quoteResult.pax_band_id || '',
        paxBandName: quoteResult.pax_band_name || '',
        seasonId: quoteResult.season_id || '',
        seasonName: quoteResult.applied_season_name || '',
        unitPrices,
        invoice: quoteResult.invoice || null,
        notes: quoteResult.notes || '',
      };
    }

    function syncPaymentHook(payload) {
      if (!paymentButton) return;
      const safePayload = payload || buildPaymentPayload(null);
      paymentButton.dataset.paymentTenantId = safePayload.tenantId || '';
      paymentButton.dataset.paymentTourId = safePayload.tourId || '';
      paymentButton.dataset.paymentSegmentId = safePayload.segmentId || '';
      paymentButton.dataset.paymentTravelDate = safePayload.travelDate || '';
      paymentButton.dataset.paymentCurrency = safePayload.currency || '';
      paymentButton.dataset.paymentSegmentName = safePayload.segmentName || '';
      paymentButton.dataset.paymentSegmentCode = safePayload.segmentCode || '';
      paymentButton.dataset.paymentPaxBandId = safePayload.paxBandId || '';
      paymentButton.dataset.paymentPaxBandName = safePayload.paxBandName || '';
      paymentButton.dataset.paymentSeasonId = safePayload.seasonId || '';
      paymentButton.dataset.paymentSeasonName = safePayload.seasonName || '';
      paymentButton.dataset.paymentAdultsShared = String(safePayload.pax?.adult_shared_room_count || 0);
      paymentButton.dataset.paymentAdultsPrivate = String(safePayload.pax?.adult_single_room_count || 0);
      paymentButton.dataset.paymentChildren = String(safePayload.pax?.child_count || 0);
      paymentButton.dataset.paymentInfants = String(safePayload.pax?.infant_count || 0);
      paymentButton.dataset.paymentSharedRoomPrice = String(safePayload.unitPrices?.adult_shared_room ?? '');
      paymentButton.dataset.paymentPrivateRoomPrice = String(safePayload.unitPrices?.adult_single_room ?? '');
      paymentButton.dataset.paymentChildPrice = String(safePayload.unitPrices?.child_shared_with_parents ?? '');
      paymentButton.dataset.paymentInfantPrice = String(safePayload.unitPrices?.infant ?? '');
      paymentButton.dataset.paymentTotal = safePayload.total == null ? '' : String(safePayload.total);
      paymentButton.disabled = !safePayload.segmentId || !safePayload.travelDate || (safePayload.total == null);
    }

    async function loadPaymentSettings() {
      if (state.paymentSettings) return state.paymentSettings;
      try {
        const response = await fetch('/api/payments/settings', {
          headers: { 'X-Tenant-ID': tenantId, 'Accept-Language': normalizeLang(document.documentElement.lang || navigator.language || 'en') },
        });
        if (response.status === 401 || response.status === 403) {
          throw new Error('AUTH_REQUIRED_FOR_PAYMENT_SETTINGS');
        }
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error || 'Could not load payment settings.');
        state.paymentSettings = data;
      } catch (error) {
        try {
          const response = await fetch('/api/tenant/config', {
            headers: { 'X-Tenant-ID': tenantId, 'Accept-Language': normalizeLang(document.documentElement.lang || navigator.language || 'en') },
          });
          const data = await response.json();
          if (!response.ok || !data?.ok) throw new Error(data?.error || 'Could not load public payment settings.');
          const paymentMethods = Array.isArray(data?.config?.payment_methods) ? data.config.payment_methods : [];
          const hasElectronicGateway = paymentMethods.some((method) => method?.enabled && ['stripe', 'paypal', 'momo', 'zalopay', 'vnpay', 'grabpay', 'credit_card'].includes(String(method.id || '').toLowerCase()));
          state.paymentSettings = {
            ok: true,
            payment_methods: paymentMethods,
            compliance: {
              has_electronic_gateway: hasElectronicGateway,
              message: hasElectronicGateway
                ? t('payments.compliance_gateway_active', {}, 'Tenant has at least one active electronic gateway.')
                : t('payments.compliance_gateway_missing', {}, 'No electronic gateway is enabled yet. Configure API keys to activate one.'),
            },
          };
        } catch (publicError) {
          state.paymentSettings = {
            ok: false,
            payment_methods: [],
            compliance: {
              has_electronic_gateway: false,
              message: publicError?.message || error?.message || 'Could not load payment settings.',
            },
          };
        }
      }
      return state.paymentSettings;
    }

    function getVisibleMethods(settings) {
      const methods = Array.isArray(settings?.payment_methods) ? settings.payment_methods.filter((method) => method.enabled) : [];
      const localizeMethod = (method) => ({
        ...method,
        label: t(`public_booking.method_${String(method.id || '').toLowerCase()}`, {}, method.label || method.id),
      });
      if (methods.length) return methods.map(localizeMethod);
      return [localizeMethod({ id: 'BANK_TRANSFER', label: 'Bank transfer', enabled: true, category: 'manual' })];
    }

    function buildDemoResponse(methodId, guest) {
      const orderId = `demo_${Math.random().toString(36).slice(2, 10)}`;
      return {
        ok: true,
        demo: true,
        order_id: orderId,
        status: 'DEMO_SUCCESS',
        payment_method: methodId,
        guest_name: guest.name,
        guest_email: guest.email,
        note: t('public_booking.payment_demo_success'),
        guest_portal_url: `${window.location.origin}${window.location.pathname}?demo_order=${orderId}`,
      };
    }

    function buildQuoteSummaryHtml(quote) {
      const lines = [];
      if (quote?.travelDate) lines.push(`<div><strong>${esc(t('public_booking.payment_travel_date'))}</strong>: ${esc(quote.travelDate)}</div>`);
      if (quote?.segmentName) lines.push(`<div><strong>${esc(t('tour_config.pricing.pricing_tier'))}</strong>: ${esc(quote.segmentName)}</div>`);
      if (quote?.seasonName) lines.push(`<div>${esc(t('tour_config.pricing.current_rate', { season: quote.seasonName }))}</div>`);
      if (quote?.paxBandName) lines.push(`<div>${esc(t('tour_config.pricing.band_current', { name: quote.paxBandName }))}</div>`);
      lines.push(`<div><strong>${esc(t('public_booking.payment_guests'))}</strong>: ${esc(t('public_booking.payment_summary_adults_children', { adults: String((quote?.pax?.adult_shared_room_count || 0) + (quote?.pax?.adult_single_room_count || 0)), children: String(quote?.pax?.child_count || 0) }))}</div>`);
      lines.push(`<div><strong>${esc(t('public_booking.payment_total'))}</strong>: ${esc(fmtMoney(quote?.total, quote?.currency || currency))}</div>`);

      const priceLines = [
        { label: PAX_TYPES[0].label, value: quote?.unitPrices?.adult_shared_room },
        { label: PAX_TYPES[1].label, value: quote?.unitPrices?.adult_single_room },
        { label: PAX_TYPES[2].label, value: quote?.unitPrices?.child_shared_with_parents },
        { label: PAX_TYPES[3].label, value: quote?.unitPrices?.infant },
      ].filter((entry) => entry.value != null);

      if (priceLines.length) {
        lines.push(`<div style="margin-top:10px;border-top:1px dashed rgba(212,175,115,0.24);padding-top:10px">${priceLines.map((entry) => `<div><strong>${esc(entry.label)}</strong>: ${esc(fmtMoney(entry.value, quote?.currency || currency))}</div>`).join('')}</div>`);
      }

      return lines.join('');
    }

    function renderPaymentResult(container, result, quote, isDemo) {
      const summary = [];
      if (result.order_id) summary.push(`<strong>Order</strong>: ${esc(result.order_id)}`);
      if (result.payment_method) summary.push(`<strong>Method</strong>: ${esc(result.payment_method)}`);
      container.className = `tbv-pay-status ${isDemo ? 'demo' : 'success'}`;
      container.innerHTML = `<div>${esc(result.note || (isDemo ? t('public_booking.payment_demo_success') : t('public_booking.payment_success')))}</div><div style="margin-top:8px">${summary.join('<br>')}</div><div style="margin-top:10px">${buildQuoteSummaryHtml(quote)}</div>${result.guest_portal_url ? `<a class="tbv-pay-portal" href="${esc(result.guest_portal_url)}" target="_blank" rel="noreferrer">${esc(t('public_booking.payment_portal'))}</a>` : ''}`;
    }

    function closePaymentSheet(sheet) {
      if (!sheet) return;
      sheet.remove();
      document.body.style.overflow = mode === 'drawer' && root._tbvDrawer?.classList.contains('is-open') ? 'hidden' : '';
    }

    async function openPaymentSheet() {
      const quote = state.lastQuote || buildPaymentPayload(null);
      if (!quote.segmentId || !quote.travelDate || quote.total == null) return;
      const settings = await loadPaymentSettings();
      const demoMode = settings?.compliance?.has_electronic_gateway !== true;
      const methods = getVisibleMethods(settings);

      const overlay = createElement('div', { className: 'tbv-pay-overlay' });
      const panel = createElement('div', { className: 'tbv-pay-panel' });
      const statusBox = createElement('div', { className: 'tbv-pay-status tbv-hidden' });
      const summaryBox = createElement('div', { className: 'tbv-pay-sum', html: buildQuoteSummaryHtml(quote) });
      const methodsWrap = createElement('div', { className: 'tbv-pay-methods' });
      const selectedMethod = { value: methods[0]?.id || 'BANK_TRANSFER' };

      methods.forEach((method, index) => {
        const methodCard = createElement('button', { type: 'button', className: `tbv-pay-method${index === 0 ? ' active' : ''}` });
        methodCard.appendChild(createElement('div', { className: 'tbv-pay-method-title', html: `<span>${esc(method.label || method.id)}</span><span class="tbv-pay-badge ${esc(method.category || 'manual')}">${esc(method.category === 'instant' ? t('public_booking.payment_category_instant') : t('public_booking.payment_category_manual'))}</span>` }));
        const desc = demoMode
          ? t('public_booking.payment_method_desc_demo')
          : (method.category === 'instant'
              ? t('public_booking.payment_method_desc_instant')
              : t('public_booking.payment_method_desc_manual'));
        methodCard.appendChild(createElement('p', { text: desc }));
        methodCard.addEventListener('click', () => {
          methodsWrap.querySelectorAll('.tbv-pay-method').forEach((entry) => entry.classList.remove('active'));
          methodCard.classList.add('active');
          selectedMethod.value = method.id;
        });
        methodsWrap.appendChild(methodCard);
      });

      const nameInput = createElement('input', { type: 'text', placeholder: t('public_booking.guest_name') });
      const emailInput = createElement('input', { type: 'email', placeholder: 'guest@example.com' });
      const phoneInput = createElement('input', { type: 'text', placeholder: '+84...' });
      const notesInput = createElement('textarea', { placeholder: demoMode ? t('public_booking.guest_note_placeholder_demo') : t('public_booking.guest_note_placeholder') });
      const submitBtn = createElement('button', { type: 'button', className: 'tbv-pay-submit', text: demoMode ? t('public_booking.payment_submit_demo') : t('public_booking.payment_submit') });
      const cancelBtn = createElement('button', { type: 'button', className: 'tbv-pay-secondary', text: t('public_booking.payment_cancel') });
      const intro = createElement('div', { className: 'tbv-pay-head' }, [
        createElement('div', {}, [
          createElement('h3', { text: demoMode ? t('public_booking.payment_title_demo') : t('public_booking.payment_title') }),
          createElement('p', { text: demoMode ? t('public_booking.payment_intro_demo') : t('public_booking.payment_intro') }),
        ]),
        createElement('button', { type: 'button', className: 'tbv-pay-close', text: '×' }),
      ]);
      const grid = createElement('div', { className: 'tbv-pay-grid' }, [
        createElement('div', { className: 'tbv-pay-field' }, [createElement('label', { text: t('public_booking.guest_name') }), nameInput]),
        createElement('div', { className: 'tbv-pay-field' }, [createElement('label', { text: t('public_booking.guest_email') }), emailInput]),
        createElement('div', { className: 'tbv-pay-field' }, [createElement('label', { text: t('public_booking.guest_phone') }), phoneInput]),
        createElement('div', { className: 'tbv-pay-field full' }, [createElement('label', { text: t('public_booking.guest_note') }), notesInput]),
      ]);

      panel.appendChild(intro);
      if (demoMode) {
        panel.appendChild(createElement('div', { className: 'tbv-pay-demo', html: `<strong>${esc(t('public_booking.payment_demo_banner'))}</strong><br>${esc(settings?.compliance?.message || t('public_booking.payment_demo_message'))}` }));
      }
      panel.appendChild(summaryBox);
      panel.appendChild(grid);
      panel.appendChild(methodsWrap);
      panel.appendChild(createElement('div', { className: 'tbv-pay-actions' }, [cancelBtn, submitBtn]));
      panel.appendChild(statusBox);
      overlay.appendChild(panel);
      document.body.appendChild(overlay);
      document.body.style.overflow = 'hidden';

      const dismiss = () => closePaymentSheet(overlay);
      overlay.addEventListener('click', (event) => { if (event.target === overlay) dismiss(); });
      intro.querySelector('.tbv-pay-close')?.addEventListener('click', dismiss);
      cancelBtn.addEventListener('click', dismiss);

      submitBtn.addEventListener('click', async () => {
        const guest = {
          name: String(nameInput.value || '').trim(),
          email: String(emailInput.value || '').trim(),
          phone: String(phoneInput.value || '').trim(),
        };
        if (!guest.name || !guest.email) {
          statusBox.className = 'tbv-pay-status error';
          statusBox.textContent = t('public_booking.payment_guest_required');
          return;
        }
        submitBtn.disabled = true;
        submitBtn.textContent = demoMode ? t('public_booking.payment_submit_loading_demo') : t('public_booking.payment_submit_loading');
        try {
          let result;
          if (demoMode) {
            result = buildDemoResponse(selectedMethod.value, guest);
            emitEvent('travelagent:public-booking-demo-payment', {
              ...quote,
              payment_method: selectedMethod.value,
              guest,
            });
          } else {
            const response = await fetch('/api/bookings/order', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenantId },
              body: JSON.stringify({
                tour_id: quote.tourId,
                travel_date: quote.travelDate,
                segment_id: quote.segmentId,
                payment_method: selectedMethod.value,
                pax: quote.pax,
                guest,
                customer_note: String(notesInput.value || '').trim(),
              }),
            });
            result = await response.json();
            if (!response.ok || !result?.ok) {
              throw new Error(result?.error || t('public_booking.payment_error_generic'));
            }
            emitEvent('travelagent:public-booking-order-created', {
              ...quote,
              payment_method: selectedMethod.value,
              guest,
              order_id: result.order_id,
              status: result.status,
            });
          }
          renderPaymentResult(statusBox, result, quote, demoMode);
        } catch (error) {
          statusBox.className = 'tbv-pay-status error';
          statusBox.textContent = error?.message || t('public_booking.payment_error_generic');
        } finally {
          submitBtn.disabled = false;
          submitBtn.textContent = demoMode ? t('public_booking.payment_submit_demo') : t('public_booking.payment_submit');
        }
      });
    }

    function buildCompactSummary() {
      const travelDate = dateInput?.value || '';
      const adults = clampInt(adultsInput?.value);
      const children = clampInt(childrenInput?.value);
      const doubles = clampInt(doublesInput?.value);
      const triples = clampInt(triplesInput?.value);
      const singles = clampInt(singlesInput?.value);
      const datePart = travelDate ? new Date(travelDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'no date';
      const roomParts = [];
      if (doubles > 0) roomParts.push(`${doubles} dbl`);
      if (triples > 0) roomParts.push(`${triples} tpl`);
      if (singles > 0) roomParts.push(`${singles} sgl`);
      return isDayTour
        ? `${datePart} · ${adults} adults, ${children} children`
        : `${datePart} · ${adults} adults, ${children} children · ${roomParts.join(' + ') || '0 rooms'}`;
    }

    function showCompact() {
      compactText.textContent = buildCompactSummary();
      compact.classList.add('is-visible');
      phase1.classList.add('tbv-hidden');
    }

    function showExpanded() {
      compact.classList.remove('is-visible');
      phase1.classList.remove('tbv-hidden');
    }

    function autoSuggestRooms(adults) {
      if (adults < 1) return;
      const doubles = Math.floor(adults / 2);
      const singles = adults % 2;
      if (doublesInput && !doublesInput.dataset.userOverride) doublesInput.value = String(doubles);
      if (triplesInput && !triplesInput.dataset.userOverride) triplesInput.value = '0';
      if (singlesInput && !singlesInput.dataset.userOverride) singlesInput.value = String(singles);
    }

    function validateRooms() {
      if (isDayTour) {
        if (roomHint) roomHint.style.display = 'none';
        return true;
      }
      const adults = clampInt(adultsInput?.value);
      const doubles = clampInt(doublesInput?.value);
      const triples = clampInt(triplesInput?.value);
      const singles = clampInt(singlesInput?.value);
      const capacity = doubles * 2 + triples * 3 + singles;
      if (adults === 0) {
        roomHint.style.display = 'none';
        return true;
      }
      roomHint.style.display = 'block';
      if (capacity < adults) {
        const shortage = adults - capacity;
        roomHint.className = 'tbv-hint tbv-warn';
        roomHint.textContent = `Room shortage: ${capacity} capacity < ${adults} adults. ${shortage} traveller${shortage > 1 ? 's' : ''} will be charged at single room rate.`;
        return false;
      }
      if (capacity > adults) {
        const surplus = capacity - adults;
        roomHint.className = 'tbv-hint tbv-info';
        roomHint.textContent = `${surplus} extra room${surplus > 1 ? 's' : ''} booked — sole-occupancy supplement will apply.`;
        return true;
      }
      roomHint.className = 'tbv-hint tbv-good';
      const parts = [];
      if (doubles > 0) parts.push(`${doubles} double`);
      if (triples > 0) parts.push(`${triples} triple`);
      if (singles > 0) parts.push(`${singles} single`);
      roomHint.textContent = `${parts.join(' + ')} = exactly ${capacity} adults.`;
      return true;
    }

    function syncPhase1ToPax() {
      const adults = clampInt(adultsInput?.value);
      const children = clampInt(childrenInput?.value);

      if (isDayTour) {
        state.calcState.pax = {
          adult_shared_room_count: adults,
          adult_triple_room_count: 0,
          adult_single_room_count: 0,
          child_count: children,
          infant_count: 0,
        };
        return;
      }

      const doubles = clampInt(doublesInput?.value);
      const triples = clampInt(triplesInput?.value);
      const singles = clampInt(singlesInput?.value);
      const totalRooms = doubles + triples + singles;
      let sharedPax = 0;
      let triplePax = 0;
      let privatePax = 0;
      if (adults > 0) {
        if (totalRooms >= adults) {
          sharedPax = 0;
          triplePax = 0;
          privatePax = adults;
        } else {
          const fullyOccupied = Math.min(doubles, adults - totalRooms);
          sharedPax = fullyOccupied * 2;
          const afterDoubles = adults - sharedPax;
          const fullyOccupiedTriples = Math.min(triples, Math.max(0, afterDoubles - (totalRooms - fullyOccupied - triples)));
          triplePax = fullyOccupiedTriples * 3;
          privatePax = adults - sharedPax - triplePax;
        }
      }
      state.calcState.pax = {
        adult_shared_room_count: sharedPax,
        adult_triple_room_count: triplePax,
        adult_single_room_count: privatePax,
        child_count: children,
        infant_count: 0,
      };
    }

    function syncTableToPax(key, newQty) {
      if (key === 'adult_shared_room_count') newQty = Math.max(0, Math.floor(newQty / 2) * 2);
      if (key === 'adult_triple_room_count') newQty = Math.max(0, Math.floor(newQty / 3) * 3);
      state.calcState.pax[key] = Math.max(0, newQty);
      const sharedPax = state.calcState.pax.adult_shared_room_count || 0;
      const triplePax = state.calcState.pax.adult_triple_room_count || 0;
      const privatePax = state.calcState.pax.adult_single_room_count || 0;
      const totalAdults = sharedPax + triplePax + privatePax;
      if (doublesInput) doublesInput.value = String(sharedPax / 2);
      if (triplesInput) triplesInput.value = String(triplePax / 3);
      if (singlesInput) singlesInput.value = String(privatePax);
      if (adultsInput) adultsInput.value = String(totalAdults);
      if (childrenInput) childrenInput.value = String(state.calcState.pax.child_count || 0);
      if (state.revealed) compactText.textContent = buildCompactSummary();
      updateRoomStatusPill();
      updateSurplusHint();
    }

    function updateRoomStatusPill() {
      if (isDayTour) { roomStatus.style.display = 'none'; return; }
      const sharedPax = state.calcState.pax.adult_shared_room_count || 0;
      const triplePax = state.calcState.pax.adult_triple_room_count || 0;
      const privatePax = state.calcState.pax.adult_single_room_count || 0;
      const adults = sharedPax + triplePax + privatePax;
      if (adults < 1) {
        roomStatus.style.display = 'none';
        return;
      }
      const doubles = sharedPax / 2;
      const tripleRooms = triplePax / 3;
      const parts = [];
      if (doubles > 0) parts.push(`${doubles} shared double${doubles > 1 ? 's' : ''}`);
      if (tripleRooms > 0) parts.push(`${tripleRooms} triple room${tripleRooms > 1 ? 's' : ''}`);
      if (privatePax > 0) parts.push(`${privatePax} private room${privatePax > 1 ? 's' : ''}`);
      roomStatus.style.display = 'block';
      roomStatus.className = 'tbv-status tbv-good';
      roomStatus.textContent = `${parts.join(' + ')} → ${adults} adults confirmed`;
    }

    function updateSurplusHint() {
      const sharedPax = state.calcState.pax.adult_shared_room_count || 0;
      const triplePax = state.calcState.pax.adult_triple_room_count || 0;
      const privatePax = state.calcState.pax.adult_single_room_count || 0;
      const adults = sharedPax + triplePax + privatePax;
      if (adults < 1) {
        surplusHint.style.display = 'none';
        return;
      }
      const doubles = sharedPax / 2;
      const tripleRooms = triplePax / 3;
      const totalRooms = doubles + tripleRooms + privatePax;
      const minRooms = Math.ceil(adults / 2);
      if (privatePax > 0 && totalRooms > minRooms) {
        surplusHint.style.display = 'block';
        surplusHint.textContent = t('tour_config.pricing.room_hint_single_supplement');
      } else {
        surplusHint.style.display = 'none';
      }
    }

    function findBasePrice(segmentId) {
      const totalPax = Object.values(state.calcState.pax).reduce((sum, value) => sum + value, 0);
      const rows = state.pricingData.prices.filter((row) => row.segment_id === segmentId);
      if (!rows.length) return null;
      if (totalPax > 0) {
        const paxBand = [...state.pricingData.paxBands]
          .sort((left, right) => left.min_pax - right.min_pax)
          .find((band) => totalPax >= band.min_pax && totalPax <= band.max_pax);
        if (paxBand) {
          const match = rows.find((row) => row.pax_band_id === paxBand.id);
          if (match) return match;
        }
      }
      return rows[0];
    }

    function renderPaxRows(priceRow) {
      if (!state.calcState.segmentId) {
        paxRows.innerHTML = `<tr><td colspan="4" style="padding:16px 0;color:#94a3b8;font-size:13px">${esc(t('tour_config.pricing.select_pricing_tier'))}</td></tr>`;
        return;
      }
      paxRows.innerHTML = PAX_TYPES.map((type) => {
        const qty = state.calcState.pax[type.key] || 0;
        const unitPrice = priceRow ? Number(priceRow[type.priceField] || 0) : null;
        const subtotal = unitPrice != null && qty > 0 ? unitPrice * qty : null;
        return `<tr>
          <td>${esc(type.label)}</td>
          <td class="align-right">${esc(fmtMoney(unitPrice, currency))}</td>
          <td class="align-center"><div class="tbv-qty"><button type="button" data-tbv-key="${esc(type.key)}" data-tbv-delta="-${type.step}">−</button><span data-tbv-qty="${esc(type.key)}">${qty}</span><button type="button" data-tbv-key="${esc(type.key)}" data-tbv-delta="${type.step}">+</button></div></td>
          <td class="align-right" style="font-weight:700;color:${subtotal != null ? '#1e293b' : '#cbd5e1'}">${esc(fmtMoney(subtotal, currency))}</td>
        </tr>`;
      }).join('');
    }

    async function runCalc() {
      const segmentId = state.calcState.segmentId;
      const paxSnap = { ...state.calcState.pax };
      const travelDate = state.calcState.date;
      const totalPax = Object.values(paxSnap).reduce((sum, value) => sum + value, 0);
      const priceRow = segmentId ? findBasePrice(segmentId) : null;
      renderPaxRows(priceRow);
      if (!segmentId || totalPax === 0) {
        totalEl.textContent = '—';
        metaEl.textContent = totalPax === 0 ? t('tour_config.pricing.add_travellers_above') : t('tour_config.pricing.select_pricing_tier_short');
        rateStatusEl.style.display = 'none';
        return;
      }
      const localTotal = PAX_TYPES.reduce((sum, type) => sum + (paxSnap[type.key] || 0) * (priceRow ? (Number(priceRow[type.priceField]) || 0) : 0), 0);
      totalEl.textContent = fmtMoney(localTotal, currency);
      metaEl.textContent = t('tour_config.pricing.total_for_group');
      updateSurplusHint();
      const localBand = [...state.pricingData.paxBands]
        .sort((left, right) => left.min_pax - right.min_pax)
        .find((band) => totalPax >= band.min_pax && totalPax <= band.max_pax);
      state.lastQuote = buildPaymentPayloadWithQuote(localTotal, {
        pax_band_id: localBand?.id || '',
        pax_band_name: localBand?.name || '',
      }, {
        adult_shared_room_price: priceRow?.adult_shared_room_price,
        adult_triple_room_price: priceRow?.adult_triple_room_price,
        adult_single_room_price: priceRow?.adult_single_room_price,
        child_shared_with_parents_price: priceRow?.child_shared_with_parents_price,
        infant_price: priceRow?.infant_price,
      });
      syncPaymentHook(state.lastQuote);
      emitEvent('travelagent:public-booking-quote-ready', state.lastQuote);
      if (localBand) {
        rateStatusEl.textContent = t('tour_config.pricing.band_summary', { name: localBand.name, min: String(localBand.min_pax), max: String(localBand.max_pax) });
        rateStatusEl.style.display = 'inline-block';
      } else {
        rateStatusEl.style.display = 'none';
      }

      try {
        const response = await fetch('/api/pricing/calculate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenantId },
          body: JSON.stringify({ tour_id: tourId, segment_id: segmentId, travel_date: travelDate, ...paxSnap }),
        });
        const result = await response.json();
        if (!response.ok || !result?.ok || segmentId !== state.calcState.segmentId) return;
        const authoritativeTotal = result.invoice?.grand_total ?? localTotal;
        const authoritativeUnitPrices = result.unit_prices || {
          adult_shared_room: result.prices?.adult_shared_room?.price_usd,
          adult_triple_room: result.prices?.adult_triple_room?.price_usd,
          adult_single_room: result.prices?.adult_single_room?.price_usd,
          child_shared_with_parents: result.prices?.child_shared_with_parents?.price_usd,
          infant: result.prices?.infant?.price_usd,
        };
        renderPaxRows({
          adult_shared_room_price: authoritativeUnitPrices.adult_shared_room ?? 0,
          adult_triple_room_price: authoritativeUnitPrices.adult_triple_room ?? 0,
          adult_single_room_price: authoritativeUnitPrices.adult_single_room ?? 0,
          child_shared_with_parents_price: authoritativeUnitPrices.child_shared_with_parents ?? 0,
          infant_price: authoritativeUnitPrices.infant ?? 0,
        });
        totalEl.textContent = fmtMoney(authoritativeTotal, currency);
        state.lastQuote = buildPaymentPayloadWithQuote(authoritativeTotal, result, authoritativeUnitPrices);
        syncPaymentHook(state.lastQuote);
        emitEvent('travelagent:public-booking-quote-ready', state.lastQuote);
        const labels = [];
        if (result.applied_season_name) labels.push(t('tour_config.pricing.current_rate', { season: result.applied_season_name }));
        if (result.pax_band_name) labels.push(t('tour_config.pricing.band_current', { name: result.pax_band_name }));
        if (labels.length) {
          rateStatusEl.textContent = labels.join(' | ');
          rateStatusEl.style.display = 'inline-block';
        }
        if (result.pricing_notes?.length) {
          const defsList = root.querySelector('[data-tbv-defs]');
          if (defsList) {
            defsList.innerHTML = result.pricing_notes
              .map((item) => `<li style="display:flex;gap:8px;align-items:flex-start"><span style="color:var(--color-secondary,#d4af73);font-weight:700">•</span><span>${esc(item)}</span></li>`)
              .join('');
          }
        }
      } catch {
        // Keep local total as source of truth for the visible total.
      }
    }

    async function loadPricing() {
      if (state.dataLoaded) return;
      const headers = { 'X-Tenant-ID': tenantId };
      const [seasonsRes, segmentsRes, paxBandsRes, pricesRes] = await Promise.all([
        fetch('/api/pricing/tenant-seasons', { headers }).then((response) => response.json()).catch(() => ({})),
        fetch('/api/pricing/pricing-segments', { headers }).then((response) => response.json()).catch(() => ({})),
        fetch('/api/pricing/pax-bands', { headers }).then((response) => response.json()).catch(() => ({})),
        fetch('/api/pricing/tour-prices', { headers }).then((response) => response.json()).catch(() => ({})),
      ]);
      const toArray = (value) => Array.isArray(value) ? value : (value?.items || []);
      const segments = toArray(segmentsRes);
      state.pricingData = {
        seasons: toArray(seasonsRes),
        segments,
        paxBands: toArray(paxBandsRes),
        prices: toArray(pricesRes).filter((price) => price.tour_id === tourId),
      };
      state.dataLoaded = true;
      calcButton.disabled = false;
      syncPaymentHook(buildPaymentPayload(null));
      if (!segments.length) {
        segTabs.innerHTML = `<span style="color:#94a3b8;font-size:13px">${esc(t('tour_config.pricing.no_segments_configured'))}</span>`;
        state.calcState.segmentId = null;
        return;
      }
      if (!state.calcState.segmentId || !segments.find((segment) => segment.id === state.calcState.segmentId)) {
        state.calcState.segmentId = segments[0].id;
      }
      segTabs.innerHTML = segments.map((segment) => `<button type="button" class="tbv-seg-tab${state.calcState.segmentId === segment.id ? ' active' : ''}" data-tbv-seg-id="${esc(segment.id)}">${esc(segment.name)}</button>`).join('');
    }

    async function openView() {
      await loadPricing();
      if (mode === 'drawer') {
        root._tbvOverlay.classList.remove('tbv-hidden');
        root._tbvDrawer.classList.add('is-open');
        document.body.style.overflow = 'hidden';
      }
      if (!state.revealed && dateInput) dateInput.focus();
    }

    function closeView() {
      if (mode !== 'drawer') return;
      root._tbvOverlay.classList.add('tbv-hidden');
      root._tbvDrawer.classList.remove('is-open');
      document.body.style.overflow = '';
    }

    closeButton?.addEventListener('click', closeView);
    root._tbvOverlay?.addEventListener('click', closeView);
    editButton?.addEventListener('click', showExpanded);
    segTabs.addEventListener('click', (event) => {
      const button = event.target.closest('[data-tbv-seg-id]');
      if (!button) return;
      segTabs.querySelectorAll('[data-tbv-seg-id]').forEach((entry) => entry.classList.remove('active'));
      button.classList.add('active');
      state.calcState.segmentId = button.getAttribute('data-tbv-seg-id');
      runCalc();
    });
    paxRows.addEventListener('click', (event) => {
      const button = event.target.closest('[data-tbv-key]');
      if (!button) return;
      syncTableToPax(button.getAttribute('data-tbv-key'), (state.calcState.pax[button.getAttribute('data-tbv-key')] || 0) + Number(button.getAttribute('data-tbv-delta') || 0));
      runCalc();
    });
    dateInput?.addEventListener('change', (event) => {
      state.calcState.date = event.target.value;
      if (state.revealed) runCalc();
    });
    adultsInput?.addEventListener('input', () => {
      autoSuggestRooms(clampInt(adultsInput.value));
      validateRooms();
    });
    doublesInput?.addEventListener('input', () => { doublesInput.dataset.userOverride = '1'; validateRooms(); });
    singlesInput?.addEventListener('input', () => { singlesInput.dataset.userOverride = '1'; validateRooms(); });
    childrenInput?.addEventListener('input', validateRooms);
    calcButton?.addEventListener('click', async () => {
      await loadPricing();
      state.revealed = true;
      state.calcState.date = dateInput?.value || state.calcState.date;
      syncPhase1ToPax();
      showCompact();
      updateRoomStatusPill();
      phase2.classList.add('is-visible');
      phase2Footer.classList.remove('tbv-hidden');
      runCalc();
    });
    paymentButton?.addEventListener('click', () => {
      const payload = state.lastQuote || buildPaymentPayload(null);
      syncPaymentHook(payload);
      emitEvent('travelagent:public-booking-payment-intent', payload);
      openPaymentSheet();
    });

    if (dateInput && !dateInput.value) dateInput.value = state.calcState.date;
    if (isDayTour) {
      const roomRow = root.querySelector('[data-tbv-room-row]');
      if (roomRow) roomRow.style.display = 'none';
      if (roomHint) roomHint.style.display = 'none';
      if (roomStatus) roomStatus.style.display = 'none';
    }
    validateRooms();
    syncPaymentHook(buildPaymentPayload(null));

    root.openBookingView = openView;
    if (root.getAttribute('data-auto-open') === '1') {
      openView();
    }
  }

  async function init() {
    injectStyles();
    const lang = normalizeLang(document.documentElement.lang || navigator.language || 'en');
    const messages = await loadLocaleMessages(lang);
    const t = (key, vars, fallback) => applyVars(getNestedValue(messages, key) ?? fallback ?? getNestedValue(DEFAULT_MESSAGES, key) ?? key, vars);
    const pricingDefinitions = [
      t('public_booking.def_infant'),
      t('public_booking.def_children'),
      t('public_booking.def_teens'),
      t('public_booking.def_note'),
    ].filter(Boolean);
    const drawerHosts = Array.from(document.querySelectorAll('[data-public-booking-host="drawer"]'));
    drawerHosts.forEach((root) => {
      createDrawerElements(root, t, pricingDefinitions);
      initView(root._tbvDrawer, 'drawer', messages);
    });

    const roots = Array.from(document.querySelectorAll(VIEW_SELECTOR));
    roots.forEach((root) => {
      const mode = root.getAttribute('data-mode') || 'inline';
      if (mode !== 'drawer') {
        root.classList.add('tbv-inline');
        root.innerHTML = buildViewMarkup('inline', t, pricingDefinitions);
        initView(root, 'inline', messages);
      }
    });

    document.addEventListener('click', (event) => {
      const trigger = event.target.closest('[data-open-public-booking="1"]');
      if (!trigger) return;
      if (window.matchMedia(DRAWER_BREAKPOINT).matches) return;
      event.preventDefault();
      const drawerRoot = document.querySelector('[data-public-booking-host="drawer"]');
      const drawer = drawerRoot?._tbvDrawer;
      if (drawer && typeof drawer.openBookingView === 'function') {
        drawer.openBookingView();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();