// In-process pub/sub for ticket events. Publishers (messageCreate, the
// internal POST handler, close helpers) call publish(); the SSE route
// subscribe()s and pipes events to admin.reforgedz.net.
//
// Mirrors the eventBus on the admin server side, kept dependency-free.

const subscribers = new Set();

function publish(event) {
	const payload = { ts: Date.now(), ...event };
	for (const fn of subscribers) {
		try { fn(payload); }
		catch (err) { console.error("[ticketBus] subscriber threw:", err); }
	}
}

function subscribe(fn) {
	subscribers.add(fn);
	return () => subscribers.delete(fn);
}

module.exports = { publish, subscribe };
