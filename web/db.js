const Database = require("better-sqlite3");
const path = require("path");
const bcrypt = require("bcryptjs");

const db = new Database(path.join(__dirname, "transcripts.db"));

// Enable WAL mode for better concurrent reads
db.pragma("journal_mode = WAL");

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS transcripts (
    id TEXT PRIMARY KEY,
    ticket_id INTEGER,
    channel_name TEXT,
    category TEXT,
    created_by TEXT,
    created_by_name TEXT,
    closed_by TEXT,
    closed_by_name TEXT,
    close_reason TEXT,
    closed_at INTEGER DEFAULT (strftime('%s','now') * 1000),
    message_count INTEGER DEFAULT 0,
    messages TEXT NOT NULL,
    auto_closed INTEGER DEFAULT 0,
    restricted INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_transcripts_ticket_id ON transcripts(ticket_id);
  CREATE INDEX IF NOT EXISTS idx_transcripts_channel_name ON transcripts(channel_name);
  CREATE INDEX IF NOT EXISTS idx_transcripts_created_by_name ON transcripts(created_by_name);
  CREATE INDEX IF NOT EXISTS idx_transcripts_closed_at ON transcripts(closed_at);
`);

// Backfill new columns for existing installs
const cols = db.prepare(`PRAGMA table_info(transcripts)`).all();
const hasCol = (n) => cols.some((c) => c.name === n);
if (!hasCol("auto_closed")) db.exec(`ALTER TABLE transcripts ADD COLUMN auto_closed INTEGER DEFAULT 0`);
if (!hasCol("restricted")) db.exec(`ALTER TABLE transcripts ADD COLUMN restricted INTEGER DEFAULT 0`);

// Seed default admin if none exist
const adminCount = db.prepare("SELECT COUNT(*) as count FROM admins").get();
if (adminCount.count === 0) {
	const hash = bcrypt.hashSync("EirySaysHi!", 10);
	db.prepare("INSERT INTO admins (username, password) VALUES (?, ?)").run("Admin", hash);
	console.log("Default admin created.");
}

module.exports = db;
