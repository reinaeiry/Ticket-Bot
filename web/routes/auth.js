const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../db");
const { requireAuth, APPEAL_JWT_SECRET } = require("../middleware/auth");

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "change-me";

function constantTimeEquals(a, b) {
	const bufA = Buffer.from(a || "", "utf8");
	const bufB = Buffer.from(b || "", "utf8");
	if (bufA.length !== bufB.length) return false;
	return crypto.timingSafeEqual(bufA, bufB);
}

// POST /api/auth/login
router.post("/login", (req, res) => {
	const { username, password } = req.body;
	if (!username || !password) return res.status(400).json({ error: "Username and password required" });

	const admin = db.prepare("SELECT * FROM admins WHERE username = ?").get(username);
	if (!admin || !bcrypt.compareSync(password, admin.password)) {
		return res.status(401).json({ error: "Invalid credentials" });
	}

	const token = jwt.sign({ id: admin.id, username: admin.username }, JWT_SECRET, { expiresIn: "24h" });
	res.cookie("token", token, { httpOnly: true, sameSite: "strict", maxAge: 86400000 });
	res.json({ success: true, username: admin.username });
});

// POST /api/auth/logout
router.post("/logout", (req, res) => {
	res.clearCookie("token");
	res.clearCookie("appealToken");
	res.json({ success: true });
});

// GET /api/auth/me
router.get("/me", requireAuth, (req, res) => {
	res.json({ username: req.admin.username });
});

// POST /api/auth/change-password
router.post("/change-password", requireAuth, (req, res) => {
	const { currentPassword, newPassword } = req.body;
	if (!currentPassword || !newPassword) return res.status(400).json({ error: "Both passwords required" });

	const admin = db.prepare("SELECT * FROM admins WHERE id = ?").get(req.admin.id);
	if (!bcrypt.compareSync(currentPassword, admin.password)) {
		return res.status(401).json({ error: "Current password is incorrect" });
	}

	const hash = bcrypt.hashSync(newPassword, 10);
	db.prepare("UPDATE admins SET password = ? WHERE id = ?").run(hash, req.admin.id);
	res.json({ success: true });
});

// POST /api/auth/appeal-unlock - secondary password gate for ban appeals / applications
router.post("/appeal-unlock", requireAuth, (req, res) => {
	const expected = process.env.APPEAL_TRANSCRIPT_PASSWORD;
	if (!expected) return res.status(500).json({ error: "Appeal access is not configured" });

	const { password } = req.body;
	if (!password) return res.status(400).json({ error: "Password required" });

	if (!constantTimeEquals(password, expected)) {
		return res.status(401).json({ error: "Invalid password" });
	}

	const appealToken = jwt.sign({ sub: req.admin.username, scope: "appeal" }, APPEAL_JWT_SECRET, { expiresIn: "2h" });
	res.cookie("appealToken", appealToken, { httpOnly: true, sameSite: "strict", maxAge: 2 * 60 * 60 * 1000 });
	res.json({ success: true });
});

// POST /api/auth/appeal-lock - revoke appeal session without logging out
router.post("/appeal-lock", requireAuth, (req, res) => {
	res.clearCookie("appealToken");
	res.json({ success: true });
});

// GET /api/auth/appeal-status - whether the current session has appeal access
router.get("/appeal-status", requireAuth, (req, res) => {
	const token = req.cookies?.appealToken;
	if (!token) return res.json({ unlocked: false });
	try {
		jwt.verify(token, APPEAL_JWT_SECRET);
		res.json({ unlocked: true });
	} catch {
		res.json({ unlocked: false });
	}
});

module.exports = router;
