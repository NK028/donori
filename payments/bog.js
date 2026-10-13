// Bank of Georgia "Payment Manager" online payments API.
// Docs: https://api.bog.ge/docs/en/payments/introduction
// The donor is redirected to the bank's hosted payment page, which offers card,
// Apple Pay and Google Pay (once enabled for the merchant in BOG Business Manager).
// Card data never touches our server, which keeps PCI DSS scope small.
const crypto = require('crypto');

const TOKEN_URL = 'https://oauth2.bog.ge/auth/realms/bog/protocol/openid-connect/token';
const ORDER_URL = 'https://api.bog.ge/payments/v1/ecommerce/orders';
const RECEIPT_URL = 'https://api.bog.ge/payments/v1/receipt/';

// Public key BOG uses to sign callbacks (SHA256withRSA), from the Callback docs page.
// Re-check it against the docs before launch in case the bank rotates it.
const BOG_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAu4RUyAw3+CdkS3ZNILQh
zHI9Hemo+vKB9U2BSabppkKjzjjkf+0Sm76hSMiu/HFtYhqWOESryoCDJoqffY0Q
1VNt25aTxbj068QNUtnxQ7KQVLA+pG0smf+EBWlS1vBEAFbIas9d8c9b9sSEkTrr
TYQ90WIM8bGB6S/KLVoT1a7SnzabjoLc5Qf/SLDG5fu8dH8zckyeYKdRKSBJKvhx
tcBuHV4f7qsynQT+f2UYbESX/TLHwT5qFWZDHZ0YUOUIvb8n7JujVSGZO9/+ll/g
4ZIWhC1MlJgPObDwRkRd8NFOopgxMcMsDIZIoLbWKhHVq67hdbwpAq9K9WMmEhPn
PwIDAQAB
-----END PUBLIC KEY-----`;

let cached = { token: null, until: 0 };
async function token() {
  if (cached.token && Date.now() < cached.until) return cached.token;
  const { BOG_CLIENT_ID: id, BOG_CLIENT_SECRET: secret } = process.env;
  if (!id || !secret) throw new Error('BOG_CLIENT_ID / BOG_CLIENT_SECRET are not set');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'),
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`BOG auth failed: ${res.status} ${await res.text()}`);
  const j = await res.json();
  cached = { token: j.access_token, until: Date.now() + 5 * 60 * 1000 }; // refresh every 5 min
  return cached.token;
}

async function createOrder({ donation, campaign, lang }) {
  const base = process.env.BASE_URL;
  const amount = donation.amount_tetri / 100;
  const res = await fetch(ORDER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + (await token()),
      'Accept-Language': lang === 'en' ? 'en' : 'ka',
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify({
      callback_url: `${base}/api/payments/callback`,
      external_order_id: `don-${donation.id}`,
      capture: 'automatic',
      ttl: 30,
      purchase_units: {
        currency: 'GEL',
        total_amount: amount,
        basket: [{
          product_id: `campaign-${campaign.id}`,
          description: `Donation: ${campaign.title}`.slice(0, 100),
          quantity: 1,
          unit_price: amount,
        }],
      },
      redirect_urls: {
        success: `${base}/#/thanks/${donation.id}`,
        fail: `${base}/#/campaign/${campaign.id}?payment=failed`,
      },
      // Leave payment_method empty = show every method enabled on the merchant account
      // (card, Apple Pay, Google Pay, BOG app). To restrict: ["card","apple_pay","google_pay"].
    }),
  });
  if (!res.ok) throw new Error(`BOG create order failed: ${res.status} ${await res.text()}`);
  const j = await res.json();
  return { orderId: j.id, redirectUrl: j._links.redirect.href };
}

function normalise(key) {
  if (key === 'completed') return 'completed';
  if (key === 'rejected') return 'rejected';
  if (key === 'refunded' || key === 'refunded_partially') return 'refunded';
  return 'pending';
}

function parseCallback(req) {
  // Signature must be checked on the raw bytes, before JSON parsing.
  const raw = req && req.body ? req.body : '';
  const sig = req && typeof req.get === 'function' ? req.get('Callback-Signature') : null;
  let signatureOk = false;
  if (sig && raw) {
    try {
      signatureOk = crypto.verify('sha256', Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw)), BOG_PUBLIC_KEY, Buffer.from(sig, 'base64'));
    } catch { signatureOk = false; }
  }
  const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw || '');
  const payload = text ? JSON.parse(text) : {};
  const b = payload.body || {};
  return {
    orderId: b.order_id || null,
    status: normalise(b.order_status && b.order_status.key),
    method: b.payment_detail && b.payment_detail.transfer_method && b.payment_detail.transfer_method.key,
    signatureOk,
    payload,
  };
}

async function fetchStatus(orderId) {
  const res = await fetch(RECEIPT_URL + encodeURIComponent(orderId), {
    headers: { Authorization: 'Bearer ' + (await token()) },
  });
  if (!res.ok) throw new Error(`BOG receipt failed: ${res.status}`);
  const j = await res.json();
  const transferAmount = j.purchase_units && j.purchase_units.transfer_amount;
  const transferTetri = transferAmount === undefined || transferAmount === null || transferAmount === ''
    ? undefined
    : Math.round(parseFloat(String(transferAmount)) * 100);
  return {
    status: normalise(j.order_status && j.order_status.key),
    method: j.payment_detail && j.payment_detail.transfer_method && j.payment_detail.transfer_method.key,
    transferTetri: Number.isFinite(transferTetri) ? transferTetri : undefined,
  };
}

module.exports = { createOrder, parseCallback, fetchStatus };
