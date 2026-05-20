// Parse log text from Discord messages into structured rows. Each parser
// takes a single message's text content (which may contain multiple log
// lines) plus the message timestamp + channel mapping, and returns an array
// of parsed rows ready for insertion into the game_logs table.
//
// Timestamps in logs are HH:MM:SS only — we reconstruct the full date from
// the Discord message timestamp, rolling back a day if the log clock is
// "ahead" of the message clock (handles messages that contain log lines
// spanning a midnight wrap).

function uuidLower(s) {
	if (!s) return null;
	const m = String(s).trim().match(/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
	return m ? m[1].toLowerCase() : null;
}

function reconstructTs(messageDate, hhmmss) {
	const m = /^(\d{2}):(\d{2}):(\d{2})$/.exec(hhmmss);
	if (!m) return messageDate.getTime();
	const [h, mi, s] = [+m[1], +m[2], +m[3]];
	const base = new Date(messageDate);
	base.setUTCHours(h, mi, s, 0);
	// If reconstructed time is in the future relative to the message, the
	// log was from the previous day (clock wrap inside the message).
	if (base.getTime() > messageDate.getTime() + 60_000) base.setUTCDate(base.getUTCDate() - 1);
	return base.getTime();
}

function splitLines(text) {
	return String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

// ─── Anticheat ─────────────────────────────────────────────────────────────
// HH:MM:SS [SEVERITY] Category | Player: NAME | UID: GUID | details... | Pos: [x, y, z]
// or       [SERVER] Anti-cheat system initialized on ReforgedZ NAx
const AC_LINE = /^(\d{2}:\d{2}:\d{2})\s+\[([A-Z]+)\]\s+(.+)$/;
const AC_PLAYER = /Player:\s*([^|]+?)\s*\|/;
const AC_UID = /UID:\s*([0-9a-f-]{36})/i;
const AC_POS = /Pos:\s*\[([^\]]+)\]/;
const AC_SERVER_INIT = /Anti-cheat system initialized on ReforgedZ\s+(\S+)/;

function parseAnticheat(text, messageDate, mapping) {
	const out = [];
	for (const line of splitLines(text)) {
		const m = AC_LINE.exec(line);
		if (!m) continue;
		const [, ts, severity, body] = m;
		const tsMs = reconstructTs(messageDate, ts);

		// SERVER init lines have no player.
		const init = AC_SERVER_INIT.exec(body);
		if (init) {
			out.push({
				log_type: "anticheat",
				ts_ms: tsMs,
				server: init[1] || mapping.server || null,
				severity,
				category: "System Init",
				player_name: null,
				player_guid: null,
				target_name: null,
				target_guid: null,
				details: {},
				raw: line
			});
			continue;
		}

		// Body has shape "CATEGORY | Player: ... | UID: ... | rest..."
		const segs = body.split(/\s*\|\s*/);
		const category = (segs[0] || "").replace(/^\[[^\]]+\]\s*/, "").trim() || "Unknown";
		const playerMatch = AC_PLAYER.exec(body);
		const uidMatch = AC_UID.exec(body);
		const posMatch = AC_POS.exec(body);

		// "details" is everything that isn't category / player / uid / pos.
		const detailParts = segs
			.slice(1)
			.filter((s) => !/^Player:/i.test(s) && !/^UID:/i.test(s) && !/^Pos:/i.test(s));
		const details = {};
		if (detailParts.length) details.note = detailParts.join(" | ");
		if (posMatch) {
			const [x, y, z] = posMatch[1].split(/\s*,\s*/).map((n) => parseFloat(n));
			details.pos = { x, y, z };
		}

		out.push({
			log_type: "anticheat",
			ts_ms: tsMs,
			server: mapping.server || null,
			severity,
			category,
			player_name: playerMatch ? playerMatch[1].trim() : null,
			player_guid: uidMatch ? uuidLower(uidMatch[1]) : null,
			target_name: null,
			target_guid: null,
			details,
			raw: line
		});
	}
	return out;
}

// ─── Shop ──────────────────────────────────────────────────────────────────
// HH:MM:SS ReforgedZ <SERVER> | <ACTION>: <seller> sold <item> to <buyer> for <N> Caps
// HH:MM:SS ReforgedZ <SERVER> | <ACTION>: <buyer> bought <item> for <N> Caps
const SHOP_LINE = /^(\d{2}:\d{2}:\d{2})\s+ReforgedZ\s+(\S+)\s*\|\s*([A-Z]+):\s*(.+)$/;
const SHOP_SOLD = /^(.+?)\s+sold\s+(.+?)\s+to\s+(.+?)\s+for\s+(\d+)\s+Caps$/i;
const SHOP_BOUGHT = /^(.+?)\s+bought\s+(.+?)\s+for\s+(\d+)\s+Caps$/i;

function parseShop(text, messageDate, mapping) {
	const out = [];
	for (const line of splitLines(text)) {
		const m = SHOP_LINE.exec(line);
		if (!m) continue;
		const [, ts, server, action, rest] = m;
		const tsMs = reconstructTs(messageDate, ts);

		const sold = SHOP_SOLD.exec(rest);
		const bought = SHOP_BOUGHT.exec(rest);
		if (sold) {
			out.push({
				log_type: "shop",
				ts_ms: tsMs,
				server,
				severity: null,
				category: action.toUpperCase(),
				player_name: sold[1].trim(),
				player_guid: null,
				target_name: sold[3].trim(),
				target_guid: null,
				details: { item: sold[2].trim(), caps: +sold[4] },
				raw: line
			});
		} else if (bought) {
			out.push({
				log_type: "shop",
				ts_ms: tsMs,
				server,
				severity: null,
				category: action.toUpperCase(),
				player_name: bought[1].trim(),
				player_guid: null,
				target_name: null,
				target_guid: null,
				details: { item: bought[2].trim(), caps: +bought[3] },
				raw: line
			});
		} else {
			out.push({
				log_type: "shop",
				ts_ms: tsMs,
				server,
				severity: null,
				category: action.toUpperCase(),
				player_name: null,
				player_guid: null,
				target_name: null,
				target_guid: null,
				details: { note: rest },
				raw: line
			});
		}
	}
	return out;
}

// ─── Kill ──────────────────────────────────────────────────────────────────
// HH:MM:SS [Cat] killer killed [Cat] victim | weapon | <distance>m | <points> pts
// HH:MM:SS [Cat] player died
const KILL_KILL = /^(\d{2}:\d{2}:\d{2})\s+\[([^\]]+)\]\s+(.+?)\s+killed\s+\[([^\]]+)\]\s+(.+?)(?:\s*\|\s*(.+))?$/;
const KILL_DEATH = /^(\d{2}:\d{2}:\d{2})\s+\[([^\]]+)\]\s+(.+?)\s+died\s*$/;
const KILL_DETAIL = /^(.+?)\s*\|\s*(\d+(?:\.\d+)?)\s*m(?:\s*\|\s*(-?\d+)\s*pts)?$/i;

function parseKill(text, messageDate, mapping) {
	const out = [];
	for (const line of splitLines(text)) {
		let m = KILL_KILL.exec(line);
		if (m) {
			const [, ts, killerCat, killerName, victimCat, victimName, detail] = m;
			const tsMs = reconstructTs(messageDate, ts);
			const details = { killerCategory: killerCat, victimCategory: victimCat };
			if (detail) {
				const dm = KILL_DETAIL.exec(detail);
				if (dm) {
					details.weapon = dm[1].trim();
					details.distance = +dm[2];
					if (dm[3] != null) details.points = +dm[3];
				} else {
					details.note = detail.trim();
				}
			}
			out.push({
				log_type: "kill",
				ts_ms: tsMs,
				server: mapping.server || null,
				severity: null,
				category: "kill",
				player_name: killerName.trim(),
				player_guid: null,
				target_name: victimName.trim(),
				target_guid: null,
				details,
				raw: line
			});
			continue;
		}
		m = KILL_DEATH.exec(line);
		if (m) {
			const [, ts, cat, name] = m;
			out.push({
				log_type: "death",
				ts_ms: reconstructTs(messageDate, ts),
				server: mapping.server || null,
				severity: null,
				category: "death",
				player_name: name.trim(),
				player_guid: null,
				target_name: null,
				target_guid: null,
				details: { category: cat },
				raw: line
			});
		}
	}
	return out;
}

// ─── Chat ──────────────────────────────────────────────────────────────────
// HH:MM:SS <name>: <message>
const CHAT_LINE = /^(\d{2}:\d{2}:\d{2})\s+([^:]+):\s+(.*)$/;

function parseChat(text, messageDate, mapping) {
	const out = [];
	for (const line of splitLines(text)) {
		const m = CHAT_LINE.exec(line);
		if (!m) continue;
		out.push({
			log_type: "chat",
			ts_ms: reconstructTs(messageDate, m[1]),
			server: mapping.server || null,
			severity: null,
			category: "chat",
			player_name: m[2].trim(),
			player_guid: null,
			target_name: null,
			target_guid: null,
			details: { message: m[3] },
			raw: line
		});
	}
	return out;
}

// ─── Base ──────────────────────────────────────────────────────────────────
// Multi-line entries — each starts with "HH:MM:SS :emoji: TYPE | SERVER | HH:MM:SS"
// followed by zero or more "Key: value" continuation lines.
const BASE_HEADER = /^(\d{2}:\d{2}:\d{2})\s+:[a-z_]+:\s+(.+?)\s*\|\s*(\S+)\s*\|\s*\d{2}:\d{2}:\d{2}\s*$/;
const BASE_KV = /^([A-Za-z ][A-Za-z _]+):\s*(.+)$/;

function parseBase(text, messageDate /* , mapping */) {
	const out = [];
	const lines = splitLines(text);
	let current = null;
	for (const line of lines) {
		const h = BASE_HEADER.exec(line);
		if (h) {
			if (current) out.push(current);
			const [, ts, category, server] = h;
			current = {
				log_type: "base",
				ts_ms: reconstructTs(messageDate, ts),
				server,
				severity: null,
				category: category.trim(),
				player_name: null,
				player_guid: null,
				target_name: null,
				target_guid: null,
				details: {},
				raw: line
			};
			continue;
		}
		if (!current) continue;
		const kv = BASE_KV.exec(line);
		if (kv) {
			const key = kv[1].trim().toLowerCase();
			const val = kv[2].trim();
			current.details[key] = val;
			current.raw += "\n" + line;
			// Promote common actors onto top-level columns for cross-player search.
			if (key === "raider") current.player_name = val;
			else if (key === "owner" || key === "base owner") {
				if (current.target_name == null) current.target_name = val;
			}
		}
	}
	if (current) out.push(current);
	return out;
}

// ─── Public dispatcher ─────────────────────────────────────────────────────

function parseMessage(message, mapping) {
	// Aggregate text from message.content + every embed (description, fields).
	const chunks = [];
	if (message.content) chunks.push(message.content);
	for (const emb of message.embeds || []) {
		if (emb.description) chunks.push(emb.description);
		for (const f of emb.fields || []) chunks.push((f.name ? `${f.name}\n` : "") + (f.value || ""));
	}
	const text = chunks.join("\n");
	if (!text.trim()) return [];

	const messageDate = message.createdAt instanceof Date
		? message.createdAt
		: new Date(message.createdTimestamp || Date.now());

	switch (mapping.type) {
	case "anticheat": return parseAnticheat(text, messageDate, mapping);
	case "shop":      return parseShop(text, messageDate, mapping);
	case "kill":      return parseKill(text, messageDate, mapping);
	case "chat":      return parseChat(text, messageDate, mapping);
	case "base":      return parseBase(text, messageDate, mapping);
	default:          return [];
	}
}

module.exports = {
	parseMessage,
	// Exported for direct testing
	parseAnticheat, parseShop, parseKill, parseChat, parseBase,
	reconstructTs
};
