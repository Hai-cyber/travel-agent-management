/**
 * Task Service [CHK-202]
 * Task generation and management helpers
 */

/**
 * Generate tasks from all service items in a tour.
 * Creates one task per service (accommodation, meal, guide, transport).
 * @param {string} tourId - Tour ID
 * @param {object} db - D1 database binding
 * @returns {Promise<Array>} Array of created task IDs
 */
export async function generateTasksForTour(tourId, db) {
	const createdIds = [];

	// Fetch tour to get tenant_id and to verify it exists
	const tour = await db.prepare('SELECT id, tenant_id FROM tours WHERE id = ?').bind(tourId).first();

	if (!tour) {
		throw new Error(`Tour not found: ${tourId}`);
	}

	const tenantId = tour.tenant_id;

	// Fetch all destinations for this tour
	const dests = await db
		.prepare('SELECT id FROM destinations WHERE tour_id = ? AND tenant_id = ?')
		.bind(tourId, tenantId)
		.all();

	if (!dests.results || dests.results.length === 0) {
		return [];
	}

	const destIds = dests.results.map((d) => d.id);

	// Helper to create tasks for a service type
	async function createTasksForServiceType(serviceType, table, nameField, timeField) {
		const placeholders = destIds.map(() => '?').join(',');
		const query = `SELECT id, ${nameField} as name, ${timeField} as due_at 
			FROM ${table} 
			WHERE destination_id IN (${placeholders}) 
			AND tenant_id = ?`;
		const result = await db.prepare(query).bind(...destIds, tenantId).all();

		for (const item of result.results || []) {
			const taskId = crypto.randomUUID();
			await db
				.prepare(
					`INSERT INTO tasks 
				(id, tenant_id, booking_id, service_entity_type, service_entity_id, title, due_at, status)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
				)
				.bind(
					taskId,
					tenantId,
					tourId,
					serviceType,
					item.id,
					`Confirm: ${item.name || serviceType}`,
					item.due_at,
					'pending'
				)
				.run();
			createdIds.push(taskId);
		}
	}

	// Generate tasks for all service types
	await createTasksForServiceType('accommodation', 'dest_accommodations', 'hotel_name', 'check_in');
	await createTasksForServiceType('meal', 'dest_meals', 'restaurant_name', 'meal_datetime');
	await createTasksForServiceType('guide', 'dest_guides', 'guide_name', 'time_from');
	await createTasksForServiceType('local_transport', 'dest_local_transports', 'mode', 'pickup_time');
	await createTasksForServiceType('intercity_leg', 'dest_intercity_legs', 'mode', 'depart_time');

	return createdIds;
}

/**
 * Get tasks due for notification within specified hours.
 * @param {object} db - D1 database binding
 * @param {number} hoursBeforeDue - Look ahead hours (e.g., 48 for tasks due within 48h)
 * @returns {Promise<Array>} Array of tasks
 */
export async function getTasksDueForNotice(db, hoursBeforeDue = 48) {
	const now = Date.now();
	const lookAheadMs = hoursBeforeDue * 60 * 60 * 1000;
	const cutoffTime = now + lookAheadMs;

	const result = await db
		.prepare(
			`SELECT id, tenant_id, title, due_at, status, last_notice_at
		FROM tasks
		WHERE due_at > ? AND due_at <= ? AND status IN ('pending', 'confirmed')
		AND (last_notice_at IS NULL OR last_notice_at < ?)
		ORDER BY due_at ASC`
		)
		.bind(now, cutoffTime, now - 24 * 60 * 60 * 1000)
		.all();

	return result.results || [];
}

/**
 * Update task notice timestamp.
 * @param {string} taskId - Task ID
 * @param {object} db - D1 database binding
 * @returns {Promise<void>}
 */
export async function updateTaskNoticeTime(taskId, db) {
	const now = Date.now();
	await db.prepare('UPDATE tasks SET last_notice_at = ? WHERE id = ?').bind(now, taskId).run();
}

/**
 * Get reminder candidates for remaining tasks based on tour start cadence.
 * Cadence: monthly, 14d, 7d, 3d before tour start.
 * @param {object} db - D1 database binding
 * @param {number} now - epoch ms
 * @returns {Promise<Array>} reminder candidates
 */
export async function getTourStartReminderCandidates(db, now = Date.now()) {
	const tasksResult = await db
		.prepare(
			`SELECT t.id, t.tenant_id, t.booking_id, t.title, t.status, t.due_at,
				tr.start_date as tour_start_date,
				tr.created_at as booking_date
			FROM tasks t
			JOIN tours tr ON tr.id = t.booking_id AND tr.tenant_id = t.tenant_id
			WHERE t.booking_id IS NOT NULL
			AND t.status NOT IN ('confirmed', 'completed', 'canceled')
			AND tr.start_date IS NOT NULL`
		)
		.all();

	const candidates = [];
	for (const task of tasksResult.results || []) {
		const schedule = buildTourReminderSchedule(task.booking_date, task.tour_start_date);
		for (const reminder of schedule) {
			if (reminder.trigger_at > now) {
				continue;
			}

			const existing = await db
				.prepare('SELECT 1 FROM task_reminder_logs WHERE task_id = ? AND reminder_key = ? LIMIT 1')
				.bind(task.id, reminder.key)
				.first();

			if (!existing) {
				candidates.push({
					task_id: task.id,
					tenant_id: task.tenant_id,
					tour_id: task.booking_id,
					title: task.title,
					reminder_key: reminder.key,
					trigger_at: reminder.trigger_at,
					cadence: reminder.cadence,
					tour_start_date: task.tour_start_date,
				});
			}
		}
	}

	return candidates.sort((left, right) => left.trigger_at - right.trigger_at);
}

/**
 * Persist reminder dispatch to avoid duplicate sends.
 * @param {string} taskId
 * @param {string} reminderKey
 * @param {object} db
 * @param {number} sentAt
 */
export async function markTourStartReminderSent(taskId, reminderKey, db, sentAt = Date.now()) {
	await db
		.prepare('INSERT INTO task_reminder_logs (task_id, reminder_key, sent_at) VALUES (?, ?, ?)')
		.bind(taskId, reminderKey, sentAt)
		.run();
}

function buildTourReminderSchedule(bookingDate, tourStartDate) {
	const reminders = [];
	const monthly = buildMonthlyReminderPoints(bookingDate, tourStartDate);
	for (const point of monthly) {
		reminders.push({
			key: `monthly:${point}`,
			cadence: 'monthly',
			trigger_at: point,
		});
	}

	const dayOffsets = [14, 7, 3];
	for (const days of dayOffsets) {
		const point = tourStartDate - days * 24 * 60 * 60 * 1000;
		if (point >= bookingDate) {
			reminders.push({
				key: `before_start:${days}d`,
				cadence: `${days}d`,
				trigger_at: point,
			});
		}
	}

	return reminders;
}

function buildMonthlyReminderPoints(bookingDate, tourStartDate) {
	if (!bookingDate || !tourStartDate || bookingDate >= tourStartDate) {
		return [];
	}

	const points = [];
	const cursor = new Date(bookingDate);

	while (cursor.getTime() < tourStartDate) {
		points.push(cursor.getTime());
		cursor.setUTCMonth(cursor.getUTCMonth() + 1);
	}

	return points;
}
