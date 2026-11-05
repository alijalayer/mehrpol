import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- A person signs in with a mobile number or an email address; at least one of them is set.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  phone TEXT UNIQUE,
  email TEXT UNIQUE,
  phone_verified INTEGER NOT NULL DEFAULT 1,
  role TEXT NOT NULL CHECK (role IN ('member', 'admin')),
  display_name TEXT NOT NULL DEFAULT '',
  full_name_enc TEXT,
  national_code_enc TEXT,
  created_at INTEGER NOT NULL
);

-- One-time codes, keyed by the phone or email they were sent to.
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

-- Platform income, kept apart from donations so every toman given to families stays traceable.
CREATE TABLE IF NOT EXISTS revenue (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('tip','gift_fee','circle_fee','csr','license','other')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  donation_id TEXT REFERENCES donations(id),
  user_id TEXT REFERENCES users(id),
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS revenue_time ON revenue(created_at);

-- «کارت هدیهٔ مهر»: a gift, a memorial («به یاد») or a vow («نذر»), paid as a donation.
CREATE TABLE IF NOT EXISTS gift_cards (
  code TEXT PRIMARY KEY,
  donation_id TEXT NOT NULL UNIQUE REFERENCES donations(id),
  kind TEXT NOT NULL CHECK (kind IN ('gift','memory','nazr')),
  theme TEXT NOT NULL,
  from_name TEXT NOT NULL,
  to_name TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  paid INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- «حلقهٔ مهر» monthly membership.
CREATE TABLE IF NOT EXISTS circle_members (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  monthly_amount INTEGER NOT NULL,
  category TEXT,
  province TEXT,
  status TEXT NOT NULL CHECK (status IN ('active','cancelled')),
  paid_until INTEGER NOT NULL,
  started_at INTEGER NOT NULL
);

-- Company-sponsored campaigns (CSR), optionally matching what the public gives.
CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  sponsor TEXT NOT NULL,
  sponsor_logo TEXT NOT NULL DEFAULT '',
  sponsor_link TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  category TEXT,
  province TEXT,
  goal INTEGER NOT NULL,
  match_percent INTEGER NOT NULL DEFAULT 0,
  match_cap INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  ends_at INTEGER,
  created_at INTEGER NOT NULL
);

-- Partnership requests from companies and charities.
CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('company','charity')),
  org TEXT NOT NULL,
  contact TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  plan TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','won','lost')),
  created_at INTEGER NOT NULL
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
  // Senior manager: manages the admin team, settings and income (role must also be 'admin').
  ['users', 'is_owner', 'INTEGER NOT NULL DEFAULT 0'],
  // extra: platform income charged on top of the donation (tip or fee), never given to a case.
  ['donations', 'extra', 'INTEGER NOT NULL DEFAULT 0'],
  // kind: case | fund | gift | circle | campaign; ref: the gift code, campaign id …
  ['donations', 'kind', "TEXT NOT NULL DEFAULT 'case'"],
  ['donations', 'ref', 'TEXT'],
  // source: for automatic allocations, the gift/circle/campaign donation the money came from.
  ['donations', 'source', 'TEXT'],
];

export function openDb(file) {
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  for (const [table, column, type] of ADDED_COLUMNS) {
    const exists = db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(column);
    if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
  makePhoneOptional(db);
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_slug ON users(slug) WHERE slug IS NOT NULL');
  return db;
}

/**
 * Early databases required a phone for every user. Email sign-in needs it optional, and SQLite
 * cannot relax NOT NULL in place, so the table is rebuilt once with the same rows.
 */
function makePhoneOptional(db) {
  const phone = db.prepare("SELECT \"notnull\" AS required FROM pragma_table_info('users') WHERE name = 'phone'").get();
  if (!phone?.required) return;
  const keep = db.prepare("SELECT name FROM pragma_table_info('users')").all().map((c) => c.name).filter((n) => !['email', 'phone_verified'].includes(n));
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN');
  try {
    db.exec(`CREATE TABLE users_new (
      id TEXT PRIMARY KEY, phone TEXT UNIQUE, email TEXT UNIQUE, phone_verified INTEGER NOT NULL DEFAULT 1,
      role TEXT NOT NULL CHECK (role IN ('member', 'admin')), display_name TEXT NOT NULL DEFAULT '',
      full_name_enc TEXT, national_code_enc TEXT, created_at INTEGER NOT NULL,
      public_profile INTEGER NOT NULL DEFAULT 0, slug TEXT, bio TEXT NOT NULL DEFAULT '', is_demo INTEGER NOT NULL DEFAULT 0,
      last_login_at INTEGER, is_owner INTEGER NOT NULL DEFAULT 0)`);
    db.exec(`INSERT INTO users_new (${keep.join(', ')}) SELECT ${keep.join(', ')} FROM users`);
    db.exec('DROP TABLE users');
    db.exec('ALTER TABLE users_new RENAME TO users');
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
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
