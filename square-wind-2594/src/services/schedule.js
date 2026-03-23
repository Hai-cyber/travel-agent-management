/**
 * Schedule computation service for tours
 * CHK-103: Computes arrival/departure dates for destinations based on tour start_date + nights
 */

/**
 * Recompute schedule for all destinations in a tour.
 * @param {string} tourId - Tour ID
 * @param {object} db - D1 database binding
 * @returns {Promise<Array>} Array of destinations with computed arrival_date and departure_date
 * @throws {Error} if tour or destinations not found
 */
export async function recomputeSchedule(tourId, db) {
	// Fetch tour
	const tourResult = await db.prepare('SELECT id, start_date FROM tours WHERE id = ?').bind(tourId).first();
	if (!tourResult) {
		throw new Error(`Tour not found: ${tourId}`);
	}

	const tourStartDate = tourResult.start_date; // epoch milliseconds

	// Fetch all destinations for this tour, ordered by position
	const destinationsResult = await db
		.prepare('SELECT id, position, nights FROM destinations WHERE tour_id = ? ORDER BY position ASC')
		.bind(tourId)
		.all();

	if (!destinationsResult.results || destinationsResult.results.length === 0) {
		throw new Error(`No destinations found for tour: ${tourId}`);
	}

	const destinations = destinationsResult.results;
	const computed = [];

	// Compute arrival/departure for each destination
	let currentTime = tourStartDate;

	for (const dest of destinations) {
		// Arrival date = current accumulated time + small buffer for transitions (2 hours)
		const arrivalDate = currentTime + (computed.length === 0 ? 2 * 60 * 60 * 1000 : 4 * 60 * 60 * 1000);

		// Departure date = arrival + nights * 24 hours
		const departureDate = arrivalDate + dest.nights * 24 * 60 * 60 * 1000;

		computed.push({
			id: dest.id,
			position: dest.position,
			nights: dest.nights,
			arrival_date: arrivalDate,
			departure_date: departureDate,
		});

		// Update current time for next destination
		currentTime = departureDate;
	}

	return computed;
}

/**
 * Persist computed schedule back to D1.
 * @param {string} tourId - Tour ID
 * @param {Array} computedDestinations - Array of computed destinations
 * @param {object} db - D1 database binding
 * @returns {Promise<void>}
 */
export async function persistComputedSchedule(tourId, computedDestinations, db) {
	for (const dest of computedDestinations) {
		await db
			.prepare(
				`UPDATE destinations 
			SET arrival_date = ?, departure_date = ? 
			WHERE id = ? AND tour_id = ?`
			)
			.bind(dest.arrival_date, dest.departure_date, dest.id, tourId)
			.run();
	}
}
