const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "change-me";
const APPEAL_JWT_SECRET = process.env.APPEAL_JWT_SECRET || JWT_SECRET + ":appeal";

function requireAuth(req, res, next) {
	const token = req.cookies?.token || req.headers.authorization?.replace("Bearer ", "");
	if (!token) return res.status(401).json({ error: "Not authenticated" });

	try {
		const decoded = jwt.verify(token, JWT_SECRET);
		req.admin = decoded;
		next();
	} catch {
		return res.status(401).json({ error: "Invalid or expired token" });
	}
}

function requireAppealAuth(req, res, next) {
	requireAuth(req, res, (err) => {
		if (err) return;
		const appealToken = req.cookies?.appealToken;
		if (!appealToken) return res.status(401).json({ error: "Appeal authentication required" });
		try {
			jwt.verify(appealToken, APPEAL_JWT_SECRET);
			next();
		} catch {
			return res.status(401).json({ error: "Appeal session expired" });
		}
	});
}

function hasAppealAuth(req) {
	const appealToken = req.cookies?.appealToken;
	if (!appealToken) return false;
	try {
		jwt.verify(appealToken, APPEAL_JWT_SECRET);
		return true;
	} catch {
		return false;
	}
}

function requireApiKey(req, res, next) {
	const key = req.headers["x-api-key"] || req.query.key;
	if (!key || key !== process.env.API_KEY) {
		return res.status(403).json({ error: "Invalid API key" });
	}
	next();
}

module.exports = { requireAuth, requireAppealAuth, hasAppealAuth, requireApiKey, APPEAL_JWT_SECRET };
