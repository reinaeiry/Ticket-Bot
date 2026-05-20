// Internal endpoints for admin.reforgedz.net to query linkages + transcripts.
// Gated by a shared bearer secret (INTERNAL_API_KEY) — separate from the
// transcript-upload API_KEY so they can be rotated independently.

const express = require("express");
const crypto = require("crypto");
const db = require("../db");

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
router.get("/linkages/by-guid/:guid", (req, res) => {
	const guid = String(req.params.guid || "").trim().toLowerCase();
	if (!guid) return res.status(400).json({ error: "missing_guid" });
	const row = db.prepare(`
		SELECT created_by AS discordId, created_by_name AS discordUsername,
		       guid, closed_at AS lastSeenAt
		FROM transcripts
		WHERE guid = ? AND created_by IS NOT NULL
		ORDER BY closed_at DESC
		LIMIT 1
	`).get(guid);
	if (!row) return res.status(404).json({ error: "not_found" });
	res.json({
		discordId: row.discordId,
		discordUsername: row.discordUsername,
		guid: row.guid,
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
	res.json({ transcripts: listForFilter("guid = ?", [guid], limit) });
});

router.get("/transcripts/by-discord-id/:id", (req, res) => {
	const did = String(req.params.id || "").trim();
	if (!did) return res.status(400).json({ error: "missing_discord_id" });
	const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
	res.json({ transcripts: listForFilter("created_by = ?", [did], limit) });
});

module.exports = router;
