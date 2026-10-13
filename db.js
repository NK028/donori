// SQLite storage. Money is always stored as integer tetri (1 GEL = 100 tetri).
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const db = new Database(process.env.DB_PATH || path.join(__dirname, 'donori.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',           -- 'user' | 'admin'
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  story TEXT NOT NULL,
  category TEXT NOT NULL,
  goal_tetri INTEGER NOT NULL,
  image_url TEXT,
  beneficiary_name TEXT NOT NULL,
  payout_iban TEXT NOT NULL,                   -- visible to owner + admins only
  status TEXT NOT NULL DEFAULT 'pending',      -- pending | approved | rejected | closed
  reject_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS donations (
  id INTEGER PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id),
  amount_tetri INTEGER NOT NULL,
  donor_name TEXT,
  anonymous INTEGER NOT NULL DEFAULT 0,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'created',      -- created | completed | rejected | refunded
  provider TEXT NOT NULL,
  provider_order_id TEXT UNIQUE,
  method TEXT,                                 -- card | apple_pay | google_pay | ...
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_don_campaign ON donations(campaign_id, status);
CREATE TABLE IF NOT EXISTS payment_events (       -- raw audit log of every provider callback
  id INTEGER PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_order_id TEXT,
  signature_ok INTEGER NOT NULL,
  payload TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function checkPassword(pw, stored) {
  if (!stored || typeof stored !== 'string' || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  if (!salt || !hash || hash.length !== 128) return false;
  try {
    const test = crypto.scryptSync(pw, salt, 64);
    return crypto.timingSafeEqual(test, Buffer.from(hash, 'hex'));
  } catch {
    return false;
  }
}

function seed() {
  const hasAdmin = db.prepare("SELECT 1 FROM users WHERE role='admin'").get();
  if (!hasAdmin) {
    const email = process.env.ADMIN_EMAIL || 'admin@donori.ge';
    const pw = process.env.ADMIN_PASSWORD || 'change-me-now';
    db.prepare("INSERT INTO users (email,name,password_hash,role) VALUES (?,?,?,'admin')")
      .run(email.toLowerCase(), 'Donori Admin', hashPassword(pw));
    console.log(`Created admin account ${email} (change the password before going live)`);
  }
  const count = db.prepare('SELECT COUNT(*) n FROM campaigns').get().n;
  if (count === 0 && process.env.SEED_DEMO !== '0') {
    const admin = db.prepare("SELECT id FROM users WHERE role='admin'").get();
    const ins = db.prepare(`INSERT INTO campaigns
      (owner_id,title,story,category,goal_tetri,image_url,beneficiary_name,payout_iban,status)
      VALUES (?,?,?,?,?,?,?,?,'approved')`);
    ins.run(admin.id, 'ნინოს ოპერაცია / Surgery for Nino',
      'Demo campaign. A family in Kutaisi is raising money for a heart operation for their 6-year-old daughter. This is sample text — replace it with real campaigns.',
      'medical', 2500000, 'https://images.unsplash.com/photo-1576091160550-2173dba999ef?w=900',
      'Demo Family', 'GE00DEMO0000000000000');
    ins.run(admin.id, 'Books for a village school in Racha',
      'Demo campaign. Raising money to stock the library of a small mountain school with Georgian and English books.',
      'education', 800000, 'https://images.unsplash.com/photo-1497633762265-9d179a990aa6?w=900',
      'Demo School', 'GE00DEMO0000000000001');
    ins.run(admin.id, 'Rebuild after the flood',
      'Demo campaign. Helping three families repair homes damaged by spring flooding.',
      'emergency', 4000000, 'https://images.unsplash.com/photo-1547683905-f686c993aae5?w=900',
      'Demo Families', 'GE00DEMO0000000000002');
    const c = db.prepare('SELECT id FROM campaigns ORDER BY id LIMIT 1').get();
    const d = db.prepare(`INSERT INTO donations
      (campaign_id,amount_tetri,donor_name,anonymous,message,status,provider,method,completed_at)
      VALUES (?,?,?,?,?,'completed','seed',?,datetime('now'))`);
    d.run(c.id, 10000, 'Giorgi', 0, 'Get well soon!', 'card');
    d.run(c.id, 50000, null, 1, null, 'apple_pay');
    d.run(c.id, 2500, 'Mariam', 0, 'წარმატებები!', 'google_pay');
  }
}

module.exports = { db, hashPassword, checkPassword, seed };
