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
		scope TEXT,
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
	CREATE INDEX IF NOT EXISTS idx_logs_scope ON game_logs(scope);

	CREATE TABLE IF NOT EXISTS name_to_guid (
		name TEXT NOT NULL,
		guid TEXT NOT NULL,
		last_seen_ms INTEGER NOT NULL,
		PRIMARY KEY (name, guid)
	);
	CREATE INDEX IF NOT EXISTS idx_n2g_name ON name_to_guid(name COLLATE NOCASE);
	CREATE INDEX IF NOT EXISTS idx_n2g_guid ON name_to_guid(guid);
`);

// Back-compat: add `scope` to existing tables if it's missing.
{
	const cols = db.prepare("PRAGMA table_info(game_logs)").all();
	if (!cols.some((c) => c.name === "scope")) {
		db.exec("ALTER TABLE game_logs ADD COLUMN scope TEXT");
		db.exec("CREATE INDEX IF NOT EXISTS idx_logs_scope ON game_logs(scope)");
	}
}

const insertLogStmt = db.prepare(`
	INSERT OR IGNORE INTO game_logs
		(channel_id, message_id, log_index, ts_ms, log_type, scope, server, severity,
		 category, player_name, player_guid, target_name, target_guid, details, raw)
	VALUES
		(@channel_id, @message_id, @log_index, @ts_ms, @log_type, @scope, @server, @severity,
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
// Derive the perm/filter scope for a row from its channel mapping.
//   Per-server channels (NA1/NA2/EU1/EU2 kill+chat) -> server tag
//   Region channels (NA/EU anticheat+shop)         -> region tag
//   Global base channel                            -> "ALL"
function scopeFor(mapping) {
	if (!mapping) return null;
	if (mapping.server) return mapping.server;            // NA1 / NA2 / EU1 / EU2
	if (mapping.region === "ALL") return "ALL";
	return mapping.region || null;                         // NA / EU
}

function ingestParsed(channelId, messageId, rows, mapping) {
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
		const scope = scopeFor(mapping);
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
				scope: scope,
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
	const pairs = (opts.scopePairs || []).map((p) => p.scope + ":" + p.type).join(",");
	return [
		opts.guid || "",
		opts.name || "",
		(opts.types || []).join(","),
		(opts.servers || []).join(","),
		(opts.scopes || []).join(","),
		pairs,
		opts.q || "",
		opts.since || "",
		opts.until || "",
		opts.limit,
		opts.offset
	].join("|");
}
// Live ingest invalidates the cache - small set so this stays cheap.
function clearHotCache() { hotCache.clear(); }

function listLogs({ guid, name, types, servers, scopes, scopePairs, q, since, until, limit = 100, offset = 0 } = {}) {
	const opts = { guid, name, types, servers, scopes, scopePairs, q, since, until, limit, offset };
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
	if (scopes && scopes.length) {
		where.push("scope IN (" + scopes.map(() => "?").join(",") + ")");
		params.push(...scopes);
	}
	// scopePairs: list of {scope, type} the user is allowed to see. Each
	// row must match at least one pair. This is the per-server perm gate.
	if (scopePairs && scopePairs.length) {
		const parts = scopePairs.map(() => "(scope = ? AND log_type = ?)");
		where.push("(" + parts.join(" OR ") + ")");
		for (const p of scopePairs) params.push(p.scope, p.type);
	}
	if (since) { where.push("ts_ms >= ?"); params.push(+since); }
	if (until) { where.push("ts_ms <= ?"); params.push(+until); }
	if (q) {
		where.push("(raw LIKE ? OR player_name LIKE ? OR target_name LIKE ? OR category LIKE ?)");
		const like = "%" + q + "%";
		params.push(like, like, like, like);
	}

	const sql = `
		SELECT id, channel_id, message_id, ts_ms, log_type, scope, server, severity, category,
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

// Roll-up stats for a single player. Counts kills, deaths (both environment
// deaths and being a kill target), then computes K/D and the mean
// inter-death interval as "avg time alive" — capped at 4 hours so massive
// offline gaps between sessions don't dominate the mean.
const stmtKillCount = db.prepare("SELECT COUNT(*) AS n FROM game_logs WHERE log_type = 'kill' AND player_guid = ?");
const stmtDeathStandalone = db.prepare("SELECT COUNT(*) AS n FROM game_logs WHERE log_type = 'death' AND player_guid = ?");
const stmtDeathAsTarget = db.prepare("SELECT COUNT(*) AS n FROM game_logs WHERE log_type = 'kill' AND target_guid = ?");
const stmtAllDeathTs = db.prepare(`
	SELECT ts_ms FROM game_logs
	WHERE (log_type = 'death' AND player_guid = ?)
	   OR (log_type = 'kill' AND target_guid = ?)
	ORDER BY ts_ms ASC
`);

const MAX_GAP_MS = 4 * 60 * 60 * 1000; // 4 hours

function playerStats(guid) {
	if (!guid) return null;
	const g = String(guid).toLowerCase();
	const kills = stmtKillCount.get(g).n;
	const deaths = stmtDeathStandalone.get(g).n + stmtDeathAsTarget.get(g).n;
	const ts = stmtAllDeathTs.all(g, g).map((r) => r.ts_ms);
	let gapSum = 0, gapN = 0;
	for (let i = 1; i < ts.length; i++) {
		const d = ts[i] - ts[i - 1];
		if (d > 0 && d <= MAX_GAP_MS) { gapSum += d; gapN++; }
	}
	return {
		kills,
		deaths,
		kdr: deaths === 0 ? (kills > 0 ? kills : 0) : (kills / deaths),
		avgAliveSec: gapN > 0 ? Math.round(gapSum / gapN / 1000) : null,
		samples: gapN,
		firstSeenMs: ts[0] || null,
		lastSeenMs: ts[ts.length - 1] || null
	};
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
	playerStats,
	getLastScrapedMessageId,
	getOldestScrapedMs
};
