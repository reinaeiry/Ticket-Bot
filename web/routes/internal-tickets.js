// Internal endpoints powering the admin.reforgedz.net Tickets relay.
//
// All routes are gated by INTERNAL_API_KEY (same Bearer pattern as the
// linkages + game-log routes). The Discord client is plucked off `req.app`
// (set by web/server.js when the bot boots the HTTP server).

const express = require("express");
const crypto = require("crypto");
const multer = require("multer");
const db = require("../db");
const ticketBus = require("../lib/ticketBus");
const { parseQA, extractGuid } = require("../lib/ticketParse");
const { permKeyForCode, isSupportedCode } = require("../lib/ticketCategories");
const { getClient, getPrisma } = require("../lib/clientHolder");
const { mapMessage } = require("../lib/ticketMessageShape");
const { closeTicketProgrammatic } = require("../../dist/utils/closeTicketProgrammatic");

const router = express.Router();

function authorize(req, res, next) {
	const expected = process.env.INTERNAL_API_KEY || "";
	if (!expected) return res.status(503).json({ error: "internal_api_disabled" });
	const header = req.headers.authorization || "";
	const prefix = "Bearer ";
	if (!header.startsWith(prefix)) return res.status(401).json({ error: "missing_bearer" });
	const got = Buffer.from(header.slice(prefix.length));
	const exp = Buffer.from(expected);
	if (got.length !== exp.length || !crypto.timingSafeEqual(got, exp)) {
		return res.status(401).json({ error: "bad_bearer" });
	}
	next();
}
router.use(authorize);

// Discord caps non-Nitro bot uploads at 10 MB. The admin server's pass-through
// route enforces the same limit; this is a defensive backstop.
const upload = multer({
	storage: multer.memoryStorage(),
	limits: { fileSize: 10 * 1024 * 1024, files: 5 }
});

const { RELAY_FOOTER_PREFIX } = require("../lib/ticketMessageShape");

function clientOrNull() { return getClient(); }
function prismaOrNull() { return getPrisma(); }

// ─── Prisma helpers ────────────────────────────────────────────────────────

async function listTicketRows(prisma, { status }) {
	const where = {};
	if (status === "open") where.closedat = null;
	else if (status === "closed") where.NOT = { closedat: null };
	return prisma.tickets.findMany({
		where,
		orderBy: [{ closedat: "asc" }, { createdat: "desc" }]
	});
}

async function loadOneTicket(prisma, channelId) {
	return prisma.tickets.findUnique({ where: { channelid: channelId } });
}

// ─── Shape mappers ─────────────────────────────────────────────────────────

function ticketSummary(row, client) {
	let cat = null;
	try { cat = JSON.parse(row.category); } catch { /* malformed */ }
	if (!cat || !isSupportedCode(cat.codeName)) return null;

	const guid = extractGuid(cat, row.reason);
	const creatorUser = client.users.cache.get(row.creator);
	const avatarUrl = creatorUser?.displayAvatarURL?.({ size: 64 }) || null;
	return {
		id: row.id,
		channelId: row.channelid,
		categoryKey: cat.codeName,
		categoryLabel: cat.name,
		permKey: permKeyForCode(cat.codeName),
		creator: {
			discordId: row.creator,
			discordName: creatorUser?.tag || row.creator,
			discordAvatarUrl: avatarUrl,
			guid
		},
		createdAt: Number(row.createdat),
		claimedBy: row.claimedby,
		claimedAt: row.claimedat ? Number(row.claimedat) : null,
		status: row.closedat ? "closed" : (row.claimedby ? "claimed" : "open"),
		closedAt: row.closedat ? Number(row.closedat) : null,
		transcript: row.transcript
	};
}

function ticketDetail(row, client) {
	const base = ticketSummary(row, client);
	if (!base) return null;
	let cat = null;
	try { cat = JSON.parse(row.category); } catch { /* malformed */ }
	return { ...base, qa: parseQA(cat, row.reason) };
}

// ─── Routes ────────────────────────────────────────────────────────────────

router.get("/", async (req, res) => {
	try {
		const status = String(req.query.status || "open");
		const wanted = req.query.categories
			? new Set(String(req.query.categories).split(",").map((s) => s.trim()).filter(Boolean))
			: null;
		const client = clientOrNull();
		if (!client) return res.status(503).json({ error: "discord_client_unavailable" });
		const rows = await listTicketRows(prismaOrNull(), { status });
		const out = [];
		for (const row of rows) {
			const s = ticketSummary(row, client);
			if (!s) continue;
			if (wanted && !wanted.has(s.permKey)) continue;
			out.push(s);
		}
		res.json({ tickets: out });
	} catch (err) {
		console.error("[/api/internal/tickets] error:", err);
		res.status(500).json({ error: "internal_error" });
	}
});

router.get("/:channelId", async (req, res) => {
	try {
		const client = clientOrNull();
		if (!client) return res.status(503).json({ error: "discord_client_unavailable" });
		const row = await loadOneTicket(prismaOrNull(), req.params.channelId);
		if (!row) return res.status(404).json({ error: "not_found" });
		const det = ticketDetail(row, client);
		if (!det) return res.status(404).json({ error: "unsupported_category" });
		res.json({ ticket: det });
	} catch (err) {
		console.error("[/api/internal/tickets/:id] error:", err);
		res.status(500).json({ error: "internal_error" });
	}
});

router.get("/:channelId/messages", async (req, res) => {
	try {
		const client = clientOrNull();
		if (!client) return res.status(503).json({ error: "discord_client_unavailable" });
		const ch = await client.channels.fetch(req.params.channelId).catch(() => null);
		if (!ch || !ch.isTextBased?.()) return res.status(404).json({ error: "channel_not_found" });
		const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
		const before = req.query.before || undefined;
		const fetched = await ch.messages.fetch({ limit, before });
		const botId = client.user?.id;
		// Discord returns newest-first; we want oldest-first for chat UI.
		const list = Array.from(fetched.values()).map((m) => mapMessage(m, botId));
		list.sort((a, b) => a.ts - b.ts);
		res.json({ messages: list });
	} catch (err) {
		console.error("[/api/internal/tickets/:id/messages] error:", err);
		res.status(500).json({ error: "internal_error" });
	}
});

router.post("/:channelId/messages", upload.array("files", 5), async (req, res) => {
	try {
		const client = clientOrNull();
		if (!client) return res.status(503).json({ error: "discord_client_unavailable" });
		const ch = await client.channels.fetch(req.params.channelId).catch(() => null);
		if (!ch || !ch.isTextBased?.()) return res.status(404).json({ error: "channel_not_found" });

		const content = String(req.body?.content || "").slice(0, 1900);
		// Username can come from form field (direct callers) or from the
		// admin server's query-param injection (used so the multipart body
		// stream can flow through without re-parsing on the admin side).
		const relayUsername = String(
			req.body?.relayUsername || req.query?.relayUsername || "unknown"
		).slice(0, 64);
		const files = (req.files || []).map((f) => ({
			attachment: f.buffer,
			name: f.originalname
		}));

		// Trailing embed carries the relay marker so the GET messages handler
		// can mark it isAdminRelay without an extra DB or message-id mapping.
		const sendBody = {
			files,
			content,
			embeds: [{
				color: 0x4f86c6,
				footer: { text: `${RELAY_FOOTER_PREFIX}${relayUsername}` }
			}]
		};
		const sent = await ch.send(sendBody);
		const mapped = mapMessage(sent, client.user?.id);

		// Resolve permKey from the ticket row so the admin-side SSE filter
		// can drop the event for users without that category perm.
		let permKey = null;
		try {
			const row = await prismaOrNull()?.tickets.findUnique({ where: { channelid: req.params.channelId } });
			const cat = row ? JSON.parse(row.category) : null;
			if (cat?.codeName) permKey = permKeyForCode(cat.codeName);
		} catch { /* best effort */ }

		// Echo through the bus immediately so the admin SPA sees its own
		// message arrive over SSE without waiting for messageCreate.
		ticketBus.publish({ type: "ticket.message", channelId: req.params.channelId, permKey, payload: mapped });

		res.json({ message: mapped });
	} catch (err) {
		console.error("[POST messages] error:", err);
		res.status(500).json({ error: "internal_error", detail: err?.message || "" });
	}
});

router.post("/:channelId/close", express.json(), async (req, res) => {
	try {
		const client = clientOrNull();
		if (!client) return res.status(503).json({ error: "discord_client_unavailable" });
		const { closedByDiscordId, closedByName, reason } = req.body || {};
		if (!closedByName) return res.status(400).json({ error: "missing_closer" });
		const result = await closeTicketProgrammatic(client, {
			channelId: req.params.channelId,
			closedByDiscordId: String(closedByDiscordId || "0"),
			closedByName: String(closedByName),
			reason: String(reason || "Closed via admin panel")
		});
		if (!result.ok) return res.status(400).json({ error: result.error || "close_failed" });
		let permKey = null;
		try {
			const row = await prismaOrNull()?.tickets.findUnique({ where: { channelid: req.params.channelId } });
			const cat = row ? JSON.parse(row.category) : null;
			if (cat?.codeName) permKey = permKeyForCode(cat.codeName);
		} catch { /* best effort */ }
		ticketBus.publish({
			type: "ticket.close",
			channelId: req.params.channelId,
			permKey,
			payload: { ticketId: result.ticketId, transcript: result.transcript }
		});
		res.json({ ok: true, transcript: result.transcript });
	} catch (err) {
		console.error("[POST close] error:", err);
		res.status(500).json({ error: "internal_error" });
	}
});

module.exports = router;
