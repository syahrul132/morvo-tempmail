const path = require('node:path');
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const {
  publicSettings,
  createUser,
  verifyUser,
  safeUser,
  findUser,
  createMailbox,
  findMailbox,
  findMailboxByAddress,
  userOwnsMailbox,
  requireFields,
  upgradeMailbox,
  verifyAdmin,
  updateSettings,
  changeAdminPassword,
  upsertAd,
  createPayment,
  approvePaymentAndApply,
  deductCredits,
  addCredits,
  upgradePlan,
  regenerateApiKey,
  getUserByApiKey,
  isMailboxExpired
} = require('./services');

function createApp({ store, sessionSecret = process.env.SESSION_SECRET || 'change-me-in-production' }) {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  app.use(session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 }
  }));

  const publicDir = path.join(__dirname, '..', 'public');
  app.use(express.static(publicDir));
  app.get(['/dashboard', '/login', '/register'], (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  function requireAdmin(req, res, next) {
    if (!req.session?.admin) return res.status(401).json({ error: 'Admin login required' });
    next();
  }

  function requireUser(req, res, next) {
    if (!req.session?.user?.id) return res.status(401).json({ error: 'Login akun diperlukan' });
    next();
  }

  function assertMailboxAccess(data, mailboxId, userId) {
    const mailbox = findMailbox(data, mailboxId);
    if (!mailbox) {
      const err = new Error('Mailbox not found');
      err.status = 404;
      throw err;
    }
    if (mailbox.userId && !userOwnsMailbox(mailbox, userId)) {
      const err = new Error('Akses mailbox ditolak');
      err.status = 403;
      throw err;
    }
    return mailbox;
  }

  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.get('/api/settings', (req, res) => res.json(publicSettings(store.read())));

  app.post('/api/auth/register', (req, res, next) => {
    try {
      const user = store.mutate((data) => createUser(data, req.body));
      req.session.user = user;
      res.status(201).json({ ok: true, user });
    } catch (err) { next(err); }
  });

  app.post('/api/auth/login', (req, res) => {
    const user = verifyUser(store.read(), req.body.email, req.body.password);
    if (!user) return res.status(401).json({ error: 'Email atau password salah' });
    req.session.user = user;
    res.json({ ok: true, user });
  });

  app.post('/api/auth/logout', (req, res) => {
    req.session.user = null;
    res.json({ ok: true });
  });

  app.get('/api/auth/me', (req, res) => {
    if (!req.session?.user?.id) return res.status(401).json({ error: 'Belum login' });
    const user = safeUser(findUser(store.read(), req.session.user.id));
    if (!user) return res.status(401).json({ error: 'Akun tidak ditemukan' });
    req.session.user = user;
    res.json({ user });
  });

  app.get('/api/account', requireUser, (req, res) => {
    const data = store.read();
    const user = safeUser(findUser(data, req.session.user.id));
    const mailboxes = data.mailboxes.filter((box) => box.userId === user.id);
    const payments = (data.payments || []).filter((payment) => payment.userId === user.id);
    res.json({ user, mailboxes, payments });
  });

  app.post('/api/mailboxes', requireUser, (req, res, next) => {
    try {
      const data = store.read();
      const user = findUser(data, req.session.user.id);
      if (!user) return res.status(404).json({ error: 'Akun tidak ditemukan' });
      if (Number(user.credits || 0) < 1) {
        return res.status(402).json({ error: 'Credits habis. Upgrade ke Premium untuk buat email baru.', code: 'CREDITS_EMPTY' });
      }
      const requestedLocalPart = req.body.localPart || (req.body.prefix
        ? `${String(req.body.prefix).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20)}${Math.random().toString(36).slice(2, 6)}`
        : undefined);
      const mailbox = store.mutate((data) => {
        const m = createMailbox(data, requestedLocalPart, req.session.user.id);
        const u = findUser(data, req.session.user.id);
        if (u) u.credits = Math.max(0, Number(u.credits || 0) - 1);
        return m;
      });
      const settings = store.read().settings;
      res.status(201).json({ ...mailbox, canSend: Boolean(settings.allowSending) });
    } catch (err) { next(err); }
  });

  app.get('/api/mailboxes/:id', requireUser, (req, res, next) => {
    try {
      const mailbox = assertMailboxAccess(store.read(), req.params.id, req.session.user.id);
      res.json(mailbox);
    } catch (err) { next(err); }
  });

  app.get('/api/mailboxes/:id/messages', requireUser, (req, res, next) => {
    try {
      const data = store.read();
      const mailbox = assertMailboxAccess(data, req.params.id, req.session.user.id);
      const messages = data.messages.filter((msg) => msg.mailboxId === mailbox.id);
      res.json({ messages });
    } catch (err) { next(err); }
  });

  app.get('/api/mailboxes/:id/messages/:messageId', requireUser, (req, res, next) => {
    try {
      const data = store.read();
      assertMailboxAccess(data, req.params.id, req.session.user.id);
      const message = data.messages.find((item) => item.mailboxId === req.params.id && item.id === req.params.messageId);
      if (!message) return res.status(404).json({ error: 'Message not found' });
      res.json(message);
    } catch (err) { next(err); }
  });

  app.post('/api/mailboxes/:id/messages/:messageId/read', requireUser, (req, res, next) => {
    try {
      const message = store.mutate((data) => {
        assertMailboxAccess(data, req.params.id, req.session.user.id);
        const msg = data.messages.find((item) => item.mailboxId === req.params.id && item.id === req.params.messageId);
        if (msg) msg.read = true;
        return msg || null;
      });
      if (!message) return res.status(404).json({ error: 'Message not found' });
      res.json(message);
    } catch (err) { next(err); }
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
        if (isMailboxExpired(mailbox)) {
          const err = new Error('Mailbox expired');
          err.status = 410;
          throw err;
        }
        const msg = {
          id: `msg_${Date.now()}_${Math.random().toString(16).slice(2)}`,
          mailboxId: mailbox.id,
          to: mailbox.address,
          from: String(req.body.from),
          subject: String(req.body.subject),
          body: String(req.body.body),
          text: String(req.body.body),
          html: String(req.body.html || ''),
          headers: [],
          read: false,
          createdAt: new Date().toISOString()
        };
        data.messages.unshift(msg);
        return msg;
      });
      res.status(202).json(message);
    } catch (err) { next(err); }
  });

  app.post('/api/mailboxes/:id/send', requireUser, (req, res, next) => {
    try {
      requireFields(req.body, ['to', 'subject', 'body']);
      const sent = store.mutate((data) => {
        if (!data.settings.allowSending) {
          const err = new Error('Sending disabled by admin');
          err.status = 403;
          throw err;
        }
        const mailbox = assertMailboxAccess(data, req.params.id, req.session.user.id);
        const item = {
          id: `sent_${Date.now()}_${Math.random().toString(16).slice(2)}`,
          mailboxId: mailbox.id,
          from: mailbox.address,
          to: String(req.body.to),
          subject: String(req.body.subject),
          body: String(req.body.body),
          status: data.settings.smtpMode === 'queued' ? 'queued' : 'accepted',
          createdAt: new Date().toISOString()
        };
        data.sent.unshift(item);
        return item;
      });
      res.status(202).json(sent);
    } catch (err) { next(err); }
  });

  app.get('/api/mailboxes/:id/sent', requireUser, (req, res, next) => {
    try {
      const data = store.read();
      const mailbox = assertMailboxAccess(data, req.params.id, req.session.user.id);
      res.json({ sent: data.sent.filter((item) => item.mailboxId === mailbox.id) });
    } catch (err) { next(err); }
  });

  app.post('/api/payments', requireUser, (req, res, next) => {
    try {
      const payment = store.mutate((data) => createPayment(data, req.session.user.id, req.body));
      res.status(201).json(payment);
    } catch (err) { next(err); }
  });

  app.post('/api/mailboxes/:id/topup', requireUser, (req, res) => {
    const amount = Math.max(0, Number(req.body.amount) || 0);
    const result = store.mutate((data) => {
      const user = findUser(data, req.session.user.id);
      if (!user) return null;
      user.balance += amount;
      return { user: safeUser(user) };
    });
    if (!result) return res.status(404).json({ error: 'Akun tidak ditemukan' });
    req.session.user = result.user;
    res.json(result);
  });

  app.post('/api/mailboxes/:id/upgrade', requireUser, (req, res, next) => {
    try {
      const mailbox = store.mutate((data) => upgradeMailbox(data, req.params.id, req.session.user.id));
      const user = safeUser(findUser(store.read(), req.session.user.id));
      req.session.user = user;
      res.json({ mailbox, user });
    } catch (err) { next(err); }
  });

  app.get('/api/credits', requireUser, (req, res) => {
    const user = safeUser(findUser(store.read(), req.session.user.id));
    if (!user) return res.status(404).json({ error: 'Akun tidak ditemukan' });
    req.session.user = user;
    res.json({ credits: user.credits, plan: user.plan, apiKey: user.apiKey });
  });


  // Crypto payment (USDT) — create pending payment with crypto details
  app.post('/api/crypto/pay', requireUser, (req, res, next) => {
    try {
      const creditAmount = Math.max(1, Number(req.body.amount) || 0);
      const network = String(req.body.network || 'base');
      const settings = store.read().settings;
      const pricePerCredit = Number(settings.creditPrice) || 1000;
      const totalIDR = creditAmount * pricePerCredit;
      const usdtRate = Number(settings.usdtRate) || 16500;
      const totalUSDT = Number((totalIDR / usdtRate).toFixed(2));
      const wallet = (settings.wallets || {})[network] || '';

      if (!settings.cryptoEnabled) {
        return res.status(400).json({ error: 'Pembayaran crypto tidak tersedia' });
      }
      if (!wallet) {
        return res.status(400).json({ error: 'Wallet untuk jaringan ' + network + ' belum dikonfigurasi' });
      }

      const payment = store.mutate((data) => createPayment(data, req.session.user.id, {
        amount: totalIDR,
        type: 'credits',
        method: 'crypto-usdt-' + network,
        metadata: {
          creditAmount,
          cryptoNetwork: network,
          cryptoAmount: totalUSDT,
          cryptoRate: usdtRate,
          cryptoWallet: wallet,
          txHash: null,
          status: 'awaiting_payment'
        },
        note: `Beli ${creditAmount} kredit via USDT (${network.toUpperCase()}) — ${totalUSDT} USDT`
      }));

      res.json({
        payment: {
          id: payment.id,
          amount: totalIDR,
          cryptoAmount: totalUSDT,
          cryptoRate: usdtRate,
          cryptoNetwork: network,
          cryptoWallet: wallet
        }
      });
    } catch (err) { next(err); }
  });

  // Submit TX hash after user sends USDT
  app.post('/api/crypto/submit-tx', requireUser, (req, res, next) => {
    try {
      const { paymentId, txHash } = req.body;
      if (!paymentId || !txHash) return res.status(400).json({ error: 'paymentId dan txHash wajib diisi' });
      const payment = store.mutate((data) => {
        const p = (data.payments || []).find((x) => x.id === paymentId);
        if (!p) { const e = new Error('Payment not found'); e.status = 404; throw e; }
        if (p.userId !== req.session.user.id) { const e = new Error('Akses ditolak'); e.status = 403; throw e; }
        p.metadata.txHash = String(txHash).trim();
        p.metadata.status = 'verifying';
        p.note = p.note + ' | TX: ' + String(txHash).trim();
        return { id: p.id, status: p.metadata.status };
      });
      res.json({ ok: true, payment });
    } catch (err) { next(err); }
  });

  // Buy credits → create payment request (requires admin approval)
  app.post('/api/credits/buy', requireUser, (req, res, next) => {
    try {
      const creditAmount = Math.max(1, Number(req.body.amount) || 0);
      const settings = store.read().settings;
      const pricePerCredit = Number(settings.creditPrice) || 1000;
      const totalAmount = creditAmount * pricePerCredit;
      const payment = store.mutate((data) => createPayment(data, req.session.user.id, {
        amount: totalAmount,
        type: 'credits',
        method: String(req.body.method || 'manual-transfer'),
        metadata: { creditAmount },
        note: `Beli ${creditAmount} kredit`
      }));
      res.json({ payment, message: 'Pembayaran dibuat. Menunggu persetujuan admin.' });
    } catch (err) { next(err); }
  });

  // Upgrade plan → create payment request (requires admin approval)
  app.post('/api/plan/upgrade', requireUser, (req, res, next) => {
    try {
      const settings = store.read().settings;
      const totalAmount = Number(settings.unlimitedPrice) || 150000;
      const payment = store.mutate((data) => createPayment(data, req.session.user.id, {
        amount: totalAmount,
        type: 'upgrade',
        method: String(req.body.method || 'manual-transfer'),
        metadata: { plan: 'unlimited' },
        note: 'Upgrade ke plan Unlimited'
      }));
      res.json({ payment, message: 'Pembayaran dibuat. Menunggu persetujuan admin.' });
    } catch (err) { next(err); }
  });

  app.get('/api/apikey', requireUser, (req, res) => {
    const user = safeUser(findUser(store.read(), req.session.user.id));
    if (!user) return res.status(404).json({ error: 'Akun tidak ditemukan' });
    res.json({ apiKey: user.apiKey, hasKey: Boolean(user.apiKey) });
  });

  app.post('/api/apikey/regenerate', requireUser, (req, res, next) => {
    try {
      const result = store.mutate((data) => regenerateApiKey(data, req.session.user.id));
      req.session.user = safeUser(findUser(store.read(), req.session.user.id));
      res.json(result);
    } catch (err) { next(err); }
  });

  app.get('/api/external/mailbox', (req, res) => {
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;
    if (!apiKey) return res.status(401).json({ error: 'API key required' });
    const data = store.read();
    const user = getUserByApiKey(data, apiKey);
    if (!user) return res.status(401).json({ error: 'Invalid API key' });
    const userMailboxes = data.mailboxes.filter((box) => box.userId === user.id);
    res.json({ mailboxes: userMailboxes.map((m) => ({ id: m.id, address: m.address, plan: m.plan })) });
  });

  app.post('/api/external/mailbox', (req, res, next) => {
    try {
      const apiKey = req.headers['x-api-key'] || req.query.apiKey;
      if (!apiKey) return res.status(401).json({ error: 'API key required' });
      const result = store.mutate((data) => {
        const user = getUserByApiKey(data, apiKey);
        if (!user) throw Object.assign(new Error('Invalid API key'), { status: 401 });
        if (user.plan !== 'unlimited') throw Object.assign(new Error('Premium plan required'), { status: 403 });
        if (Number(user.credits) < 1) throw Object.assign(new Error('Credits empty'), { status: 402 });
        const requestedLocalPart = req.body.localPart || req.body.prefix
          ? `${String(req.body.prefix || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20)}${Math.random().toString(36).slice(2, 6)}`
          : undefined;
        const mailbox = createMailbox(data, requestedLocalPart, user.id);
        user.credits = Math.max(0, Number(user.credits) - 1);
        return { mailbox, credits: user.credits };
      });
      res.status(201).json(result);
    } catch (err) { next(err); }
  });

  app.get('/api/external/messages', (req, res) => {
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;
    if (!apiKey) return res.status(401).json({ error: 'API key required' });
    const data = store.read();
    const user = getUserByApiKey(data, apiKey);
    if (!user) return res.status(401).json({ error: 'Invalid API key' });
    const userBoxIds = data.mailboxes.filter((b) => b.userId === user.id).map((b) => b.id);
    const messages = data.messages.filter((m) => userBoxIds.includes(m.mailboxId));
    res.json({ messages });
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

  app.post('/api/admin/payments/:id/approve', requireAdmin, (req, res, next) => {
    try {
      const payment = store.mutate((data) => approvePaymentAndApply(data, req.params.id));
      res.json(payment);
    } catch (err) { next(err); }
  });

  app.post('/api/admin/payments/:id/reject', requireAdmin, (req, res, next) => {
    try {
      const payment = store.mutate((data) => {
        const item = (data.payments || []).find((p) => p.id === req.params.id);
        if (!item) {
          const err = new Error('Payment not found');
          err.status = 404;
          throw err;
        }
        item.status = 'rejected';
        item.updatedAt = new Date().toISOString();
        return item;
      });
      res.json(payment);
    } catch (err) { next(err); }
  });

  // Admin: add credits to user
  app.post('/api/admin/users/:id/credits', requireAdmin, (req, res) => {
    const amount = Math.max(0, Number(req.body.amount) || 0);
    const result = store.mutate((data) => {
      const user = findUser(data, req.params.id);
      if (!user) return null;
      user.credits = Number(user.credits || 0) + amount;
      return { id: user.id, name: user.name, email: user.email, credits: user.credits, plan: user.plan };
    });
    if (!result) return res.status(404).json({ error: 'User not found' });
    res.json(result);
  });

  // Admin: set user plan
  app.post('/api/admin/users/:id/plan', requireAdmin, (req, res) => {
    const result = store.mutate((data) => {
      const user = findUser(data, req.params.id);
      if (!user) return null;
      user.plan = req.body.plan || 'free';
      if (user.plan === 'unlimited') {
        user.credits = 9999;
        if (!user.apiKey) user.apiKey = require('crypto').randomBytes(16).toString('hex');
      }
      return { id: user.id, name: user.name, email: user.email, credits: user.credits, plan: user.plan };
    });
    if (!result) return res.status(404).json({ error: 'User not found' });
    res.json(result);
  });

  // Admin: delete user
  app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
    const removed = store.mutate((data) => {
      const before = data.users.length;
      data.users = data.users.filter((u) => u.id !== req.params.id);
      return before !== data.users.length;
    });
    res.status(removed ? 204 : 404).send();
  });

  // Admin: delete mailbox
  app.delete('/api/admin/mailboxes/:id', requireAdmin, (req, res) => {
    const removed = store.mutate((data) => {
      const before = data.mailboxes.length;
      data.mailboxes = data.mailboxes.filter((m) => m.id !== req.params.id);
      return before !== data.mailboxes.length;
    });
    res.status(removed ? 204 : 404).send();
  });

  // Serve admin panel
  app.get('/admin', (req, res) => {
    res.sendFile(path.join(publicDir, 'admin.html'));
  });

  // Serve API docs
  app.get('/api/docs', (req, res) => {
    res.sendFile(path.join(publicDir, 'api-docs.html'));
  });

  app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ error: err.message || 'Internal error' });
  });

  return app;
}

module.exports = { createApp };
