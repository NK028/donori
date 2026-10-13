// End-to-end smoke test against a throwaway in-memory database with the mock provider.
process.env.DB_PATH = ':memory:';
process.env.PAYMENT_PROVIDER = 'mock';
process.env.ADMIN_EMAIL = 'admin@test.ge';
process.env.ADMIN_PASSWORD = 'admin-pass-123';
const assert = require('assert');
const app = require('../server');

const server = app.listen(0, async () => {
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const jar = {};
  const call = async (who, path, body) => {
    const res = await fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(jar[who] ? { Cookie: jar[who] } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const sc = res.headers.get('set-cookie'); if (sc) jar[who] = sc.split(';')[0];
    return { status: res.status, data: await res.json() };
  };
  try {
    let r = await call('anon', '/campaigns');
    assert.equal(r.data.length, 3, 'seeded campaigns listed');

    r = await call('nino', '/auth/signup', { name: 'Nino', email: 'nino@test.ge', password: 'password1' });
    assert.equal(r.status, 200);

    r = await call('nino', '/campaigns', { title: 'Short', story: 'x', category: 'medical', goal: 5, beneficiary_name: 'A', payout_iban: 'bad' });
    assert.equal(r.status, 400); assert.ok(r.data.fields.includes('payout_iban'), 'IBAN validated');

    r = await call('nino', '/campaigns', {
      title: 'Wheelchair for Levan', category: 'medical', goal: '3000', beneficiary_name: 'Levan',
      story: 'Levan needs a new wheelchair after an accident last winter; this will help him get to school.',
      payout_iban: 'GE29 NB00 0000 0101 9049 17',
    });
    assert.equal(r.status, 200); const cid = r.data.id;

    r = await call('anon', `/campaigns/${cid}`); assert.equal(r.status, 404, 'pending campaign hidden from public');
    r = await call('nino', `/campaigns/${cid}`); assert.equal(r.data.payout_iban, 'GE29NB0000000101904917', 'owner sees IBAN');
    r = await call('nino', `/admin/campaigns`); assert.equal(r.status, 403, 'non-admin blocked');

    await call('admin', '/auth/login', { email: 'admin@test.ge', password: 'admin-pass-123' });
    r = await call('admin', '/admin/campaigns?status=pending'); assert.equal(r.data.length, 1);
    await call('admin', `/admin/campaigns/${cid}/approve`, {});

    r = await call('anon', `/campaigns/${cid}`);
    assert.equal(r.status, 200); assert.equal(r.data.payout_iban, undefined, 'IBAN hidden from public');

    r = await call('anon', `/campaigns/${cid}/donate`, { amount: '0.5' }); assert.equal(r.status, 400, 'min amount');
    r = await call('anon', `/campaigns/${cid}/donate`, { amount: '75', name: 'Ana', message: 'Good luck' });
    assert.equal(r.status, 200); const did = r.data.donationId;
    const order = r.data.redirectUrl.split('/')[3];

    // forged callback without valid signature is rejected
    let res = await fetch(base + '/payments/callback', { method: 'POST', body: JSON.stringify({ order_id: order, status: 'completed', sig: 'x' }) });
    assert.equal(res.status, 400, 'forged callback rejected');
    r = await call('anon', `/donations/${did}/status`); assert.equal(r.data.status, 'created');

    r = await call('anon', '/mock-pay/complete', { order, method: 'apple_pay' }); assert.ok(r.data.ok);
    r = await call('anon', '/mock-pay/complete', { order, method: 'apple_pay' }); // duplicate callback
    r = await call('anon', `/donations/${did}/status`); assert.equal(r.data.status, 'completed');
    r = await call('anon', `/campaigns/${cid}`);
    assert.equal(r.data.raised_tetri, 7500, 'counted exactly once'); assert.equal(r.data.donations[0].donor_name, 'Ana');

    // failed payment does not count
    r = await call('anon', `/campaigns/${cid}/donate`, { amount: '20' });
    await call('anon', '/mock-pay/complete', { order: r.data.redirectUrl.split('/')[3], method: 'card', outcome: 'fail' });
    r = await call('anon', `/campaigns/${cid}`); assert.equal(r.data.raised_tetri, 7500, 'failed payment ignored');

    // BOG adapter rejects a callback not signed by the bank
    const bog = require('../payments/bog');
    const cb = bog.parseCallback({ body: Buffer.from(JSON.stringify({ event: 'order_payment', body: { order_id: 'x', order_status: { key: 'completed' } } })), get: () => 'AAAA' });
    assert.equal(cb.signatureOk, false); assert.equal(cb.status, 'completed');

    console.log('All smoke tests passed ✓');
    server.close(); process.exit(0);
  } catch (e) { console.error('FAILED:', e); server.close(); process.exit(1); }
});
