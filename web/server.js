const express = require("express");
const cookieParser = require("cookie-parser");
const path = require("path");
const db = require("./db");

function startWebServer() {
	const app = express();
	const PORT = process.env.WEB_PORT || 3100;

	app.use(express.json({ limit: "50mb" }));
	app.use(express.urlencoded({ extended: true }));
	app.use(cookieParser());
	app.use(express.static(path.join(__dirname, "public")));

	app.use("/api", require("./routes/api"));
	app.use("/api/auth", require("./routes/auth"));

	app.get("/t/:id", (req, res) => {
		res.sendFile(path.join(__dirname, "public", "view.html"));
	});

	app.get("/admin", (req, res) => {
		res.sendFile(path.join(__dirname, "public", "admin.html"));
	});

	app.get("/login", (req, res) => {
		res.sendFile(path.join(__dirname, "public", "login.html"));
	});

	app.get("/", (req, res) => {
		res.redirect("/login");
	});

	app.listen(PORT, () => {
		console.log(`\x1b[0m\uD83C\uDF10  Transcript server running on port \x1b[37;46;1m${PORT}\x1b[0m`);
	});
}

module.exports = { startWebServer };
