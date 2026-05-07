const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { DEFAULT_DOMAIN } = require('./store');

function id(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function publicSettings(data) {
  const activeAds = {};
  for (const ad of data.ads.filter((item) => item.active)) {
    if (!activeAds[ad.slot]) activeAds[ad.slot] = ad;
  }
  return {
    siteName: data.settings.siteName,
    domain: data.settings.domain,
    freeHours: data.settings.freeHours,
    unlimitedPrice: data.settings.unlimitedPrice,
    allowSending: data.settings.allowSending,
    heroTitle: data.settings.heroTitle,
    heroSubtitle: data.settings.heroSubtitle,
    smtpMode: data.settings.smtpMode,
    ads: activeAds
  };
}

function sanitizeLocalPart(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 24);
}

function randomAddress(domain = DEFAULT_DOMAIN) {
  const words = ['akses', 'otp', 'mail', 'ghost', 'inbox', 'verify', 'ninja', 'kilat'];
  return `${words[Math.floor(Math.random() * words.length)]}${crypto.randomInt(10000, 99999)}@${domain}`;
}

function createMailbox(data, localPart) {
  const now = new Date();
  const safeLocal = sanitizeLocalPart(localPart);
  const address = safeLocal ? `${safeLocal}@${data.settings.domain}` : randomAddress(data.settings.domain);
  if (!address.endsWith(`@${data.settings.domain}`)) throw new Error('Invalid domain');
  if (data.mailboxes.some((box) => box.address === address)) throw new Error('Mailbox already exists');
  const mailbox = {
    id: id('mbx'),
    address,
    domain: data.settings.domain,
    plan: 'free',
    balance: 0,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + Number(data.settings.freeHours) * 60 * 60 * 1000).toISOString()
  };
  data.mailboxes.unshift(mailbox);
  return mailbox;
}

function findMailbox(data, mailboxId) {
  return data.mailboxes.find((box) => box.id === mailboxId);
}

function findMailboxByAddress(data, address) {
  return data.mailboxes.find((box) => box.address.toLowerCase() === String(address).toLowerCase());
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

function upgradeMailbox(data, mailboxId) {
  const mailbox = findMailbox(data, mailboxId);
  if (!mailbox) {
    const err = new Error('Mailbox not found');
    err.status = 404;
    throw err;
  }
  if (mailbox.plan === 'unlimited') return mailbox;
  const price = Number(data.settings.unlimitedPrice);
  if (mailbox.balance < price) {
    const err = new Error('Balance tidak cukup');
    err.status = 402;
    throw err;
  }
  mailbox.balance -= price;
  mailbox.plan = 'unlimited';
  mailbox.expiresAt = null;
  return mailbox;
}

function verifyAdmin(data, username, password) {
  return username === data.settings.adminUsername && bcrypt.compareSync(String(password || ''), data.settings.adminPasswordHash);
}

function updateSettings(data, payload) {
  const allowed = ['siteName', 'freeHours', 'unlimitedPrice', 'allowSending', 'heroTitle', 'heroSubtitle', 'smtpMode'];
  for (const key of allowed) {
    if (payload[key] !== undefined) data.settings[key] = payload[key];
  }
  data.settings.domain = DEFAULT_DOMAIN;
  data.settings.freeHours = Math.max(1, Number(data.settings.freeHours) || 24);
  data.settings.unlimitedPrice = Math.max(0, Number(data.settings.unlimitedPrice) || 0);
  data.settings.allowSending = Boolean(data.settings.allowSending);
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

module.exports = {
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
};
