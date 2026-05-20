// Server-Sent Events stream of ticket events for admin.reforgedz.net.
// Same Bearer-token auth as the rest of the /api/internal/tickets/* tree;
// the admin server keeps a long-lived EventSource connection to this URL
// and re-publishes events into its own bm-event bus.

const express = require("express");
const crypto = require("crypto");
const ticketBus = require("../lib/ticketBus");

const router = express.Router();

function authorize(req, res, next) {
	const expected = process.env.INTERNAL_API_KEY || "";
	if (!expected) return res.status(503).end();
	const header = req.headers.authorization || "";
	const prefix = "Bearer ";
	if (!header.startsWith(prefix)) return res.status(401).end();
	const got = Buffer.from(header.slice(prefix.length));
	const exp = Buffer.from(expected);
	if (got.length !== exp.length || !crypto.timingSafeEqual(got, exp)) return res.status(401).end();
	next();
}

router.get("/", authorize, (req, res) => {
	res.set({
		"Content-Type": "text/event-stream",
		"Cache-Control": "no-cache, no-transform",
		"Connection": "keep-alive",
		"X-Accel-Buffering": "no"
	});
	res.flushHeaders?.();
	res.write(`event: hello\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);

	const unsub = ticketBus.subscribe((evt) => {
		try {
			res.write(`event: ${evt.type}\ndata: ${JSON.stringify(evt)}\n\n`);
		} catch (err) {
			console.warn("[ticket-sse] write failed:", err.message);
		}
	});

	const keepalive = setInterval(() => {
		try { res.write(`: keepalive ${Date.now()}\n\n`); }
		catch { /* connection probably closed already */ }
	}, 25_000);

	req.on("close", () => {
		clearInterval(keepalive);
		unsub();
	});
});

module.exports = router;
