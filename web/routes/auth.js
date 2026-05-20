const express = require("express");
const router = express.Router();

const AUTH_BASE = (process.env.AUTH_BASE || "https://auth.reforgedz.net").replace(/\/+$/, "");

// All authentication lives at auth.reforgedz.net.
// /me is a convenience for admin.html JS to know which perms the user has.
router.get("/me", (req, res) => {
	if (!req.rzUser) return res.status(401).json({ error: "Not authenticated" });
	const tp = req.rzUser.perms?.transcripts || {};
	res.json({
		username: req.rzUser.username,
		canViewStats: !!tp.stats,
		canSeeRestricted: !!tp.restricted
	});
});

// Old endpoints respond 410 Gone so straggling clients fail loudly.
router.post("/login", (_req, res) => res.status(410).json({ error: "moved", location: `${AUTH_BASE}/login` }));
router.post("/logout", (_req, res) => res.status(410).json({ error: "moved", location: `${AUTH_BASE}/api/auth/logout` }));
router.post("/change-password", (_req, res) => res.status(410).json({
	error: "moved",
	location: `${AUTH_BASE}/account`
}));

module.exports = router;
