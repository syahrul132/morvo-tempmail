const path = require('node:path');
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const {
  publicSettings,
  createMailbox,
  findMailbox,
  findMailboxByAddress,
  requireFields,
  upgradeMailbox,
  verifyAdmin,
  updateSettings,
  changeAdminPassword,
  upsertAd
} = require('./services');

function createApp({ store, sessionSecret = process.env.SESSION_SECRET || 'change-me-in-production' }) {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  app.use(session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax' }
  }));

  app.use(express.static(path.join(__dirname, '..', 'public')));

  function requireAdmin(req, res, next) {
    if (!req.session?.admin) return res.status(401).json({ error: 'Admin login required' });
    next();
  }

  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.get('/api/settings', (req, res) => res.json(publicSettings(store.read())));

  app.post('/api/mailboxes', (req, res, next) => {
    try {
      const mailbox = store.mutate((data) => createMailbox(data, req.body.localPart));
      res.status(201).json(mailbox);
    } catch (err) { next(err); }
  });

  app.get('/api/mailboxes/:id', (req, res) => {
    const mailbox = findMailbox(store.read(), req.params.id);
    if (!mailbox) return res.status(404).json({ error: 'Mailbox not found' });
    res.json(mailbox);
  });

  app.get('/api/mailboxes/:id/messages', (req, res) => {
    const data = store.read();
    const mailbox = findMailbox(data, req.params.id);
    if (!mailbox) return res.status(404).json({ error: 'Mailbox not found' });
    const messages = data.messages.filter((msg) => msg.mailboxId === mailbox.id);
    res.json({ messages });
  });

  app.post('/api/mailboxes/:id/messages/:messageId/read', (req, res) => {
    const message = store.mutate((data) => {
      const msg = data.messages.find((item) => item.mailboxId === req.params.id && item.id === req.params.messageId);
      if (msg) msg.read = true;
      return msg || null;
    });
    if (!message) return res.status(404).json({ error: 'Message not found' });
    res.json(message);
  });

  app.post('/api/inbound', (req, res, next) => {
    try {
      requireFields(req.body, ['to', 'from', 'subject', 'body']);
      const message = store.mutate((data) => {
        const mailbox = findMailboxByAddress(data, req.body.to);
        if (!mailbox) {
          const err = new Error('Recipient mailbox not found');
          err.status = 404;
          throw err;
        }
        const msg = {
          id: `msg_${Date.now()}_${Math.random().toString(16).slice(2)}`,
          mailboxId: mailbox.id,
          to: mailbox.address,
          from: String(req.body.from),
          subject: String(req.body.subject),
          body: String(req.body.body),
          read: false,
          createdAt: new Date().toISOString()
        };
        data.messages.unshift(msg);
        return msg;
      });
      res.status(202).json(message);
    } catch (err) { next(err); }
  });

  app.post('/api/mailboxes/:id/send', (req, res, next) => {
    try {
      requireFields(req.body, ['to', 'subject', 'body']);
      const sent = store.mutate((data) => {
        if (!data.settings.allowSending) {
          const err = new Error('Sending disabled by admin');
          err.status = 403;
          throw err;
        }
        const mailbox = findMailbox(data, req.params.id);
        if (!mailbox) {
          const err = new Error('Mailbox not found');
          err.status = 404;
          throw err;
        }
        const item = {
          id: `sent_${Date.now()}_${Math.random().toString(16).slice(2)}`,
          mailboxId: mailbox.id,
          from: mailbox.address,
          to: String(req.body.to),
          subject: String(req.body.subject),
          body: String(req.body.body),
          status: data.settings.smtpMode === 'demo' ? 'demo-recorded' : 'queued',
          createdAt: new Date().toISOString()
        };
        data.sent.unshift(item);
        return item;
      });
      res.status(202).json(sent);
    } catch (err) { next(err); }
  });

  app.get('/api/mailboxes/:id/sent', (req, res) => {
    const data = store.read();
    const mailbox = findMailbox(data, req.params.id);
    if (!mailbox) return res.status(404).json({ error: 'Mailbox not found' });
    res.json({ sent: data.sent.filter((item) => item.mailboxId === mailbox.id) });
  });

  app.post('/api/mailboxes/:id/topup', (req, res) => {
    const amount = Math.max(0, Number(req.body.amount) || 0);
    const mailbox = store.mutate((data) => {
      const box = findMailbox(data, req.params.id);
      if (!box) return null;
      box.balance += amount;
      return box;
    });
    if (!mailbox) return res.status(404).json({ error: 'Mailbox not found' });
    res.json(mailbox);
  });

  app.post('/api/mailboxes/:id/upgrade', (req, res, next) => {
    try {
      const mailbox = store.mutate((data) => upgradeMailbox(data, req.params.id));
      res.json(mailbox);
    } catch (err) { next(err); }
  });

  app.post('/api/admin/login', (req, res) => {
    const data = store.read();
    if (!verifyAdmin(data, req.body.username, req.body.password)) return res.status(401).json({ error: 'Invalid credentials' });
    req.session.admin = { username: data.settings.adminUsername, role: 'admin' };
    res.json({ ok: true, admin: req.session.admin });
  });

  app.post('/api/admin/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));
  app.get('/api/admin/me', requireAdmin, (req, res) => res.json({ admin: req.session.admin }));
  app.get('/api/admin/state', requireAdmin, (req, res) => res.json(store.read()));

  app.put('/api/admin/settings', requireAdmin, (req, res) => {
    const settings = store.mutate((data) => updateSettings(data, req.body));
    res.json(settings);
  });

  app.put('/api/admin/password', requireAdmin, (req, res) => {
    const result = store.mutate((data) => changeAdminPassword(data, req.body.username, req.body.password));
    res.json(result);
  });

  app.post('/api/admin/ads', requireAdmin, (req, res, next) => {
    try {
      const ad = store.mutate((data) => upsertAd(data, req.body));
      res.status(201).json(ad);
    } catch (err) { next(err); }
  });

  app.put('/api/admin/ads/:id', requireAdmin, (req, res, next) => {
    try {
      const ad = store.mutate((data) => upsertAd(data, req.body, req.params.id));
      res.json(ad);
    } catch (err) { next(err); }
  });

  app.delete('/api/admin/ads/:id', requireAdmin, (req, res) => {
    const removed = store.mutate((data) => {
      const before = data.ads.length;
      data.ads = data.ads.filter((ad) => ad.id !== req.params.id);
      return before !== data.ads.length;
    });
    res.status(removed ? 204 : 404).send();
  });

  app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ error: err.message || 'Internal error' });
  });

  return app;
}

module.exports = { createApp };
