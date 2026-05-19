const express = require("express");
const router = express.Router();

const AUTH_BASE = (process.env.AUTH_BASE || "https://auth.reforgedz.net").replace(/\/+$/, "");

// Authentication, logout, password change, and appeal unlock all moved to auth.reforgedz.net.
// /me is kept as a convenience for admin.html JS to detect whether the session has access.
router.get("/me", (req, res) => {
	if (!req.rzUser) return res.status(401).json({ error: "Not authenticated" });
	res.json({
		username: req.rzUser.username,
		hasAppealAccess: !!req.rzUser.perms?.transcripts?.appeals,
		canDelete: !!req.rzUser.perms?.transcripts?.delete
	});
});

// All other endpoints respond 410 Gone with the new location, so any straggling clients can be diagnosed.
router.post("/login", (_req, res) => res.status(410).json({ error: "moved", location: `${AUTH_BASE}/login` }));
router.post("/logout", (_req, res) => res.status(410).json({ error: "moved", location: `${AUTH_BASE}/api/auth/logout` }));
router.post("/appeal-unlock", (_req, res) => res.status(410).json({
	error: "moved",
	details: "Ban-appeal access is now controlled by the transcripts.appeals permission set in auth.reforgedz.net."
}));
router.post("/appeal-lock", (_req, res) => res.status(410).json({ error: "moved" }));
router.get("/appeal-status", (req, res) => {
	res.json({ unlocked: !!(req.rzUser && req.rzUser.perms?.transcripts?.appeals) });
});
router.post("/change-password", (_req, res) => res.status(410).json({
	error: "moved",
	location: `${AUTH_BASE}/account`
}));

module.exports = router;
