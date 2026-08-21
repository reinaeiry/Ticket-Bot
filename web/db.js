const Database = require("better-sqlite3");
const path = require("path");

const db = new Database(path.join(__dirname, "transcripts.db"));

// Enable WAL mode for better concurrent reads, plus a generous page cache
// (64MB) so the entire game_logs working set stays hot for sub-ms reads.
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");
db.pragma("cache_size = -64000");
db.pragma("temp_store = MEMORY");
db.pragma("mmap_size = 268435456");

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
if (!hasCol("created_by_avatar")) db.exec(`ALTER TABLE transcripts ADD COLUMN created_by_avatar TEXT`);
if (!hasCol("category_code")) {
  // Per-category access control on the archive needs the machine codeName, not the
  // display name. Backfill from `category` so historic rows are gated too — a
  // restricted row whose code we cannot resolve fails CLOSED (see routes/api.js).
  db.exec(`ALTER TABLE transcripts ADD COLUMN category_code TEXT`);
  const { NAME_TO_CODE } = require("./lib/ticketCategories");
  const upd = db.prepare(`UPDATE transcripts SET category_code = ? WHERE category = ? AND category_code IS NULL`);
  const tx = db.transaction(() => {
    for (const name of Object.keys(NAME_TO_CODE)) upd.run(NAME_TO_CODE[name], name);
    // Shop and Management use distinctive channel prefixes; use them to catch rows
    // whose display name was since renamed in config.
    db.prepare(`UPDATE transcripts SET category_code = 'shop-support' WHERE category_code IS NULL AND channel_name LIKE 'shop-%'`).run();
    db.prepare(`UPDATE transcripts SET category_code = 'contact-management' WHERE category_code IS NULL AND channel_name LIKE 'mgmt-%'`).run();
  });
  tx();
  const left = db.prepare(`SELECT COUNT(*) c FROM transcripts WHERE category_code IS NULL AND restricted = 1`).get().c;
  console.log(`[transcripts] category_code backfilled; ${left} restricted row(s) still unresolved (these fail closed)`);
}
db.exec(`CREATE INDEX IF NOT EXISTS idx_transcripts_category_code ON transcripts(category_code)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_transcripts_guid ON transcripts(guid)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_transcripts_created_by ON transcripts(created_by)`);

// The `admins` table is no longer used — login moved to auth.reforgedz.net.
// Table is left in place to avoid a destructive migration on first deploy; drop in a
// follow-up cleanup once we're confident no other tooling reads it.

module.exports = db;
