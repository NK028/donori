// Test-mode provider: sends the donor to a built-in fake checkout page (/mock-pay)
// that imitates card / Apple Pay / Google Pay and then fires a callback just like a bank would.
// It moves no money. Never run production with PAYMENT_PROVIDER=mock.
const crypto = require('crypto');

const orders = new Map(); // orderId -> status (in memory is enough for testing)

async function createOrder({ donation }) {
  const orderId = 'mock_' + crypto.randomUUID();
  orders.set(orderId, 'pending');
  return { orderId, redirectUrl: `/#/mock-pay/${orderId}/${donation.id}/${donation.amount_tetri}` };
}

function parseCallback(req) {
  const raw = req && req.body ? req.body : '';
  const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw || '');
  const payload = text ? JSON.parse(text) : {};
  const orderId = payload && payload.order_id ? payload.order_id : null;
  const status = payload && payload.status ? payload.status : 'pending';
  // Mock callbacks are signed with a per-process secret so they can't be forged from outside.
  const expected = sign(orderId + ':' + status);
  const signatureOk = typeof payload.sig === 'string' && orderId && payload.sig.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(payload.sig), Buffer.from(expected));
  if (signatureOk) orders.set(orderId, status);
  return { orderId, status, method: payload.method, signatureOk, payload };
}

async function fetchStatus(orderId) {
  return { status: orders.get(orderId) || 'pending' };
}

const SECRET = crypto.randomBytes(32);
function sign(s) { return crypto.createHmac('sha256', SECRET).update(s).digest('hex'); }

module.exports = { createOrder, parseCallback, fetchStatus, sign };
