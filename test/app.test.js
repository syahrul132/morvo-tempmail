const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const { createMemoryStore } = require('../src/store');

function makeApp() {
  const store = createMemoryStore();
  return { app: createApp({ store, sessionSecret: 'test-secret' }), store };
}

async function loginUser(app, email = `user${Math.random().toString(16).slice(2)}@example.com`) {
  const agent = request.agent(app);
  await agent.post('/api/auth/register').send({ name: 'User Test', email, password: 'secret123' }).expect(201);
  return agent;
}

test('creates a free 24-hour mailbox on morvo.me', async () => {
  const { app } = makeApp();
  const agent = await loginUser(app);
  const res = await agent.post('/api/mailboxes').send({ prefix: 'demo' }).expect(201);
  assert.match(res.body.address, /^demo[a-z0-9]{4}@adzstore\.my\.id$/);
  assert.equal(res.body.plan, 'free');
  assert.equal(res.body.canSend, true);
  assert.ok(res.body.expiresAt);
  const hours = (Date.parse(res.body.expiresAt) - Date.now()) / 36e5;
  assert.ok(hours > 23.8 && hours <= 24.1, `expected around 24 hours, got ${hours}`);
});

test('stores inbound mail for an existing mailbox', async () => {
  const { app } = makeApp();
  const agent = await loginUser(app);
  const mailbox = await agent.post('/api/mailboxes').send({ prefix: 'inbox' }).expect(201);
  await request(app).post('/api/inbound').send({
    to: mailbox.body.address,
    from: 'sender@example.com',
    subject: 'Kode OTP',
    body: 'Kode kamu 123456'
  }).expect(202);
  const inbox = await agent.get(`/api/mailboxes/${mailbox.body.id}/messages`).expect(200);
  assert.equal(inbox.body.messages.length, 1);
  assert.equal(inbox.body.messages[0].subject, 'Kode OTP');
});

test('opens inbound mail and marks it as read with full body/html available', async () => {
  const { app } = makeApp();
  const agent = await loginUser(app);
  const mailbox = await agent.post('/api/mailboxes').send({ prefix: 'read' }).expect(201);
  const inbound = await request(app).post('/api/inbound').send({
    to: mailbox.body.address,
    from: 'sender@example.com',
    subject: 'HTML OTP',
    body: 'Kode kamu 654321\nBaris kedua',
    html: '<b>Kode kamu 654321</b>'
  }).expect(202);

  const opened = await agent.post(`/api/mailboxes/${mailbox.body.id}/messages/${inbound.body.id}/read`).send({}).expect(200);
  assert.equal(opened.body.body, 'Kode kamu 654321\nBaris kedua');
  assert.equal(opened.body.html, '<b>Kode kamu 654321</b>');
  assert.equal(opened.body.read, true);

  const fetched = await agent.get(`/api/mailboxes/${mailbox.body.id}/messages/${inbound.body.id}`).expect(200);
  assert.equal(fetched.body.id, inbound.body.id);
});

test('can send demo mail while sending is enabled', async () => {
  const { app } = makeApp();
  const agent = await loginUser(app);
  const mailbox = await agent.post('/api/mailboxes').send({ prefix: 'send' }).expect(201);
  const sent = await agent.post(`/api/mailboxes/${mailbox.body.id}/send`).send({
    to: 'target@example.com',
    subject: 'Halo',
    body: 'Pesan demo'
  }).expect(202);
  assert.equal(sent.body.status, 'accepted');
  const history = await agent.get(`/api/mailboxes/${mailbox.body.id}/sent`).expect(200);
  assert.equal(history.body.sent[0].subject, 'Halo');
});

test('topup and upgrade make mailbox unlimited', async () => {
  const { app } = makeApp();
  const agent = await loginUser(app);
  const mailbox = await agent.post('/api/mailboxes').send({ prefix: 'vip' }).expect(201);
  await agent.post(`/api/mailboxes/${mailbox.body.id}/topup`).send({ amount: 25000 }).expect(200);
  const upgraded = await agent.post(`/api/mailboxes/${mailbox.body.id}/upgrade`).send({}).expect(200);
  assert.equal(upgraded.body.mailbox.plan, 'unlimited');
  assert.equal(upgraded.body.mailbox.expiresAt, null);
  assert.equal(upgraded.body.user.balance, 0);
});

test('admin can update settings and public settings reflect them', async () => {
  const { app } = makeApp();
  const agent = request.agent(app);
  await agent.post('/api/admin/login').send({ username: 'admin', password: 'admin123' }).expect(200);
  await agent.put('/api/admin/settings').send({
    siteName: 'ADZ Temp Mail',
    freeHours: 12,
    allowSending: false,
    unlimitedPrice: 30000
  }).expect(200);
  const settings = await request(app).get('/api/settings').expect(200);
  assert.equal(settings.body.siteName, 'ADZ Temp Mail');
  assert.equal(settings.body.freeHours, 12);
  assert.equal(settings.body.allowSending, false);
  assert.equal(settings.body.unlimitedPrice, 30000);
});

test('admin routes reject unauthenticated mutations', async () => {
  const { app } = makeApp();
  await request(app).put('/api/admin/settings').send({ siteName: 'Nope' }).expect(401);
  await request(app).post('/api/admin/ads').send({ slot: 'header', title: 'X' }).expect(401);
});

test('admin-created active ads appear in public settings by slot and override older ads', async () => {
  const { app } = makeApp();
  const agent = request.agent(app);
  await agent.post('/api/admin/login').send({ username: 'admin', password: 'admin123' }).expect(200);
  await agent.post('/api/admin/ads').send({ slot: 'header', title: 'Iklan Lama', body: 'lama', url: 'https://old.example', active: true }).expect(201);
  await agent.post('/api/admin/ads').send({ slot: 'header', title: 'Promo ADZ', body: 'Topup murah', url: 'https://morvo.me', active: true }).expect(201);
  const settings = await request(app).get('/api/settings').expect(200);
  assert.equal(settings.body.ads.header.title, 'Promo ADZ');
});
