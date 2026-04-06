(function () {
  'use strict';

  const DEFAULT_MESSAGES = {
    roomShortage: 'Room shortage: {{capacity}} capacity < {{adults}} adults. {{shortage}} traveller{{travellerSuffix}} will be charged at single room rate.',
    extraRooms: '{{surplus}} extra room{{roomSuffix}} booked - sole occupancy supplement will apply.',
    exactAdults: '{{doubles}} double + {{singles}} single = exactly {{capacity}} adults.',
    childCapacityExceeded: 'The chosen rooming capacity cannot accommodate the given number of children. Your current rooming allows up to {{max}} child{{childSuffix}}: 1 per shared double room and 2 per private room. Please increase the room count or contact our staff for a family-room/manual quote.',
    childCapacityFits: '{{children}} child{{childSuffix}} fit within the current rooming rule: 1 per shared double room and 2 per private room.',
    roomStatusShared: '{{count}} shared double{{suffix}}',
    roomStatusPrivate: '{{count}} private room{{suffix}}',
    roomStatusConfirmed: '{{parts}} -> {{adults}} adult{{suffix}} confirmed',
    soleOccupancyHint: 'Note: Single supplement applied for rooms with sole occupancy.',
  };

  let ACTIVE_MESSAGES = { ...DEFAULT_MESSAGES };

  function formatTemplate(template, vars = {}) {
    return String(template || '').replace(/\{\{(\w+)\}\}/g, (_, key) => String(vars[key] ?? ''));
  }

  function text(key, vars = {}) {
    return formatTemplate(ACTIVE_MESSAGES[key] || DEFAULT_MESSAGES[key] || '', vars);
  }

  function setTranslations(messages = {}) {
    ACTIVE_MESSAGES = { ...DEFAULT_MESSAGES, ...(messages || {}) };
  }

  function clampNonNegativeInt(value) {
    const num = Number.parseInt(String(value ?? '').trim(), 10);
    return Number.isFinite(num) && num >= 0 ? num : 0;
  }

  function suggestRooms(adults) {
    const safeAdults = clampNonNegativeInt(adults);
    if (safeAdults < 1) return { doubles: 0, singles: 0 };
    return {
      doubles: Math.floor(safeAdults / 2),
      singles: safeAdults % 2,
    };
  }

  function allocateRooms(adults, doubles, singles) {
    const safeAdults = clampNonNegativeInt(adults);
    const safeDoubles = clampNonNegativeInt(doubles);
    const safeSingles = clampNonNegativeInt(singles);
    const totalRooms = safeDoubles + safeSingles;

    let sharedPax = 0;
    let privatePax = 0;
    if (safeAdults > 0) {
      if (totalRooms >= safeAdults) {
        sharedPax = 0;
        privatePax = safeAdults;
      } else {
        const fullyOccupied = Math.min(safeDoubles, safeAdults - totalRooms);
        sharedPax = fullyOccupied * 2;
        privatePax = safeAdults - sharedPax;
      }
    }

    return {
      adult_shared_room_count: sharedPax,
      adult_single_room_count: privatePax,
    };
  }

  function paxToSentenceInputs(pax) {
    const sharedPax = clampNonNegativeInt(pax?.adult_shared_room_count);
    const privatePax = clampNonNegativeInt(pax?.adult_single_room_count);
    return {
      adults: sharedPax + privatePax,
      doubles: sharedPax / 2,
      singles: privatePax,
      children: clampNonNegativeInt(pax?.child_count),
      infants: clampNonNegativeInt(pax?.infant_count),
    };
  }

  function roomValidation(adults, doubles, singles) {
    const safeAdults = clampNonNegativeInt(adults);
    const safeDoubles = clampNonNegativeInt(doubles);
    const safeSingles = clampNonNegativeInt(singles);
    const capacity = safeDoubles * 2 + safeSingles;

    if (safeAdults === 0) {
      return { type: 'none', message: '' };
    }
    if (capacity < safeAdults) {
      const shortage = safeAdults - capacity;
      return {
        type: 'warn',
        message: text('roomShortage', { capacity, adults: safeAdults, shortage, travellerSuffix: shortage > 1 ? 's' : '' }),
      };
    }
    if (capacity > safeAdults) {
      const surplus = capacity - safeAdults;
      return {
        type: 'info',
        message: text('extraRooms', { surplus, roomSuffix: surplus > 1 ? 's' : '' }),
      };
    }
    return {
      type: 'good',
      message: text('exactAdults', { doubles: safeDoubles, singles: safeSingles, capacity }),
    };
  }

  function childShareValidation(doubles, singles, children) {
    const safeDoubles = clampNonNegativeInt(doubles);
    const safeSingles = clampNonNegativeInt(singles);
    const safeChildren = clampNonNegativeInt(children);
    const maxSharedChildren = safeDoubles + (safeSingles * 2);

    if ((safeDoubles + safeSingles) < 1 || safeChildren === 0) {
      return { type: 'none', message: '', maxSharedChildren };
    }

    if (safeChildren > maxSharedChildren) {
      return {
        type: 'warn',
        maxSharedChildren,
        message: text('childCapacityExceeded', { max: maxSharedChildren, childSuffix: maxSharedChildren === 1 ? '' : 'ren' }),
      };
    }

    return {
      type: 'good',
      maxSharedChildren,
      message: text('childCapacityFits', { children: safeChildren, childSuffix: safeChildren === 1 ? '' : 'ren' }),
    };
  }

  function roomStatus(pax) {
    const sharedPax = clampNonNegativeInt(pax?.adult_shared_room_count);
    const privatePax = clampNonNegativeInt(pax?.adult_single_room_count);
    const adults = sharedPax + privatePax;
    if (adults < 1) return '';

    const doubles = sharedPax / 2;
    const parts = [];
    if (doubles > 0) parts.push(text('roomStatusShared', { count: doubles, suffix: doubles > 1 ? 's' : '' }));
    if (privatePax > 0) parts.push(text('roomStatusPrivate', { count: privatePax, suffix: privatePax > 1 ? 's' : '' }));
    return text('roomStatusConfirmed', { parts: parts.join(' + '), adults, suffix: adults > 1 ? 's' : '' });
  }

  function surplusHint(pax) {
    const sharedPax = clampNonNegativeInt(pax?.adult_shared_room_count);
    const privatePax = clampNonNegativeInt(pax?.adult_single_room_count);
    const adults = sharedPax + privatePax;
    if (adults < 1) return '';

    const doubles = sharedPax / 2;
    const totalRooms = doubles + privatePax;
    const minRooms = Math.ceil(adults / 2);
    if (privatePax > 0 && totalRooms > minRooms) {
      return text('soleOccupancyHint');
    }
    return '';
  }

  function effectivePaxCount(pax) {
    return clampNonNegativeInt(pax?.adult_shared_room_count)
      + clampNonNegativeInt(pax?.adult_single_room_count)
      + clampNonNegativeInt(pax?.child_count);
  }

  function findBasePrice(prices, paxBands, segmentId, pax) {
    const rows = (Array.isArray(prices) ? prices : []).filter((row) => String(row.segment_id) === String(segmentId));
    if (!rows.length) return null;

    const totalPax = effectivePaxCount(pax);
    if (totalPax > 0) {
      const band = [...(Array.isArray(paxBands) ? paxBands : [])]
        .sort((left, right) => Number(left.min_pax || 0) - Number(right.min_pax || 0))
        .find((entry) => totalPax >= Number(entry.min_pax || 0) && totalPax <= Number(entry.max_pax || 0));
      if (band) {
        const match = rows.find((row) => String(row.pax_band_id) === String(band.id));
        if (match) return match;
      }
    }

    return rows[0];
  }

  function computeLocalTotal(paxTypes, pax, priceRow) {
    return (Array.isArray(paxTypes) ? paxTypes : []).reduce((sum, paxType) => {
      return sum + clampNonNegativeInt(pax?.[paxType.key]) * Number(priceRow?.[paxType.priceField] || 0);
    }, 0);
  }

  window.TAMBookingViewCore = {
    clampNonNegativeInt,
    suggestRooms,
    allocateRooms,
    paxToSentenceInputs,
    roomValidation,
    childShareValidation,
    roomStatus,
    surplusHint,
    setTranslations,
    effectivePaxCount,
    findBasePrice,
    computeLocalTotal,
  };
})();