// Internal endpoints for admin.reforgedz.net to query linkages + transcripts.
// Gated by a shared bearer secret (INTERNAL_API_KEY) — separate from the
// transcript-upload API_KEY so they can be rotated independently.

const express = require("express");
const crypto = require("crypto");
const db = require("../db");
const logStore = require("../lib/logStore");

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

// Discord ↔ GUID linkage, derived from the transcripts table (most recent ticket).
// We pick the most recent row matching either side to keep usernames fresh.
// Tries the structured `guid` column first, then falls back to LIKE matching
// the GUID inside the `messages` JSON (historical tickets that captured the
// GUID as an "Arma Reforger UID" Q&A answer never populated the column).
router.get("/linkages/by-guid/:guid", (req, res) => {
	const guid = String(req.params.guid || "").trim().toLowerCase();
	if (!guid) return res.status(400).json({ error: "missing_guid" });
	const like = `%${guid}%`;
	const row = db.prepare(`
		SELECT created_by AS discordId, created_by_name AS discordUsername,
		       guid, closed_at AS lastSeenAt
		FROM transcripts
		WHERE created_by IS NOT NULL
		  AND (LOWER(guid) = ? OR LOWER(messages) LIKE ?)
		ORDER BY closed_at DESC
		LIMIT 1
	`).get(guid, like);
	if (!row) return res.status(404).json({ error: "not_found" });
	res.json({
		discordId: row.discordId,
		discordUsername: row.discordUsername,
		guid: row.guid || guid,
		lastSeenAt: row.lastSeenAt
	});
});

router.get("/linkages/by-discord-id/:id", (req, res) => {
	const did = String(req.params.id || "").trim();
	if (!did) return res.status(400).json({ error: "missing_discord_id" });
	const row = db.prepare(`
		SELECT created_by AS discordId, created_by_name AS discordUsername,
		       guid, closed_at AS lastSeenAt
		FROM transcripts
		WHERE created_by = ? AND guid IS NOT NULL
		ORDER BY closed_at DESC
		LIMIT 1
	`).get(did);
	if (!row) {
		// Fall back to just the Discord side (transcript present but no guid yet)
		const r2 = db.prepare(`
			SELECT created_by AS discordId, created_by_name AS discordUsername,
			       closed_at AS lastSeenAt
			FROM transcripts
			WHERE created_by = ?
			ORDER BY closed_at DESC
			LIMIT 1
		`).get(did);
		if (!r2) return res.status(404).json({ error: "not_found" });
		return res.json({
			discordId: r2.discordId,
			discordUsername: r2.discordUsername,
			guid: null,
			lastSeenAt: r2.lastSeenAt
		});
	}
	res.json({
		discordId: row.discordId,
		discordUsername: row.discordUsername,
		guid: row.guid,
		lastSeenAt: row.lastSeenAt
	});
});

// Transcripts matching a GUID or Discord ID — used to populate the
// "Transcripts" section on the player profile.
function listForFilter(whereClause, params, limit) {
	return db.prepare(`
		SELECT id, ticket_id, channel_name, category, created_by, created_by_name,
		       closed_by, closed_by_name, close_reason, closed_at,
		       auto_closed, restricted, guid
		FROM transcripts
		WHERE ${whereClause}
		ORDER BY closed_at DESC
		LIMIT ?
	`).all(...params, limit).map((r) => ({
		id: r.id,
		ticketId: r.ticket_id,
		channelName: r.channel_name,
		category: r.category,
		createdBy: r.created_by,
		createdByName: r.created_by_name,
		closedBy: r.closed_by,
		closedByName: r.closed_by_name,
		closeReason: r.close_reason,
		closedAt: r.closed_at,
		autoClosed: !!r.auto_closed,
		restricted: !!r.restricted,
		guid: r.guid
	}));
}

router.get("/transcripts/by-guid/:guid", (req, res) => {
	const guid = String(req.params.guid || "").trim().toLowerCase();
	if (!guid) return res.status(400).json({ error: "missing_guid" });
	const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
	// Match either:
	//   1. structured guid column (set by the bot at upload time)
	//   2. the GUID appearing anywhere in the messages content (covers
	//      tickets that captured it as an "Arma Reforger UID" Q&A answer)
	// Both forms supported so historical transcripts that didn't populate
	// the guid column still surface.
	const like = `%${guid}%`;
	res.json({
		transcripts: listForFilter(
			"(LOWER(guid) = ? OR LOWER(messages) LIKE ?)",
			[guid, like],
			limit
		)
	});
});

router.get("/transcripts/by-discord-id/:id", (req, res) => {
	const did = String(req.params.id || "").trim();
	if (!did) return res.status(400).json({ error: "missing_discord_id" });
	const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
	res.json({ transcripts: listForFilter("created_by = ?", [did], limit) });
});

// ─── Game logs ─────────────────────────────────────────────────────────────
// Query parameters:
//   guid        — match against player_guid / target_guid AND all
//                 historically-linked names for that guid
//   name        — case-insensitive equality on player_name / target_name
//                 (used by the top-level Logs tab's player search)
//   nameSearch  — case-insensitive substring on player_name / target_name
//   types       — comma-separated list of: anticheat,shop,kill,death,chat,base
//   servers     — comma-separated list of server tags (NA1, NA2, EU1, EU2)
//   q           — substring search across raw text / names / category
//   sinceMs / untilMs — optional time window
//   limit (<=500), offset
router.get("/logs", (req, res) => {
	try {
		const types = req.query.types ? String(req.query.types).split(",").map((s) => s.trim()).filter(Boolean) : null;
		const servers = req.query.servers ? String(req.query.servers).split(",").map((s) => s.trim()).filter(Boolean) : null;
		const rows = logStore.listLogs({
			guid: req.query.guid ? String(req.query.guid).trim().toLowerCase() : null,
			name: req.query.name ? String(req.query.name).trim() : null,
			types,
			servers,
			q: req.query.q ? String(req.query.q).trim() : null,
			since: req.query.sinceMs ? +req.query.sinceMs : null,
			until: req.query.untilMs ? +req.query.untilMs : null,
			limit: req.query.limit ? +req.query.limit : 100,
			offset: req.query.offset ? +req.query.offset : 0
		});
		res.json({ logs: rows });
	} catch (err) {
		console.error("[/api/internal/logs] error:", err);
		res.status(500).json({ error: "internal_error" });
	}
});

router.get("/logs/names-for-guid/:guid", (req, res) => {
	const guid = String(req.params.guid || "").trim().toLowerCase();
	if (!guid) return res.status(400).json({ error: "missing_guid" });
	res.json({ names: logStore.knownNamesForGuid(guid) });
});

// Manual link upsert — lets the admin server feed authoritative (name, guid)
// pairs (e.g. from BattleMetrics resolves) into the lookup table.
router.post("/logs/remember-link", express.json(), (req, res) => {
	const { name, guid, atMs } = req.body || {};
	if (!name || !guid) return res.status(400).json({ error: "missing_name_or_guid" });
	logStore.rememberLink(String(name), String(guid).toLowerCase(), +atMs || Date.now());
	res.json({ ok: true });
});

module.exports = router;
