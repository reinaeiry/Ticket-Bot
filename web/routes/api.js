const express = require("express");
const crypto = require("crypto");
const db = require("../db");
const { requireAuth, requireApiKey } = require("../middleware/auth");

const router = express.Router();

// POST /api/upload - Bot uploads a transcript
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
		} = req.body;

		const id = crypto.randomUUID();
		const messageCount = Array.isArray(messages) ? messages.length : 0;

		db.prepare(`
			INSERT INTO transcripts (id, ticket_id, channel_name, category, created_by, created_by_name, closed_by, closed_by_name, close_reason, closed_at, message_count, messages)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
		);

		res.json({ id });
	} catch (err) {
		console.error("Upload error:", err);
		res.status(500).json({ error: "Failed to save transcript" });
	}
});

// GET /api/transcript/:id - Get a single transcript (public)
router.get("/transcript/:id", (req, res) => {
	const row = db.prepare("SELECT * FROM transcripts WHERE id = ?").get(req.params.id);
	if (!row) return res.status(404).json({ error: "Transcript not found" });

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
		messages: JSON.parse(row.messages),
	});
});

// GET /api/tickets - Admin search/list tickets
router.get("/tickets", requireAuth, (req, res) => {
	const { search, page = 1, limit = 50 } = req.query;
	const offset = (parseInt(page) - 1) * parseInt(limit);

	let where = "";
	let params = [];

	if (search && search.trim()) {
		const s = `%${search.trim()}%`;
		where = `WHERE channel_name LIKE ? OR created_by_name LIKE ? OR close_reason LIKE ? OR category LIKE ? OR CAST(ticket_id AS TEXT) LIKE ?`;
		params = [s, s, s, s, s];
	}

	const countRow = db.prepare(`SELECT COUNT(*) as total FROM transcripts ${where}`).get(...params);
	const rows = db.prepare(`
		SELECT id, ticket_id, channel_name, category, created_by_name, closed_by_name, close_reason, closed_at, message_count
		FROM transcripts ${where}
		ORDER BY closed_at DESC
		LIMIT ? OFFSET ?
	`).all(...params, parseInt(limit), offset);

	res.json({
		tickets: rows.map((r) => ({
			id: r.id,
			ticketId: r.ticket_id,
			channelName: r.channel_name,
			category: r.category,
			createdByName: r.created_by_name,
			closedByName: r.closed_by_name,
			closeReason: r.close_reason,
			closedAt: r.closed_at,
			messageCount: r.message_count,
		})),
		total: countRow.total,
		page: parseInt(page),
		totalPages: Math.ceil(countRow.total / parseInt(limit)),
	});
});

// DELETE /api/transcript/:id - Admin delete a transcript
router.delete("/transcript/:id", requireAuth, (req, res) => {
	const result = db.prepare("DELETE FROM transcripts WHERE id = ?").run(req.params.id);
	if (result.changes === 0) return res.status(404).json({ error: "Not found" });
	res.json({ success: true });
});

module.exports = router;
