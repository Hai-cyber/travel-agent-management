import {
	getTenantId,
	successResponse,
	readJsonBody,
	validationError,
	internalError,
} from '../lib/db.js';

const DEFAULT_SETTINGS = {
	auto_confirm_min_days: 30,
	auto_confirm_max_pax: 16,
	class_presets: [
		{
			id: 'class_standard',
			label: 'Standard',
			base_price: 2500000,
			single_room_supplement: 450000,
			description: 'Comfortable hotels, basic local restaurants.',
		},
		{
			id: 'class_boutique',
			label: 'Boutique',
			base_price: 3400000,
			single_room_supplement: 700000,
			description: 'Upscale hotels and curated restaurants.',
		},
		{
			id: 'class_luxury',
			label: 'Luxury/Excellency',
			base_price: 4900000,
			single_room_supplement: 1200000,
			description: 'Premium luxury hotels and high-end dining.',
		},
	],
	pricing_tiers: [],
	date_time_format: 'dd.mm.yyyy hh:mm',
	pricing_currency_mode: 'auto',
	pricing_base_currency: 'VND',
	usd_to_vnd_rate: 25000,
	class_labels: {
		'3_star': 'Standard',
		'4_star': 'Boutique',
		'5_star': 'Luxury/Excellency',
	},
	class_prices: {
		'3_star': 2500000,
		'4_star': 3400000,
		'5_star': 4900000,
	},
	class_descriptions: {
		'3_star': '3 star: comfortable hotels (e.g. Mayfair, Silk style), basic local restaurants.',
		'4_star': '4 star: upscale city hotels, curated regional restaurants.',
		'5_star': '5 star: premium luxury hotels, high-end dining experience.',
	},
	single_room_supplement: {
		'3_star': 450000,
		'4_star': 700000,
		'5_star': 1200000,
	},
	child_discount_pct: 0.5,
};

export async function getBookingSettings(request, db) {
	try {
		const tenantId = getTenantId(request);
		const settings = await loadSettings(tenantId, db);
		return successResponse(settings);
	} catch (error) {
		return internalError(`Failed to get booking settings: ${error.message}`);
	}
}

export async function upsertBookingSettings(request, db) {
	try {
		const parsed = await readJsonBody(request);
		if (!parsed.ok) return parsed.response;

		const tenantId = getTenantId(request);
		const payload = normalizeSettingsPayload(parsed.value);
		if (!payload.ok) {
			return validationError(payload.message);
		}

		const now = Date.now();
		const normalized = payload.value;
		await db
			.prepare(
				`INSERT INTO booking_settings
					(tenant_id, auto_confirm_min_days, auto_confirm_max_pax, class_presets_json, pricing_tiers_json, date_time_format, pricing_currency_mode, pricing_base_currency, usd_to_vnd_rate, class_labels_json, class_prices_json, class_descriptions_json, single_room_supplement_json, child_discount_pct, updated_at)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(tenant_id) DO UPDATE SET
					auto_confirm_min_days = excluded.auto_confirm_min_days,
					auto_confirm_max_pax = excluded.auto_confirm_max_pax,
					class_presets_json = excluded.class_presets_json,
					pricing_tiers_json = excluded.pricing_tiers_json,
						date_time_format = excluded.date_time_format,
					pricing_currency_mode = excluded.pricing_currency_mode,
					pricing_base_currency = excluded.pricing_base_currency,
					usd_to_vnd_rate = excluded.usd_to_vnd_rate,
					class_labels_json = excluded.class_labels_json,
					class_prices_json = excluded.class_prices_json,
					class_descriptions_json = excluded.class_descriptions_json,
					single_room_supplement_json = excluded.single_room_supplement_json,
					child_discount_pct = excluded.child_discount_pct,
					updated_at = excluded.updated_at`
			)
			.bind(
				tenantId,
				normalized.auto_confirm_min_days,
				normalized.auto_confirm_max_pax,
				JSON.stringify(normalized.class_presets),
				JSON.stringify(normalized.pricing_tiers),
				normalized.date_time_format,
				normalized.pricing_currency_mode,
				normalized.pricing_base_currency,
				normalized.usd_to_vnd_rate,
				JSON.stringify(normalized.class_labels),
				JSON.stringify(normalized.class_prices),
				JSON.stringify(normalized.class_descriptions),
				JSON.stringify(normalized.single_room_supplement),
				normalized.child_discount_pct,
				now
			)
			.run();

		return successResponse({ ...normalized, updated_at: now });
	} catch (error) {
		return internalError(`Failed to update booking settings: ${error.message}`);
	}
}

export async function getPublicBookingSettings(request, db) {
	try {
		const tenantId = getTenantId(request);
		const settings = await loadSettings(tenantId, db);
		return successResponse(settings);
	} catch (error) {
		return internalError(`Failed to get public booking settings: ${error.message}`);
	}
}

export async function getEffectiveBookingSettings(tenantId, db) {
	return loadSettings(tenantId, db);
}

function normalizeSettingsPayload(input) {
	const merged = {
		...DEFAULT_SETTINGS,
		...input,
		class_presets: Array.isArray(input.class_presets) ? input.class_presets : null,
		pricing_tiers: Array.isArray(input.pricing_tiers) ? input.pricing_tiers : DEFAULT_SETTINGS.pricing_tiers,
		class_labels: { ...DEFAULT_SETTINGS.class_labels, ...(input.class_labels || {}) },
		class_prices: { ...DEFAULT_SETTINGS.class_prices, ...(input.class_prices || {}) },
		class_descriptions: { ...DEFAULT_SETTINGS.class_descriptions, ...(input.class_descriptions || {}) },
		single_room_supplement: {
			...DEFAULT_SETTINGS.single_room_supplement,
			...(input.single_room_supplement || {}),
		},
	};

	if (!Number.isInteger(merged.auto_confirm_min_days) || merged.auto_confirm_min_days < 0) {
		return { ok: false, message: 'auto_confirm_min_days must be an integer >= 0' };
	}
	if (!Number.isInteger(merged.auto_confirm_max_pax) || merged.auto_confirm_max_pax < 1) {
		return { ok: false, message: 'auto_confirm_max_pax must be an integer >= 1' };
	}
	if (!['dd.mm.yyyy hh:mm'].includes(String(merged.date_time_format || 'dd.mm.yyyy hh:mm'))) {
		return { ok: false, message: 'date_time_format must be dd.mm.yyyy hh:mm' };
	}
	if (!['auto', 'USD', 'VND'].includes(String(merged.pricing_currency_mode || 'auto'))) {
		return { ok: false, message: 'pricing_currency_mode must be auto, USD, or VND' };
	}
	if (!['USD', 'VND'].includes(String(merged.pricing_base_currency || 'VND'))) {
		return { ok: false, message: 'pricing_base_currency must be USD or VND' };
	}
	if (!Number.isFinite(Number(merged.usd_to_vnd_rate)) || Number(merged.usd_to_vnd_rate) <= 0) {
		return { ok: false, message: 'usd_to_vnd_rate must be > 0' };
	}
	if (typeof merged.child_discount_pct !== 'number' || merged.child_discount_pct < 0 || merged.child_discount_pct > 1) {
		return { ok: false, message: 'child_discount_pct must be a number between 0 and 1' };
	}

	let normalizedPresets = [];
	if (Array.isArray(merged.class_presets) && merged.class_presets.length > 0) {
		normalizedPresets = merged.class_presets.map((preset, idx) => ({
			id: String(preset.id || `class_${idx + 1}`),
			label: String(preset.label || `Class ${idx + 1}`),
			base_price: Number(preset.base_price || 0),
			single_room_supplement: Number(preset.single_room_supplement || 0),
			description: String(preset.description || ''),
		}));
	} else {
		normalizedPresets = [
			{
				id: '3_star',
				label: merged.class_labels['3_star'],
				base_price: merged.class_prices['3_star'],
				single_room_supplement: merged.single_room_supplement['3_star'],
				description: merged.class_descriptions['3_star'],
			},
			{
				id: '4_star',
				label: merged.class_labels['4_star'],
				base_price: merged.class_prices['4_star'],
				single_room_supplement: merged.single_room_supplement['4_star'],
				description: merged.class_descriptions['4_star'],
			},
			{
				id: '5_star',
				label: merged.class_labels['5_star'],
				base_price: merged.class_prices['5_star'],
				single_room_supplement: merged.single_room_supplement['5_star'],
				description: merged.class_descriptions['5_star'],
			},
		];
	}

	if (!normalizedPresets.length) {
		return { ok: false, message: 'class_presets must contain at least one class' };
	}
	for (const preset of normalizedPresets) {
		if (!preset.id.trim()) return { ok: false, message: 'Each class preset needs an id' };
		if (!preset.label.trim()) return { ok: false, message: 'Each class preset needs a label' };
		if (!Number.isFinite(preset.base_price) || preset.base_price < 0) return { ok: false, message: 'Each class preset base_price must be >= 0' };
		if (!Number.isFinite(preset.single_room_supplement) || preset.single_room_supplement < 0) return { ok: false, message: 'Each class preset single_room_supplement must be >= 0' };
	}

	const normalizedPricingTiers = Array.isArray(merged.pricing_tiers)
		? merged.pricing_tiers
				.map((tier, idx) => ({
					id: String(tier.id || `tier_${idx + 1}`),
					class_id: String(
						tier.class_id
						|| normalizedPresets.find((preset) => preset.label === String(tier.title || ''))?.id
						|| normalizedPresets[0]?.id
						|| `class_${idx + 1}`
					),
					season: String(tier.season || ''),
					season_start: String(tier.season_start || ''),
					season_end: String(tier.season_end || ''),
					pax_band: String(tier.pax_band || ''),
					min_pax: Number(tier.min_pax || 1),
					max_pax: Number(tier.max_pax || 99),
					title: String(tier.title || ''),
					adult_shared_price: Number(tier.adult_shared_price || 0),
					adult_single_price: Number(tier.adult_single_price || 0),
					child_shared_price: Number(tier.child_shared_price || 0),
				}))
				.filter((tier) => tier.season && tier.pax_band && tier.title)
		: [];

	for (const tier of normalizedPricingTiers) {
		if (!Number.isFinite(tier.min_pax) || tier.min_pax < 1) {
			return { ok: false, message: 'pricing_tiers.min_pax must be >= 1' };
		}
		if (!Number.isFinite(tier.max_pax) || tier.max_pax < tier.min_pax) {
			return { ok: false, message: 'pricing_tiers.max_pax must be >= min_pax' };
		}
		for (const key of ['adult_shared_price', 'adult_single_price', 'child_shared_price']) {
			if (!Number.isFinite(tier[key]) || tier[key] < 0) {
				return { ok: false, message: `pricing_tiers.${key} must be >= 0` };
			}
		}
	}

	const derivedLabels = {};
	const derivedPrices = {};
	const derivedDescriptions = {};
	const derivedSupplements = {};
	normalizedPresets.slice(0, 3).forEach((preset, idx) => {
		const key = idx === 0 ? '3_star' : idx === 1 ? '4_star' : '5_star';
		derivedLabels[key] = preset.label;
		derivedPrices[key] = preset.base_price;
		derivedDescriptions[key] = preset.description;
		derivedSupplements[key] = preset.single_room_supplement;
	});

	for (const cls of ['3_star', '4_star', '5_star']) {
		derivedLabels[cls] = derivedLabels[cls] || DEFAULT_SETTINGS.class_labels[cls];
		derivedPrices[cls] = Number.isFinite(derivedPrices[cls]) ? derivedPrices[cls] : DEFAULT_SETTINGS.class_prices[cls];
		derivedDescriptions[cls] = derivedDescriptions[cls] || DEFAULT_SETTINGS.class_descriptions[cls];
		derivedSupplements[cls] = Number.isFinite(derivedSupplements[cls]) ? derivedSupplements[cls] : DEFAULT_SETTINGS.single_room_supplement[cls];
	}

	return {
		ok: true,
		value: {
			auto_confirm_min_days: merged.auto_confirm_min_days,
			auto_confirm_max_pax: merged.auto_confirm_max_pax,
			class_presets: normalizedPresets,
			pricing_tiers: normalizedPricingTiers,
			date_time_format: String(merged.date_time_format || 'dd.mm.yyyy hh:mm'),
			pricing_currency_mode: String(merged.pricing_currency_mode || 'auto'),
			pricing_base_currency: String(merged.pricing_base_currency || 'VND'),
			usd_to_vnd_rate: Number(merged.usd_to_vnd_rate || 25000),
			class_labels: derivedLabels,
			class_prices: derivedPrices,
			class_descriptions: derivedDescriptions,
			single_room_supplement: derivedSupplements,
			child_discount_pct: merged.child_discount_pct,
		},
	};
}

async function loadSettings(tenantId, db) {
	let row = null;
	try {
		row = await db
			.prepare(
				`SELECT auto_confirm_min_days, auto_confirm_max_pax, class_presets_json, pricing_tiers_json, date_time_format, pricing_currency_mode, pricing_base_currency, usd_to_vnd_rate, class_labels_json, class_prices_json, class_descriptions_json,
				single_room_supplement_json, child_discount_pct, updated_at
				FROM booking_settings WHERE tenant_id = ?`
			)
			.bind(tenantId)
			.first();
	} catch {
		return {
			...DEFAULT_SETTINGS,
			updated_at: null,
		};
	}

	if (!row) {
		return {
			...DEFAULT_SETTINGS,
			updated_at: null,
		};
	}

	let classPresets = DEFAULT_SETTINGS.class_presets;
	let pricingTiers = DEFAULT_SETTINGS.pricing_tiers;
	let classLabels = DEFAULT_SETTINGS.class_labels;
	let classPrices = DEFAULT_SETTINGS.class_prices;
	let classDescriptions = DEFAULT_SETTINGS.class_descriptions;
	let supplements = DEFAULT_SETTINGS.single_room_supplement;
	try {
		const parsedPresets = JSON.parse(row.class_presets_json || '[]');
		if (Array.isArray(parsedPresets) && parsedPresets.length) {
			classPresets = parsedPresets;
		}
	} catch {
		// keep defaults
	}
	try {
		const parsedPricing = JSON.parse(row.pricing_tiers_json || '[]');
		if (Array.isArray(parsedPricing)) {
			pricingTiers = parsedPricing;
		}
	} catch {
		// keep defaults
	}
	try {
		classLabels = { ...classLabels, ...(JSON.parse(row.class_labels_json || '{}')) };
	} catch {
		// keep defaults
	}
	try {
		classPrices = { ...classPrices, ...(JSON.parse(row.class_prices_json || '{}')) };
	} catch {
		// keep defaults
	}
	try {
		classDescriptions = { ...classDescriptions, ...(JSON.parse(row.class_descriptions_json || '{}')) };
	} catch {
		// keep defaults
	}
	try {
		supplements = { ...supplements, ...(JSON.parse(row.single_room_supplement_json || '{}')) };
	} catch {
		// keep defaults
	}

	if (!Array.isArray(classPresets) || !classPresets.length) {
		classPresets = DEFAULT_SETTINGS.class_presets;
	}

	return {
		auto_confirm_min_days: row.auto_confirm_min_days,
		auto_confirm_max_pax: row.auto_confirm_max_pax,
		class_presets: classPresets,
		pricing_tiers: pricingTiers,
		date_time_format: row.date_time_format || DEFAULT_SETTINGS.date_time_format,
		pricing_currency_mode: row.pricing_currency_mode || DEFAULT_SETTINGS.pricing_currency_mode,
		pricing_base_currency: row.pricing_base_currency || DEFAULT_SETTINGS.pricing_base_currency,
		usd_to_vnd_rate: Number(row.usd_to_vnd_rate || DEFAULT_SETTINGS.usd_to_vnd_rate),
		class_labels: classLabels,
		class_prices: classPrices,
		class_descriptions: classDescriptions,
		single_room_supplement: supplements,
		child_discount_pct: row.child_discount_pct,
		updated_at: row.updated_at,
	};
}
