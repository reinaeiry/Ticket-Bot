const Database = require("better-sqlite3");
const path = require("path");

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
if (!hasCol("guid")) db.exec(`ALTER TABLE transcripts ADD COLUMN guid TEXT`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_transcripts_guid ON transcripts(guid)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_transcripts_created_by ON transcripts(created_by)`);

// The `admins` table is no longer used — login moved to auth.reforgedz.net.
// Table is left in place to avoid a destructive migration on first deploy; drop in a
// follow-up cleanup once we're confident no other tooling reads it.

module.exports = db;
