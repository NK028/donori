// Donori — crowdfunding server (Express + SQLite).
// Run: npm install && npm start   then open http://localhost:3000
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Minimal .env loader (no extra dependency)
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
process.env.BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;

const express = require('express');
const { db, hashPassword, checkPassword, seed } = require('./db');
const pay = require('./payments');

seed();
const app = express();
app.disable('x-powered-by');
const FEE = Math.max(0, Math.min(15, parseFloat(process.env.PLATFORM_FEE_PERCENT || '0')));
const CATEGORIES = ['medical', 'education', 'emergency', 'community', 'animals', 'other'];

// ---------- security headers ----------
app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': "default-src 'self'; img-src 'self' https: data:; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; frame-ancestors 'none'; form-action 'self' https://payment.bog.ge",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  });
  if (process.env.BASE_URL.startsWith('https://')) res.set('Strict-Transport-Security', 'max-age=31536000');
  next();
});

// The payment callback needs the raw body for signature checks, so it is mounted before express.json.
app.post('/api/payments/callback', express.raw({ type: '*/*', limit: '200kb' }), async (req, res) => {
  try {
    const result = await handleCallback(req);
    res.status(result.ok ? 200 : 400).json(result);
  } catch (e) {
    console.error('callback error', e);
    res.status(500).json({ ok: false });
  }
});

app.use(express.json({ limit: '50kb' }));
// JSON-only API + SameSite cookies = basic CSRF protection for state-changing requests.
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET' && !req.is('application/json')) return res.status(415).json({ error: 'json_required' });
  next();
});

// ---------- auth ----------
function cookie(req, name) {
  const m = (req.headers.cookie || '').match(new RegExp('(?:^|; )' + name + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : null;
}
app.use((req, res, next) => {
  const t = cookie(req, 'sid');
  if (t) {
    const row = db.prepare(`SELECT u.id,u.email,u.name,u.role FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.token=? AND s.expires_at > datetime('now')`).get(hash(t));
    if (row) req.user = row;
  }
  next();
});
function hash(t) { return crypto.createHash('sha256').update(t).digest('hex'); }
function cleanString(value, fallback = '') { return typeof value === 'string' ? value : String(value ?? fallback); }
function parseMoney(value) {
  const n = Number.parseFloat(String(value ?? '').trim());
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}
function startSession(res, userId) {
  const t = crypto.randomBytes(32).toString('hex');
  db.prepare("INSERT INTO sessions (token,user_id,expires_at) VALUES (?,?,datetime('now','+30 days'))").run(hash(t), userId);
  const secure = process.env.BASE_URL.startsWith('https://') ? '; Secure' : '';
  res.set('Set-Cookie', `sid=${t}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 86400}${secure}`);
}
const needUser = (req, res, next) => req.user ? next() : res.status(401).json({ error: 'login_required' });
const needAdmin = (req, res, next) => req.user && req.user.role === 'admin' ? next() : res.status(403).json({ error: 'forbidden' });

// tiny in-memory rate limiter
const hits = new Map();
function limit(key, max, windowMs) {
  const now = Date.now();
  const h = (hits.get(key) || []).filter(t => now - t < windowMs);
  h.push(now); hits.set(key, h);
  return h.length > max;
}

app.post('/api/auth/signup', (req, res) => {
  const email = cleanString((req.body || {}).email || '').trim().toLowerCase();
  const name = cleanString((req.body || {}).name || '').trim();
  const password = cleanString((req.body || {}).password || '');
  if (limit('signup:' + req.ip, 10, 3600e3)) return res.status(429).json({ error: 'too_many' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !name || name.length > 80)
    return res.status(400).json({ error: 'invalid_input' });
  if (!password || password.length < 8) return res.status(400).json({ error: 'weak_password' });
  try {
    const r = db.prepare('INSERT INTO users (email,name,password_hash) VALUES (?,?,?)')
      .run(email, name, hashPassword(password));
    startSession(res, r.lastInsertRowid);
    res.json({ ok: true });
  } catch { res.status(409).json({ error: 'email_taken' }); }
});

app.post('/api/auth/login', (req, res) => {
  const email = cleanString((req.body || {}).email || '').trim().toLowerCase();
  const password = cleanString((req.body || {}).password || '');
  if (limit('login:' + req.ip, 20, 900e3)) return res.status(429).json({ error: 'too_many' });
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (!u || !checkPassword(password, u.password_hash)) return res.status(401).json({ error: 'bad_login' });
  startSession(res, u.id);
  res.json({ ok: true });
});

app.post('/api/auth/logout', (req, res) => {
  const t = cookie(req, 'sid');
  if (t) db.prepare('DELETE FROM sessions WHERE token=?').run(hash(t));
  res.set('Set-Cookie', 'sid=; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => res.json({ user: req.user || null }));
app.get('/api/config', (req, res) => res.json({ provider: pay.name, feePercent: FEE, categories: CATEGORIES }));

// ---------- campaigns ----------
const RAISED = `(SELECT COALESCE(SUM(amount_tetri),0) FROM donations d WHERE d.campaign_id=c.id AND d.status='completed')`;
const DONORS = `(SELECT COUNT(*) FROM donations d WHERE d.campaign_id=c.id AND d.status='completed')`;
const PUBLIC_COLS = `c.id,c.title,c.story,c.category,c.goal_tetri,c.image_url,c.beneficiary_name,c.status,c.created_at,
  ${RAISED} AS raised_tetri, ${DONORS} AS donor_count`;

app.get('/api/campaigns', (req, res) => {
  const q = String(req.query.q || '').trim();
  const cat = CATEGORIES.includes(req.query.category) ? req.query.category : null;
  const rows = db.prepare(`SELECT ${PUBLIC_COLS} FROM campaigns c WHERE c.status='approved'
    ${cat ? 'AND c.category=@cat' : ''} ${q ? 'AND (c.title LIKE @q OR c.story LIKE @q)' : ''}
    ORDER BY c.created_at DESC LIMIT 100`).all({ cat, q: `%${q}%` });
  res.json(rows);
});

app.get('/api/campaigns/:id', (req, res) => {
  const c = db.prepare(`SELECT ${PUBLIC_COLS}, c.owner_id, c.payout_iban, c.reject_reason FROM campaigns c WHERE c.id=?`).get(req.params.id);
  const canSeePrivate = c && req.user && (req.user.role === 'admin' || req.user.id === c.owner_id);
  if (!c || (c.status !== 'approved' && c.status !== 'closed' && !canSeePrivate)) return res.status(404).json({ error: 'not_found' });
  if (!canSeePrivate) { delete c.payout_iban; delete c.reject_reason; }
  delete c.owner_id;
  c.can_manage = !!canSeePrivate;
  c.donations = db.prepare(`SELECT CASE WHEN anonymous=1 THEN NULL ELSE donor_name END AS donor_name,
    amount_tetri, message, completed_at FROM donations WHERE campaign_id=? AND status='completed'
    ORDER BY completed_at DESC LIMIT 50`).all(c.id);
  res.json(c);
});

app.post('/api/campaigns', needUser, (req, res) => {
  const b = req.body || {};
  const title = cleanString(b.title || '').trim();
  const story = cleanString(b.story || '').trim();
  const category = cleanString(b.category || '');
  const beneficiary_name = cleanString(b.beneficiary_name || '').trim();
  const image_url = b.image_url === undefined || b.image_url === null || cleanString(b.image_url || '').trim() === ''
    ? null : cleanString(b.image_url).trim();
  const goal = parseMoney(b.goal);
  const iban = cleanString(b.payout_iban || '').replace(/\s+/g, '').toUpperCase();
  const errs = [];
  if (!title || title.length < 5 || title.length > 120) errs.push('title');
  if (!story || story.length < 50 || story.length > 10000) errs.push('story');
  if (!CATEGORIES.includes(category)) errs.push('category');
  if (!(goal >= 10000 && goal <= 100000000)) errs.push('goal'); // 100 – 1,000,000 GEL
  if (!beneficiary_name || beneficiary_name.length > 120) errs.push('beneficiary_name');
  if (!/^GE\d{2}[A-Z]{2}\d{16}$/.test(iban)) errs.push('payout_iban');
  if (image_url && !/^https:\/\/\S+$/.test(image_url)) errs.push('image_url');
  if (errs.length) return res.status(400).json({ error: 'invalid_input', fields: errs });
  const r = db.prepare(`INSERT INTO campaigns (owner_id,title,story,category,goal_tetri,image_url,beneficiary_name,payout_iban)
    VALUES (?,?,?,?,?,?,?,?)`).run(req.user.id, title, story, category, goal, image_url, beneficiary_name, iban);
  res.json({ id: r.lastInsertRowid, status: 'pending' });
});

app.get('/api/my/campaigns', needUser, (req, res) => {
  res.json(db.prepare(`SELECT ${PUBLIC_COLS}, c.reject_reason FROM campaigns c WHERE c.owner_id=? ORDER BY c.created_at DESC`).all(req.user.id));
});

// ---------- admin moderation ----------
app.get('/api/admin/campaigns', needAdmin, (req, res) => {
  const status = ['pending', 'approved', 'rejected', 'closed'].includes(req.query.status) ? req.query.status : 'pending';
  res.json(db.prepare(`SELECT ${PUBLIC_COLS}, c.payout_iban, c.reject_reason, u.email AS owner_email, u.name AS owner_name
    FROM campaigns c JOIN users u ON u.id=c.owner_id WHERE c.status=? ORDER BY c.created_at`).all(status));
});
app.post('/api/admin/campaigns/:id/:action', needAdmin, (req, res) => {
  const map = { approve: 'approved', reject: 'rejected', close: 'closed' };
  const s = map[req.params.action];
  if (!s) return res.status(400).json({ error: 'bad_action' });
  const reason = s === 'rejected' ? cleanString((req.body || {}).reason || '').slice(0, 500).trim() : null;
  db.prepare('UPDATE campaigns SET status=?, reject_reason=? WHERE id=?')
    .run(s, reason, req.params.id);
  res.json({ ok: true });
});
app.get('/api/admin/donations', needAdmin, (req, res) => {
  res.json(db.prepare(`SELECT d.id,d.campaign_id,c.title,d.amount_tetri,d.donor_name,d.status,d.provider,d.method,d.provider_order_id,d.created_at,d.completed_at
    FROM donations d JOIN campaigns c ON c.id=d.campaign_id ORDER BY d.id DESC LIMIT 200`).all());
});

// ---------- donations ----------
app.post('/api/campaigns/:id/donate', async (req, res) => {
  if (limit('donate:' + req.ip, 30, 600e3)) return res.status(429).json({ error: 'too_many' });
  const c = db.prepare("SELECT * FROM campaigns WHERE id=? AND status='approved'").get(req.params.id);
  if (!c) return res.status(404).json({ error: 'not_found' });
  const b = req.body || {};
  const amount = parseMoney(b.amount);
  if (!(amount >= 100 && amount <= 5000000)) return res.status(400).json({ error: 'invalid_amount' }); // 1 – 50,000 GEL
  const donor_name = cleanString(b.name || '').slice(0, 80).trim() || null;
  const message = cleanString(b.message || '').slice(0, 280).trim() || null;
  const r = db.prepare(`INSERT INTO donations (campaign_id,amount_tetri,donor_name,anonymous,message,provider)
    VALUES (?,?,?,?,?,?)`).run(c.id, amount, donor_name, b.anonymous ? 1 : 0, message, pay.name);
  const donation = db.prepare('SELECT * FROM donations WHERE id=?').get(r.lastInsertRowid);
  try {
    const { orderId, redirectUrl } = await pay.createOrder({ donation, campaign: c, lang: cleanString(b.lang || 'ka') });
    db.prepare('UPDATE donations SET provider_order_id=? WHERE id=?').run(orderId, donation.id);
    res.json({ donationId: donation.id, redirectUrl });
  } catch (e) {
    console.error(e);
    db.prepare("UPDATE donations SET status='rejected' WHERE id=?").run(donation.id);
    res.status(502).json({ error: 'payment_unavailable' });
  }
});

// Status for the thank-you page. If the callback hasn't arrived yet, ask the provider directly.
app.get('/api/donations/:id/status', async (req, res) => {
  const d = db.prepare('SELECT id,campaign_id,amount_tetri,status,provider_order_id,provider FROM donations WHERE id=?').get(req.params.id);
  if (!d) return res.status(404).json({ error: 'not_found' });
  if (d.status === 'created' && d.provider_order_id && d.provider === pay.name) {
    try {
      const s = await pay.fetchStatus(d.provider_order_id);
      applyStatus(d.provider_order_id, s.status, s.method, s.transferTetri);
      d.status = db.prepare('SELECT status FROM donations WHERE id=?').get(d.id).status;
    } catch (e) { console.error('status check failed', e.message); }
  }
  res.json({ id: d.id, campaign_id: d.campaign_id, amount_tetri: d.amount_tetri, status: d.status });
});

// One place where donation status changes. Only legal transitions are applied, so repeated
// or out-of-order callbacks are harmless (idempotent).
function applyStatus(orderId, status, method, transferTetri) {
  const d = db.prepare('SELECT * FROM donations WHERE provider_order_id=?').get(orderId);
  if (!d) return false;
  if (status === 'completed' && d.status === 'created') {
    if (Number.isFinite(transferTetri) && transferTetri !== d.amount_tetri) {
      console.warn(`Amount mismatch on donation ${d.id}: expected ${d.amount_tetri}, got ${transferTetri}`);
      return false;
    }
    db.prepare("UPDATE donations SET status='completed', method=?, completed_at=datetime('now') WHERE id=?").run(method || null, d.id);
  } else if (status === 'rejected' && d.status === 'created') {
    db.prepare("UPDATE donations SET status='rejected' WHERE id=?").run(d.id);
  } else if (status === 'refunded' && d.status === 'completed') {
    db.prepare("UPDATE donations SET status='refunded' WHERE id=?").run(d.id);
  }
  return true;
}

async function handleCallback(req) {
  let cb;
  try {
    cb = pay.parseCallback(req);
  } catch (e) {
    return { ok: false, error: 'bad_signature' };
  }
  db.prepare('INSERT INTO payment_events (provider,provider_order_id,signature_ok,payload) VALUES (?,?,?,?)')
    .run(pay.name, cb.orderId || null, cb.signatureOk ? 1 : 0, JSON.stringify(cb.payload || {}));
  if (!cb.signatureOk || !cb.orderId) return { ok: false, error: 'bad_signature' };
  // Defence in depth: confirm the final status directly with the provider before trusting it.
  let { status, method } = cb, transferTetri;
  if (pay.name !== 'mock') {
    const s = await pay.fetchStatus(cb.orderId);
    status = s.status; method = s.method || method; transferTetri = s.transferTetri;
  }
  applyStatus(cb.orderId, status, method, transferTetri);
  return { ok: true };
}

// ---------- test checkout (mock provider only) ----------
if (pay.name === 'mock') {
  app.post('/api/mock-pay/complete', async (req, res) => {
    const { order, method, outcome } = req.body || {};
    const status = outcome === 'fail' ? 'rejected' : 'completed';
    const payload = { order_id: order, status, method: ['card', 'apple_pay', 'google_pay'].includes(method) ? method : 'card' };
    payload.sig = pay.sign(payload.order_id + ':' + status);
    // Goes through exactly the same callback path a real bank callback would.
    const r = await handleCallback({ body: Buffer.from(JSON.stringify(payload)), get: () => null });
    res.json(r);
  });
}

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.use('/api', (req, res) => res.status(404).json({ error: 'not_found' }));

const port = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(port, () => console.log(`Donori running at ${process.env.BASE_URL} (payments: ${pay.name})`));
}
module.exports = app;
