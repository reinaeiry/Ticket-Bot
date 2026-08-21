const express = require("express");
const crypto = require("crypto");
const db = require("../db");
const { requireApiKey, requireRead, requireStats, hasRestrictedAccess, canSeeCategory, allowedRestrictedCodes } = require("../middleware/auth");
const { codeForCategoryName } = require("../lib/ticketCategories");
const authAudit = require("../lib/authAudit");

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
			guid,
			categoryCode,
		} = req.body;

		const id = crypto.randomUUID();
		const messageCount = Array.isArray(messages) ? messages.length : 0;

		// Pull the ticket-opener's avatar from the first message they authored
		// in-channel (the bot's intro message pings them, their first reply
		// carries the avatar URL).
		let createdByAvatar = null;
		if (createdBy && Array.isArray(messages)) {
			for (const m of messages) {
				if (m?.author?.id === createdBy && m.author.avatar) {
					createdByAvatar = String(m.author.avatar);
					break;
				}
			}
		}

		db.prepare(`
			INSERT INTO transcripts (id, ticket_id, channel_name, category, category_code, created_by, created_by_name, closed_by, closed_by_name, close_reason, closed_at, message_count, messages, auto_closed, restricted, guid, created_by_avatar)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`).run(
			id,
			ticketId || null,
			channelName || null,
			category || null,
			// Prefer the code the bot sent; fall back to resolving the display name so a
			// bot running older code still produces gate-able rows.
			(typeof categoryCode === "string" && categoryCode.trim()) ? categoryCode.trim() : codeForCategoryName(category),
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
			(typeof guid === "string" && guid.trim()) ? guid.trim().toLowerCase() : null,
			createdByAvatar,
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

	// Restricted transcripts are gated per CATEGORY, not by one blanket flag —
	// see canSeeCategory() in middleware/auth.js.
	if (row.restricted && !canSeeCategory(req, row.category_code)) {
		return res.status(401).json({ error: "Restricted transcript — you do not have access to this ticket category" });
	}

	// Record the view for logged-in admins (public share-link views, where
	// there's no rzUser session, are not audited).
	authAudit.auditView(req, "view.transcript", `transcript:${row.id}`, {
		ticketId: row.ticket_id,
		channelName: row.channel_name,
		targetName: row.created_by_name || null,
		restricted: !!row.restricted
	});

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

function buildListQuery({ search, includeAutoClosed, includeRestricted, allowedCodes }) {
	const clauses = [];
	const params = [];

	if (!includeRestricted) {
		clauses.push("(restricted = 0 OR restricted IS NULL)");
	} else if (Array.isArray(allowedCodes)) {
		// Show unrestricted rows, plus restricted rows only in the categories this
		// caller is cleared for. An empty allow-list therefore hides every
		// restricted row rather than showing all of them.
		if (allowedCodes.length === 0) {
			clauses.push("(restricted = 0 OR restricted IS NULL)");
		} else {
			clauses.push(`((restricted = 0 OR restricted IS NULL) OR category_code IN (${allowedCodes.map(() => "?").join(",")}))`);
			params.push(...allowedCodes);
		}
	}
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

// GET /api/tickets - Admin table.
// Requires transcripts.read. Restricted transcripts are included only if the
// caller also has transcripts.restricted (or explicitly opts out via ?showRestricted=0).
router.get("/tickets", requireRead, (req, res) => {
	const { search, page = 1, limit = 50, showAutoClosed, showRestricted } = req.query;
	const offset = (parseInt(page) - 1) * parseInt(limit);

	// Audit the admin table browse (deduped; search term in detail).
	authAudit.auditView(req, "view.transcriptsTable", search ? `search` : "browse", { search: search || undefined });

	const allowedCodes = allowedRestrictedCodes(req);
	const canSeeRestricted = allowedCodes.length > 0;
	const includeRestricted = canSeeRestricted && (showRestricted !== "0" && showRestricted !== "false");

	const { where, params } = buildListQuery({
		search,
		includeAutoClosed: showAutoClosed === "1" || showAutoClosed === "true",
		includeRestricted,
		allowedCodes,
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

// GET /api/stats/staff - per-staff close counts (requires transcripts.stats).
// Optional ?since=<ms> to constrain to a time window. Restricted transcripts are
// only counted if the caller also has transcripts.restricted.
router.get("/stats/staff", requireStats, (req, res) => {
	const since = parseInt(req.query.since, 10) || 0;
	const allowedCodes = allowedRestrictedCodes(req);
	const canSeeRestricted = allowedCodes.length > 0;

	const clauses = ["closed_by_name IS NOT NULL", "TRIM(closed_by_name) != ''", "(auto_closed = 0 OR auto_closed IS NULL)"];
	const params = [];
	if (!canSeeRestricted) {
		clauses.push("(restricted = 0 OR restricted IS NULL)");
	} else {
		clauses.push(`((restricted = 0 OR restricted IS NULL) OR category_code IN (${allowedCodes.map(() => "?").join(",")}))`);
		params.push(...allowedCodes);
	}
	if (since > 0) {
		clauses.push("closed_at >= ?");
		params.push(since);
	}
	const where = `WHERE ${clauses.join(" AND ")}`;

	const rows = db.prepare(`
		SELECT closed_by_name AS name, closed_by AS userId, COUNT(*) AS count,
		       MAX(closed_at) AS lastClosedAt
		FROM transcripts
		${where}
		GROUP BY closed_by_name, closed_by
		ORDER BY count DESC
	`).all(...params);

	const total = rows.reduce((sum, r) => sum + r.count, 0);

	res.json({
		staff: rows,
		total,
		since,
		includesRestricted: canSeeRestricted
	});
});

module.exports = router;
