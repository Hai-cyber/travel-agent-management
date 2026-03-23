/**
 * Itinerary Routes [CHK-303]
 * GET /api/tours/:tourId/itinerary
 */

import { getTenantId, successResponse, validationError, notFoundResponse, internalError } from '../lib/db.js';

const SERVICE_DEFINITIONS = [
	{ label: 'Accommodation', table: 'dest_accommodations', field: 'hotel_name' },
	{ label: 'Meals', table: 'dest_meals', field: 'restaurant_name' },
	{ label: 'Guide', table: 'dest_guides', field: 'guide_name' },
	{ label: 'Local Transport', table: 'dest_local_transports', field: 'supplier' },
	{ label: 'Intercity Leg', table: 'dest_intercity_legs', field: 'supplier' },
];

export async function getItinerary(tourId, request, db) {
	try {
		const tenantId = getTenantId(request);
		const url = new URL(request.url);
		const format = normalizeFormat(url.searchParams.get('format'));
		const includeDestinationText = parseBooleanFlag(url.searchParams.get('includeDestinationText'), true);
		const lang = url.searchParams.get('lang');
		if (!format) {
			return validationError('format must be one of: markdown, md, html');
		}
		if (includeDestinationText === null) {
			return validationError('includeDestinationText must be true/false/1/0');
		}

		const tour = await db
			.prepare('SELECT id, tenant_id, title, lang, start_date, duration_text FROM tours WHERE id = ? AND tenant_id = ?')
			.bind(tourId, tenantId)
			.first();

		if (!tour) {
			return notFoundResponse('Tour not found');
		}

		const contentLang = lang || tour.lang || 'vi';
		const destinationsResult = await db
			.prepare(
				`SELECT id, name, position, nights, arrival_date, departure_date
				FROM destinations
				WHERE tour_id = ? AND tenant_id = ?
				ORDER BY position ASC`
			)
			.bind(tourId, tenantId)
			.all();

		const destinations = destinationsResult.results || [];
		const blocks = [];

		for (const destination of destinations) {
			const text = includeDestinationText
				? await getDestinationText(destination.id, tenantId, contentLang, db)
				: null;
			const services = await getDestinationServices(destination.id, tenantId, db);
			blocks.push({ destination, text, services });
		}

		const content =
			format === 'html'
				? renderItineraryHtml({ tour, blocks, lang: contentLang, includeDestinationText })
				: renderItineraryMarkdown({ tour, blocks, lang: contentLang, includeDestinationText });

		return successResponse({
			tour_id: tourId,
			format,
			lang: contentLang,
			include_destination_text: includeDestinationText,
			content,
		});
	} catch (error) {
		return internalError(`Failed to build itinerary: ${error.message}`);
	}
}

async function getDestinationText(destinationId, tenantId, lang, db) {
	const exact = await db
		.prepare(
			`SELECT summary, details, notes, lang
			FROM destination_texts
			WHERE destination_id = ? AND tenant_id = ? AND lang = ?
			LIMIT 1`
		)
		.bind(destinationId, tenantId, lang)
		.first();
	if (exact) {
		return exact;
	}

	return db
		.prepare(
			`SELECT summary, details, notes, lang
			FROM destination_texts
			WHERE destination_id = ? AND tenant_id = ?
			ORDER BY updated_at DESC
			LIMIT 1`
		)
		.bind(destinationId, tenantId)
		.first();
}

async function getDestinationServices(destinationId, tenantId, db) {
	const items = [];
	for (const service of SERVICE_DEFINITIONS) {
		const result = await db
			.prepare(
				`SELECT ${service.field} as name
				FROM ${service.table}
				WHERE destination_id = ? AND tenant_id = ?
				ORDER BY position ASC, created_at ASC`
			)
			.bind(destinationId, tenantId)
			.all();

		items.push({
			label: service.label,
			names: (result.results || []).map((row) => row.name).filter(Boolean),
		});
	}
	return items;
}

function renderItineraryMarkdown({ tour, blocks, lang, includeDestinationText }) {
	const lines = [];
	lines.push(`# ${tour.title}`);
	lines.push('');
	lines.push(`- Language: ${lang}`);
	lines.push(`- Start date: ${formatDate(tour.start_date)}`);
	lines.push(`- Duration: ${tour.duration_text || 'N/A'}`);
	lines.push('');

	if (!blocks.length) {
		lines.push('_No destinations added yet._');
		return lines.join('\n');
	}

	for (let index = 0; index < blocks.length; index += 1) {
		const block = blocks[index];
		const { destination, text, services } = block;
		lines.push(`## Day ${index + 1}: ${destination.name}`);
		lines.push(`- Nights: ${destination.nights}`);
		lines.push(`- Arrival: ${formatDateTime(destination.arrival_date)}`);
		lines.push(`- Departure: ${formatDateTime(destination.departure_date)}`);

		if (includeDestinationText && text) {
			if (text.summary) {
				lines.push(`- Summary: ${text.summary}`);
			}
			if (text.details) {
				lines.push(`- Details: ${text.details}`);
			}
		}

		lines.push('');
		lines.push('### Services');
		for (const service of services) {
			if (!service.names.length) {
				lines.push(`- ${service.label}: none`);
				continue;
			}
			lines.push(`- ${service.label}: ${service.names.join(', ')}`);
		}
		lines.push('');
	}

	return lines.join('\n').trim();
}

function renderItineraryHtml({ tour, blocks, lang, includeDestinationText }) {
	const sectionHtml = blocks
		.map((block, index) => {
			const { destination, text, services } = block;
			const servicesHtml = services
				.map((service) => {
					const names = service.names.length ? escapeHtml(service.names.join(', ')) : 'none';
					return `<li><strong>${escapeHtml(service.label)}:</strong> ${names}</li>`;
				})
				.join('');

			const textHtml =
				includeDestinationText && text
					? `<div class="dest-text">${
						text.summary ? `<p><strong>Summary:</strong> ${escapeHtml(text.summary)}</p>` : ''
					}${text.details ? `<p><strong>Details:</strong> ${escapeHtml(text.details)}</p>` : ''}</div>`
					: '';

			return `<section>
				<h2>Day ${index + 1}: ${escapeHtml(destination.name)}</h2>
				<ul>
					<li><strong>Nights:</strong> ${destination.nights}</li>
					<li><strong>Arrival:</strong> ${escapeHtml(formatDateTime(destination.arrival_date))}</li>
					<li><strong>Departure:</strong> ${escapeHtml(formatDateTime(destination.departure_date))}</li>
				</ul>
				${textHtml}
				<h3>Services</h3>
				<ul>${servicesHtml}</ul>
			</section>`;
		})
		.join('');

	const emptyState = blocks.length ? '' : '<p>No destinations added yet.</p>';

	return `<!doctype html>
<html lang="${escapeHtml(lang)}">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>${escapeHtml(tour.title)} - Itinerary</title>
	</head>
	<body>
		<main>
			<h1>${escapeHtml(tour.title)}</h1>
			<p><strong>Language:</strong> ${escapeHtml(lang)}</p>
			<p><strong>Start date:</strong> ${escapeHtml(formatDate(tour.start_date))}</p>
			<p><strong>Duration:</strong> ${escapeHtml(tour.duration_text || 'N/A')}</p>
			${emptyState}
			${sectionHtml}
		</main>
	</body>
</html>`;
}

function normalizeFormat(value) {
	if (!value || value === 'markdown' || value === 'md') {
		return 'markdown';
	}
	if (value === 'html') {
		return 'html';
	}
	return null;
}

function parseBooleanFlag(value, defaultValue) {
	if (value === null) {
		return defaultValue;
	}
	if (value === '1' || value === 'true') {
		return true;
	}
	if (value === '0' || value === 'false') {
		return false;
	}
	return null;
}

function formatDate(timestamp) {
	if (!timestamp) {
		return 'N/A';
	}
	return new Date(timestamp).toISOString().slice(0, 10);
}

function formatDateTime(timestamp) {
	if (!timestamp) {
		return 'N/A';
	}
	return new Date(timestamp).toISOString();
}

function escapeHtml(value) {
	return String(value)
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}
