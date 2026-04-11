const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "change-me";

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

module.exports = router;
