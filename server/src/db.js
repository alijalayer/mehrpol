import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  phone TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('member', 'admin')),
  display_name TEXT NOT NULL DEFAULT '',
  full_name_enc TEXT,
  national_code_enc TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS otps (
  phone TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  sent_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cases (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id),
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  story TEXT NOT NULL,
  province TEXT NOT NULL,
  bill_id TEXT,
  payment_id TEXT,
  payee_enc TEXT,
  amount INTEGER NOT NULL CHECK (amount > 0),
  raised INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('pending','approved','rejected','funded','paid')),
  bill_verified INTEGER NOT NULL DEFAULT 0,
  review_note TEXT NOT NULL DEFAULT '',
  payout_ref TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  reviewed_at INTEGER,
  paid_at INTEGER
);
CREATE INDEX IF NOT EXISTS cases_status ON cases(status, created_at);
CREATE INDEX IF NOT EXISTS cases_user ON cases(user_id);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  stored_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS donations (
  id TEXT PRIMARY KEY,
  case_id TEXT REFERENCES cases(id),
  donor_id TEXT REFERENCES users(id),
  amount INTEGER NOT NULL CHECK (amount > 0),
  applied INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('initiated','succeeded','failed')),
  gateway TEXT NOT NULL,
  authority TEXT UNIQUE,
  ref_id TEXT,
  anonymous INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  verified_at INTEGER
);
CREATE INDEX IF NOT EXISTS donations_donor ON donations(donor_id, created_at);

CREATE TABLE IF NOT EXISTS certificates (
  code TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  level TEXT NOT NULL,
  name TEXT NOT NULL,
  total_toman INTEGER NOT NULL,
  cases INTEGER NOT NULL,
  issued_at INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS certificates_user ON certificates(user_id, issued_at);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id TEXT,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_actor ON audit_log(actor_id, id);

-- Settings the admin edits from the panel (trust page, app release), stored as JSON.
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Files meant for everyone (trust badges, official documents, the Android app). Not encrypted.
CREATE TABLE IF NOT EXISTS public_files (
  id TEXT PRIMARY KEY,
  stored_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
`;

/** Columns added after the first release; ALTER TABLE runs only when a column is missing. */
const ADDED_COLUMNS = [
  ['users', 'public_profile', 'INTEGER NOT NULL DEFAULT 0'],
  ['users', 'slug', 'TEXT'],
  ['users', 'bio', "TEXT NOT NULL DEFAULT ''"],
  ['users', 'is_demo', 'INTEGER NOT NULL DEFAULT 0'],
  ['donations', 'closed_case', 'INTEGER NOT NULL DEFAULT 0'],
  ['users', 'last_login_at', 'INTEGER'],
];

export function openDb(file) {
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  for (const [table, column, type] of ADDED_COLUMNS) {
    const exists = db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(column);
    if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_slug ON users(slug) WHERE slug IS NOT NULL');
  return db;
}

/** Runs fn inside a transaction (IMMEDIATE so concurrent writers serialize). */
export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function getSetting(db, key, fallback) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : fallback;
}

export function setSetting(db, key, value) {
  db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .run(key, JSON.stringify(value), Date.now());
}

export function audit(db, actorId, action, target, detail) {
  db.prepare('INSERT INTO audit_log (actor_id, action, target, detail, at) VALUES (?, ?, ?, ?, ?)')
    .run(actorId ?? null, action, target ?? null, detail ? JSON.stringify(detail) : null, Date.now());
}
