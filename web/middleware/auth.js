const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "change-me";

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

function requireApiKey(req, res, next) {
	const key = req.headers["x-api-key"] || req.query.key;
	if (!key || key !== process.env.API_KEY) {
		return res.status(403).json({ error: "Invalid API key" });
	}
	next();
}

module.exports = { requireAuth, requireApiKey };
