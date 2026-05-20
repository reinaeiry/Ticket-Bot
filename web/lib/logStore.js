// SQLite store for parsed game logs. Reuses the transcripts DB so we don't
// have to ship a second sqlite file. Provides idempotent insert + indexed
// queries for the admin panel.

const db = require("../db");

db.exec(`
	CREATE TABLE IF NOT EXISTS game_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		channel_id TEXT NOT NULL,
		message_id TEXT NOT NULL,
		log_index INTEGER NOT NULL,
		ts_ms INTEGER NOT NULL,
		log_type TEXT NOT NULL,
		server TEXT,
		severity TEXT,
		category TEXT,
		player_name TEXT,
		player_guid TEXT,
		target_name TEXT,
		target_guid TEXT,
		details TEXT,
		raw TEXT NOT NULL,
		UNIQUE(channel_id, message_id, log_index)
	);

	CREATE INDEX IF NOT EXISTS idx_logs_ts ON game_logs(ts_ms DESC);
	CREATE INDEX IF NOT EXISTS idx_logs_player_guid ON game_logs(player_guid);
	CREATE INDEX IF NOT EXISTS idx_logs_player_name ON game_logs(player_name COLLATE NOCASE);
	CREATE INDEX IF NOT EXISTS idx_logs_target_name ON game_logs(target_name COLLATE NOCASE);
	CREATE INDEX IF NOT EXISTS idx_logs_type ON game_logs(log_type);
	CREATE INDEX IF NOT EXISTS idx_logs_server ON game_logs(server);

	CREATE TABLE IF NOT EXISTS name_to_guid (
		name TEXT NOT NULL,
		guid TEXT NOT NULL,
		last_seen_ms INTEGER NOT NULL,
		PRIMARY KEY (name, guid)
	);
	CREATE INDEX IF NOT EXISTS idx_n2g_name ON name_to_guid(name COLLATE NOCASE);
	CREATE INDEX IF NOT EXISTS idx_n2g_guid ON name_to_guid(guid);
`);

const insertLogStmt = db.prepare(`
	INSERT OR IGNORE INTO game_logs
		(channel_id, message_id, log_index, ts_ms, log_type, server, severity,
		 category, player_name, player_guid, target_name, target_guid, details, raw)
	VALUES
		(@channel_id, @message_id, @log_index, @ts_ms, @log_type, @server, @severity,
		 @category, @player_name, @player_guid, @target_name, @target_guid, @details, @raw)
`);

const upsertNameStmt = db.prepare(`
	INSERT INTO name_to_guid (name, guid, last_seen_ms)
	VALUES (?, ?, ?)
	ON CONFLICT(name, guid) DO UPDATE SET last_seen_ms = excluded.last_seen_ms
`);

const lookupGuidStmt = db.prepare(`
	SELECT guid FROM name_to_guid
	WHERE name = ? COLLATE NOCASE
	ORDER BY last_seen_ms DESC
	LIMIT 1
`);

const lookupNamesStmt = db.prepare(`
	SELECT name FROM name_to_guid WHERE guid = ?
`);

// Insert a batch of parsed rows in a single transaction. Pre-resolves
// player_guid via the name_to_guid table when the parser didn't supply one,
// and feeds the table with any (name, guid) pairs the parser DID supply.
function ingestParsed(channelId, messageId, rows) {
	if (!rows || !rows.length) return 0;
	let inserted = 0;
	const tx = db.transaction(() => {
		// First pass: harvest names→guids from rows that gave us both.
		for (const r of rows) {
			if (r.player_name && r.player_guid) {
				upsertNameStmt.run(r.player_name, r.player_guid, r.ts_ms);
			}
			if (r.target_name && r.target_guid) {
				upsertNameStmt.run(r.target_name, r.target_guid, r.ts_ms);
			}
		}
		// Second pass: backfill missing guids from the table, then insert.
		rows.forEach((r, idx) => {
			if (!r.player_guid && r.player_name) {
				const hit = lookupGuidStmt.get(r.player_name);
				if (hit) r.player_guid = hit.guid;
			}
			if (!r.target_guid && r.target_name) {
				const hit = lookupGuidStmt.get(r.target_name);
				if (hit) r.target_guid = hit.guid;
			}
			const info = insertLogStmt.run({
				channel_id: channelId,
				message_id: messageId,
				log_index: idx,
				ts_ms: r.ts_ms,
				log_type: r.log_type,
				server: r.server || null,
				severity: r.severity || null,
				category: r.category || null,
				player_name: r.player_name || null,
				player_guid: r.player_guid || null,
				target_name: r.target_name || null,
				target_guid: r.target_guid || null,
				details: r.details ? JSON.stringify(r.details) : null,
				raw: r.raw
			});
			if (info.changes) inserted++;
		});
	});
	tx();
	if (inserted) clearHotCache();
	return inserted;
}

// Backfill known (name, guid) pairs from external sources (e.g. transcripts
// table's guid column or BattleMetrics lookups passed in by the bot).
function rememberLink(name, guid, atMs) {
	if (!name || !guid) return;
	upsertNameStmt.run(name, guid, atMs || Date.now());
}

function knownNamesForGuid(guid) {
	return lookupNamesStmt.all(guid).map((r) => r.name);
}

// Query API ────────────────────────────────────────────────────────────────

// Small in-process cache for the hot paths (top-of-list page with no
// search query). Most "Logs" tab traffic hits this and it lets us serve
// repeated requests in microseconds without touching SQLite.
const HOT_CACHE_TTL_MS = 10_000;
const hotCache = new Map();
function hotKey(opts) {
	return [
		opts.guid || "",
		opts.name || "",
		(opts.types || []).join(","),
		(opts.servers || []).join(","),
		opts.q || "",
		opts.since || "",
		opts.until || "",
		opts.limit,
		opts.offset
	].join("|");
}
// Live ingest invalidates the cache - small set so this stays cheap.
function clearHotCache() { hotCache.clear(); }

function listLogs({ guid, name, types, servers, q, since, until, limit = 100, offset = 0 } = {}) {
	const opts = { guid, name, types, servers, q, since, until, limit, offset };
	const k = hotKey(opts);
	const hit = hotCache.get(k);
	if (hit && hit.expiresAt > Date.now()) return hit.value;
	const where = [];
	const params = [];

	// Player filter: GUID match OR known-names-for-guid OR the explicit name.
	if (guid) {
		const names = knownNamesForGuid(guid);
		const parts = ["player_guid = ?", "target_guid = ?"];
		params.push(guid, guid);
		for (const n of names) {
			parts.push("player_name = ? COLLATE NOCASE");
			parts.push("target_name = ? COLLATE NOCASE");
			params.push(n, n);
		}
		where.push("(" + parts.join(" OR ") + ")");
	} else if (name) {
		where.push("(player_name = ? COLLATE NOCASE OR target_name = ? COLLATE NOCASE)");
		params.push(name, name);
	}

	if (types && types.length) {
		where.push("log_type IN (" + types.map(() => "?").join(",") + ")");
		params.push(...types);
	}
	if (servers && servers.length) {
		where.push("server IN (" + servers.map(() => "?").join(",") + ")");
		params.push(...servers);
	}
	if (since) { where.push("ts_ms >= ?"); params.push(+since); }
	if (until) { where.push("ts_ms <= ?"); params.push(+until); }
	if (q) {
		where.push("(raw LIKE ? OR player_name LIKE ? OR target_name LIKE ? OR category LIKE ?)");
		const like = "%" + q + "%";
		params.push(like, like, like, like);
	}

	const sql = `
		SELECT id, channel_id, message_id, ts_ms, log_type, server, severity, category,
		       player_name, player_guid, target_name, target_guid, details, raw
		FROM game_logs
		${where.length ? "WHERE " + where.join(" AND ") : ""}
		ORDER BY ts_ms DESC
		LIMIT ? OFFSET ?
	`;
	params.push(Math.min(+limit || 100, 500), Math.max(+offset || 0, 0));
	const out = db.prepare(sql).all(...params).map((r) => ({
		...r,
		details: r.details ? JSON.parse(r.details) : null
	}));
	hotCache.set(k, { value: out, expiresAt: Date.now() + HOT_CACHE_TTL_MS });
	// Keep the cache bounded — drop oldest if we grow past ~64 entries.
	if (hotCache.size > 64) {
		const oldest = hotCache.keys().next().value;
		hotCache.delete(oldest);
	}
	return out;
}

function getLastScrapedMessageId(channelId) {
	const row = db.prepare("SELECT message_id FROM game_logs WHERE channel_id = ? ORDER BY ts_ms DESC LIMIT 1").get(channelId);
	return row ? row.message_id : null;
}

function getOldestScrapedMs(channelId) {
	const row = db.prepare("SELECT MIN(ts_ms) AS t FROM game_logs WHERE channel_id = ?").get(channelId);
	return row && row.t ? row.t : null;
}

module.exports = {
	ingestParsed,
	rememberLink,
	knownNamesForGuid,
	listLogs,
	getLastScrapedMessageId,
	getOldestScrapedMs
};
