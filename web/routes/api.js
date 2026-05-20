const express = require("express");
const crypto = require("crypto");
const db = require("../db");
const { requireApiKey, requireStats, hasRestrictedAccess } = require("../middleware/auth");

const router = express.Router();

// POST /api/upload - Bot uploads a transcript (API key, not session)
router.post("/upload", requireApiKey, (req, res) => {
	try {
		const {
			ticketId,
			channelName,
			category,
			createdBy,
			createdByName,
			closedBy,
			closedByName,
			closeReason,
			messages,
			autoClosed,
			restricted,
		} = req.body;

		const id = crypto.randomUUID();
		const messageCount = Array.isArray(messages) ? messages.length : 0;

		db.prepare(`
			INSERT INTO transcripts (id, ticket_id, channel_name, category, created_by, created_by_name, closed_by, closed_by_name, close_reason, closed_at, message_count, messages, auto_closed, restricted)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`).run(
			id,
			ticketId || null,
			channelName || null,
			category || null,
			createdBy || null,
			createdByName || null,
			closedBy || null,
			closedByName || null,
			closeReason || null,
			Date.now(),
			messageCount,
			JSON.stringify(messages || []),
			autoClosed ? 1 : 0,
			restricted ? 1 : 0,
		);

		res.json({ id });
	} catch (err) {
		console.error("Upload error:", err);
		res.status(500).json({ error: "Failed to save transcript" });
	}
});

// GET /api/transcript/:id - View a single transcript.
// Open to anyone with the share link, but restricted transcripts require the
// transcripts.restricted perm on the viewer's SSO account.
router.get("/transcript/:id", (req, res) => {
	const row = db.prepare("SELECT * FROM transcripts WHERE id = ?").get(req.params.id);
	if (!row) return res.status(404).json({ error: "Transcript not found" });

	if (row.auto_closed) {
		return res.status(403).json({ error: "Auto-closed tickets have no transcript" });
	}

	if (row.restricted && !hasRestrictedAccess(req)) {
		return res.status(401).json({ error: "Restricted transcript — requires Access Restricted Transcripts permission" });
	}

	res.json({
		id: row.id,
		ticketId: row.ticket_id,
		channelName: row.channel_name,
		category: row.category,
		createdBy: row.created_by,
		createdByName: row.created_by_name,
		closedBy: row.closed_by,
		closedByName: row.closed_by_name,
		closeReason: row.close_reason,
		closedAt: row.closed_at,
		messageCount: row.message_count,
		autoClosed: !!row.auto_closed,
		restricted: !!row.restricted,
		messages: JSON.parse(row.messages),
	});
});

function buildListQuery({ search, includeAutoClosed, includeRestricted }) {
	const clauses = [];
	const params = [];

	if (!includeRestricted) clauses.push("(restricted = 0 OR restricted IS NULL)");
	if (!includeAutoClosed) clauses.push("(auto_closed = 0 OR auto_closed IS NULL)");

	if (search && search.trim()) {
		const s = `%${search.trim()}%`;
		clauses.push(`(channel_name LIKE ? OR created_by_name LIKE ? OR closed_by_name LIKE ? OR close_reason LIKE ? OR category LIKE ? OR created_by LIKE ? OR closed_by LIKE ? OR id LIKE ? OR CAST(ticket_id AS TEXT) LIKE ? OR messages LIKE ?)`);
		params.push(s, s, s, s, s, s, s, s, s, s);
	}

	const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
	return { where, params };
}

function mapListRow(r) {
	return {
		id: r.id,
		ticketId: r.ticket_id,
		channelName: r.channel_name,
		category: r.category,
		createdByName: r.created_by_name,
		closedByName: r.closed_by_name,
		closeReason: r.close_reason,
		closedAt: r.closed_at,
		messageCount: r.message_count,
		autoClosed: !!r.auto_closed,
		restricted: !!r.restricted,
	};
}

// GET /api/tickets - Admin stats / table.
// Requires transcripts.stats. Restricted transcripts are included only if the
// caller also has transcripts.restricted (or explicitly opts out via ?showRestricted=0).
router.get("/tickets", requireStats, (req, res) => {
	const { search, page = 1, limit = 50, showAutoClosed, showRestricted } = req.query;
	const offset = (parseInt(page) - 1) * parseInt(limit);

	const canSeeRestricted = hasRestrictedAccess(req);
	const includeRestricted = canSeeRestricted && (showRestricted !== "0" && showRestricted !== "false");

	const { where, params } = buildListQuery({
		search,
		includeAutoClosed: showAutoClosed === "1" || showAutoClosed === "true",
		includeRestricted,
	});

	const countRow = db.prepare(`SELECT COUNT(*) as total FROM transcripts ${where}`).get(...params);
	const rows = db.prepare(`
		SELECT id, ticket_id, channel_name, category, created_by_name, closed_by_name, close_reason, closed_at, message_count, auto_closed, restricted
		FROM transcripts ${where}
		ORDER BY closed_at DESC
		LIMIT ? OFFSET ?
	`).all(...params, parseInt(limit), offset);

	res.json({
		tickets: rows.map(mapListRow),
		total: countRow.total,
		page: parseInt(page),
		totalPages: Math.ceil(countRow.total / parseInt(limit)),
		canSeeRestricted,
	});
});

module.exports = router;
