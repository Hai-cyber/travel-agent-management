/**
 * Bookings & Demo Payment routes [CHK-406]
 * Public: traveler booking submission + demo payment checkout.
 * Admin: agent booking management + confirm/reject.
 */

import {
	getTenantId,
	generateId,
	successResponse,
	readJsonBody,
	validationError,
	notFoundResponse,
	internalError,
} from '../lib/db.js';
import { generateTasksForTour } from '../services/tasks.js';
import { getEffectiveBookingSettings } from './booking-settings.js';

// ─── Public: traveler routes ────────────────────────────────────────────────

export async function publicCreateBooking(request, db) {
	try {
		const parsedBody = await readJsonBody(request);
		if (!parsedBody.ok) return parsedBody.response;

		const {
			tour_id,
			traveler_name,
			traveler_email,
			traveler_phone,
			pax,
			child_count,
			single_room_count,
			tour_class,
			message,
			desired_departure_date,
		} = parsedBody.value;
		const tenantId = getTenantId(request);

		if (!tour_id || typeof tour_id !== 'string') return validationError('tour_id is required');
		if (!traveler_name || typeof traveler_name !== 'string') return validationError('traveler_name is required');

		const parsedPax = pax === undefined ? 1 : Number(pax);
		if (!Number.isInteger(parsedPax) || parsedPax < 1) return validationError('pax must be a positive integer');
		const parsedChildCount = child_count === undefined ? 0 : Number(child_count);
		const parsedSingleRoomCount = single_room_count === undefined ? 0 : Number(single_room_count);
		if (!Number.isInteger(parsedChildCount) || parsedChildCount < 0) return validationError('child_count must be an integer >= 0');
		if (!Number.isInteger(parsedSingleRoomCount) || parsedSingleRoomCount < 0) return validationError('single_room_count must be an integer >= 0');
		if (tour_class !== undefined && typeof tour_class !== 'string') {
			return validationError('tour_class must be a string when provided');
		}

		for (const [field, value] of Object.entries({ traveler_email, traveler_phone, message })) {
			if (value !== undefined && value !== null && typeof value !== 'string') {
				return validationError(`${field} must be a string`);
			}
		}
		if (desired_departure_date !== undefined && (typeof desired_departure_date !== 'number' || desired_departure_date <= 0)) {
			return validationError('desired_departure_date must be a positive number (epoch ms) when provided');
		}

		const tour = await db
			.prepare("SELECT id, tenant_id FROM tours WHERE id = ? AND tenant_id = ? AND status = 'on_sale'")
			.bind(tour_id, tenantId)
			.first();
		if (!tour) return notFoundResponse('Tour not found or not available for booking');

		const bookingId = generateId();
		const now = Date.now();
		const settings = await getEffectiveBookingSettings(tenantId, db);
		const selectedClass = tour_class || settings.class_presets?.[0]?.id || 'class_1';
		const defaultAmount = calculateQuoteTotal({
			settings,
			pax: parsedPax,
			childCount: parsedChildCount,
			singleRoomCount: parsedSingleRoomCount,
			tourClass: selectedClass,
			desiredDepartureDate: desired_departure_date,
		});

		await db
			.prepare(
				`INSERT INTO bookings
				(id, tenant_id, tour_id, traveler_name, traveler_email, traveler_phone, pax, child_count, single_room_count, tour_class, quoted_total, message, desired_departure_date, status, payment_status, payment_amount, payment_currency, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'unpaid', ?, 'VND', ?)`
			)
			.bind(
				bookingId,
				tenantId,
				tour_id,
				traveler_name,
				traveler_email || null,
				traveler_phone || null,
				parsedPax,
				parsedChildCount,
				parsedSingleRoomCount,
				selectedClass,
				defaultAmount,
				message || null,
				desired_departure_date || null,
				defaultAmount,
				now
			)
			.run();

		return successResponse(
			{
				id: bookingId,
				tenant_id: tenantId,
				tour_id,
				status: 'pending',
				payment_status: 'unpaid',
				created_at: now,
				_next: `POST /public/bookings/${bookingId}/pay`,
			},
			201
		);
	} catch (error) {
		return internalError(`Failed to create booking: ${error.message}`);
	}
}

export async function publicGetBooking(bookingId, request, db) {
	try {
		const tenantId = getTenantId(request);
		const booking = await db
			.prepare(
				`SELECT id, tenant_id, tour_id, traveler_name, pax, status, payment_status, payment_currency, created_at
				FROM bookings WHERE id = ? AND tenant_id = ?`
			)
			.bind(bookingId, tenantId)
			.first();
		if (!booking) return notFoundResponse('Booking not found');
		return successResponse(booking);
	} catch (error) {
		return internalError(`Failed to get booking: ${error.message}`);
	}
}

export async function publicPayBooking(bookingId, request, db) {
	try {
		const parsedBody = await readJsonBody(request);
		if (!parsedBody.ok) return parsedBody.response;

		const { card_number, expiry, cvv, amount } = parsedBody.value;

		if (!card_number || typeof card_number !== 'string' || card_number.replace(/\s/g, '').length < 12) {
			return validationError('card_number must be at least 12 digits');
		}
		if (!expiry || typeof expiry !== 'string') return validationError('expiry is required (MM/YY)');
		if (!cvv || typeof cvv !== 'string' || cvv.length < 3) return validationError('cvv must be at least 3 digits');
		if (amount !== undefined && amount !== null && (typeof amount !== 'number' || amount < 0)) {
			return validationError('amount must be a non-negative number');
		}

		const tenantId = getTenantId(request);
		const booking = await db
			.prepare('SELECT id, status, payment_status, tour_id, desired_departure_date, pax FROM bookings WHERE id = ? AND tenant_id = ?')
			.bind(bookingId, tenantId)
			.first();
		if (!booking) return notFoundResponse('Booking not found');
		if (booking.payment_status === 'paid') return validationError('Booking is already paid');
		if (booking.status === 'rejected' || booking.status === 'cancelled') {
			return validationError('Cannot pay for a rejected or cancelled booking');
		}

		const cardLast4 = card_number.replace(/\s/g, '').slice(-4);
		const payAmount = typeof amount === 'number' ? amount : 0;
		const paymentId = generateId();
		const now = Date.now();

		await db
			.prepare(
				`INSERT INTO demo_payments (id, tenant_id, booking_id, amount, currency, card_last4, status, paid_at)
				VALUES (?, ?, ?, ?, 'VND', ?, 'paid', ?)`
			)
			.bind(paymentId, tenantId, bookingId, payAmount, cardLast4, now)
			.run();


		const autoSettings = await getEffectiveBookingSettings(tenantId, db);
		const shouldAutoConfirm = canAutoConfirmAfterPayment({
			desiredDepartureDate: booking.desired_departure_date,
			pax: booking.pax,
			settings: autoSettings,
		});
		if (shouldAutoConfirm) {
			await db
				.prepare(`UPDATE bookings SET payment_status = 'paid', payment_amount = ?, status = 'confirmed' WHERE id = ? AND tenant_id = ?`)
				.bind(payAmount, bookingId, tenantId)
				.run();

			try {
				await ensureServiceItemsFromBlueprint(booking.tour_id, tenantId, db);
				await generateTasksForTour(booking.tour_id, db);
			} catch {
				// Non-fatal for payment success path
			}
		} else {
			await db
				.prepare(`UPDATE bookings SET payment_status = 'paid', payment_amount = ? WHERE id = ? AND tenant_id = ?`)
				.bind(payAmount, bookingId, tenantId)
				.run();
		}

		return successResponse({
			payment_id: paymentId,
			booking_id: bookingId,
			status: 'paid',
			auto_confirmed: shouldAutoConfirm,
			card_last4: cardLast4,
			amount: payAmount,
			currency: 'VND',
			paid_at: now,
			message: shouldAutoConfirm
				? 'Payment recorded and booking auto-confirmed.'
				: 'Payment recorded. Booking is awaiting agent confirmation.',
		});
	} catch (error) {
		return internalError(`Failed to process demo payment: ${error.message}`);
	}
}

// ─── Admin: agent routes ─────────────────────────────────────────────────────

export async function listBookings(request, db) {
	try {
		const tenantId = getTenantId(request);
		const url = new URL(request.url);
		const status = url.searchParams.get('status');

		let query = `SELECT b.id, b.tour_id, b.traveler_name, b.traveler_email, b.traveler_phone,
			b.pax, b.child_count, b.single_room_count, b.tour_class, b.quoted_total, b.desired_departure_date,
			b.message, b.status, b.payment_status, b.payment_amount, b.payment_currency,
			b.created_at, t.title AS tour_title
			FROM bookings b
			LEFT JOIN tours t ON t.id = b.tour_id AND t.tenant_id = b.tenant_id
			WHERE b.tenant_id = ?`;
		const params = [tenantId];

		if (status) {
			query += ' AND b.status = ?';
			params.push(status);
		}
		query += ' ORDER BY b.created_at DESC LIMIT 100';

		const rows = await db.prepare(query).bind(...params).all();
		return successResponse({ bookings: rows.results || [] });
	} catch (error) {
		return internalError(`Failed to list bookings: ${error.message}`);
	}
}

export async function updateBooking(bookingId, request, db) {
	try {
		const parsedBody = await readJsonBody(request);
		if (!parsedBody.ok) return parsedBody.response;

		const tenantId = getTenantId(request);
		const { status } = parsedBody.value;

		const ALLOWED = ['confirmed', 'rejected', 'completed', 'cancelled'];
		if (!status || !ALLOWED.includes(status)) {
			return validationError(`status must be one of: ${ALLOWED.join(', ')}`);
		}

		const booking = await db
			.prepare('SELECT id, tour_id, status FROM bookings WHERE id = ? AND tenant_id = ?')
			.bind(bookingId, tenantId)
			.first();
		if (!booking) return notFoundResponse('Booking not found');

		if (booking.status === 'rejected' || booking.status === 'cancelled') {
			return validationError('Cannot transition from a terminal booking status');
		}

		await db
			.prepare('UPDATE bookings SET status = ? WHERE id = ? AND tenant_id = ?')
			.bind(status, bookingId, tenantId)
			.run();

		let generatedTasks = [];
		if (status === 'confirmed') {
			// Materialize hidden CRM service records from destination blueprints, then generate tasks.
			try {
				await ensureServiceItemsFromBlueprint(booking.tour_id, tenantId, db);
				generatedTasks = await generateTasksForTour(booking.tour_id, db);
			} catch {
				// Non-fatal — booking was confirmed, tasks just weren't generated
			}
		}

		const updated = await db
			.prepare(
				`SELECT id, tour_id, traveler_name, pax, status, payment_status, created_at
				FROM bookings WHERE id = ?`
			)
			.bind(bookingId)
			.first();

		return successResponse({ ...updated, generated_task_count: generatedTasks.length });
	} catch (error) {
		return internalError(`Failed to update booking: ${error.message}`);
	}
}

async function ensureServiceItemsFromBlueprint(tourId, tenantId, db) {
	let destinations;
	try {
		destinations = await db
			.prepare('SELECT id, name, arrival_date, departure_date, service_blueprint_json FROM destinations WHERE tour_id = ? AND tenant_id = ? ORDER BY position ASC')
			.bind(tourId, tenantId)
			.all();
	} catch {
		// Backward compatibility for schemas missing service_blueprint_json.
		destinations = await db
			.prepare('SELECT id, name, arrival_date, departure_date FROM destinations WHERE tour_id = ? AND tenant_id = ? ORDER BY position ASC')
			.bind(tourId, tenantId)
			.all();
	}

	for (const destination of destinations.results || []) {
		const blueprint = parseBlueprint(destination.service_blueprint_json);
		if (blueprint.accommodations) {
			await ensureAccommodation(destination, tenantId, db);
		}
		if (blueprint.meals) {
			await ensureMeal(destination, tenantId, db);
		}
		if (blueprint.guides) {
			await ensureGuide(destination, tenantId, db);
		}
		if (blueprint.local_transports) {
			await ensureLocalTransport(destination, tenantId, db);
		}
		if (blueprint.intercity_legs) {
			await ensureIntercityLeg(destination, tenantId, db);
		}
	}
}

function canAutoConfirmAfterPayment({ desiredDepartureDate, pax, settings }) {
	if (!desiredDepartureDate || typeof desiredDepartureDate !== 'number') {
		return false;
	}
	const minDays = settings?.auto_confirm_min_days ?? 30;
	const maxPax = settings?.auto_confirm_max_pax ?? 16;
	const requiredMs = minDays * 24 * 60 * 60 * 1000;
	const leadTimeOk = desiredDepartureDate - Date.now() >= requiredMs;
	const paxOk = typeof pax === 'number' && pax < maxPax;
	return leadTimeOk && paxOk;
}

function calculateQuoteTotal({ settings, pax, childCount, singleRoomCount, tourClass, desiredDepartureDate }) {
	const pricingTiers = Array.isArray(settings.pricing_tiers) ? settings.pricing_tiers : [];
	const matchedTiers = pricingTiers.filter((tier) => matchPricingTier(tier, pax, desiredDepartureDate));
	if (matchedTiers.length) {
		const selectedTier = matchedTiers.find((tier) => tier.id === tourClass || tier.title === tourClass) || matchedTiers[0];
		const adults = Math.max(0, pax - childCount);
		const singleAdults = Math.min(adults, Math.max(0, singleRoomCount));
		const sharedAdults = Math.max(0, adults - singleAdults);
		return (
			sharedAdults * Number(selectedTier.adult_shared_price || 0)
			+ singleAdults * Number(selectedTier.adult_single_price || 0)
			+ childCount * Number(selectedTier.child_shared_price || 0)
		);
	}

	const presets = Array.isArray(settings.class_presets) ? settings.class_presets : [];
	const matched = presets.find((preset) => preset.id === tourClass) || presets[0] || null;
	const classPrice = Number(matched?.base_price || settings.class_prices?.[tourClass] || settings.class_prices?.['3_star'] || 0);
	const singleSupp = Number(matched?.single_room_supplement || settings.single_room_supplement?.[tourClass] || settings.single_room_supplement?.['3_star'] || 0);
	const childDiscount = typeof settings.child_discount_pct === 'number' ? settings.child_discount_pct : 0.5;
	const payingAdults = Math.max(0, pax - childCount);
	const childPrice = classPrice * childDiscount;
	return payingAdults * classPrice + childCount * childPrice + singleRoomCount * singleSupp;
}

function matchPricingTier(tier, pax, desiredDepartureDate) {
	if (!tier || typeof tier !== 'object') return false;
	const minPax = Number(tier.min_pax || 1);
	const maxPax = Number(tier.max_pax || 999);
	if (pax < minPax || pax > maxPax) return false;
	if (!desiredDepartureDate || typeof desiredDepartureDate !== 'number') return true;

	const date = new Date(desiredDepartureDate);
	if (Number.isNaN(date.getTime())) return true;
	const current = (date.getMonth() + 1) * 100 + date.getDate();
	const start = mmddToInt(tier.season_start);
	const end = mmddToInt(tier.season_end);
	if (!start || !end) return true;
	if (start <= end) {
		return current >= start && current <= end;
	}
	return current >= start || current <= end;
}

function mmddToInt(value) {
	if (typeof value !== 'string') return 0;
	const m = value.match(/^(\d{2})-(\d{2})$/);
	if (!m) return 0;
	const month = Number(m[1]);
	const day = Number(m[2]);
	if (month < 1 || month > 12 || day < 1 || day > 31) return 0;
	return month * 100 + day;
}

function parseBlueprint(rawValue) {
	const fallback = {
		accommodations: false,
		meals: false,
		guides: false,
		local_transports: false,
		intercity_legs: false,
		intercity_mode: 'train',
	};

	if (!rawValue) {
		return fallback;
	}
	try {
		const parsed = JSON.parse(rawValue);
		return {
			accommodations: Boolean(parsed.accommodations),
			meals: Boolean(parsed.meals),
			guides: Boolean(parsed.guides),
			local_transports: Boolean(parsed.local_transports),
			intercity_legs: Boolean(parsed.intercity_legs),
			intercity_mode: parsed.intercity_mode || 'train',
		};
	} catch {
		return fallback;
	}
}

async function ensureAccommodation(destination, tenantId, db) {
	const existing = await db
		.prepare('SELECT id FROM dest_accommodations WHERE destination_id = ? AND tenant_id = ? LIMIT 1')
		.bind(destination.id, tenantId)
		.first();
	if (existing) return;

	const now = Date.now();
	await db
		.prepare(
			`INSERT INTO dest_accommodations
			(id, tenant_id, destination_id, hotel_name, check_in, check_out, status, position, created_at,
			 person_in_charge, contact_name, contact_phone, contact_email, address, notes, stage, communication_channels_json)
			VALUES (?, ?, ?, ?, ?, ?, 'planned', 1, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
		)
		.bind(
			generateId(),
			tenantId,
			destination.id,
			`${destination.name} Stay (auto)`,
			destination.arrival_date || null,
			destination.departure_date || null,
			now,
			'System Auto CRM',
			'TBD',
			null,
			null,
			`${destination.name} (TBD address)`,
			'Auto-created from service toggle on booking confirmation',
			JSON.stringify(['email'])
		)
		.run();
}

async function ensureMeal(destination, tenantId, db) {
	const existing = await db
		.prepare('SELECT id FROM dest_meals WHERE destination_id = ? AND tenant_id = ? LIMIT 1')
		.bind(destination.id, tenantId)
		.first();
	if (existing) return;

	const now = Date.now();
	await db
		.prepare(
			`INSERT INTO dest_meals
			(id, tenant_id, destination_id, meal_type, restaurant_name, meal_datetime, status, position, created_at,
			 person_in_charge, contact_name, contact_phone, contact_email, address, notes, stage, communication_channels_json)
			VALUES (?, ?, ?, 'dinner', ?, ?, 'planned', 1, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
		)
		.bind(
			generateId(),
			tenantId,
			destination.id,
			`${destination.name} Meal (auto)`,
			destination.arrival_date || null,
			now,
			'System Auto CRM',
			'TBD',
			null,
			null,
			`${destination.name} (TBD restaurant address)`,
			'Auto-created from service toggle on booking confirmation',
			JSON.stringify(['email'])
		)
		.run();
}

async function ensureGuide(destination, tenantId, db) {
	const existing = await db
		.prepare('SELECT id FROM dest_guides WHERE destination_id = ? AND tenant_id = ? LIMIT 1')
		.bind(destination.id, tenantId)
		.first();
	if (existing) return;

	const now = Date.now();
	const timeFrom = destination.arrival_date || null;
	const timeTo = destination.departure_date || null;
	await db
		.prepare(
			`INSERT INTO dest_guides
			(id, tenant_id, destination_id, guide_name, time_from, time_to, status, position, created_at,
			 person_in_charge, contact_name, contact_phone, contact_email, address, notes, stage, communication_channels_json)
			VALUES (?, ?, ?, ?, ?, ?, 'planned', 1, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
		)
		.bind(
			generateId(),
			tenantId,
			destination.id,
			`${destination.name} Guide (auto)`,
			timeFrom,
			timeTo,
			now,
			'System Auto CRM',
			'TBD',
			null,
			null,
			`${destination.name} (TBD guide meetup point)`,
			'Auto-created from service toggle on booking confirmation',
			JSON.stringify(['zalo'])
		)
		.run();
}

async function ensureLocalTransport(destination, tenantId, db) {
	const existing = await db
		.prepare('SELECT id FROM dest_local_transports WHERE destination_id = ? AND tenant_id = ? LIMIT 1')
		.bind(destination.id, tenantId)
		.first();
	if (existing) return;

	const now = Date.now();
	await db
		.prepare(
			`INSERT INTO dest_local_transports
			(id, tenant_id, destination_id, mode, supplier, pickup_time, pickup_place, dropoff_place, status, position, created_at,
			 person_in_charge, contact_name, contact_phone, contact_email, address, notes, stage, communication_channels_json)
			VALUES (?, ?, ?, 'van', ?, ?, ?, ?, 'planned', 1, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
		)
		.bind(
			generateId(),
			tenantId,
			destination.id,
			`${destination.name} Local Transport (auto)`,
			destination.arrival_date || null,
			`${destination.name} arrival`,
			`${destination.name} city center`,
			now,
			'System Auto CRM',
			'TBD',
			null,
			null,
			`${destination.name} (TBD transport operator address)`,
			'Auto-created from service toggle on booking confirmation',
			JSON.stringify(['sms'])
		)
		.run();
}

async function ensureIntercityLeg(destination, tenantId, db, mode = 'train') {
	const existing = await db
		.prepare('SELECT id FROM dest_intercity_legs WHERE destination_id = ? AND tenant_id = ? LIMIT 1')
		.bind(destination.id, tenantId)
		.first();
	if (existing) return;

	const now = Date.now();
	await db
		.prepare(
			`INSERT INTO dest_intercity_legs
			(id, tenant_id, destination_id, mode, supplier, depart_time, depart_point, arrive_point, status, position, created_at,
			 person_in_charge, contact_name, contact_phone, contact_email, address, notes, stage, communication_channels_json)
			VALUES (?, ?, ?, 'train', ?, ?, ?, ?, 'planned', 1, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
		)
		.bind(
			generateId(),
			tenantId,
			destination.id,
			`${destination.name} Intercity Leg (auto)`,
			destination.departure_date || destination.arrival_date || null,
			destination.name,
			'TBD',
			now,
			'System Auto CRM',
			'TBD',
			null,
			null,
			`${destination.name} (TBD departure terminal)`,
			'Auto-created from service toggle on booking confirmation',
			JSON.stringify(['email'])
		)
		.run();

	await db
		.prepare('UPDATE dest_intercity_legs SET mode = ? WHERE destination_id = ? AND tenant_id = ?')
		.bind(mode || 'train', destination.id, tenantId)
		.run();
}
