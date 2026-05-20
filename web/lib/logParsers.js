// Parse log text from Discord messages into structured rows.
//
// Real messages use Discord's `<t:UNIX:T>` time tag (NOT plain HH:MM:SS as
// rendered in the client) and **bold** markdown around names and category
// labels. We preprocess every line to strip bold and lift out the unix
// timestamp so the remaining shape matches the human-readable form.

function uuidLower(s) {
	if (!s) return null;
	const m = String(s).trim().match(/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
	return m ? m[1].toLowerCase() : null;
}

const TIME_TAG = /^<t:(\d+):[tTfFRD]>\s*/;
const TIME_TAG_INLINE = /<t:(\d+):[tTfFRD]>/g;

// Strip **bold** markdown wrappers (and __bold__) but preserve everything
// inside. Also strips backtick-wrapped code spans. Leaves zero-width
// invisible chars untouched — those don't show up in this dataset.
function stripMd(s) {
	return String(s || "")
		.replace(/\*\*([^*]+)\*\*/g, "$1")
		.replace(/__([^_]+)__/g, "$1")
		.replace(/`([^`]+)`/g, "$1");
}

// Pull a per-line timestamp from the leading `<t:UNIX:T>` tag. Returns
// { tsMs, rest } where rest is the line with the tag stripped. If the line
// has no tag, falls back to the surrounding message's timestamp.
function takeTs(line, messageMs) {
	const m = TIME_TAG.exec(line);
	if (m) {
		const ts = parseInt(m[1], 10) * 1000;
		return { tsMs: ts, rest: line.slice(m[0].length).trim() };
	}
	// Lines that don't lead with a tag (continuation lines on multi-line
	// base events) get the surrounding message's timestamp.
	return { tsMs: messageMs, rest: line };
}

function splitLines(text) {
	// Normalize bold and remove any inline timestamp tags after the leading
	// one (the leading tag is parsed separately by takeTs).
	return String(text || "")
		.split(/\r?\n/)
		.map((l) => stripMd(l).trim())
		.filter(Boolean);
}

// Replace inline timestamp tags AFTER the leading one with their HH:MM:SS
// form (purely cosmetic — keeps the `raw` field readable in the UI).
function tagsToTime(s) {
	return s.replace(TIME_TAG_INLINE, (_, n) => {
		const d = new Date(parseInt(n, 10) * 1000);
		const pad = (x) => String(x).padStart(2, "0");
		return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
	});
}

// ─── Anticheat ─────────────────────────────────────────────────────────────
// [SEVERITY] Category | Player: NAME | UID: GUID | details | Pos: [x, y, z]
// or       [SERVER] Anti-cheat system initialized on ReforgedZ NAx
const AC_HEAD = /^\[([A-Z]+)\]\s+(.+)$/;
const AC_PLAYER = /Player:\s*([^|]+?)\s*(?:\||$)/;
const AC_UID = /UID:\s*([0-9a-f-]{36})/i;
const AC_POS = /Pos:\s*\[([^\]]+)\]/;
const AC_SERVER_INIT = /Anti-cheat system initialized on ReforgedZ\s+(\S+)/;

function parseAnticheat(text, messageMs, mapping) {
	const out = [];
	for (const rawLine of splitLines(text)) {
		const { tsMs, rest } = takeTs(rawLine, messageMs);
		const m = AC_HEAD.exec(rest);
		if (!m) continue;
		const [, severity, body] = m;

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
				raw: tagsToTime(rawLine)
			});
			continue;
		}

		const segs = body.split(/\s*\|\s*/);
		const category = (segs[0] || "").trim() || "Unknown";
		const playerMatch = AC_PLAYER.exec(body);
		const uidMatch = AC_UID.exec(body);
		const posMatch = AC_POS.exec(body);

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
			raw: tagsToTime(rawLine)
		});
	}
	return out;
}

// ─── Shop ──────────────────────────────────────────────────────────────────
// ReforgedZ <SERVER> | <ACTION>: <seller> sold <item> to <buyer> for <N> Caps
const SHOP_HEAD = /^ReforgedZ\s+(\S+)\s*\|\s*([A-Z]+):\s*(.+)$/;
const SHOP_SOLD = /^(.+?)\s+sold\s+(.+?)\s+to\s+(.+?)\s+for\s+(\d+)\s+Caps$/i;
const SHOP_BOUGHT = /^(.+?)\s+bought\s+(.+?)\s+for\s+(\d+)\s+Caps$/i;

function parseShop(text, messageMs, mapping) {
	const out = [];
	for (const rawLine of splitLines(text)) {
		const { tsMs, rest } = takeTs(rawLine, messageMs);
		const m = SHOP_HEAD.exec(rest);
		if (!m) continue;
		const [, server, action, body] = m;
		const sold = SHOP_SOLD.exec(body);
		const bought = SHOP_BOUGHT.exec(body);
		if (sold) {
			out.push({
				log_type: "shop", ts_ms: tsMs, server,
				severity: null, category: action.toUpperCase(),
				player_name: sold[1].trim(), player_guid: null,
				target_name: sold[3].trim(), target_guid: null,
				details: { item: sold[2].trim(), caps: +sold[4] },
				raw: tagsToTime(rawLine)
			});
		} else if (bought) {
			out.push({
				log_type: "shop", ts_ms: tsMs, server,
				severity: null, category: action.toUpperCase(),
				player_name: bought[1].trim(), player_guid: null,
				target_name: null, target_guid: null,
				details: { item: bought[2].trim(), caps: +bought[3] },
				raw: tagsToTime(rawLine)
			});
		} else {
			out.push({
				log_type: "shop", ts_ms: tsMs, server,
				severity: null, category: action.toUpperCase(),
				player_name: null, player_guid: null,
				target_name: null, target_guid: null,
				details: { note: body },
				raw: tagsToTime(rawLine)
			});
		}
	}
	return out;
}

// ─── Kill ──────────────────────────────────────────────────────────────────
// [Cat] killer killed [Cat] victim | weapon | <N>m | <N> pts
// [Cat] player died
const KILL_KILL = /^\[([^\]]+)\]\s+(.+?)\s+killed\s+\[([^\]]+)\]\s+(.+?)(?:\s*\|\s*(.+))?$/;
const KILL_DEATH = /^\[([^\]]+)\]\s+(.+?)\s+died\s*$/;
const KILL_DETAIL = /^(.+?)\s*\|\s*(\d+(?:\.\d+)?)\s*m(?:\s*\|\s*(-?\d+)\s*pts)?$/i;

function parseKill(text, messageMs, mapping) {
	const out = [];
	for (const rawLine of splitLines(text)) {
		const { tsMs, rest } = takeTs(rawLine, messageMs);
		let m = KILL_KILL.exec(rest);
		if (m) {
			const [, killerCat, killerName, victimCat, victimName, detail] = m;
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
				log_type: "kill", ts_ms: tsMs, server: mapping.server || null,
				severity: null, category: "kill",
				player_name: killerName.trim(), player_guid: null,
				target_name: victimName.trim(), target_guid: null,
				details, raw: tagsToTime(rawLine)
			});
			continue;
		}
		m = KILL_DEATH.exec(rest);
		if (m) {
			const [, cat, name] = m;
			out.push({
				log_type: "death", ts_ms: tsMs, server: mapping.server || null,
				severity: null, category: "death",
				player_name: name.trim(), player_guid: null,
				target_name: null, target_guid: null,
				details: { category: cat },
				raw: tagsToTime(rawLine)
			});
		}
	}
	return out;
}

// ─── Chat ──────────────────────────────────────────────────────────────────
// <name>: <message>
const CHAT_LINE = /^([^:]+):\s+(.*)$/;

function parseChat(text, messageMs, mapping) {
	const out = [];
	for (const rawLine of splitLines(text)) {
		const { tsMs, rest } = takeTs(rawLine, messageMs);
		const m = CHAT_LINE.exec(rest);
		if (!m) continue;
		out.push({
			log_type: "chat", ts_ms: tsMs, server: mapping.server || null,
			severity: null, category: "chat",
			player_name: m[1].trim(), player_guid: null,
			target_name: null, target_guid: null,
			details: { message: m[2] },
			raw: tagsToTime(rawLine)
		});
	}
	return out;
}

// ─── Base ──────────────────────────────────────────────────────────────────
// Multi-line entries — each starts with ":emoji: TYPE | SERVER | <t:UNIX:T>"
// followed by zero or more "Key: value" lines.
const BASE_HEADER = /^:[a-z_]+:\s+(.+?)\s*\|\s*(\S+)\s*\|\s*(?:<t:\d+:[tTfFRD]>|\d{2}:\d{2}:\d{2})\s*$/;
const BASE_KV = /^([A-Za-z ][A-Za-z _]+):\s*(.+)$/;

function parseBase(text, messageMs /* , mapping */) {
	const out = [];
	let current = null;
	for (const rawLine of splitLines(text)) {
		const { tsMs, rest } = takeTs(rawLine, messageMs);
		const h = BASE_HEADER.exec(rest);
		if (h) {
			if (current) out.push(current);
			const [, category, server] = h;
			current = {
				log_type: "base", ts_ms: tsMs, server,
				severity: null, category: category.trim(),
				player_name: null, player_guid: null,
				target_name: null, target_guid: null,
				details: {}, raw: tagsToTime(rawLine)
			};
			continue;
		}
		if (!current) continue;
		const kv = BASE_KV.exec(rest);
		if (kv) {
			const key = kv[1].trim().toLowerCase();
			const val = kv[2].trim();
			current.details[key] = val;
			current.raw += "\n" + tagsToTime(rawLine);
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
	const chunks = [];
	if (message.content) chunks.push(message.content);
	for (const emb of message.embeds || []) {
		if (emb.description) chunks.push(emb.description);
		for (const f of emb.fields || []) chunks.push((f.name ? `${f.name}\n` : "") + (f.value || ""));
	}
	const text = chunks.join("\n");
	if (!text.trim()) return [];

	const messageMs = (message.createdAt instanceof Date)
		? message.createdAt.getTime()
		: (message.createdTimestamp || Date.now());

	switch (mapping.type) {
	case "anticheat": return parseAnticheat(text, messageMs, mapping);
	case "shop":      return parseShop(text, messageMs, mapping);
	case "kill":      return parseKill(text, messageMs, mapping);
	case "chat":      return parseChat(text, messageMs, mapping);
	case "base":      return parseBase(text, messageMs, mapping);
	default:          return [];
	}
}

module.exports = {
	parseMessage,
	parseAnticheat, parseShop, parseKill, parseChat, parseBase
};
