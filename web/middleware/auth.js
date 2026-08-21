const makeRzAuth = require("../lib/rz-auth");
const { permKeyForCode, RESTRICTED_CODES } = require("../lib/ticketCategories");

const AUTH_BASE = process.env.AUTH_BASE || "https://auth.reforgedz.net";
const COOKIE_NAME = process.env.COOKIE_NAME || "rz_session";

const rzAuth = makeRzAuth({
	publicKeyPem: process.env.AUTH_PUBLIC_KEY_PEM || undefined,
	publicKeyPath: process.env.AUTH_PUBLIC_KEY_PATH || undefined,
	publicKeyUrl: process.env.AUTH_PUBLIC_KEY_PEM
		? undefined
		: (process.env.AUTH_PUBLIC_KEY_URL || `${AUTH_BASE.replace(/\/+$/, "")}/api/auth/public-key`),
	authBase: AUTH_BASE,
	loginUrl: `${AUTH_BASE.replace(/\/+$/, "")}/login`,
	cookieName: COOKIE_NAME
});

async function readyPromise() { await rzAuth.ready(); }

// transcripts.read — view a single transcript via /t/:id
function requireRead(req, res, next) {
	if (!req.rzUser) return res.status(401).json({ error: "Not authenticated" });
	if (!req.rzUser.perms?.transcripts?.read) return res.status(403).json({ error: "Forbidden" });
	req.admin = { username: req.rzUser.username };
	next();
}

// transcripts.stats — admin table + counts
function requireStats(req, res, next) {
	if (!req.rzUser) return res.status(401).json({ error: "Not authenticated" });
	if (!req.rzUser.perms?.transcripts?.stats) return res.status(403).json({ error: "Forbidden" });
	req.admin = { username: req.rzUser.username };
	next();
}

function hasRestrictedAccess(req) {
	return !!(req.rzUser && req.rzUser.perms?.transcripts?.restricted);
}

// Per-category gate for the archive.
//
// The old model was a single `transcripts.restricted` boolean covering FIVE
// categories at once (ban appeals, dev/GM applications, shop, management), so
// anyone who needed ban-appeal transcripts silently got shop and management too.
// The per-category grid already existed and already gated the live relay on
// admin.reforgedz.net — this makes the archive consult the same source of truth.
//
// Fails CLOSED: a restricted row whose category cannot be resolved to a perm key
// falls back to the coarse `transcripts.restricted` flag rather than being shown.
// Deliberately requires BOTH switches:
//   transcripts.restricted  — master "may see sensitive transcripts at all"
//   tickets.<category>      — which of them, same grid the live relay uses
//
// Requiring both means this change can only ever NARROW access. Gating on the
// category alone would have silently GRANTED archive access to anyone holding a
// category for the live relay but not the restricted flag (e.g. a Regional Admin
// with tickets.gmApplications would have gained 75 GM-application transcripts).
// Widening access is not something a fix for an over-sharing bug should ever do.
function canSeeCategory(req, codeName) {
	if (!req.rzUser) return false;
	if (!hasRestrictedAccess(req)) return false;
	const permKey = permKeyForCode(codeName);
	// Unknown/unmapped category on a restricted row — fall back to the master flag.
	if (!permKey) return true;
	return req.rzUser.perms?.tickets?.[permKey] === true;
}

// Which restricted categories may this caller see? Used to build list queries.
function allowedRestrictedCodes(req) {
	if (!req.rzUser) return [];
	return RESTRICTED_CODES.filter((code) => canSeeCategory(req, code));
}

function requireApiKey(req, res, next) {
	const key = req.headers["x-api-key"] || req.query.key;
	if (!key || key !== process.env.API_KEY) {
		return res.status(403).json({ error: "Invalid API key" });
	}
	next();
}

module.exports = {
	attachSession: rzAuth.attachSession,
	readyPromise,
	requireRead,
	requireStats,
	hasRestrictedAccess,
	canSeeCategory,
	allowedRestrictedCodes,
	requireApiKey,
	// Back-compat alias for any caller still importing requireAuth.
	requireAuth: requireRead
};
