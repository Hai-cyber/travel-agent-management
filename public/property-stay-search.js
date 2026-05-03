(function () {
  'use strict';

  const ROOT_SELECTOR = '[data-public-hotel-search]';

  function formatCurrency(amount, currency) {
    const numeric = Number(amount);
    if (!Number.isFinite(numeric)) return 'On request';
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: currency || 'USD',
        maximumFractionDigits: 0,
      }).format(numeric);
    } catch {
      return `${numeric.toFixed(0)} ${currency || 'USD'}`;
    }
  }

  function addDays(date, days) {
    const next = new Date(date.getTime());
    next.setDate(next.getDate() + days);
    return next;
  }

  function toIsoDate(date) {
    return date.toISOString().slice(0, 10);
  }

  function defaultDates() {
    const today = new Date();
    const checkIn = addDays(today, 7);
    const checkOut = addDays(checkIn, 1);
    return { checkIn: toIsoDate(checkIn), checkOut: toIsoDate(checkOut) };
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderShell(root, hotelKey) {
    const dates = defaultDates();
    root.innerHTML = `
      <section class="rounded-[26px] border border-slate-200 bg-white p-6 shadow-sm">
        <div class="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p class="text-xs uppercase tracking-[0.24em] text-slate-500">Stay Search</p>
            <h2 class="mt-2 text-3xl font-semibold text-slate-950">Check live room options</h2>
            <p class="mt-3 max-w-2xl text-sm leading-6 text-slate-600">This search runs against the current property engine. Availability remains night-based and server-validated.</p>
          </div>
          <div class="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-medium text-slate-600">Hotel key: ${hotelKey}</div>
        </div>
        <form class="mt-6 grid gap-4 md:grid-cols-5" data-hotel-stay-search-form>
          <label class="text-sm font-medium text-slate-700">Check-in<input class="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3" type="date" name="check_in" value="${dates.checkIn}" required></label>
          <label class="text-sm font-medium text-slate-700">Check-out<input class="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3" type="date" name="check_out" value="${dates.checkOut}" required></label>
          <label class="text-sm font-medium text-slate-700">Adults<input class="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3" type="number" min="1" max="20" name="adults" value="2" required></label>
          <label class="text-sm font-medium text-slate-700">Children<input class="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3" type="number" min="0" max="20" name="children" value="0"></label>
          <label class="text-sm font-medium text-slate-700">Rooms<input class="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3" type="number" min="1" max="20" name="rooms_requested" value="1" required></label>
          <div class="md:col-span-5 flex flex-wrap items-center gap-3">
            <button class="rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white" type="submit">Search stays</button>
            <span class="text-sm text-slate-500" data-hotel-stay-search-status></span>
          </div>
        </form>
        <div class="mt-6 hidden rounded-2xl border px-4 py-3 text-sm" data-hotel-stay-search-policy></div>
        <div class="mt-6 grid gap-4" data-hotel-stay-search-results></div>
        <div class="mt-6 hidden rounded-[26px] border border-slate-200 bg-slate-50 p-6" data-hotel-booking-panel></div>
      </section>`;
  }

  function buildBookingPanel(selectedOption, payload) {
    const roomType = selectedOption?.room_type || {};
    const pricing = selectedOption?.pricing || {};
    return `
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p class="text-xs uppercase tracking-[0.24em] text-slate-500">Booking commit</p>
          <h3 class="mt-2 text-2xl font-semibold text-slate-950">Reserve ${escapeHtml(roomType.name || roomType.code || 'selected room')}</h3>
          <p class="mt-2 text-sm leading-6 text-slate-600">The booking request will re-run server availability, create a short soft hold, and then create the canonical property reservation if inventory still fits.</p>
        </div>
        <div class="rounded-2xl bg-slate-950 px-4 py-3 text-right text-white">
          <p class="text-xs uppercase tracking-[0.18em] text-slate-300">Stay total</p>
          <p class="mt-2 text-2xl font-semibold">${escapeHtml(formatCurrency(pricing.total_amount, pricing.currency))}</p>
        </div>
      </div>
      <form class="mt-6 grid gap-4 md:grid-cols-2" data-hotel-booking-form>
        <input type="hidden" name="room_type_id" value="${escapeHtml(roomType.id || '')}">
        <label class="text-sm font-medium text-slate-700">Guest name<input class="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3" type="text" name="guest_name" required></label>
        <label class="text-sm font-medium text-slate-700">Email<input class="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3" type="email" name="guest_email" required></label>
        <label class="text-sm font-medium text-slate-700">Phone<input class="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3" type="text" name="guest_phone" required></label>
        <label class="text-sm font-medium text-slate-700">Expected arrival time<input class="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3" type="time" name="expected_arrival_time"></label>
        <label class="text-sm font-medium text-slate-700 md:col-span-2">Special requests<textarea class="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3" name="special_requests" rows="3"></textarea></label>
        <div class="md:col-span-2 flex flex-wrap items-center gap-3">
          <button class="rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white" type="submit">Reserve this stay</button>
          <span class="text-sm text-slate-500" data-hotel-booking-status></span>
        </div>
      </form>
      <div class="mt-4" data-hotel-booking-feedback></div>`;
  }

  function bindBookingPanel(root, selectedOption, payload) {
    const panel = root.querySelector('[data-hotel-booking-panel]');
    panel.innerHTML = buildBookingPanel(selectedOption, payload);
    panel.classList.remove('hidden');
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const form = panel.querySelector('[data-hotel-booking-form]');
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      submitBooking(root, form);
    });
  }

  function renderResults(root, payload) {
    const results = root.querySelector('[data-hotel-stay-search-results]');
    const policy = root.querySelector('[data-hotel-stay-search-policy]');
    const options = Array.isArray(payload?.room_options) ? payload.room_options : [];
    const policyText = payload?.commercial_policy?.message || '';
    if (policyText) {
      policy.className = `mt-6 rounded-2xl border px-4 py-3 text-sm ${payload?.commercial_policy?.public_booking_enabled ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`;
      policy.textContent = policyText;
      policy.classList.remove('hidden');
    } else {
      policy.classList.add('hidden');
    }

    if (!options.length) {
      results.innerHTML = '<div class="rounded-2xl border border-dashed border-slate-300 p-6 text-sm text-slate-500">No room options were returned for this stay.</div>';
      return;
    }

    results.innerHTML = options.map((option, index) => {
      const roomType = option.room_type || {};
      const pricing = option.pricing || {};
      const shortageDates = Array.isArray(option.availability?.shortage_dates) ? option.availability.shortage_dates : [];
      const availableClass = option.available ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700';
      const availableLabel = option.available ? 'Available for this stay' : 'Not fully available for these dates';
      const meta = [
        roomType.base_capacity ? `Base ${roomType.base_capacity}` : '',
        roomType.max_occupancy ? `Max ${roomType.max_occupancy}` : '',
        pricing.nightly_amount ? `${formatCurrency(pricing.nightly_amount, pricing.currency)}/night` : '',
      ].filter(Boolean).join(' · ');
      return `
        <article class="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
          <div class="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div class="inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${availableClass}">${availableLabel}</div>
              <h3 class="mt-3 text-2xl font-semibold text-slate-950">${roomType.name || roomType.code || 'Room option'}</h3>
              <p class="mt-2 text-sm leading-6 text-slate-600">${roomType.description || 'No room description added yet.'}</p>
              <p class="mt-3 text-xs uppercase tracking-[0.18em] text-slate-500">${meta || 'Live search result'}</p>
            </div>
            <div class="rounded-2xl bg-slate-950 px-4 py-3 text-right text-white">
              <p class="text-xs uppercase tracking-[0.18em] text-slate-300">Stay total</p>
              <p class="mt-2 text-2xl font-semibold">${formatCurrency(pricing.total_amount, pricing.currency)}</p>
            </div>
          </div>
          ${shortageDates.length ? `<p class="mt-4 text-sm text-amber-700">Shortage dates: ${shortageDates.join(', ')}</p>` : ''}
          ${payload?.commercial_policy?.public_booking_enabled && option.available ? `<div class="mt-5 flex flex-wrap gap-3"><button class="rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white" type="button" data-book-room-option="${index}">Reserve now</button><span class="text-sm text-slate-500">Booking commit is available on this verified commercial host.</span></div>` : ''}
        </article>`;
    }).join('');

    results.querySelectorAll('[data-book-room-option]').forEach((button) => {
      button.addEventListener('click', () => {
        const selectedIndex = Number(button.getAttribute('data-book-room-option') || -1);
        const selectedOption = options[selectedIndex] || null;
        if (!selectedOption) return;
        bindBookingPanel(root, selectedOption, payload);
      });
    });
  }

  async function submitBooking(root, form) {
    const hotelKey = root.getAttribute('data-hotel-key') || '';
    const status = root.querySelector('[data-hotel-booking-status]');
    const feedback = root.querySelector('[data-hotel-booking-feedback]');
    const searchRequest = root._staySearchRequest || {};
    const formData = new FormData(form);
    status.textContent = 'Submitting booking...';
    feedback.innerHTML = '';

    try {
      const response = await fetch(`/api/universal/public/hotels/${encodeURIComponent(hotelKey)}/booking-commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          room_type_id: String(formData.get('room_type_id') || ''),
          check_in: searchRequest.check_in,
          check_out: searchRequest.check_out,
          adults: searchRequest.adults,
          children: searchRequest.children,
          rooms_requested: searchRequest.rooms_requested,
          guest_name: String(formData.get('guest_name') || ''),
          guest_email: String(formData.get('guest_email') || ''),
          guest_phone: String(formData.get('guest_phone') || ''),
          expected_arrival_time: String(formData.get('expected_arrival_time') || ''),
          special_requests: String(formData.get('special_requests') || ''),
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || 'Booking failed');
      const reservation = payload.reservation || {};
      feedback.innerHTML = `<div class="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">Reservation <strong>${escapeHtml(reservation.id || 'created')}</strong> is now in status <strong>${escapeHtml(reservation.status || 'confirmed')}</strong>. The shared property engine has already frozen pricing and selected the concrete stay plan on the server.</div>`;
      status.textContent = 'Booking created';
    } catch (error) {
      feedback.innerHTML = `<div class="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">${escapeHtml(String(error.message || error))}</div>`;
      status.textContent = 'Booking failed';
    }
  }

  async function submitSearch(root) {
    const hotelKey = root.getAttribute('data-hotel-key') || '';
    const form = root.querySelector('[data-hotel-stay-search-form]');
    const status = root.querySelector('[data-hotel-stay-search-status]');
    const formData = new FormData(form);
    status.textContent = 'Searching...';

    try {
      const response = await fetch(`/api/universal/public/hotels/${encodeURIComponent(hotelKey)}/stay-search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          check_in: String(formData.get('check_in') || ''),
          check_out: String(formData.get('check_out') || ''),
          adults: Number(formData.get('adults') || 0),
          children: Number(formData.get('children') || 0),
          rooms_requested: Number(formData.get('rooms_requested') || 0),
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || 'Search failed');
      root._staySearchRequest = {
        check_in: String(formData.get('check_in') || ''),
        check_out: String(formData.get('check_out') || ''),
        adults: Number(formData.get('adults') || 0),
        children: Number(formData.get('children') || 0),
        rooms_requested: Number(formData.get('rooms_requested') || 0),
      };
      renderResults(root, payload);
      root.querySelector('[data-hotel-booking-panel]').classList.add('hidden');
      root.querySelector('[data-hotel-booking-panel]').innerHTML = '';
      status.textContent = `${(payload.room_options || []).length} room option(s) checked.`;
    } catch (error) {
      root.querySelector('[data-hotel-stay-search-results]').innerHTML = `<div class="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">${String(error.message || error)}</div>`;
      status.textContent = 'Search failed';
    }
  }

  function boot(root) {
    const hotelKey = root.getAttribute('data-hotel-key') || '';
    if (!hotelKey) return;
    renderShell(root, hotelKey);
    const form = root.querySelector('[data-hotel-stay-search-form]');
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      submitSearch(root);
    });
    submitSearch(root);
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll(ROOT_SELECTOR).forEach((root) => boot(root));
  });
}());
