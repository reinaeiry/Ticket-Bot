// Unified entry point - starts both the Discord bot and the transcript web server
const { config } = require("dotenv");
try { config(); } catch {}

// Start the transcript web server
const { startWebServer } = require("./web/server");
startWebServer();

// Start the Discord bot
require("./dist/index.js");
