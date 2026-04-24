import { currentUnixSeconds, enumerateStayDates, parseDateUtc } from './date-utils.js';
import { PROPERTY_WEEKDAY_NAMES } from './constants.js';
import {
  mapPropertyPricingProfileRow,
  mapPropertyWeekdayPricingRuleRow,
  mapRateSeasonRow,
  mapRoomRateRow,
  mapSeasonRateRow,
  parseJsonSafe,
} from './mappers.js';

function resolveNightlyRateForDate(stayDate, activeSeasons, seasonRatesByKey, baseRate) {
  const matchingSeason = activeSeasons.find((season) => stayDate >= season.start_date && stayDate <= season.end_date);
  if (matchingSeason) {
    const seasonRate = seasonRatesByKey.get(`${matchingSeason.id}`);
    if (seasonRate?.active) {
      return {
        source: 'season_rate',
        season_id: matchingSeason.id,
        season_name: matchingSeason.name,
        currency: seasonRate.currency,
        nightly_amount: Number(seasonRate.nightly_amount),
        included_adults: Number(seasonRate.included_adults ?? 2),
        included_children: Number(seasonRate.included_children ?? 0),
        extra_adult_amount: Number(seasonRate.extra_adult_amount ?? 0),
        extra_child_amount: Number(seasonRate.extra_child_amount ?? 0),
      };
    }
  }
  if (baseRate?.active) {
    return {
      source: 'base_rate',
      season_id: null,
      season_name: null,
      currency: baseRate.currency,
      nightly_amount: Number(baseRate.nightly_amount),
      included_adults: Number(baseRate.included_adults ?? 2),
      included_children: Number(baseRate.included_children ?? 0),
      extra_adult_amount: Number(baseRate.extra_adult_amount ?? 0),
      extra_child_amount: Number(baseRate.extra_child_amount ?? 0),
    };
  }
  return null;
}

function weekdayIndexForIsoDate(stayDate) {
  return parseDateUtc(stayDate).getUTCDay();
}

function selectApplicablePropertyWeekdayPricingRule(weekdayRules, roomTypeId, stayDate) {
  const dayOfWeek = weekdayIndexForIsoDate(stayDate);
  const normalizedRoomTypeId = String(roomTypeId || '').trim();
  const exactRule = (weekdayRules || []).find((rule) => Number(rule.day_of_week) === dayOfWeek && String(rule.room_type_id || '').trim() === normalizedRoomTypeId);
  if (exactRule) return exactRule;
  return (weekdayRules || []).find((rule) => Number(rule.day_of_week) === dayOfWeek && !rule.room_type_id) || null;
}

function applyPropertyWeekdayPricingRuleToResolvedRate(resolvedRate, weekdayRule, stayDate) {
  if (!resolvedRate || !weekdayRule || !weekdayRule.active) return resolvedRate;

  const baseNightlyAmount = Number(resolvedRate.nightly_amount || 0);
  let adjustedNightlyAmount = baseNightlyAmount;
  let adjustmentPercent = null;

  if (weekdayRule.pricing_mode === 'fixed_nightly_amount') {
    adjustedNightlyAmount = Number(weekdayRule.fixed_nightly_amount || 0);
  } else if (weekdayRule.pricing_mode === 'delta_amount') {
    adjustedNightlyAmount = baseNightlyAmount + Number(weekdayRule.delta_amount || 0);
  } else if (weekdayRule.pricing_mode === 'delta_percent') {
    adjustmentPercent = Number(weekdayRule.delta_percent || 0);
    adjustedNightlyAmount = baseNightlyAmount * (1 + (adjustmentPercent / 100));
  }

  adjustedNightlyAmount = Number(Math.max(0, adjustedNightlyAmount).toFixed(2));
  const adjustmentAmount = Number((adjustedNightlyAmount - baseNightlyAmount).toFixed(2));
  const dayOfWeek = weekdayIndexForIsoDate(stayDate);

  return {
    ...resolvedRate,
    nightly_amount: adjustedNightlyAmount,
    weekday_pricing_rule_applied: true,
    weekday_pricing_rule_id: weekdayRule.id,
    weekday_pricing_rule_name: weekdayRule.name,
    weekday_pricing_rule_day_of_week: dayOfWeek,
    weekday_pricing_rule_day_name: PROPERTY_WEEKDAY_NAMES[dayOfWeek] || `Day ${dayOfWeek}`,
    weekday_pricing_rule_mode: weekdayRule.pricing_mode,
    weekday_pricing_rule_scope: weekdayRule.scope,
    weekday_pricing_rule_room_type_id: weekdayRule.room_type_id || null,
    weekday_pricing_rule_adjustment_amount: adjustmentAmount,
    weekday_pricing_rule_adjustment_percent: adjustmentPercent,
  };
}

function applyPropertyPricingProfileToResolvedRate(resolvedRate, pricingProfile) {
  if (!resolvedRate || !pricingProfile || !pricingProfile.active) return resolvedRate;

  const baseNightlyAmount = Number(resolvedRate.nightly_amount || 0);
  let adjustedNightlyAmount = baseNightlyAmount;
  let adjustmentPercent = null;

  if (pricingProfile.pricing_mode === 'fixed_nightly_amount') {
    adjustedNightlyAmount = Number(pricingProfile.fixed_nightly_amount || 0);
  } else if (pricingProfile.pricing_mode === 'delta_amount') {
    adjustedNightlyAmount = baseNightlyAmount + Number(pricingProfile.delta_amount || 0);
  } else if (pricingProfile.pricing_mode === 'delta_percent') {
    adjustmentPercent = Number(pricingProfile.delta_percent || 0);
    adjustedNightlyAmount = baseNightlyAmount * (1 + (adjustmentPercent / 100));
  }

  adjustedNightlyAmount = Number(Math.max(0, adjustedNightlyAmount).toFixed(2));
  const adjustmentAmount = Number((adjustedNightlyAmount - baseNightlyAmount).toFixed(2));

  return {
    ...resolvedRate,
    nightly_amount: adjustedNightlyAmount,
    pricing_profile_applied: true,
    pricing_profile_id: pricingProfile.id,
    pricing_profile_code: pricingProfile.code,
    pricing_profile_name: pricingProfile.name,
    pricing_profile_visibility: pricingProfile.visibility,
    pricing_profile_mode: pricingProfile.pricing_mode,
    pricing_profile_scope: pricingProfile.scope,
    pricing_profile_room_type_id: pricingProfile.room_type_id || null,
    pricing_profile_adjustment_amount: adjustmentAmount,
    pricing_profile_adjustment_percent: adjustmentPercent,
  };
}

function calculateOccupancyAdjustment(resolvedRate, adults, children, roomsRequested = 1) {
  if (!resolvedRate) {
    return {
      included_adults_total: 0,
      included_children_total: 0,
      extra_adults: 0,
      extra_children: 0,
      extra_adult_amount: 0,
      extra_child_amount: 0,
      adjustment_amount: 0,
    };
  }

  const includedAdultsTotal = Number(resolvedRate.included_adults || 0) * Number(roomsRequested || 1);
  const includedChildrenTotal = Number(resolvedRate.included_children || 0) * Number(roomsRequested || 1);
  const extraAdults = Math.max(0, Number(adults || 0) - includedAdultsTotal);
  const extraChildren = Math.max(0, Number(children || 0) - includedChildrenTotal);
  const extraAdultAmount = Number(resolvedRate.extra_adult_amount || 0);
  const extraChildAmount = Number(resolvedRate.extra_child_amount || 0);
  const adjustmentAmount = extraAdults * extraAdultAmount + extraChildren * extraChildAmount;

  return {
    included_adults_total: includedAdultsTotal,
    included_children_total: includedChildrenTotal,
    extra_adults: extraAdults,
    extra_children: extraChildren,
    extra_adult_amount: extraAdultAmount,
    extra_child_amount: extraChildAmount,
    adjustment_amount: adjustmentAmount,
  };
}

function calculatePerRoomOccupancyAdjustments(resolvedRate, roomGuestAssignments) {
  if (!resolvedRate || !Array.isArray(roomGuestAssignments) || !roomGuestAssignments.length) return null;
  return roomGuestAssignments.map((assignment) => {
    const adjustment = calculateOccupancyAdjustment(resolvedRate, assignment.adults, assignment.children, 1);
    return {
      room_index: assignment.room_index,
      label: assignment.label,
      adults: assignment.adults,
      children: assignment.children,
      nightly_base_total: Number(resolvedRate.nightly_amount),
      occupancy_adjustment: adjustment,
      nightly_total: Number(resolvedRate.nightly_amount) + Number(adjustment.adjustment_amount || 0),
    };
  });
}

function parseReservationPricingSnapshotValue(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  return parseJsonSafe(value);
}

function extractPricingProfileIdFromPricingSnapshot(value) {
  const snapshot = parseReservationPricingSnapshotValue(value);
  const pricingProfileId = snapshot?.pricing_profile_id ?? snapshot?.pricing_profile?.id ?? null;
  return pricingProfileId ? String(pricingProfileId).trim() : null;
}

function mapPricingProfileQuoteSummary(pricingProfile) {
  if (!pricingProfile) return null;
  return {
    id: pricingProfile.id,
    code: pricingProfile.code,
    name: pricingProfile.name,
    room_type_id: pricingProfile.room_type_id,
    pricing_mode: pricingProfile.pricing_mode,
    fixed_nightly_amount: pricingProfile.fixed_nightly_amount,
    delta_amount: pricingProfile.delta_amount,
    delta_percent: pricingProfile.delta_percent,
  };
}

function applyPreviewScarcityPricing(nightlyBreakdown, nightlyRemainingByType, scarcityPreview, currency) {
  const normalized = Array.isArray(nightlyBreakdown) ? nightlyBreakdown.map((row) => ({ ...row })) : [];
  const config = scarcityPreview && scarcityPreview.enabled
    ? {
        enabled: true,
        threshold_remaining: Number(scarcityPreview.thresholdRemaining || 0),
        surcharge_amount: Number(scarcityPreview.surchargeAmount || 0),
        max_total_amount: Number(scarcityPreview.maxTotalAmount || 0),
      }
    : {
        enabled: false,
        threshold_remaining: Number(scarcityPreview?.thresholdRemaining || 0),
        surcharge_amount: Number(scarcityPreview?.surchargeAmount || 0),
        max_total_amount: Number(scarcityPreview?.maxTotalAmount || 0),
      };

  if (!config.enabled || config.surcharge_amount <= 0 || config.max_total_amount <= 0) {
    return {
      nightlyBreakdown: normalized.map((row) => ({
        ...row,
        scarcity_adjustment: null,
      })),
      scarcityPreview: {
        ...config,
        total_surcharge_amount: 0,
        triggered_nights: 0,
        applied: false,
        currency,
      },
    };
  }

  let remainingCap = config.max_total_amount;
  let totalSurchargeAmount = 0;
  let triggeredNights = 0;

  const scarcityNightly = normalized.map((row) => {
    const components = Array.isArray(row.room_type_components) ? row.room_type_components : [];
    const triggeredComponents = components.map((component) => {
      const nightlyRows = nightlyRemainingByType?.get(String(component.room_type_id || '')) || [];
      const nightlyRow = nightlyRows.find((candidate) => String(candidate.stay_date || '') === String(row.stay_date || '')) || null;
      const remainingAfterSelectedPlan = nightlyRow
        ? Math.max(Number(nightlyRow.remaining || 0) - Number(component.rooms_requested || 0), 0)
        : null;
      if (remainingAfterSelectedPlan === null || remainingAfterSelectedPlan >= config.threshold_remaining) return null;
      return {
        room_type_id: component.room_type_id,
        room_type_code: component.room_type_code || null,
        room_type_name: component.room_type_name || null,
        remaining_after_selected_plan: remainingAfterSelectedPlan,
        threshold_remaining: config.threshold_remaining,
      };
    }).filter(Boolean);

    if (!triggeredComponents.length || remainingCap <= 0 || !Number.isFinite(Number(row.nightly_total))) {
      return {
        ...row,
        scarcity_adjustment: null,
      };
    }

    const appliedAmount = Number(Math.min(config.surcharge_amount, remainingCap).toFixed(2));
    remainingCap = Number(Math.max(0, remainingCap - appliedAmount).toFixed(2));
    totalSurchargeAmount = Number((totalSurchargeAmount + appliedAmount).toFixed(2));
    triggeredNights += 1;

    return {
      ...row,
      nightly_total: Number((Number(row.nightly_total || 0) + appliedAmount).toFixed(2)),
      scarcity_adjustment: {
        applied_amount: appliedAmount,
        currency: row.currency || currency,
        triggered_components: triggeredComponents,
        threshold_remaining: config.threshold_remaining,
      },
    };
  });

  return {
    nightlyBreakdown: scarcityNightly,
    scarcityPreview: {
      ...config,
      total_surcharge_amount: totalSurchargeAmount,
      triggered_nights: triggeredNights,
      applied: totalSurchargeAmount > 0,
      currency,
    },
  };
}

async function buildSelectedPlanPricingPreview(env, tenantId, propertyId, requestInput, selectedPlan, options = {}, deps) {
  if (!selectedPlan?.segments?.length) return { pricing: null };

  const property = await deps.loadPropertyById(env, tenantId, propertyId);
  if (!property) return { error: { status: 404, payload: { error: 'Property not found.' } } };

  const pricingProfileId = options.pricingProfileId ? String(options.pricingProfileId).trim() : null;
  const pricingProfile = pricingProfileId
    ? await deps.loadPropertyPricingProfileById(env, tenantId, propertyId, pricingProfileId)
    : null;
  if (pricingProfileId) {
    if (!pricingProfile) return { error: { status: 404, payload: { error: 'Pricing profile not found.' } } };
    if (!pricingProfile.active) return { error: { status: 409, payload: { error: 'Pricing profile is inactive.' } } };
  }

  const activeSeasonsResult = await env.DB
    .prepare(
      `SELECT id, tenant_id, property_id, name, start_date, end_date, sort_order, active, created_at, updated_at
         FROM property_rate_seasons
        WHERE tenant_id = ? AND property_id = ? AND active = 1
        ORDER BY sort_order ASC, start_date ASC, created_at ASC`
    )
    .bind(tenantId, propertyId)
    .all();
  const activeSeasons = (activeSeasonsResult.results || []).map(mapRateSeasonRow);

  const roomTypeIds = Array.from(new Set((selectedPlan.segments || []).map((segment) => String(segment.room_type_id || '').trim()).filter(Boolean)));
  const roomTypeContexts = new Map();

  await Promise.all(roomTypeIds.map(async (roomTypeId) => {
    const [roomType, baseRateRow, seasonRatesResult, weekdayRulesResult] = await Promise.all([
      deps.loadRoomTypeById(env, tenantId, propertyId, roomTypeId),
      env.DB.prepare(
        `SELECT id, tenant_id, property_id, room_type_id, rate_name, currency, nightly_amount,
                included_adults, included_children, extra_adult_amount, extra_child_amount,
                active, created_at, updated_at
           FROM property_room_rates
          WHERE tenant_id = ? AND property_id = ? AND room_type_id = ? AND active = 1
          ORDER BY updated_at DESC, created_at DESC
          LIMIT 1`
      ).bind(tenantId, propertyId, roomTypeId).first(),
      env.DB.prepare(
        `SELECT id, tenant_id, property_id, season_id, room_type_id, currency, nightly_amount,
                included_adults, included_children, extra_adult_amount, extra_child_amount,
                active, created_at, updated_at
           FROM property_room_rate_season_prices
          WHERE tenant_id = ? AND property_id = ? AND room_type_id = ? AND active = 1`
      ).bind(tenantId, propertyId, roomTypeId).all(),
      env.DB.prepare(
        `SELECT pwr.id, pwr.tenant_id, pwr.property_id, pwr.room_type_id, pwr.day_of_week, pwr.name,
                pwr.pricing_mode, pwr.fixed_nightly_amount, pwr.delta_amount, pwr.delta_percent,
                pwr.notes, pwr.active, pwr.created_by, pwr.updated_by, pwr.created_at, pwr.updated_at,
                rt.code AS room_type_code, rt.name AS room_type_name
           FROM property_weekday_pricing_rules pwr
           LEFT JOIN room_types rt ON rt.id = pwr.room_type_id AND rt.tenant_id = pwr.tenant_id AND rt.property_id = pwr.property_id
          WHERE pwr.tenant_id = ?
            AND pwr.property_id = ?
            AND pwr.active = 1
            AND (pwr.room_type_id IS NULL OR pwr.room_type_id = ?)
          ORDER BY CASE WHEN pwr.room_type_id = ? THEN 0 ELSE 1 END ASC, pwr.day_of_week ASC, pwr.created_at ASC`
      ).bind(tenantId, propertyId, roomTypeId, roomTypeId).all(),
    ]);

    roomTypeContexts.set(roomTypeId, {
      roomType,
      baseRate: baseRateRow ? mapRoomRateRow(baseRateRow) : null,
      seasonRatesByKey: new Map((seasonRatesResult.results || []).map((row) => [String(row.season_id), mapSeasonRateRow(row)])),
      weekdayRules: (weekdayRulesResult.results || []).map(mapPropertyWeekdayPricingRuleRow),
    });
  }));

  const stayDates = enumerateStayDates(requestInput.checkIn, requestInput.checkOut);
  const nightlyBreakdown = stayDates.map((stayDate) => {
    const segmentsForNight = (selectedPlan.segments || []).filter((segment) => segment.check_in <= stayDate && segment.check_out > stayDate);
    if (!segmentsForNight.length) {
      return {
        stay_date: stayDate,
        source: 'missing_plan_segment',
        currency: property.currency,
        nightly_amount: null,
        nightly_total: null,
        room_type_components: [],
        occupancy_adjustment: null,
      };
    }

    const roomsByType = new Map();
    for (const segment of segmentsForNight) {
      const roomTypeId = String(segment.room_type_id || '').trim();
      roomsByType.set(roomTypeId, (roomsByType.get(roomTypeId) || 0) + 1);
    }

    const roomTypeComponents = Array.from(roomsByType.entries()).map(([roomTypeId, roomsRequestedForType]) => {
      const context = roomTypeContexts.get(roomTypeId);
      const resolved = context
        ? resolveNightlyRateForDate(stayDate, activeSeasons, context.seasonRatesByKey, context.baseRate)
        : null;
      const weekdayAdjusted = context
        ? applyPropertyWeekdayPricingRuleToResolvedRate(resolved, selectApplicablePropertyWeekdayPricingRule(context.weekdayRules, roomTypeId, stayDate), stayDate)
        : null;
      const applicableProfile = pricingProfile && (!pricingProfile.room_type_id || String(pricingProfile.room_type_id) === roomTypeId)
        ? pricingProfile
        : null;
      const quotedRate = applyPropertyPricingProfileToResolvedRate(weekdayAdjusted, applicableProfile);
      return {
        room_type_id: roomTypeId,
        room_type_code: context?.roomType?.code || null,
        room_type_name: context?.roomType?.name || null,
        rooms_requested: roomsRequestedForType,
        source: quotedRate?.source || 'missing_rate',
        season_name: quotedRate?.season_name || null,
        currency: quotedRate?.currency || property.currency,
        nightly_amount: quotedRate ? Number(quotedRate.nightly_amount) : null,
        nightly_total: quotedRate ? Number(quotedRate.nightly_amount) * roomsRequestedForType : null,
        weekday_adjustment: quotedRate?.weekday_pricing_rule_applied
          ? {
              id: quotedRate.weekday_pricing_rule_id,
              name: quotedRate.weekday_pricing_rule_name,
              day_name: quotedRate.weekday_pricing_rule_day_name,
              pricing_mode: quotedRate.weekday_pricing_rule_mode,
              adjustment_amount: quotedRate.weekday_pricing_rule_adjustment_amount,
              adjustment_percent: quotedRate.weekday_pricing_rule_adjustment_percent,
            }
          : null,
        pricing_profile: quotedRate?.pricing_profile_applied ? mapPricingProfileQuoteSummary(applicableProfile) : null,
        included_adults: quotedRate ? Number(quotedRate.included_adults) : null,
        included_children: quotedRate ? Number(quotedRate.included_children) : null,
        extra_adult_amount: quotedRate ? Number(quotedRate.extra_adult_amount || 0) : null,
        extra_child_amount: quotedRate ? Number(quotedRate.extra_child_amount || 0) : null,
      };
    });

    const priceableComponents = roomTypeComponents.filter((component) => Number.isFinite(Number(component.nightly_amount)));
    const nightlyBaseTotal = priceableComponents.reduce((sum, component) => sum + Number(component.nightly_total || 0), 0);
    const occupancyBasis = roomTypeComponents.length === 1 ? roomTypeComponents[0] : null;
    const occupancyAdjustment = occupancyBasis && Number.isFinite(Number(occupancyBasis.nightly_amount))
      ? calculateOccupancyAdjustment(
          {
            included_adults: occupancyBasis.included_adults,
            included_children: occupancyBasis.included_children,
            extra_adult_amount: occupancyBasis.extra_adult_amount,
            extra_child_amount: occupancyBasis.extra_child_amount,
          },
          requestInput.adults,
          requestInput.children,
          Number(occupancyBasis.rooms_requested || 1),
        )
      : null;

    return {
      stay_date: stayDate,
      currency: roomTypeComponents.find((component) => component.currency)?.currency || property.currency,
      source: roomTypeComponents.length === 1 ? roomTypeComponents[0].source : 'selected_plan_mix',
      season_name: roomTypeComponents.length === 1 ? roomTypeComponents[0].season_name : null,
      room_type_id: roomTypeComponents.length === 1 ? roomTypeComponents[0].room_type_id : null,
      room_type_code: roomTypeComponents.length === 1 ? roomTypeComponents[0].room_type_code : null,
      room_type_name: roomTypeComponents.length === 1 ? roomTypeComponents[0].room_type_name : null,
      rooms_requested: segmentsForNight.length,
      nightly_amount: roomTypeComponents.length === 1 ? roomTypeComponents[0].nightly_amount : null,
      nightly_base_total: nightlyBaseTotal,
      occupancy_adjustment: occupancyAdjustment,
      nightly_total: Number(nightlyBaseTotal + Number(occupancyAdjustment?.adjustment_amount || 0)),
      room_type_components: roomTypeComponents,
      pricing_profile: roomTypeComponents.length === 1 ? roomTypeComponents[0].pricing_profile : null,
      weekday_adjustment: roomTypeComponents.length === 1 ? roomTypeComponents[0].weekday_adjustment : null,
    };
  });

  const scarcityPreviewApplied = applyPreviewScarcityPricing(
    nightlyBreakdown,
    options.nightlyRemainingByType || null,
    options.scarcityPreview || null,
    nightlyBreakdown.find((row) => row.currency)?.currency || property.currency,
  );
  const scarcityNightlyBreakdown = scarcityPreviewApplied.nightlyBreakdown;
  const missingDates = scarcityNightlyBreakdown.filter((row) => !Number.isFinite(Number(row.nightly_total))).map((row) => row.stay_date);
  const totalBaseAmount = scarcityNightlyBreakdown.reduce((sum, row) => sum + (Number(row.nightly_base_total) || 0), 0);
  const totalOccupancyAdjustment = scarcityNightlyBreakdown.reduce((sum, row) => sum + (Number(row.occupancy_adjustment?.adjustment_amount) || 0), 0);
  const totalAmount = scarcityNightlyBreakdown.reduce((sum, row) => sum + (Number(row.nightly_total) || 0), 0);

  return {
    pricing: {
      currency: scarcityNightlyBreakdown.find((row) => row.currency)?.currency || property.currency,
      pricing_profile: mapPricingProfileQuoteSummary(pricingProfile),
      nightly_breakdown: scarcityNightlyBreakdown,
      missing_rate_dates: missingDates,
      total_base_amount: totalBaseAmount,
      total_occupancy_adjustment: totalOccupancyAdjustment,
      total_amount: totalAmount,
      selected_plan_type: selectedPlan.plan_type || null,
      scarcity_preview: scarcityPreviewApplied.scarcityPreview,
    },
  };
}

async function resolvePropertyRateQuote(env, tenantId, propertyId, parsed, deps) {
  const property = await deps.loadPropertyById(env, tenantId, propertyId);
  if (!property) return { error: { payload: { error: 'Property not found.' }, status: 404 } };

  const roomType = await deps.loadRoomTypeById(env, tenantId, propertyId, parsed.roomTypeId);
  if (!roomType) return { error: { payload: { error: 'Room type not found.' }, status: 404 } };

  const totalGuests = Number(parsed.adults || 0) + Number(parsed.children || 0);
  const maxGuests = Number(roomType.max_occupancy || 0) * Number(parsed.roomsRequested || 1);
  if (maxGuests > 0 && totalGuests > maxGuests) {
    return {
      error: {
        payload: { error: `Guest mix exceeds the configured max occupancy for ${parsed.roomsRequested} room(s).` },
        status: 409,
      },
    };
  }

  const [baseRateRow, seasonsResult, seasonRatesResult, weekdayRulesResult, pricingProfile] = await Promise.all([
    env.DB.prepare(
      `SELECT id, tenant_id, property_id, room_type_id, rate_name, currency, nightly_amount,
              included_adults, included_children, extra_adult_amount, extra_child_amount,
              active, created_at, updated_at
         FROM property_room_rates
        WHERE tenant_id = ? AND property_id = ? AND room_type_id = ? AND active = 1
        ORDER BY updated_at DESC, created_at DESC
        LIMIT 1`
    ).bind(tenantId, propertyId, parsed.roomTypeId).first(),
    env.DB.prepare(
      `SELECT id, tenant_id, property_id, name, start_date, end_date, sort_order, active, created_at, updated_at
         FROM property_rate_seasons
        WHERE tenant_id = ? AND property_id = ? AND active = 1
        ORDER BY sort_order ASC, start_date ASC, created_at ASC`
    ).bind(tenantId, propertyId).all(),
    env.DB.prepare(
      `SELECT id, tenant_id, property_id, season_id, room_type_id, currency, nightly_amount,
              included_adults, included_children, extra_adult_amount, extra_child_amount,
              active, created_at, updated_at
         FROM property_room_rate_season_prices
        WHERE tenant_id = ? AND property_id = ? AND room_type_id = ? AND active = 1`
    ).bind(tenantId, propertyId, parsed.roomTypeId).all(),
    env.DB.prepare(
      `SELECT pwr.id, pwr.tenant_id, pwr.property_id, pwr.room_type_id, pwr.day_of_week, pwr.name,
              pwr.pricing_mode, pwr.fixed_nightly_amount, pwr.delta_amount, pwr.delta_percent,
              pwr.notes, pwr.active, pwr.created_by, pwr.updated_by, pwr.created_at, pwr.updated_at,
              rt.code AS room_type_code, rt.name AS room_type_name
         FROM property_weekday_pricing_rules pwr
         LEFT JOIN room_types rt ON rt.id = pwr.room_type_id AND rt.tenant_id = pwr.tenant_id AND rt.property_id = pwr.property_id
        WHERE pwr.tenant_id = ?
          AND pwr.property_id = ?
          AND pwr.active = 1
          AND (pwr.room_type_id IS NULL OR pwr.room_type_id = ?)
        ORDER BY CASE WHEN pwr.room_type_id = ? THEN 0 ELSE 1 END ASC, pwr.day_of_week ASC, pwr.created_at ASC`
    ).bind(tenantId, propertyId, parsed.roomTypeId, parsed.roomTypeId).all(),
    parsed.pricingProfileId
      ? deps.loadPropertyPricingProfileById(env, tenantId, propertyId, parsed.pricingProfileId)
      : Promise.resolve(null),
  ]);

  if (parsed.pricingProfileId) {
    if (!pricingProfile) return { error: { payload: { error: 'Pricing profile not found.' }, status: 404 } };
    if (!pricingProfile.active) return { error: { payload: { error: 'Pricing profile is inactive.' }, status: 409 } };
    if (pricingProfile.room_type_id && String(pricingProfile.room_type_id) !== parsed.roomTypeId) {
      return {
        error: {
          payload: { error: 'Pricing profile does not apply to the selected room type.' },
          status: 409,
        },
      };
    }
  }

  const stayDates = enumerateStayDates(parsed.checkIn, parsed.checkOut);
  const activeSeasons = (seasonsResult.results || []).map(mapRateSeasonRow);
  const seasonRatesByKey = new Map((seasonRatesResult.results || []).map((row) => [String(row.season_id), mapSeasonRateRow(row)]));
  const weekdayRules = (weekdayRulesResult.results || []).map(mapPropertyWeekdayPricingRuleRow);
  const baseRate = baseRateRow ? mapRoomRateRow(baseRateRow) : null;

  const nightlyBreakdown = stayDates.map((stayDate) => {
    const resolved = resolveNightlyRateForDate(stayDate, activeSeasons, seasonRatesByKey, baseRate);
    const weekdayRule = selectApplicablePropertyWeekdayPricingRule(weekdayRules, parsed.roomTypeId, stayDate);
    const weekdayAdjustedRate = applyPropertyWeekdayPricingRuleToResolvedRate(resolved, weekdayRule, stayDate);
    const quotedRate = applyPropertyPricingProfileToResolvedRate(weekdayAdjustedRate, pricingProfile);
    const perRoomAssignments = calculatePerRoomOccupancyAdjustments(quotedRate, parsed.roomGuestAssignments);
    const occupancyAdjustment = perRoomAssignments
      ? {
          included_adults_total: perRoomAssignments.reduce((sum, item) => sum + Number(item.occupancy_adjustment.included_adults_total || 0), 0),
          included_children_total: perRoomAssignments.reduce((sum, item) => sum + Number(item.occupancy_adjustment.included_children_total || 0), 0),
          extra_adults: perRoomAssignments.reduce((sum, item) => sum + Number(item.occupancy_adjustment.extra_adults || 0), 0),
          extra_children: perRoomAssignments.reduce((sum, item) => sum + Number(item.occupancy_adjustment.extra_children || 0), 0),
          extra_adult_amount: Number(quotedRate?.extra_adult_amount || 0),
          extra_child_amount: Number(quotedRate?.extra_child_amount || 0),
          adjustment_amount: perRoomAssignments.reduce((sum, item) => sum + Number(item.occupancy_adjustment.adjustment_amount || 0), 0),
        }
      : calculateOccupancyAdjustment(quotedRate, parsed.adults, parsed.children, parsed.roomsRequested);
    const nightlyBaseTotal = perRoomAssignments
      ? perRoomAssignments.reduce((sum, item) => sum + Number(item.nightly_base_total || 0), 0)
      : (quotedRate ? Number(quotedRate.nightly_amount) * parsed.roomsRequested : null);
    return {
      stay_date: stayDate,
      source: quotedRate?.source || 'missing_rate',
      season_id: quotedRate?.season_id || null,
      season_name: quotedRate?.season_name || null,
      currency: quotedRate?.currency || baseRate?.currency || property.currency,
      base_nightly_amount: resolved ? Number(resolved.nightly_amount) : null,
      weekday_nightly_amount: weekdayAdjustedRate ? Number(weekdayAdjustedRate.nightly_amount) : null,
      nightly_amount: quotedRate ? Number(quotedRate.nightly_amount) : null,
      rooms_requested: parsed.roomsRequested,
      nightly_base_total: nightlyBaseTotal,
      included_adults: quotedRate ? Number(quotedRate.included_adults) : null,
      included_children: quotedRate ? Number(quotedRate.included_children) : null,
      room_guest_assignments: perRoomAssignments,
      weekday_adjustment: quotedRate?.weekday_pricing_rule_applied
        ? {
            id: quotedRate.weekday_pricing_rule_id,
            name: quotedRate.weekday_pricing_rule_name,
            day_of_week: quotedRate.weekday_pricing_rule_day_of_week,
            day_name: quotedRate.weekday_pricing_rule_day_name,
            pricing_mode: quotedRate.weekday_pricing_rule_mode,
            adjustment_amount: quotedRate.weekday_pricing_rule_adjustment_amount,
            adjustment_percent: quotedRate.weekday_pricing_rule_adjustment_percent,
          }
        : null,
      pricing_profile: quotedRate?.pricing_profile_applied
        ? {
            id: quotedRate.pricing_profile_id,
            code: quotedRate.pricing_profile_code,
            name: quotedRate.pricing_profile_name,
            pricing_mode: quotedRate.pricing_profile_mode,
            adjustment_amount: quotedRate.pricing_profile_adjustment_amount,
            adjustment_percent: quotedRate.pricing_profile_adjustment_percent,
          }
        : null,
      occupancy_adjustment: quotedRate ? occupancyAdjustment : null,
      nightly_total: quotedRate ? nightlyBaseTotal + Number(occupancyAdjustment.adjustment_amount || 0) : null,
    };
  });

  const missingDates = nightlyBreakdown.filter((row) => row.nightly_amount === null).map((row) => row.stay_date);
  const totalBaseAmount = nightlyBreakdown.reduce((sum, row) => sum + (Number(row.nightly_base_total) || 0), 0);
  const totalOccupancyAdjustment = nightlyBreakdown.reduce((sum, row) => sum + (Number(row.occupancy_adjustment?.adjustment_amount) || 0), 0);
  const totalAmount = nightlyBreakdown.reduce((sum, row) => sum + (Number(row.nightly_total) || 0), 0);
  const currency = nightlyBreakdown.find((row) => row.currency)?.currency || property.currency;

  return {
    pricingProfile,
    nightlyBreakdown,
    missingDates,
    totalBaseAmount,
    totalOccupancyAdjustment,
    totalAmount,
    currency,
    sourceSummary: {
      has_base_rate: Boolean(baseRate),
      active_seasons: activeSeasons.length,
      active_season_rates: seasonRatesByKey.size,
      weekday_rules_loaded: weekdayRules.length,
      weekday_pricing_applied: nightlyBreakdown.some((row) => row.weekday_adjustment),
      pricing_profile_applied: Boolean(pricingProfile),
    },
  };
}

function buildResolvedRateQuotePayload(propertyId, parsed, quote) {
  return {
    ok: true,
    property_id: propertyId,
    room_type_id: parsed.roomTypeId,
    request: {
      check_in: parsed.checkIn,
      check_out: parsed.checkOut,
      adults: parsed.adults,
      children: parsed.children,
      rooms_requested: parsed.roomsRequested,
      room_guest_assignments: parsed.roomGuestAssignments,
      pricing_profile_id: parsed.pricingProfileId,
    },
    pricing: {
      currency: quote.currency,
      pricing_profile: mapPricingProfileQuoteSummary(quote.pricingProfile),
      nightly_breakdown: quote.nightlyBreakdown,
      missing_rate_dates: quote.missingDates,
      total_base_amount: quote.totalBaseAmount,
      total_occupancy_adjustment: quote.totalOccupancyAdjustment,
      total_amount: quote.totalAmount,
      source_summary: quote.sourceSummary,
    },
  };
}

function buildReservationPricingSnapshot(quote, reservationInput, frozenAt, fallbackSnapshot = null) {
  const parsedFallback = fallbackSnapshot && typeof fallbackSnapshot === 'object' ? { ...fallbackSnapshot } : {};
  const nightlyTotals = quote.nightlyBreakdown
    .map((row) => Number(row.nightly_total))
    .filter((amount) => Number.isFinite(amount));
  const averageNightlyAmount = nightlyTotals.length
    ? Number((nightlyTotals.reduce((sum, amount) => sum + amount, 0) / nightlyTotals.length).toFixed(2))
    : null;
  const fallbackTotalAmount = Number.isFinite(Number(parsedFallback.total_amount))
    ? Number(parsedFallback.total_amount)
    : (Number.isFinite(Number(parsedFallback.total)) ? Number(parsedFallback.total) : null);
  const pricingProfileSummary = mapPricingProfileQuoteSummary(quote.pricingProfile) || parsedFallback.pricing_profile || null;
  const pricingProfileId = quote.pricingProfile?.id
    || parsedFallback.pricing_profile_id
    || parsedFallback.pricing_profile?.id
    || null;
  const snapshotBase = {
    ...parsedFallback,
    version: 'reservation_pricing_snapshot_v1',
    frozen_at: frozenAt,
    check_in: reservationInput.checkIn,
    check_out: reservationInput.checkOut,
    room_type_id: reservationInput.roomTypeId,
    adults: reservationInput.adults,
    children: reservationInput.children,
    rooms_requested: reservationInput.roomsRequested,
    request: {
      check_in: reservationInput.checkIn,
      check_out: reservationInput.checkOut,
      adults: reservationInput.adults,
      children: reservationInput.children,
      rooms_requested: reservationInput.roomsRequested,
      pricing_profile_id: reservationInput.pricingProfileId || null,
    },
    pricing_profile_id: pricingProfileId ? String(pricingProfileId) : null,
    pricing_profile: pricingProfileSummary,
    source_summary: quote.sourceSummary,
    missing_rate_dates: quote.missingDates,
  };

  if (quote.missingDates.length) {
    return {
      ...snapshotBase,
      snapshot_capture_status: 'legacy_fallback',
      currency: parsedFallback.currency || quote.currency || null,
      total: fallbackTotalAmount,
      total_amount: fallbackTotalAmount,
      nightly_amount: Number.isFinite(Number(parsedFallback.nightly_amount))
        ? Number(parsedFallback.nightly_amount)
        : averageNightlyAmount,
      nightly_breakdown: Array.isArray(parsedFallback.nightly_breakdown) ? parsedFallback.nightly_breakdown : [],
    };
  }

  return {
    ...snapshotBase,
    snapshot_capture_status: 'frozen_quote',
    currency: quote.currency,
    total: quote.totalAmount,
    total_amount: quote.totalAmount,
    total_base_amount: quote.totalBaseAmount,
    total_occupancy_adjustment: quote.totalOccupancyAdjustment,
    nightly_amount: averageNightlyAmount,
    nightly_breakdown: quote.nightlyBreakdown,
  };
}

async function resolveFrozenReservationPricingSnapshot(env, tenantId, propertyId, reservationInput, options = {}, deps) {
  const quoteResolver = deps?.resolvePropertyRateQuote || resolvePropertyRateQuote;
  const quote = await quoteResolver(env, tenantId, propertyId, {
    roomTypeId: reservationInput.roomTypeId,
    checkIn: reservationInput.checkIn,
    checkOut: reservationInput.checkOut,
    adults: reservationInput.adults,
    children: reservationInput.children,
    roomsRequested: reservationInput.roomsRequested,
    roomGuestAssignments: reservationInput.roomGuestAssignments || null,
    pricingProfileId: reservationInput.pricingProfileId || null,
  }, deps);
  if (quote.error) return { error: quote.error };

  return {
    snapshot: buildReservationPricingSnapshot(
      quote,
      reservationInput,
      Number(options.frozenAt || currentUnixSeconds()),
      parseReservationPricingSnapshotValue(options.fallbackSnapshot || null),
    ),
  };
}

function resolveSnapshotNightlyRate(snapshotValue, stayDate) {
  const snapshot = parseReservationPricingSnapshotValue(snapshotValue);
  if (!snapshot || typeof snapshot !== 'object') return null;
  const nightly = Array.isArray(snapshot.nightly_breakdown)
    ? snapshot.nightly_breakdown.find((row) => String(row?.stay_date || '') === String(stayDate || '').trim())
    : null;
  if (!nightly) return null;

  const unitAmount = Number(nightly.nightly_amount);
  const totalAmount = Number(nightly.nightly_total);
  if (!Number.isFinite(unitAmount) || !Number.isFinite(totalAmount)) return null;

  return {
    currency: nightly.currency || snapshot.currency || null,
    unit_amount: unitAmount,
    total_amount: totalAmount,
    adjustment_amount: Number(nightly.occupancy_adjustment?.adjustment_amount || 0),
    source: nightly.source || null,
    season_name: nightly.season_name || null,
  };
}

export {
  applyPreviewScarcityPricing,
  applyPropertyPricingProfileToResolvedRate,
  applyPropertyWeekdayPricingRuleToResolvedRate,
  buildResolvedRateQuotePayload,
  buildReservationPricingSnapshot,
  buildSelectedPlanPricingPreview,
  calculateOccupancyAdjustment,
  calculatePerRoomOccupancyAdjustments,
  extractPricingProfileIdFromPricingSnapshot,
  mapPricingProfileQuoteSummary,
  parseReservationPricingSnapshotValue,
  resolveFrozenReservationPricingSnapshot,
  resolveNightlyRateForDate,
  resolvePropertyRateQuote,
  resolveSnapshotNightlyRate,
  selectApplicablePropertyWeekdayPricingRule,
  weekdayIndexForIsoDate,
};