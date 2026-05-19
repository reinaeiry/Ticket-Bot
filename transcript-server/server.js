const express = require("express");
const cookieParser = require("cookie-parser");
const path = require("path");
const db = require("./db");
const { attachSession, readyPromise } = require("./middleware/auth");

// Load .env if present
try { require("dotenv").config(); } catch {}

const app = express();
const PORT = process.env.PORT || 3100;
const AUTH_BASE = process.env.AUTH_BASE || "https://auth.reforgedz.net";

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(attachSession);

// Routes
app.use("/api", require("./routes/api"));
app.use("/api/auth", require("./routes/auth"));

// Transcript viewer (public with link)
app.get("/t/:id", (req, res) => {
	res.sendFile(path.join(__dirname, "public", "view.html"));
});

// Admin panel
app.get("/admin", (req, res) => {
	res.sendFile(path.join(__dirname, "public", "admin.html"));
});

// Ban appeal / application transcripts (gated by transcripts.appeals perm in the SSO cookie)
app.get("/appeals", (req, res) => {
	res.sendFile(path.join(__dirname, "public", "appeals.html"));
});

// Login lives at auth.reforgedz.net now — redirect there with a return URL.
app.get("/login", (req, res) => {
	const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
	const host = req.headers["x-forwarded-host"] || req.headers.host;
	const dest = req.query.return || `${proto}://${host}/admin`;
	const url = `${AUTH_BASE.replace(/\/+$/, "")}/login?return=${encodeURIComponent(dest)}`;
	res.redirect(url);
});

// Root redirect
app.get("/", (req, res) => {
	res.redirect("/admin");
});

// Static last so the routes above win.
app.use(express.static(path.join(__dirname, "public")));

readyPromise()
	.then(() => {
		app.listen(PORT, () => {
			console.log(`Transcript server running on port ${PORT}`);
		});
	})
	.catch((err) => {
		console.error("Failed to load auth public key:", err);
		process.exit(1);
	});
