const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const { createMemoryStore } = require('../src/store');

test('creates free temporary email on adzstore.my.id with 24 hour expiry', async () => {
  const app = createApp({ store: createMemoryStore(), sessionSecret: 'test-secret' });

  const res = await request(app).post('/api/mailboxes').expect(201);

  assert.match(res.body.address, /^[a-z0-9]+@adzstore\.my\.id$/);
  assert.equal(res.body.plan, 'free');
  assert.equal(res.body.domain, 'adzstore.my.id');
  assert.ok(res.body.expiresAt);
  const ttlMs = new Date(res.body.expiresAt).getTime() - Date.now();
  assert.ok(ttlMs > 23.9 * 60 * 60 * 1000);
  assert.ok(ttlMs <= 24 * 60 * 60 * 1000);
});

test('receives inbound mail and exposes inbox for a temp mailbox', async () => {
  const store = createMemoryStore();
  const app = createApp({ store, sessionSecret: 'test-secret' });
  const created = await request(app).post('/api/mailboxes').expect(201);

  await request(app)
    .post('/api/inbound')
    .send({ to: created.body.address, from: 'otp@example.com', subject: 'OTP', body: 'Kode 123456' })
    .expect(202);

  const inbox = await request(app).get(`/api/mailboxes/${created.body.id}/messages`).expect(200);
  assert.equal(inbox.body.messages.length, 1);
  assert.equal(inbox.body.messages[0].subject, 'OTP');
  assert.equal(inbox.body.messages[0].to, created.body.address);
});

test('sends email from mailbox and records sent item', async () => {
  const app = createApp({ store: createMemoryStore(), sessionSecret: 'test-secret' });
  const created = await request(app).post('/api/mailboxes').expect(201);

  await request(app)
    .post(`/api/mailboxes/${created.body.id}/send`)
    .send({ to: 'target@example.com', subject: 'Halo', body: 'Testing kirim' })
    .expect(202);

  const sent = await request(app).get(`/api/mailboxes/${created.body.id}/sent`).expect(200);
  assert.equal(sent.body.sent.length, 1);
  assert.equal(sent.body.sent[0].from, created.body.address);
});

test('admin can login, update website settings and manage ads', async () => {
  const app = createApp({ store: createMemoryStore(), sessionSecret: 'test-secret' });
  const agent = request.agent(app);

  await agent.post('/api/admin/login').send({ username: 'admin', password: 'admin123' }).expect(200);
  await agent
    .put('/api/admin/settings')
    .send({ siteName: 'ADZ TempMail', freeHours: 24, unlimitedPrice: 25000, allowSending: true })
    .expect(200);
  await agent
    .post('/api/admin/ads')
    .send({ slot: 'header', title: 'Promo VPS', body: 'Diskon hosting', url: 'https://adzstore.my.id', active: true })
    .expect(201);

  const publicSettings = await request(app).get('/api/settings').expect(200);
  assert.equal(publicSettings.body.siteName, 'ADZ TempMail');
  assert.equal(publicSettings.body.ads.header.title, 'Promo VPS');
});

test('non-admin cannot change website settings', async () => {
  const app = createApp({ store: createMemoryStore(), sessionSecret: 'test-secret' });

  await request(app)
    .put('/api/admin/settings')
    .send({ siteName: 'Hacked' })
    .expect(401);
});

test('upgrades mailbox to unlimited when balance is enough', async () => {
  const app = createApp({ store: createMemoryStore(), sessionSecret: 'test-secret' });
  const created = await request(app).post('/api/mailboxes').expect(201);

  await request(app).post(`/api/mailboxes/${created.body.id}/topup`).send({ amount: 50000 }).expect(200);
  const upgraded = await request(app).post(`/api/mailboxes/${created.body.id}/upgrade`).expect(200);

  assert.equal(upgraded.body.plan, 'unlimited');
  assert.equal(upgraded.body.expiresAt, null);
  assert.equal(upgraded.body.balance, 25000);
});
