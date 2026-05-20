const makeRzAuth = require("../lib/rz-auth");

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
	requireApiKey,
	// Back-compat alias for any caller still importing requireAuth.
	requireAuth: requireRead
};
