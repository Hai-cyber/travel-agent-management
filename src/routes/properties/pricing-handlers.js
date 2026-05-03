import { nanoid } from 'nanoid';

import { currentUnixSeconds, parseDateUtc } from './date-utils.js';

function createPricingHandlers(deps) {
  const {
    DEFAULT_PROPERTY_ADDON_PRESETS,
    buildDynamicUpdateSql,
    jsonResponse,
    loadAddonServicePresetById,
    loadPropertyById,
    loadPropertyPricingProfileById,
    loadPropertyWeekdayPricingRuleById,
    loadRateSeasonById,
    loadRoomRateById,
    loadRoomTypeById,
    loadSeasonRoomRateById,
    mapAddonServicePresetRow,
    mapBuilderSqlError,
    mapPropertyPricingProfileRow,
    mapPropertyWeekdayPricingRuleRow,
    mapRateSeasonRow,
    mapRoomRateRow,
    mapSeasonRateRow,
    parseJsonBody,
    pricingBuildResolvedRateQuotePayload,
    pricingDeps,
    pricingResolvePropertyRateQuote,
    requireManagerActor,
    requireTenantActor,
    resolveTenantId,
    serializeAddonConfigJson,
    validateAddonServicePresetCreateRequest,
    validateAddonServicePresetPatchRequest,
    validatePropertyPricingProfileConfiguration,
    validatePropertyPricingProfileCreateRequest,
    validatePropertyPricingProfilePatchRequest,
    validatePropertyWeekdayPricingRuleCreateRequest,
    validatePropertyWeekdayPricingRulePatchRequest,
    validateRateQuoteRequest,
    validateRateSeasonCreateRequest,
    validateRateSeasonPatchRequest,
    validateRoomRateCreateRequest,
    validateRoomRatePatchRequest,
    validateSeasonRoomRateCreateRequest,
    validateSeasonRoomRatePatchRequest,
  } = deps;

  async function handleListPropertyPricingProfiles(request, env, params) {
    const tenantId = resolveTenantId(request);
    if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
    const propertyId = String(params?.propertyId || '').trim();

    const actor = await requireManagerActor(request, env, tenantId);
    if (actor.error) return actor.error;

    try {
      const property = await loadPropertyById(env, tenantId, propertyId);
      if (!property) return jsonResponse({ error: 'Property not found.' }, 404);

      const result = await env.DB
        .prepare(
          `SELECT ppp.id, ppp.tenant_id, ppp.property_id, ppp.room_type_id, ppp.code, ppp.name,
              ppp.visibility, ppp.pricing_mode, ppp.roh_capacity_filter, ppp.fixed_nightly_amount, ppp.delta_amount, ppp.delta_percent,
                  ppp.notes, ppp.active, ppp.created_by, ppp.updated_by, ppp.created_at, ppp.updated_at,
                  rt.code AS room_type_code, rt.name AS room_type_name
             FROM property_pricing_profiles ppp
             LEFT JOIN room_types rt ON rt.id = ppp.room_type_id AND rt.tenant_id = ppp.tenant_id AND rt.property_id = ppp.property_id
            WHERE ppp.tenant_id = ? AND ppp.property_id = ?
            ORDER BY ppp.active DESC, ppp.created_at DESC`
        )
        .bind(tenantId, propertyId)
        .all();

      return jsonResponse({ ok: true, pricing_profiles: (result.results || []).map(mapPropertyPricingProfileRow) });
    } catch (error) {
      console.error('[PROPERTY_PRICING_PROFILE_LIST]', error);
      return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
    }
  }

  async function handleCreatePropertyPricingProfile(request, env, params) {
    const tenantId = resolveTenantId(request);
    if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
    const propertyId = String(params?.propertyId || '').trim();

    const actor = await requireManagerActor(request, env, tenantId);
    if (actor.error) return actor.error;

    let body;
    try { body = await parseJsonBody(request); } catch { return jsonResponse({ error: 'Request body is not valid JSON.' }, 400); }
    const parsed = validatePropertyPricingProfileCreateRequest(body, propertyId);
    if (parsed.error) return jsonResponse({ error: parsed.error }, 400);

    try {
      const property = await loadPropertyById(env, tenantId, propertyId);
      if (!property) return jsonResponse({ error: 'Property not found.' }, 404);
      if (parsed.roomTypeId) {
        const roomType = await loadRoomTypeById(env, tenantId, propertyId, parsed.roomTypeId);
        if (!roomType) return jsonResponse({ error: 'Room type not found.' }, 404);
      }

      const id = nanoid();
      const now = currentUnixSeconds();
      const actorId = actor.session.user_id || null;
      await env.DB
        .prepare(
          `INSERT INTO property_pricing_profiles
            (id, tenant_id, property_id, room_type_id, code, name, visibility, pricing_mode,
             roh_capacity_filter, fixed_nightly_amount, delta_amount, delta_percent, notes, active, created_by, updated_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          id,
          tenantId,
          propertyId,
          parsed.roomTypeId,
          parsed.code,
          parsed.name,
          parsed.visibility,
          parsed.pricingMode,
          parsed.rohCapacityFilter,
          parsed.fixedNightlyAmount,
          parsed.deltaAmount,
          parsed.deltaPercent,
          parsed.notes,
          parsed.active,
          actorId,
          actorId,
          now,
          now
        )
        .run();

      return jsonResponse({ ok: true, pricing_profile: await loadPropertyPricingProfileById(env, tenantId, propertyId, id) }, 201);
    } catch (error) {
      const mapped = mapBuilderSqlError(error);
      if (mapped) return jsonResponse(mapped.payload, mapped.status);
      console.error('[PROPERTY_PRICING_PROFILE_CREATE]', error);
      return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
    }
  }

  async function handleUpdatePropertyPricingProfile(request, env, params) {
    const tenantId = resolveTenantId(request);
    if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
    const propertyId = String(params?.propertyId || '').trim();
    const pricingProfileId = String(params?.pricingProfileId || '').trim();

    const actor = await requireManagerActor(request, env, tenantId);
    if (actor.error) return actor.error;

    let body;
    try { body = await parseJsonBody(request); } catch { return jsonResponse({ error: 'Request body is not valid JSON.' }, 400); }
    const parsed = validatePropertyPricingProfilePatchRequest(body);
    if (parsed.error) return jsonResponse({ error: parsed.error }, 400);

    try {
      const existing = await loadPropertyPricingProfileById(env, tenantId, propertyId, pricingProfileId);
      if (!existing) return jsonResponse({ error: 'Pricing profile not found.' }, 404);

      const nextRoomTypeId = Object.prototype.hasOwnProperty.call(parsed.updates, 'room_type_id')
        ? parsed.updates.room_type_id
        : existing.room_type_id;
      if (nextRoomTypeId) {
        const roomType = await loadRoomTypeById(env, tenantId, propertyId, nextRoomTypeId);
        if (!roomType) return jsonResponse({ error: 'Room type not found.' }, 404);
      }

      const normalizedConfig = validatePropertyPricingProfileConfiguration(
        parsed.updates.pricing_mode || existing.pricing_mode,
        {
          fixedNightlyAmount: Object.prototype.hasOwnProperty.call(parsed.updates, 'fixed_nightly_amount')
            ? parsed.updates.fixed_nightly_amount
            : existing.fixed_nightly_amount,
          deltaAmount: Object.prototype.hasOwnProperty.call(parsed.updates, 'delta_amount')
            ? parsed.updates.delta_amount
            : existing.delta_amount,
          deltaPercent: Object.prototype.hasOwnProperty.call(parsed.updates, 'delta_percent')
            ? parsed.updates.delta_percent
            : existing.delta_percent,
        }
      );
      if (normalizedConfig.error) return jsonResponse({ error: normalizedConfig.error }, 400);

      const updates = {
        ...parsed.updates,
        roh_capacity_filter: nextRoomTypeId
          ? null
          : (Object.prototype.hasOwnProperty.call(parsed.updates, 'roh_capacity_filter')
            ? parsed.updates.roh_capacity_filter
            : existing.roh_capacity_filter),
        fixed_nightly_amount: normalizedConfig.fixedNightlyAmount,
        delta_amount: normalizedConfig.deltaAmount,
        delta_percent: normalizedConfig.deltaPercent,
        updated_by: actor.session.user_id || null,
      };
      const now = currentUnixSeconds();
      const { sql, values } = buildDynamicUpdateSql('property_pricing_profiles', updates);
      await env.DB
        .prepare(`${sql} WHERE id = ? AND tenant_id = ? AND property_id = ?`)
        .bind(...values, now, pricingProfileId, tenantId, propertyId)
        .run();
      return jsonResponse({ ok: true, pricing_profile: await loadPropertyPricingProfileById(env, tenantId, propertyId, pricingProfileId) });
    } catch (error) {
      const mapped = mapBuilderSqlError(error);
      if (mapped) return jsonResponse(mapped.payload, mapped.status);
      console.error('[PROPERTY_PRICING_PROFILE_UPDATE]', error);
      return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
    }
  }

  async function handleListPropertyWeekdayPricingRules(request, env, params) {
    const tenantId = resolveTenantId(request);
    if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
    const propertyId = String(params?.propertyId || '').trim();

    const actor = await requireManagerActor(request, env, tenantId);
    if (actor.error) return actor.error;

    try {
      const property = await loadPropertyById(env, tenantId, propertyId);
      if (!property) return jsonResponse({ error: 'Property not found.' }, 404);

      const result = await env.DB
        .prepare(
          `SELECT pwr.id, pwr.tenant_id, pwr.property_id, pwr.room_type_id, pwr.day_of_week, pwr.name,
                  pwr.pricing_mode, pwr.fixed_nightly_amount, pwr.delta_amount, pwr.delta_percent,
                  pwr.notes, pwr.active, pwr.created_by, pwr.updated_by, pwr.created_at, pwr.updated_at,
                  rt.code AS room_type_code, rt.name AS room_type_name
             FROM property_weekday_pricing_rules pwr
             LEFT JOIN room_types rt ON rt.id = pwr.room_type_id AND rt.tenant_id = pwr.tenant_id AND rt.property_id = pwr.property_id
            WHERE pwr.tenant_id = ? AND pwr.property_id = ?
            ORDER BY pwr.active DESC, pwr.day_of_week ASC, CASE WHEN pwr.room_type_id IS NULL THEN 1 ELSE 0 END ASC, pwr.created_at DESC`
        )
        .bind(tenantId, propertyId)
        .all();

      return jsonResponse({ ok: true, weekday_pricing_rules: (result.results || []).map(mapPropertyWeekdayPricingRuleRow) });
    } catch (error) {
      console.error('[PROPERTY_WEEKDAY_PRICING_RULE_LIST]', error);
      return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
    }
  }

  async function handleCreatePropertyWeekdayPricingRule(request, env, params) {
    const tenantId = resolveTenantId(request);
    if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
    const propertyId = String(params?.propertyId || '').trim();

    const actor = await requireManagerActor(request, env, tenantId);
    if (actor.error) return actor.error;

    let body;
    try { body = await parseJsonBody(request); } catch { return jsonResponse({ error: 'Request body is not valid JSON.' }, 400); }
    const parsed = validatePropertyWeekdayPricingRuleCreateRequest(body, propertyId);
    if (parsed.error) return jsonResponse({ error: parsed.error }, 400);

    try {
      const property = await loadPropertyById(env, tenantId, propertyId);
      if (!property) return jsonResponse({ error: 'Property not found.' }, 404);
      if (parsed.roomTypeId) {
        const roomType = await loadRoomTypeById(env, tenantId, propertyId, parsed.roomTypeId);
        if (!roomType) return jsonResponse({ error: 'Room type not found.' }, 404);
      }

      const id = nanoid();
      const now = currentUnixSeconds();
      const actorId = actor.session.user_id || null;
      await env.DB
        .prepare(
          `INSERT INTO property_weekday_pricing_rules
            (id, tenant_id, property_id, room_type_id, day_of_week, name, pricing_mode,
             fixed_nightly_amount, delta_amount, delta_percent, notes, active, created_by, updated_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          id,
          tenantId,
          propertyId,
          parsed.roomTypeId,
          parsed.dayOfWeek,
          parsed.name,
          parsed.pricingMode,
          parsed.fixedNightlyAmount,
          parsed.deltaAmount,
          parsed.deltaPercent,
          parsed.notes,
          parsed.active,
          actorId,
          actorId,
          now,
          now
        )
        .run();

      return jsonResponse({ ok: true, weekday_pricing_rule: await loadPropertyWeekdayPricingRuleById(env, tenantId, propertyId, id) }, 201);
    } catch (error) {
      const mapped = mapBuilderSqlError(error);
      if (mapped) return jsonResponse(mapped.payload, mapped.status);
      console.error('[PROPERTY_WEEKDAY_PRICING_RULE_CREATE]', error);
      return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
    }
  }

  async function handleUpdatePropertyWeekdayPricingRule(request, env, params) {
    const tenantId = resolveTenantId(request);
    if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
    const propertyId = String(params?.propertyId || '').trim();
    const weekdayPricingRuleId = String(params?.weekdayPricingRuleId || '').trim();

    const actor = await requireManagerActor(request, env, tenantId);
    if (actor.error) return actor.error;

    let body;
    try { body = await parseJsonBody(request); } catch { return jsonResponse({ error: 'Request body is not valid JSON.' }, 400); }
    const parsed = validatePropertyWeekdayPricingRulePatchRequest(body);
    if (parsed.error) return jsonResponse({ error: parsed.error }, 400);

    try {
      const existing = await loadPropertyWeekdayPricingRuleById(env, tenantId, propertyId, weekdayPricingRuleId);
      if (!existing) return jsonResponse({ error: 'Weekday pricing rule not found.' }, 404);

      const nextRoomTypeId = Object.prototype.hasOwnProperty.call(parsed.updates, 'room_type_id')
        ? parsed.updates.room_type_id
        : existing.room_type_id;
      if (nextRoomTypeId) {
        const roomType = await loadRoomTypeById(env, tenantId, propertyId, nextRoomTypeId);
        if (!roomType) return jsonResponse({ error: 'Room type not found.' }, 404);
      }

      const normalizedConfig = validatePropertyPricingProfileConfiguration(
        parsed.updates.pricing_mode || existing.pricing_mode,
        {
          fixedNightlyAmount: Object.prototype.hasOwnProperty.call(parsed.updates, 'fixed_nightly_amount')
            ? parsed.updates.fixed_nightly_amount
            : existing.fixed_nightly_amount,
          deltaAmount: Object.prototype.hasOwnProperty.call(parsed.updates, 'delta_amount')
            ? parsed.updates.delta_amount
            : existing.delta_amount,
          deltaPercent: Object.prototype.hasOwnProperty.call(parsed.updates, 'delta_percent')
            ? parsed.updates.delta_percent
            : existing.delta_percent,
        }
      );
      if (normalizedConfig.error) return jsonResponse({ error: normalizedConfig.error }, 400);

      const updates = {
        ...parsed.updates,
        fixed_nightly_amount: normalizedConfig.fixedNightlyAmount,
        delta_amount: normalizedConfig.deltaAmount,
        delta_percent: normalizedConfig.deltaPercent,
        updated_by: actor.session.user_id || null,
      };
      const now = currentUnixSeconds();
      const { sql, values } = buildDynamicUpdateSql('property_weekday_pricing_rules', updates);
      await env.DB
        .prepare(`${sql} WHERE id = ? AND tenant_id = ? AND property_id = ?`)
        .bind(...values, now, weekdayPricingRuleId, tenantId, propertyId)
        .run();
      return jsonResponse({ ok: true, weekday_pricing_rule: await loadPropertyWeekdayPricingRuleById(env, tenantId, propertyId, weekdayPricingRuleId) });
    } catch (error) {
      const mapped = mapBuilderSqlError(error);
      if (mapped) return jsonResponse(mapped.payload, mapped.status);
      console.error('[PROPERTY_WEEKDAY_PRICING_RULE_UPDATE]', error);
      return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
    }
  }

  async function handleListRoomRates(request, env, params) {
    const tenantId = resolveTenantId(request);
    if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
    const propertyId = String(params?.propertyId || '').trim();

    const actor = await requireManagerActor(request, env, tenantId);
    if (actor.error) return actor.error;

    try {
      const property = await loadPropertyById(env, tenantId, propertyId);
      if (!property) return jsonResponse({ error: 'Property not found.' }, 404);

      const result = await env.DB
        .prepare(
        `SELECT prr.id, prr.tenant_id, prr.property_id, prr.room_type_id, prr.rate_name, prr.currency, prr.nightly_amount,
          prr.included_adults, prr.included_children, prr.extra_adult_amount, prr.extra_child_amount,
          prr.active, prr.created_at, prr.updated_at,
                  rt.code AS room_type_code, rt.name AS room_type_name
             FROM property_room_rates prr
             LEFT JOIN room_types rt ON rt.id = prr.room_type_id AND rt.tenant_id = prr.tenant_id AND rt.property_id = prr.property_id
            WHERE prr.tenant_id = ? AND prr.property_id = ?
            ORDER BY prr.created_at DESC`
        )
        .bind(tenantId, propertyId)
        .all();

      return jsonResponse({ ok: true, room_rates: (result.results || []).map(mapRoomRateRow) });
    } catch (error) {
      console.error('[ROOM_RATE_LIST]', error);
      return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
    }
  }

  async function handleListPropertyAddonServicePresets(request, env, params) {
    const tenantId = resolveTenantId(request);
    if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
    const propertyId = String(params?.propertyId || '').trim();

    const actor = await requireManagerActor(request, env, tenantId);
    if (actor.error) return actor.error;

    try {
      const property = await loadPropertyById(env, tenantId, propertyId);
      if (!property) return jsonResponse({ error: 'Property not found.' }, 404);

      const result = await env.DB
        .prepare(
          `SELECT id, tenant_id, property_id, code, name, service_type, pricing_mode, currency,
                  default_unit_price, default_unit_label, scope, early_arrival_fee, late_checkout_fee,
                  active, sort_order, notes, config_json,
                  created_at, updated_at
             FROM property_addon_service_presets
            WHERE tenant_id = ? AND property_id = ?
            ORDER BY sort_order ASC, created_at DESC`
        )
        .bind(tenantId, propertyId)
        .all();

      return jsonResponse({ ok: true, addon_service_presets: (result.results || []).map(mapAddonServicePresetRow) });
    } catch (error) {
      console.error('[PROPERTY_ADDON_PRESET_LIST]', error);
      return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
    }
  }

  async function handleCreatePropertyAddonServicePreset(request, env, params) {
    const tenantId = resolveTenantId(request);
    if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
    const propertyId = String(params?.propertyId || '').trim();

    const actor = await requireManagerActor(request, env, tenantId);
    if (actor.error) return actor.error;

    let body;
    try { body = await parseJsonBody(request); } catch { return jsonResponse({ error: 'Request body is not valid JSON.' }, 400); }
    const parsed = validateAddonServicePresetCreateRequest(body);
    if (parsed.error) return jsonResponse({ error: parsed.error }, 400);

    try {
      const property = await loadPropertyById(env, tenantId, propertyId);
      if (!property) return jsonResponse({ error: 'Property not found.' }, 404);
      const id = nanoid();
      const now = currentUnixSeconds();
      await env.DB
        .prepare(
          `INSERT INTO property_addon_service_presets
            (id, tenant_id, property_id, code, name, service_type, pricing_mode, currency,
             default_unit_price, default_unit_label, scope, early_arrival_fee, late_checkout_fee,
             active, sort_order, notes, config_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          id,
          tenantId,
          propertyId,
          parsed.code,
          parsed.name,
          parsed.serviceType,
          parsed.pricingMode,
          parsed.currency,
          parsed.defaultUnitPrice,
          parsed.defaultUnitLabel,
          parsed.scope,
          parsed.earlyArrivalFee,
          parsed.lateCheckoutFee,
          parsed.active,
          parsed.sortOrder,
          parsed.notes,
          serializeAddonConfigJson(parsed.serviceType, parsed.code, parsed.name, parsed.rawConfig),
          now,
          now
        )
        .run();

      return jsonResponse({ ok: true, addon_service_preset: await loadAddonServicePresetById(env, tenantId, propertyId, id) }, 201);
    } catch (error) {
      const mapped = mapBuilderSqlError(error);
      if (mapped) return jsonResponse(mapped.payload, mapped.status);
      console.error('[PROPERTY_ADDON_PRESET_CREATE]', error);
      return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
    }
  }

  async function handleSeedPropertyAddonServicePresets(request, env, params) {
    const tenantId = resolveTenantId(request);
    if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
    const propertyId = String(params?.propertyId || '').trim();

    const actor = await requireManagerActor(request, env, tenantId);
    if (actor.error) return actor.error;

    let body = {};
    try { body = await parseJsonBody(request); } catch {}
    const presetKeys = Array.isArray(body?.preset_keys) && body.preset_keys.length
      ? body.preset_keys.map((key) => String(key).trim())
      : Object.keys(DEFAULT_PROPERTY_ADDON_PRESETS);

    try {
      const property = await loadPropertyById(env, tenantId, propertyId);
      if (!property) return jsonResponse({ error: 'Property not found.' }, 404);
      const now = currentUnixSeconds();
      const created = [];
      for (let index = 0; index < presetKeys.length; index += 1) {
        const preset = DEFAULT_PROPERTY_ADDON_PRESETS[presetKeys[index]];
        if (!preset) continue;

        const existing = await env.DB
          .prepare(`SELECT id FROM property_addon_service_presets WHERE tenant_id = ? AND property_id = ? AND code = ?`)
          .bind(tenantId, propertyId, preset.code)
          .first();
        if (existing?.id) continue;

        const presetId = nanoid();
        await env.DB
          .prepare(
            `INSERT INTO property_addon_service_presets
              (id, tenant_id, property_id, code, name, service_type, pricing_mode, currency,
               default_unit_price, default_unit_label, scope, early_arrival_fee, late_checkout_fee,
               active, sort_order, notes, config_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`
          )
          .bind(
            presetId,
            tenantId,
            propertyId,
            preset.code,
            preset.name,
            preset.service_type,
            preset.pricing_mode,
            preset.currency,
            preset.default_unit_price,
            preset.default_unit_label,
            preset.scope,
            Number(preset.early_arrival_fee || 0),
            Number(preset.late_checkout_fee || 0),
            index * 10,
            preset.notes || null,
            serializeAddonConfigJson(preset.service_type, preset.code, preset.name, null),
            now,
            now
          )
          .run();
        created.push(await loadAddonServicePresetById(env, tenantId, propertyId, presetId));
      }

      return jsonResponse({ ok: true, created_count: created.length, addon_service_presets: created }, 201);
    } catch (error) {
      const mapped = mapBuilderSqlError(error);
      if (mapped) return jsonResponse(mapped.payload, mapped.status);
      console.error('[PROPERTY_ADDON_PRESET_SEED]', error);
      return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
    }
  }

  async function handleUpdatePropertyAddonServicePreset(request, env, params) {
    const tenantId = resolveTenantId(request);
    if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
    const propertyId = String(params?.propertyId || '').trim();
    const presetId = String(params?.presetId || '').trim();

    const actor = await requireManagerActor(request, env, tenantId);
    if (actor.error) return actor.error;

    let body;
    try { body = await parseJsonBody(request); } catch { return jsonResponse({ error: 'Request body is not valid JSON.' }, 400); }
    const parsed = validateAddonServicePresetPatchRequest(body);
    if (parsed.error) return jsonResponse({ error: parsed.error }, 400);

    try {
      const existing = await loadAddonServicePresetById(env, tenantId, propertyId, presetId);
      if (!existing) return jsonResponse({ error: 'Addon service preset not found.' }, 404);
      const now = currentUnixSeconds();
      const effectiveCode = parsed.updates.code ?? existing.code;
      const effectiveName = parsed.updates.name ?? existing.name;
      const effectiveServiceType = parsed.updates.service_type ?? existing.service_type;
      const effectiveConfig = 'config_json' in parsed.updates ? parsed.updates.config_json : existing.config_json;
      parsed.updates.config_json = serializeAddonConfigJson(effectiveServiceType, effectiveCode, effectiveName, effectiveConfig);
      const { sql, values } = buildDynamicUpdateSql('property_addon_service_presets', parsed.updates);
      await env.DB.prepare(`${sql} WHERE id = ? AND tenant_id = ? AND property_id = ?`).bind(...values, now, presetId, tenantId, propertyId).run();
      return jsonResponse({ ok: true, addon_service_preset: await loadAddonServicePresetById(env, tenantId, propertyId, presetId) });
    } catch (error) {
      const mapped = mapBuilderSqlError(error);
      if (mapped) return jsonResponse(mapped.payload, mapped.status);
      console.error('[PROPERTY_ADDON_PRESET_UPDATE]', error);
      return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
    }
  }

  async function handleCreateRoomRate(request, env, params) {
    const tenantId = resolveTenantId(request);
    if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
    const propertyId = String(params?.propertyId || '').trim();

    const actor = await requireManagerActor(request, env, tenantId);
    if (actor.error) return actor.error;

    let body;
    try { body = await parseJsonBody(request); } catch { return jsonResponse({ error: 'Request body is not valid JSON.' }, 400); }
    const parsed = validateRoomRateCreateRequest(body);
    if (parsed.error) return jsonResponse({ error: parsed.error }, 400);

    try {
      const roomType = await loadRoomTypeById(env, tenantId, propertyId, parsed.roomTypeId);
      if (!roomType) return jsonResponse({ error: 'Room type not found.' }, 404);
      const id = nanoid();
      const now = currentUnixSeconds();
      await env.DB
        .prepare(
          `INSERT INTO property_room_rates
            (id, tenant_id, property_id, room_type_id, rate_name, currency, nightly_amount,
             included_adults, included_children, extra_adult_amount, extra_child_amount,
             active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          id,
          tenantId,
          propertyId,
          parsed.roomTypeId,
          parsed.rateName,
          parsed.currency,
          parsed.nightlyAmount,
          parsed.includedAdults,
          parsed.includedChildren,
          parsed.extraAdultAmount,
          parsed.extraChildAmount,
          parsed.active,
          now,
          now
        )
        .run();

      return jsonResponse({ ok: true, room_rate: await loadRoomRateById(env, tenantId, propertyId, id) }, 201);
    } catch (error) {
      const mapped = mapBuilderSqlError(error);
      if (mapped) return jsonResponse(mapped.payload, mapped.status);
      console.error('[ROOM_RATE_CREATE]', error);
      return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
    }
  }

  async function handleUpdateRoomRate(request, env, params) {
    const tenantId = resolveTenantId(request);
    if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
    const propertyId = String(params?.propertyId || '').trim();
    const roomRateId = String(params?.roomRateId || '').trim();

    const actor = await requireManagerActor(request, env, tenantId);
    if (actor.error) return actor.error;

    let body;
    try { body = await parseJsonBody(request); } catch { return jsonResponse({ error: 'Request body is not valid JSON.' }, 400); }
    const parsed = validateRoomRatePatchRequest(body);
    if (parsed.error) return jsonResponse({ error: parsed.error }, 400);

    try {
      const existing = await loadRoomRateById(env, tenantId, propertyId, roomRateId);
      if (!existing) return jsonResponse({ error: 'Room rate not found.' }, 404);
      const now = currentUnixSeconds();
      const { sql, values } = buildDynamicUpdateSql('property_room_rates', parsed.updates);
      await env.DB.prepare(`${sql} WHERE id = ? AND tenant_id = ? AND property_id = ?`).bind(...values, now, roomRateId, tenantId, propertyId).run();
      return jsonResponse({ ok: true, room_rate: await loadRoomRateById(env, tenantId, propertyId, roomRateId) });
    } catch (error) {
      const mapped = mapBuilderSqlError(error);
      if (mapped) return jsonResponse(mapped.payload, mapped.status);
      console.error('[ROOM_RATE_UPDATE]', error);
      return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
    }
  }

  async function handleListRateSeasons(request, env, params) {
    const tenantId = resolveTenantId(request);
    if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
    const propertyId = String(params?.propertyId || '').trim();
    const actor = await requireManagerActor(request, env, tenantId);
    if (actor.error) return actor.error;

    try {
      const property = await loadPropertyById(env, tenantId, propertyId);
      if (!property) return jsonResponse({ error: 'Property not found.' }, 404);
      const result = await env.DB
        .prepare(
          `SELECT id, tenant_id, property_id, name, start_date, end_date, sort_order, active, created_at, updated_at
             FROM property_rate_seasons
            WHERE tenant_id = ? AND property_id = ?
            ORDER BY sort_order ASC, start_date ASC, created_at ASC`
        )
        .bind(tenantId, propertyId)
        .all();
      return jsonResponse({ ok: true, rate_seasons: (result.results || []).map(mapRateSeasonRow) });
    } catch (error) {
      console.error('[RATE_SEASON_LIST]', error);
      return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
    }
  }

  async function handleCreateRateSeason(request, env, params) {
    const tenantId = resolveTenantId(request);
    if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
    const propertyId = String(params?.propertyId || '').trim();
    const actor = await requireManagerActor(request, env, tenantId);
    if (actor.error) return actor.error;

    let body;
    try { body = await parseJsonBody(request); } catch { return jsonResponse({ error: 'Request body is not valid JSON.' }, 400); }
    const parsed = validateRateSeasonCreateRequest(body);
    if (parsed.error) return jsonResponse({ error: parsed.error }, 400);

    try {
      const property = await loadPropertyById(env, tenantId, propertyId);
      if (!property) return jsonResponse({ error: 'Property not found.' }, 404);
      const id = nanoid();
      const now = currentUnixSeconds();
      await env.DB
        .prepare(
          `INSERT INTO property_rate_seasons
            (id, tenant_id, property_id, name, start_date, end_date, sort_order, active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(id, tenantId, propertyId, parsed.name, parsed.startDate, parsed.endDate, parsed.sortOrder, parsed.active, now, now)
        .run();
      return jsonResponse({ ok: true, rate_season: await loadRateSeasonById(env, tenantId, propertyId, id) }, 201);
    } catch (error) {
      const mapped = mapBuilderSqlError(error);
      if (mapped) return jsonResponse(mapped.payload, mapped.status);
      console.error('[RATE_SEASON_CREATE]', error);
      return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
    }
  }

  async function handleUpdateRateSeason(request, env, params) {
    const tenantId = resolveTenantId(request);
    if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
    const propertyId = String(params?.propertyId || '').trim();
    const seasonId = String(params?.seasonId || '').trim();
    const actor = await requireManagerActor(request, env, tenantId);
    if (actor.error) return actor.error;

    let body;
    try { body = await parseJsonBody(request); } catch { return jsonResponse({ error: 'Request body is not valid JSON.' }, 400); }
    const parsed = validateRateSeasonPatchRequest(body);
    if (parsed.error) return jsonResponse({ error: parsed.error }, 400);

    try {
      const existing = await loadRateSeasonById(env, tenantId, propertyId, seasonId);
      if (!existing) return jsonResponse({ error: 'Rate season not found.' }, 404);
      const nextStart = parsed.updates.start_date || existing.start_date;
      const nextEnd = parsed.updates.end_date || existing.end_date;
      if (parseDateUtc(nextStart) > parseDateUtc(nextEnd)) return jsonResponse({ error: 'start_date must be on or before end_date.' }, 400);
      const now = currentUnixSeconds();
      const { sql, values } = buildDynamicUpdateSql('property_rate_seasons', parsed.updates);
      await env.DB.prepare(`${sql} WHERE id = ? AND tenant_id = ? AND property_id = ?`).bind(...values, now, seasonId, tenantId, propertyId).run();
      return jsonResponse({ ok: true, rate_season: await loadRateSeasonById(env, tenantId, propertyId, seasonId) });
    } catch (error) {
      const mapped = mapBuilderSqlError(error);
      if (mapped) return jsonResponse(mapped.payload, mapped.status);
      console.error('[RATE_SEASON_UPDATE]', error);
      return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
    }
  }

  async function handleListSeasonRoomRates(request, env, params) {
    const tenantId = resolveTenantId(request);
    if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
    const propertyId = String(params?.propertyId || '').trim();
    const actor = await requireManagerActor(request, env, tenantId);
    if (actor.error) return actor.error;

    try {
      const property = await loadPropertyById(env, tenantId, propertyId);
      if (!property) return jsonResponse({ error: 'Property not found.' }, 404);
      const result = await env.DB
        .prepare(
        `SELECT sr.id, sr.tenant_id, sr.property_id, sr.season_id, sr.room_type_id, sr.currency, sr.nightly_amount,
          sr.included_adults, sr.included_children, sr.extra_adult_amount, sr.extra_child_amount,
          sr.active, sr.created_at, sr.updated_at,
                  prs.name AS season_name, rt.name AS room_type_name, rt.code AS room_type_code
             FROM property_room_rate_season_prices sr
             LEFT JOIN property_rate_seasons prs ON prs.id = sr.season_id AND prs.tenant_id = sr.tenant_id AND prs.property_id = sr.property_id
             LEFT JOIN room_types rt ON rt.id = sr.room_type_id AND rt.tenant_id = sr.tenant_id AND rt.property_id = sr.property_id
            WHERE sr.tenant_id = ? AND sr.property_id = ?
            ORDER BY prs.sort_order ASC, prs.start_date ASC, rt.sort_order ASC, sr.created_at ASC`
        )
        .bind(tenantId, propertyId)
        .all();
      return jsonResponse({ ok: true, season_room_rates: (result.results || []).map(mapSeasonRateRow) });
    } catch (error) {
      console.error('[SEASON_ROOM_RATE_LIST]', error);
      return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
    }
  }

  async function handleCreateSeasonRoomRate(request, env, params) {
    const tenantId = resolveTenantId(request);
    if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
    const propertyId = String(params?.propertyId || '').trim();
    const actor = await requireManagerActor(request, env, tenantId);
    if (actor.error) return actor.error;

    let body;
    try { body = await parseJsonBody(request); } catch { return jsonResponse({ error: 'Request body is not valid JSON.' }, 400); }
    const parsed = validateSeasonRoomRateCreateRequest(body);
    if (parsed.error) return jsonResponse({ error: parsed.error }, 400);

    try {
      const season = await loadRateSeasonById(env, tenantId, propertyId, parsed.seasonId);
      if (!season) return jsonResponse({ error: 'Rate season not found.' }, 404);
      const roomType = await loadRoomTypeById(env, tenantId, propertyId, parsed.roomTypeId);
      if (!roomType) return jsonResponse({ error: 'Room type not found.' }, 404);
      const id = nanoid();
      const now = currentUnixSeconds();
      await env.DB
        .prepare(
          `INSERT INTO property_room_rate_season_prices
            (id, tenant_id, property_id, season_id, room_type_id, currency, nightly_amount,
             included_adults, included_children, extra_adult_amount, extra_child_amount,
             active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          id,
          tenantId,
          propertyId,
          parsed.seasonId,
          parsed.roomTypeId,
          parsed.currency,
          parsed.nightlyAmount,
          parsed.includedAdults,
          parsed.includedChildren,
          parsed.extraAdultAmount,
          parsed.extraChildAmount,
          parsed.active,
          now,
          now
        )
        .run();
      return jsonResponse({ ok: true, season_room_rate: await loadSeasonRoomRateById(env, tenantId, propertyId, id) }, 201);
    } catch (error) {
      const mapped = mapBuilderSqlError(error);
      if (mapped) return jsonResponse(mapped.payload, mapped.status);
      console.error('[SEASON_ROOM_RATE_CREATE]', error);
      return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
    }
  }

  async function handleUpdateSeasonRoomRate(request, env, params) {
    const tenantId = resolveTenantId(request);
    if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
    const propertyId = String(params?.propertyId || '').trim();
    const seasonRoomRateId = String(params?.seasonRoomRateId || '').trim();
    const actor = await requireManagerActor(request, env, tenantId);
    if (actor.error) return actor.error;

    let body;
    try { body = await parseJsonBody(request); } catch { return jsonResponse({ error: 'Request body is not valid JSON.' }, 400); }
    const parsed = validateSeasonRoomRatePatchRequest(body);
    if (parsed.error) return jsonResponse({ error: parsed.error }, 400);

    try {
      const existing = await loadSeasonRoomRateById(env, tenantId, propertyId, seasonRoomRateId);
      if (!existing) return jsonResponse({ error: 'Season room rate not found.' }, 404);
      const now = currentUnixSeconds();
      const { sql, values } = buildDynamicUpdateSql('property_room_rate_season_prices', parsed.updates);
      await env.DB.prepare(`${sql} WHERE id = ? AND tenant_id = ? AND property_id = ?`).bind(...values, now, seasonRoomRateId, tenantId, propertyId).run();
      return jsonResponse({ ok: true, season_room_rate: await loadSeasonRoomRateById(env, tenantId, propertyId, seasonRoomRateId) });
    } catch (error) {
      const mapped = mapBuilderSqlError(error);
      if (mapped) return jsonResponse(mapped.payload, mapped.status);
      console.error('[SEASON_ROOM_RATE_UPDATE]', error);
      return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
    }
  }

  async function handleQuotePropertyRoomRate(request, env, params) {
    const tenantId = resolveTenantId(request);
    if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
    const propertyId = String(params?.propertyId || '').trim();
    const actor = await requireTenantActor(request, env, tenantId);
    if (actor.error) return actor.error;

    let body;
    try { body = await parseJsonBody(request); } catch { return jsonResponse({ error: 'Request body is not valid JSON.' }, 400); }
    const parsed = validateRateQuoteRequest(body, propertyId);
    if (parsed.error) return jsonResponse({ error: parsed.error }, 400);

    try {
      const quote = await pricingResolvePropertyRateQuote(env, tenantId, propertyId, parsed, pricingDeps);
      if (quote.error) return jsonResponse(quote.error.payload, quote.error.status);
      return jsonResponse(pricingBuildResolvedRateQuotePayload(propertyId, parsed, quote));
    } catch (error) {
      console.error('[PROPERTY_RATE_QUOTE]', error);
      return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
    }
  }

  async function handleDeletePropertyPricingProfile(request, env, params) {
    const tenantId = resolveTenantId(request);
    if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
    const propertyId = String(params?.propertyId || '').trim();
    const pricingProfileId = String(params?.pricingProfileId || '').trim();
    const actor = await requireManagerActor(request, env, tenantId);
    if (actor.error) return actor.error;
    try {
      const existing = await loadPropertyPricingProfileById(env, tenantId, propertyId, pricingProfileId);
      if (!existing) return jsonResponse({ error: 'Pricing profile not found.' }, 404);
      await env.DB.prepare('DELETE FROM property_pricing_profiles WHERE id = ? AND tenant_id = ? AND property_id = ?').bind(pricingProfileId, tenantId, propertyId).run();
      return new Response(null, { status: 204 });
    } catch (error) {
      console.error('[PROPERTY_PRICING_PROFILE_DELETE]', error);
      return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
    }
  }

  async function handleDeletePropertyWeekdayPricingRule(request, env, params) {
    const tenantId = resolveTenantId(request);
    if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
    const propertyId = String(params?.propertyId || '').trim();
    const weekdayPricingRuleId = String(params?.weekdayPricingRuleId || '').trim();
    const actor = await requireManagerActor(request, env, tenantId);
    if (actor.error) return actor.error;
    try {
      const existing = await loadPropertyWeekdayPricingRuleById(env, tenantId, propertyId, weekdayPricingRuleId);
      if (!existing) return jsonResponse({ error: 'Weekday pricing rule not found.' }, 404);
      await env.DB.prepare('DELETE FROM property_weekday_pricing_rules WHERE id = ? AND tenant_id = ? AND property_id = ?').bind(weekdayPricingRuleId, tenantId, propertyId).run();
      return new Response(null, { status: 204 });
    } catch (error) {
      console.error('[PROPERTY_WEEKDAY_PRICING_RULE_DELETE]', error);
      return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
    }
  }

  async function handleDeleteRoomRate(request, env, params) {
    const tenantId = resolveTenantId(request);
    if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
    const propertyId = String(params?.propertyId || '').trim();
    const roomRateId = String(params?.roomRateId || '').trim();
    const actor = await requireManagerActor(request, env, tenantId);
    if (actor.error) return actor.error;
    try {
      const existing = await loadRoomRateById(env, tenantId, propertyId, roomRateId);
      if (!existing) return jsonResponse({ error: 'Room rate not found.' }, 404);
      await env.DB.prepare('DELETE FROM property_room_rates WHERE id = ? AND tenant_id = ? AND property_id = ?').bind(roomRateId, tenantId, propertyId).run();
      return new Response(null, { status: 204 });
    } catch (error) {
      console.error('[ROOM_RATE_DELETE]', error);
      return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
    }
  }

  async function handleDeletePropertyAddonServicePreset(request, env, params) {
    const tenantId = resolveTenantId(request);
    if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
    const propertyId = String(params?.propertyId || '').trim();
    const presetId = String(params?.presetId || '').trim();
    const actor = await requireManagerActor(request, env, tenantId);
    if (actor.error) return actor.error;
    try {
      const existing = await loadAddonServicePresetById(env, tenantId, propertyId, presetId);
      if (!existing) return jsonResponse({ error: 'Addon service preset not found.' }, 404);
      await env.DB.prepare('DELETE FROM property_addon_service_presets WHERE id = ? AND tenant_id = ? AND property_id = ?').bind(presetId, tenantId, propertyId).run();
      return new Response(null, { status: 204 });
    } catch (error) {
      console.error('[ADDON_PRESET_DELETE]', error);
      return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
    }
  }

  async function handleDeleteRateSeason(request, env, params) {
    const tenantId = resolveTenantId(request);
    if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
    const propertyId = String(params?.propertyId || '').trim();
    const seasonId = String(params?.seasonId || '').trim();
    const actor = await requireManagerActor(request, env, tenantId);
    if (actor.error) return actor.error;
    try {
      const existing = await loadRateSeasonById(env, tenantId, propertyId, seasonId);
      if (!existing) return jsonResponse({ error: 'Rate season not found.' }, 404);
      await env.DB.prepare('DELETE FROM property_rate_seasons WHERE id = ? AND tenant_id = ? AND property_id = ?').bind(seasonId, tenantId, propertyId).run();
      return new Response(null, { status: 204 });
    } catch (error) {
      console.error('[RATE_SEASON_DELETE]', error);
      return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
    }
  }

  async function handleDeleteSeasonRoomRate(request, env, params) {
    const tenantId = resolveTenantId(request);
    if (!tenantId) return jsonResponse({ error: 'X-Tenant-ID header is required' }, 400);
    const propertyId = String(params?.propertyId || '').trim();
    const seasonRoomRateId = String(params?.seasonRoomRateId || '').trim();
    const actor = await requireManagerActor(request, env, tenantId);
    if (actor.error) return actor.error;
    try {
      const existing = await loadSeasonRoomRateById(env, tenantId, propertyId, seasonRoomRateId);
      if (!existing) return jsonResponse({ error: 'Season room rate not found.' }, 404);
      await env.DB.prepare('DELETE FROM property_room_rate_season_prices WHERE id = ? AND tenant_id = ? AND property_id = ?').bind(seasonRoomRateId, tenantId, propertyId).run();
      return new Response(null, { status: 204 });
    } catch (error) {
      console.error('[SEASON_ROOM_RATE_DELETE]', error);
      return jsonResponse({ error: 'Internal server error. Please try again later.' }, 500);
    }
  }

  return {
    handleCreatePropertyAddonServicePreset,
    handleCreatePropertyPricingProfile,
    handleCreatePropertyWeekdayPricingRule,
    handleCreateRateSeason,
    handleCreateRoomRate,
    handleCreateSeasonRoomRate,
    handleDeletePropertyAddonServicePreset,
    handleDeletePropertyPricingProfile,
    handleDeletePropertyWeekdayPricingRule,
    handleDeleteRateSeason,
    handleDeleteRoomRate,
    handleDeleteSeasonRoomRate,
    handleListPropertyAddonServicePresets,
    handleListPropertyPricingProfiles,
    handleListPropertyWeekdayPricingRules,
    handleListRateSeasons,
    handleListRoomRates,
    handleListSeasonRoomRates,
    handleQuotePropertyRoomRate,
    handleSeedPropertyAddonServicePresets,
    handleUpdatePropertyAddonServicePreset,
    handleUpdatePropertyPricingProfile,
    handleUpdatePropertyWeekdayPricingRule,
    handleUpdateRateSeason,
    handleUpdateRoomRate,
    handleUpdateSeasonRoomRate,
  };
}

export { createPricingHandlers };