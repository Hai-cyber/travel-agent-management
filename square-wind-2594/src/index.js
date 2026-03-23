/**
 * Tour Booking Worker [CHK-201, CHK-202, CHK-203]
 * Main entry point for API routes
 */

import { createTour, getTour, updateTour } from './routes/tours.js';
import {
	addDestination,
	updateDestination,
	deleteDestination,
	listDestinations,
	getDestinationServiceBlueprint,
	upsertDestinationServiceBlueprint,
} from './routes/destinations.js';
import {
	listTasks,
	getTask,
	updateTask,
	generateTasksForTourEndpoint,
	listReminderCandidates,
	markReminderSent,
} from './routes/tasks.js';
import { sendEmail, addNote, getThread, getMessages } from './routes/communication.js';
import { createServiceItem, listServiceItems, updateServiceItem } from './routes/service-items.js';
import { upsertCalendarConfig, getCalendarConfig, getTourCalendarFeed, getGoogleSyncPreview } from './routes/calendar.js';
import { getItinerary } from './routes/itinerary.js';
import { listMobileTasks, addMobileTaskNote, updateMobileTaskStatus } from './routes/mobile.js';
import { createSupplier, listSuppliers, updateSupplier } from './routes/suppliers.js';
import { getDomainConfig, upsertDomainConfig, verifyDomain } from './routes/domains.js';
import { getPublishGate, upsertPublishGate } from './routes/publish.js';
import { getBillingStatus, upsertBillingStatus } from './routes/billing.js';
import {
	getSiteConfig,
	upsertSiteConfig,
	getLegalPage,
	upsertLegalPage,
	getTourPublicContent,
	upsertTourPublicContent,
	getPublicSite,
	listPublicTours,
	getPublicTour,
} from './routes/site-studio.js';
import {
	getSiteLayout,
	upsertSiteLayout,
	maybeRenderHostedSite,
} from './routes/site-layouts.js';
import {
	getGrowthConfig,
	upsertGrowthConfig,
	getTourSeoMeta,
	upsertTourSeoMeta,
	upsertTourSlug,
	getPublicTourBySlug,
	getSitemapXml,
	getRobotsTxt,
	captureLead,
	captureGrowthEvent,
} from './routes/growth.js';
import {
	publicCreateBooking,
	publicGetBooking,
	publicPayBooking,
	listBookings,
	updateBooking,
} from './routes/bookings.js';
import {
	getBookingSettings,
	upsertBookingSettings,
	getPublicBookingSettings,
} from './routes/booking-settings.js';
import { errorResponse } from './lib/db.js';
import {
	attachTraceHeaders,
	createRequestContext,
	logRequestError,
	logRequestFinish,
	logRequestStart,
} from './lib/observability.js';

export default {
	async fetch(request, env, ctx) {
		const context = createRequestContext(request);
		logRequestStart(context);

		let routeName = 'not_found';

		try {
			const result = await dispatchRequest(request, env);
			routeName = result.routeName;
			const tracedResponse = attachTraceHeaders(result.response, context);
			logRequestFinish(context, tracedResponse, routeName);
			return tracedResponse;
		} catch (error) {
			logRequestError(context, error, routeName);
			const response = attachTraceHeaders(errorResponse('Unhandled worker error', 500), context);
			logRequestFinish(context, response, routeName);
			return response;
		}
	},
};

async function dispatchRequest(request, env) {
	const url = new URL(request.url);
	const pathParts = url.pathname.split('/').filter(Boolean);
	const serviceGroups = new Set(['accommodations', 'meals', 'guides', 'local-transports', 'intercity-legs']);
	const hostedSiteResponse = await maybeRenderHostedSite(request, env.DB);
	if (hostedSiteResponse) {
		return { routeName: 'hosted.site.render', response: hostedSiteResponse };
	}

	if (url.pathname === '/message') {
		return { routeName: 'demo.message', response: new Response('Hello, World!') };
	}

	if (url.pathname === '/random') {
		return { routeName: 'demo.random', response: new Response(crypto.randomUUID()) };
	}

	const redirectMap = new Map([
		['/test/saas-admin', '/'],
		['/test/agent-admin', '/'],
		['/test/saas-frontend', '/book.html'],
		['/test/traveler-frontend', '/book.html'],
		['/preview', '/'],
		['/live', '/'],
		['/pro', '/'],
	]);
	if (redirectMap.has(url.pathname)) {
		const target = redirectMap.get(url.pathname);
		return {
			routeName: 'env.redirect',
			response: Response.redirect(new URL(target, url.origin).toString(), 302),
		};
	}

	if (url.pathname === '/api/tours' && request.method === 'POST') {
		return { routeName: 'tours.create', response: await createTour(request, env.DB) };
	}

	if (pathParts.length === 4 && pathParts[0] === 'api' && pathParts[1] === 'tours' && pathParts[3] === 'destinations') {
		const tourId = pathParts[2];
		if (request.method === 'POST') {
			return { routeName: 'destinations.create', response: await addDestination(tourId, request, env.DB) };
		}
		if (request.method === 'GET') {
			return { routeName: 'destinations.list', response: await listDestinations(tourId, request, env.DB) };
		}
	}

	if (pathParts.length === 4 && pathParts[0] === 'api' && pathParts[1] === 'tours' && pathParts[3] === 'itinerary' && request.method === 'GET') {
		const tourId = pathParts[2];
		return { routeName: 'tours.itinerary', response: await getItinerary(tourId, request, env.DB) };
	}

	if (pathParts.length === 3 && pathParts[0] === 'api' && pathParts[1] === 'tours') {
		const tourId = pathParts[2];
		if (request.method === 'GET') {
			return { routeName: 'tours.get', response: await getTour(tourId, env.DB, request) };
		}
		if (request.method === 'PATCH') {
			return { routeName: 'tours.update', response: await updateTour(tourId, request, env.DB) };
		}
	}

	if (pathParts.length === 3 && pathParts[0] === 'api' && pathParts[1] === 'destinations' && request.method === 'PATCH') {
		const destId = pathParts[2];
		return { routeName: 'destinations.update', response: await updateDestination(destId, request, env.DB) };
	}

	if (pathParts.length === 3 && pathParts[0] === 'api' && pathParts[1] === 'destinations' && request.method === 'DELETE') {
		const destId = pathParts[2];
		return { routeName: 'destinations.delete', response: await deleteDestination(destId, request, env.DB) };
	}

	if (pathParts.length === 4 && pathParts[0] === 'api' && pathParts[1] === 'destinations' && pathParts[3] === 'service-blueprint') {
		const destId = pathParts[2];
		if (request.method === 'GET') {
			return { routeName: 'destinations.service_blueprint.get', response: await getDestinationServiceBlueprint(destId, request, env.DB) };
		}
		if (request.method === 'POST') {
			return { routeName: 'destinations.service_blueprint.upsert', response: await upsertDestinationServiceBlueprint(destId, request, env.DB) };
		}
	}

	if (pathParts.length === 4 && pathParts[0] === 'api' && pathParts[1] === 'destinations' && serviceGroups.has(pathParts[3])) {
		const destinationId = pathParts[2];
		const groupKey = pathParts[3];
		if (request.method === 'POST') {
			return { routeName: `services.${groupKey}.create`, response: await createServiceItem(groupKey, destinationId, request, env.DB) };
		}
		if (request.method === 'GET') {
			return { routeName: `services.${groupKey}.list`, response: await listServiceItems(groupKey, destinationId, request, env.DB) };
		}
	}

	if (pathParts.length === 3 && pathParts[0] === 'api' && serviceGroups.has(pathParts[1]) && request.method === 'PATCH') {
		const groupKey = pathParts[1];
		const itemId = pathParts[2];
		return { routeName: `services.${groupKey}.update`, response: await updateServiceItem(groupKey, itemId, request, env.DB) };
	}

	if (url.pathname === '/api/tasks/generate-for-tour' && request.method === 'POST') {
		return { routeName: 'tasks.generate_for_tour', response: await generateTasksForTourEndpoint(request, env.DB) };
	}

	if (url.pathname === '/api/tasks' && request.method === 'GET') {
		return { routeName: 'tasks.list', response: await listTasks(request, env.DB) };
	}

	if (url.pathname === '/api/suppliers') {
		if (request.method === 'POST') {
			return { routeName: 'suppliers.create', response: await createSupplier(request, env.DB) };
		}
		if (request.method === 'GET') {
			return { routeName: 'suppliers.list', response: await listSuppliers(request, env.DB) };
		}
	}

	if (url.pathname === '/api/mobile/tasks' && request.method === 'GET') {
		return { routeName: 'mobile.tasks.list', response: await listMobileTasks(request, env.DB) };
	}

	if (url.pathname === '/api/domain/config') {
		if (request.method === 'GET') {
			return { routeName: 'domain.config.get', response: await getDomainConfig(request, env.DB) };
		}
		if (request.method === 'POST') {
			return { routeName: 'domain.config.upsert', response: await upsertDomainConfig(request, env.DB) };
		}
	}

	if (url.pathname === '/api/domain/verify' && request.method === 'POST') {
		return { routeName: 'domain.verify', response: await verifyDomain(request, env.DB) };
	}

	if (url.pathname === '/api/publish/gate') {
		if (request.method === 'GET') {
			return { routeName: 'publish.gate.get', response: await getPublishGate(request, env.DB) };
		}
		if (request.method === 'POST') {
			return { routeName: 'publish.gate.upsert', response: await upsertPublishGate(request, env.DB) };
		}
	}

	if (url.pathname === '/api/billing/status') {
		if (request.method === 'GET') {
			return { routeName: 'billing.status.get', response: await getBillingStatus(request, env.DB) };
		}
		if (request.method === 'POST') {
			return { routeName: 'billing.status.upsert', response: await upsertBillingStatus(request, env.DB) };
		}
	}

	if (url.pathname === '/api/site/config') {
		if (request.method === 'GET') {
			return { routeName: 'site.config.get', response: await getSiteConfig(request, env.DB) };
		}
		if (request.method === 'POST') {
			return { routeName: 'site.config.upsert', response: await upsertSiteConfig(request, env.DB) };
		}
	}

	if (url.pathname === '/api/site/layout') {
		if (request.method === 'GET') {
			return { routeName: 'site.layout.get', response: await getSiteLayout(request, env.DB) };
		}
		if (request.method === 'POST') {
			return { routeName: 'site.layout.upsert', response: await upsertSiteLayout(request, env.DB) };
		}
	}

	if (url.pathname === '/api/site/pages') {
		if (request.method === 'GET') {
			return { routeName: 'site.pages.get', response: await getLegalPage(request, env.DB) };
		}
		if (request.method === 'POST') {
			return { routeName: 'site.pages.upsert', response: await upsertLegalPage(request, env.DB) };
		}
	}

	if (pathParts.length === 5 && pathParts[0] === 'api' && pathParts[1] === 'site' && pathParts[2] === 'tours' && pathParts[4] === 'content') {
		const tourId = pathParts[3];
		if (request.method === 'GET') {
			return { routeName: 'site.tours.content.get', response: await getTourPublicContent(tourId, request, env.DB) };
		}
		if (request.method === 'POST') {
			return { routeName: 'site.tours.content.upsert', response: await upsertTourPublicContent(tourId, request, env.DB) };
		}
	}

	if (url.pathname === '/public/site' && request.method === 'GET') {
		return { routeName: 'public.site.get', response: await getPublicSite(request, env.DB) };
	}

	if (url.pathname === '/public/tours' && request.method === 'GET') {
		return { routeName: 'public.tours.list', response: await listPublicTours(request, env.DB) };
	}

	if (pathParts.length === 4 && pathParts[0] === 'public' && pathParts[1] === 'tours' && pathParts[2] === 'slug' && request.method === 'GET') {
		const slug = pathParts[3];
		return { routeName: 'public.tours.slug.get', response: await getPublicTourBySlug(slug, request, env.DB) };
	}

	if (pathParts.length === 3 && pathParts[0] === 'public' && pathParts[1] === 'tours' && request.method === 'GET') {
		const tourId = pathParts[2];
		return { routeName: 'public.tours.get', response: await getPublicTour(tourId, request, env.DB) };
	}

	if (url.pathname === '/api/growth/config') {
		if (request.method === 'GET') {
			return { routeName: 'growth.config.get', response: await getGrowthConfig(request, env.DB) };
		}
		if (request.method === 'POST') {
			return { routeName: 'growth.config.upsert', response: await upsertGrowthConfig(request, env.DB) };
		}
	}

	if (pathParts.length === 5 && pathParts[0] === 'api' && pathParts[1] === 'growth' && pathParts[2] === 'tours' && pathParts[4] === 'seo') {
		const tourId = pathParts[3];
		if (request.method === 'GET') {
			return { routeName: 'growth.tours.seo.get', response: await getTourSeoMeta(tourId, request, env.DB) };
		}
		if (request.method === 'POST') {
			return { routeName: 'growth.tours.seo.upsert', response: await upsertTourSeoMeta(tourId, request, env.DB) };
		}
	}

	if (pathParts.length === 5 && pathParts[0] === 'api' && pathParts[1] === 'growth' && pathParts[2] === 'tours' && pathParts[4] === 'slug' && request.method === 'POST') {
		const tourId = pathParts[3];
		return { routeName: 'growth.tours.slug.upsert', response: await upsertTourSlug(tourId, request, env.DB) };
	}

	if (url.pathname === '/public/leads/contact' && request.method === 'POST') {
		return { routeName: 'public.leads.contact.capture', response: await captureLead(request, env.DB) };
	}

	if (url.pathname === '/public/events' && request.method === 'POST') {
		return { routeName: 'public.events.capture', response: await captureGrowthEvent(request, env.DB) };
	}

	if (url.pathname === '/sitemap.xml' && request.method === 'GET') {
		return { routeName: 'public.sitemap', response: await getSitemapXml(request, env.DB) };
	}

	if (url.pathname === '/robots.txt' && request.method === 'GET') {
		return { routeName: 'public.robots', response: await getRobotsTxt(request, env.DB) };
	}

	if (url.pathname === '/public/bookings' && request.method === 'POST') {
		return { routeName: 'public.bookings.create', response: await publicCreateBooking(request, env.DB) };
	}

	if (url.pathname === '/public/booking-settings' && request.method === 'GET') {
		return { routeName: 'public.booking_settings.get', response: await getPublicBookingSettings(request, env.DB) };
	}

	if (pathParts.length === 4 && pathParts[0] === 'public' && pathParts[1] === 'bookings' && pathParts[3] === 'pay' && request.method === 'POST') {
		const bookingId = pathParts[2];
		return { routeName: 'public.bookings.pay', response: await publicPayBooking(bookingId, request, env.DB) };
	}

	if (pathParts.length === 3 && pathParts[0] === 'public' && pathParts[1] === 'bookings' && request.method === 'GET') {
		const bookingId = pathParts[2];
		return { routeName: 'public.bookings.get', response: await publicGetBooking(bookingId, request, env.DB) };
	}

	if (url.pathname === '/api/bookings' && request.method === 'GET') {
		return { routeName: 'api.bookings.list', response: await listBookings(request, env.DB) };
	}

	if (url.pathname === '/api/booking-settings') {
		if (request.method === 'GET') {
			return { routeName: 'api.booking_settings.get', response: await getBookingSettings(request, env.DB) };
		}
		if (request.method === 'POST') {
			return { routeName: 'api.booking_settings.upsert', response: await upsertBookingSettings(request, env.DB) };
		}
	}

	if (pathParts.length === 3 && pathParts[0] === 'api' && pathParts[1] === 'bookings' && request.method === 'PATCH') {
		const bookingId = pathParts[2];
		return { routeName: 'api.bookings.update', response: await updateBooking(bookingId, request, env.DB) };
	}

	if (url.pathname === '/api/tasks/reminders/candidates' && request.method === 'GET') {
		return { routeName: 'tasks.reminders.candidates', response: await listReminderCandidates(request, env.DB) };
	}

	if (pathParts.length === 3 && pathParts[0] === 'api' && pathParts[1] === 'tasks') {
		const taskId = pathParts[2];
		if (request.method === 'GET') {
			return { routeName: 'tasks.get', response: await getTask(taskId, request, env.DB) };
		}
		if (request.method === 'PATCH') {
			return { routeName: 'tasks.update', response: await updateTask(taskId, request, env.DB) };
		}
	}

	if (pathParts.length === 5 && pathParts[0] === 'api' && pathParts[1] === 'tasks' && pathParts[3] === 'reminders' && pathParts[4] === 'mark-sent' && request.method === 'POST') {
		const taskId = pathParts[2];
		return { routeName: 'tasks.reminders.mark_sent', response: await markReminderSent(taskId, request, env.DB) };
	}

	if (pathParts.length === 5 && pathParts[0] === 'api' && pathParts[1] === 'mobile' && pathParts[2] === 'tasks' && pathParts[4] === 'note' && request.method === 'POST') {
		const taskId = pathParts[3];
		return { routeName: 'mobile.tasks.note', response: await addMobileTaskNote(taskId, request, env.DB) };
	}

	if (pathParts.length === 5 && pathParts[0] === 'api' && pathParts[1] === 'mobile' && pathParts[2] === 'tasks' && pathParts[4] === 'status' && request.method === 'POST') {
		const taskId = pathParts[3];
		return { routeName: 'mobile.tasks.status', response: await updateMobileTaskStatus(taskId, request, env.DB) };
	}

	if (pathParts.length === 3 && pathParts[0] === 'api' && pathParts[1] === 'suppliers' && request.method === 'PATCH') {
		const supplierId = pathParts[2];
		return { routeName: 'suppliers.update', response: await updateSupplier(supplierId, request, env.DB) };
	}

	if (url.pathname === '/api/calendar/config') {
		if (request.method === 'GET') {
			return { routeName: 'calendar.config.get', response: await getCalendarConfig(request, env.DB) };
		}
		if (request.method === 'POST') {
			return { routeName: 'calendar.config.upsert', response: await upsertCalendarConfig(request, env.DB) };
		}
	}

	if (pathParts.length === 5 && pathParts[0] === 'api' && pathParts[1] === 'calendar' && pathParts[2] === 'tours' && pathParts[4] === 'tasks.ics' && request.method === 'GET') {
		const tourId = pathParts[3];
		return { routeName: 'calendar.tour.feed', response: await getTourCalendarFeed(tourId, request, env.DB) };
	}

	if (pathParts.length === 6 && pathParts[0] === 'api' && pathParts[1] === 'calendar' && pathParts[2] === 'tours' && pathParts[4] === 'google-sync' && pathParts[5] === 'preview' && request.method === 'GET') {
		const tourId = pathParts[3];
		return { routeName: 'calendar.tour.google_sync_preview', response: await getGoogleSyncPreview(tourId, request, env.DB) };
	}

	if (pathParts.length === 4 && pathParts[0] === 'api' && pathParts[1] === 'threads' && pathParts[3] === 'note' && request.method === 'POST') {
		const threadId = pathParts[2];
		return { routeName: 'threads.add_note', response: await addNote(threadId, request, env.DB) };
	}

	if (pathParts.length === 4 && pathParts[0] === 'api' && pathParts[1] === 'threads' && pathParts[3] === 'messages' && request.method === 'GET') {
		const threadId = pathParts[2];
		return { routeName: 'threads.messages', response: await getMessages(threadId, request, env.DB) };
	}

	if (url.pathname.match(/^\/api\/threads\/[^/]+\/[^/]+\/email$/) && request.method === 'POST') {
		const match = url.pathname.match(/^\/api\/threads\/([^/]+)\/([^/]+)\/email$/);
		if (match) {
			const [, entityType, entityId] = match;
			return { routeName: 'threads.send_email', response: await sendEmail(entityType, entityId, request, env.DB) };
		}
	}

	if (url.pathname.match(/^\/api\/threads\/[^/]+\/[^/]+$/) && request.method === 'GET') {
		const match = url.pathname.match(/^\/api\/threads\/([^/]+)\/([^/]+)$/);
		if (match) {
			const [, entityType, entityId] = match;
			return { routeName: 'threads.get', response: await getThread(entityType, entityId, request, env.DB) };
		}
	}

	return { routeName: 'not_found', response: errorResponse('Not Found', 404) };
}
