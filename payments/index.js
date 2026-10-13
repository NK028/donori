// Payment provider switch. Every provider exposes the same three functions:
//   createOrder({ donation, campaign, lang })  -> { orderId, redirectUrl }
//   parseCallback(req)                         -> { orderId, status, method, signatureOk, payload }
//   fetchStatus(orderId)                       -> { status, method }   (used to double-check callbacks)
// status is normalised to: 'completed' | 'rejected' | 'refunded' | 'pending'
const name = (process.env.PAYMENT_PROVIDER || 'mock').toLowerCase();
const providers = { mock: require('./mock'), bog: require('./bog') };
if (!providers[name]) throw new Error(`Unknown PAYMENT_PROVIDER "${name}"`);
module.exports = { name, ...providers[name] };
