const express = require("express");
const cookieParser = require("cookie-parser");
const path = require("path");
const db = require("./db");
const { attachSession, readyPromise } = require("./middleware/auth");

const AUTH_BASE = (process.env.AUTH_BASE || "https://auth.reforgedz.net").replace(/\/+$/, "");

async function startWebServer() {
	const app = express();
	const PORT = process.env.WEB_PORT || 3100;

	app.use(express.json({ limit: "50mb" }));
	app.use(express.urlencoded({ extended: true }));
	app.use(cookieParser());
	app.use(attachSession);

	app.use("/api", require("./routes/api"));
	app.use("/api/auth", require("./routes/auth"));

	app.get("/t/:id", (req, res) => {
		res.sendFile(path.join(__dirname, "public", "view.html"));
	});

	app.get("/admin", (req, res) => {
		res.sendFile(path.join(__dirname, "public", "admin.html"));
	});

	app.get("/appeals", (req, res) => {
		res.sendFile(path.join(__dirname, "public", "appeals.html"));
	});

	// Login lives at auth.reforgedz.net now — redirect with a return URL.
	app.get("/login", (req, res) => {
		const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
		const host = req.headers["x-forwarded-host"] || req.headers.host;
		const dest = req.query.return || `${proto}://${host}/admin`;
		res.redirect(`${AUTH_BASE}/login?return=${encodeURIComponent(dest)}`);
	});

	app.get("/", (req, res) => {
		res.redirect("/admin");
	});

	// Static last so the routes above win.
	app.use(express.static(path.join(__dirname, "public")));

	try {
		await readyPromise();
	} catch (err) {
		console.error("Failed to load auth public key:", err);
		throw err;
	}

	app.listen(PORT, () => {
		console.log(`\x1b[0m🌐  Transcript server running on port \x1b[37;46;1m${PORT}\x1b[0m`);
	});
}

module.exports = { startWebServer };
