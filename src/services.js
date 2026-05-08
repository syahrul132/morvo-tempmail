const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { DEFAULT_DOMAIN } = require('./store');

function id(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function publicSettings(data) {
  const activeAds = {};
  for (const ad of (data.ads || []).filter((item) => item.active)) {
    if (!activeAds[ad.slot]) activeAds[ad.slot] = ad;
  }
  return {
    siteName: data.settings.siteName,
    domain: data.settings.domain,
    freeHours: data.settings.freeHours,
    creditPrice: data.settings.creditPrice || 1000,
    unlimitedPrice: data.settings.unlimitedPrice,
    unlimitedDurationDays: data.settings.unlimitedDurationDays || 90,
    allowSending: data.settings.allowSending,
    heroTitle: data.settings.heroTitle,
    heroSubtitle: data.settings.heroSubtitle,
    smtpMode: data.settings.smtpMode,
    cryptoEnabled: data.settings.cryptoEnabled !== false,
    usdtRate: data.settings.usdtRate || 16500,
    wallets: {
      base: data.settings.wallets?.base || '',
      tron: data.settings.wallets?.tron || '',
      solana: data.settings.wallets?.solana || ''
    },
    ads: activeAds
  };
}

function sanitizeLocalPart(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24);
}

function randomAddress(domain = DEFAULT_DOMAIN) {
  const words = ['akses', 'otp', 'mail', 'inbox', 'verify', 'secure', 'kilat', 'nova'];
  return `${words[Math.floor(Math.random() * words.length)]}${crypto.randomInt(10000, 99999)}@${domain}`;
}

function safeUser(user) {
  if (!user) return null;
  return { id: user.id, name: user.name, email: user.email, credits: Number(user.credits || 0), plan: user.plan || 'free', apiKey: user.apiKey || null, balance: Number(user.balance || 0), createdAt: user.createdAt };
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function createUser(data, payload) {
  requireFields(payload, ['name', 'email', 'password']);
  const email = normalizeEmail(payload.email);
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    const err = new Error('Email akun tidak valid');
    err.status = 400;
    throw err;
  }
  if (String(payload.password).length < 6) {
    const err = new Error('Password minimal 6 karakter');
    err.status = 400;
    throw err;
  }
  data.users ||= [];
  if (data.users.some((user) => user.email === email)) {
    const err = new Error('Email akun sudah terdaftar');
    err.status = 409;
    throw err;
  }
  const user = {
    id: id('usr'),
    name: String(payload.name).trim().slice(0, 80),
    email,
    passwordHash: bcrypt.hashSync(String(payload.password), 10),
    credits: 3,
    plan: 'free',
    apiKey: null,
    balance: 0,
    createdAt: new Date().toISOString()
  };
  data.users.unshift(user);
  return safeUser(user);
}

function verifyUser(data, email, password) {
  const user = (data.users || []).find((item) => item.email === normalizeEmail(email));
  if (!user || !bcrypt.compareSync(String(password || ''), user.passwordHash)) return null;
  return safeUser(user);
}

function findUser(data, userId) {
  return (data.users || []).find((user) => user.id === userId);
}

function createMailbox(data, localPart, ownerId = null) {
  const now = new Date();
  const safeLocal = sanitizeLocalPart(localPart);
  const address = safeLocal ? `${safeLocal}@${data.settings.domain}` : randomAddress(data.settings.domain);
  if (!address.endsWith(`@${data.settings.domain}`)) throw new Error('Invalid domain');
  if (data.mailboxes.some((box) => box.address === address)) throw new Error('Mailbox already exists');

  // Determine plan from user
  const user = ownerId ? findUser(data, ownerId) : null;
  const plan = user ? (user.plan || 'free') : 'free';
  const freeHours = Number(data.settings.freeHours) || 24;
  const hours = plan === 'unlimited' ? (7 * 24) : freeHours; // Pro = 7 days, Free = 24h

  const mailbox = {
    id: id('mbx'),
    userId: ownerId,
    address,
    domain: data.settings.domain,
    plan,
    balance: 0,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + hours * 60 * 60 * 1000).toISOString()
  };
  data.mailboxes.unshift(mailbox);
  return mailbox;
}

function isMailboxExpired(mailbox) {
  if (!mailbox || !mailbox.expiresAt) return false;
  return new Date(mailbox.expiresAt).getTime() < Date.now();
}

function findMailbox(data, mailboxId) {
  return data.mailboxes.find((box) => box.id === mailboxId);
}

function findMailboxByAddress(data, address) {
  return data.mailboxes.find((box) => box.address.toLowerCase() === String(address).toLowerCase());
}

function userOwnsMailbox(mailbox, userId) {
  return mailbox && mailbox.userId === userId;
}

function requireFields(body, fields) {
  for (const field of fields) {
    if (!String(body[field] || '').trim()) {
      const err = new Error(`${field} is required`);
      err.status = 400;
      throw err;
    }
  }
}

function upgradeMailbox(data, mailboxId, userId = null) {
  const mailbox = findMailbox(data, mailboxId);
  if (!mailbox) {
    const err = new Error('Mailbox not found');
    err.status = 404;
    throw err;
  }
  if (userId && !userOwnsMailbox(mailbox, userId)) {
    const err = new Error('Akses mailbox ditolak');
    err.status = 403;
    throw err;
  }
  if (mailbox.plan === 'unlimited') return mailbox;
  const price = Number(data.settings.unlimitedPrice);
  const user = userId ? findUser(data, userId) : null;
  const balance = user ? Number(user.balance || 0) : Number(mailbox.balance || 0);
  if (balance < price) {
    const err = new Error('Balance tidak cukup');
    err.status = 402;
    throw err;
  }
  if (user) user.balance -= price;
  else mailbox.balance -= price;
  mailbox.plan = 'unlimited';
  mailbox.expiresAt = null;
  return mailbox;
}

function createPayment(data, userId, payload) {
  const amount = Math.max(1000, Number(payload.amount) || 0);
  const payment = {
    id: id('pay'),
    userId,
    amount,
    type: String(payload.type || 'credits'), // 'credits' or 'upgrade'
    method: String(payload.method || 'manual-transfer'),
    status: 'pending',
    metadata: payload.metadata || {}, // { creditAmount: 5 } or { plan: 'unlimited' }
    note: String(payload.note || '').slice(0, 200),
    createdAt: new Date().toISOString()
  };
  data.payments ||= [];
  data.payments.unshift(payment);
  return payment;
}

function approvePaymentAndApply(data, paymentId) {
  const payment = (data.payments || []).find((p) => p.id === paymentId);
  if (!payment) {
    const err = new Error('Payment not found');
    err.status = 404;
    throw err;
  }
  if (payment.status === 'approved') return payment;

  const user = findUser(data, payment.userId);
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }

  // Apply the effect based on payment type
  if (payment.type === 'credits') {
    const creditAmount = Number(payment.metadata?.creditAmount) || 0;
    user.credits = Number(user.credits || 0) + creditAmount;
  } else if (payment.type === 'upgrade') {
    user.plan = 'unlimited';
    user.credits = 9999;
    user.apiKey = user.apiKey || generateApiKey();
  } else {
    // Legacy payment without type → add to balance
    user.balance = Number(user.balance || 0) + Number(payment.amount || 0);
  }

  payment.status = 'approved';
  payment.updatedAt = new Date().toISOString();
  return payment;
}

function verifyAdmin(data, username, password) {
  return username === data.settings.adminUsername && bcrypt.compareSync(String(password || ''), data.settings.adminPasswordHash);
}

function updateSettings(data, payload) {
  const allowed = ['siteName', 'freeHours', 'unlimitedPrice', 'creditPrice', 'allowSending', 'heroTitle', 'heroSubtitle', 'smtpMode', 'cryptoEnabled', 'usdtRate'];
  for (const key of allowed) {
    if (payload[key] !== undefined) data.settings[key] = payload[key];
  }
  data.settings.domain = DEFAULT_DOMAIN;
  data.settings.freeHours = Math.max(1, Number(data.settings.freeHours) || 24);
  data.settings.unlimitedPrice = Math.max(0, Number(data.settings.unlimitedPrice) || 0);
  data.settings.allowSending = Boolean(data.settings.allowSending);
  data.settings.smtpMode = data.settings.smtpMode === 'queued' ? 'queued' : 'real';
  // Update wallet addresses if provided
  if (payload.wallets && typeof payload.wallets === 'object') {
    data.settings.wallets ||= {};
    for (const net of ['base', 'tron', 'solana']) {
      if (payload.wallets[net] !== undefined) {
        data.settings.wallets[net] = String(payload.wallets[net]).trim();
      }
    }
  }
  if (payload.usdtRate) data.settings.usdtRate = Math.max(1, Number(payload.usdtRate) || 16500);
  if (payload.cryptoEnabled !== undefined) data.settings.cryptoEnabled = Boolean(payload.cryptoEnabled);
  return data.settings;
}

function changeAdminPassword(data, username, password) {
  if (username) data.settings.adminUsername = String(username);
  if (password) data.settings.adminPasswordHash = bcrypt.hashSync(String(password), 10);
  return { username: data.settings.adminUsername };
}

function upsertAd(data, payload, adId = null) {
  requireFields(payload, ['slot', 'title', 'body']);
  const clean = {
    slot: String(payload.slot).trim(),
    title: String(payload.title).trim(),
    body: String(payload.body).trim(),
    url: String(payload.url || '#').trim(),
    active: payload.active !== false,
    imageUrl: String(payload.imageUrl || '').trim()
  };
  data.ads ||= [];
  if (adId) {
    const ad = data.ads.find((item) => item.id === adId);
    if (!ad) {
      const err = new Error('Ad not found');
      err.status = 404;
      throw err;
    }
    Object.assign(ad, clean, { updatedAt: new Date().toISOString() });
    return ad;
  }
  const ad = { id: id('ad'), ...clean, createdAt: new Date().toISOString() };
  data.ads.unshift(ad);
  return ad;
}



function generateApiKey() {
  return 'tm_' + require('crypto').randomBytes(16).toString('hex');
}

function getUserByApiKey(data, apiKey) {
  if (!apiKey) return null;
  return (data.users || []).find((u) => u.apiKey === apiKey) || null;
}

function regenerateApiKey(data, userId) {
  const user = findUser(data, userId);
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }
  if (user.plan !== 'unlimited') {
    const err = new Error('API key hanya tersedia untuk plan premium');
    err.status = 403;
    throw err;
  }
  user.apiKey = generateApiKey();
  return { apiKey: user.apiKey };
}

function deductCredits(data, userId, amount = 1) {
  const user = findUser(data, userId);
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }
  if (user.plan === 'unlimited' && user.credits >= 9999) return { ok: true, credits: user.credits };
  if (Number(user.credits || 0) < amount) {
    const err = new Error('Credits tidak cukup');
    err.status = 402;
    throw err;
  }
  user.credits -= amount;
  return { ok: true, credits: user.credits };
}

function addCredits(data, userId, amount) {
  const user = findUser(data, userId);
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }
  user.credits = Number(user.credits || 0) + amount;
  return { ok: true, credits: user.credits };
}

function upgradePlan(data, userId, planType) {
  const user = findUser(data, userId);
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }
  user.plan = planType;
  if (planType === 'unlimited') {
    user.credits = 9999;
    user.apiKey = user.apiKey || generateApiKey();
  }
  return { plan: user.plan, credits: user.credits, apiKey: user.apiKey };
}

module.exports = {
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
  createPayment,
  verifyAdmin,
  updateSettings,
  changeAdminPassword,
  upsertAd,
  generateApiKey,
  getUserByApiKey,
  regenerateApiKey,
  deductCredits,
  addCredits,
  approvePaymentAndApply,
  upgradePlan,
  isMailboxExpired
};
