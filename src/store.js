const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcryptjs');

const DEFAULT_DOMAIN = 'morvo.me';
const DEFAULT_ADMIN_PASSWORD_HASH = bcrypt.hashSync('MorvoAdmin2026!', 10);

function defaultData() {
  return {
    settings: {
      siteName: 'MORVO TempMail',
      domain: DEFAULT_DOMAIN,
      freeHours: 24,
      creditPrice: 1000,
      unlimitedPrice: 150000,
      unlimitedDurationDays: 90,
      allowSending: true,
      adminUsername: 'admin',
      adminPasswordHash: DEFAULT_ADMIN_PASSWORD_HASH,
      heroTitle: 'Email sementara yang cepat, privat, dan siap menerima pesan asli.',
      heroSubtitle: 'Buat inbox temporary, terima email penuh, kelola saldo, dan upgrade alamat menjadi unlimited.',
      smtpMode: 'real',
      cryptoEnabled: true,
      usdtRate: 16500,
      wallets: {
        base: '',
        tron: '',
        solana: ''
      },
      cryptoConfirmations: 1
    },
    mailboxes: [],
    messages: [],
    sent: [],
    users: [],
    payments: [],
    ads: []
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function migrateUser(user) {
  if (user.credits === undefined) user.credits = user.plan === 'unlimited' ? 9999 : 3;
  if (!user.plan) user.plan = 'free';
  if (user.apiKey === undefined) user.apiKey = null;
  if (user.balance === undefined) user.balance = 0;
  return user;
}

function createMemoryStore(initial = defaultData()) {
  let data = clone(initial);
  data.users = (data.users || []).map(migrateUser);
  return {
    get data() { return data; },
    read() { return clone(data); },
    write(next) { data = clone(next); return this.read(); },
    mutate(fn) { const next = clone(data); const result = fn(next); data = next; return result === undefined ? this.read() : clone(result); }
  };
}

function createFileStore(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, JSON.stringify(defaultData(), null, 2));
  else {
    const current = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    current.users ||= [];
    current.payments ||= [];
    current.ads ||= [];
    current.settings ||= defaultData().settings;
    current.settings.domain = DEFAULT_DOMAIN;
    current.settings.smtpMode = current.settings.smtpMode === 'queued' ? 'queued' : 'real';
    if (current.settings.creditPrice === undefined) current.settings.creditPrice = 1000;
    if (current.settings.unlimitedDurationDays === undefined) current.settings.unlimitedDurationDays = 90;
    if (current.settings.cryptoEnabled === undefined) current.settings.cryptoEnabled = true;
    if (current.settings.usdtRate === undefined) current.settings.usdtRate = 16500;
    if (!current.settings.wallets) current.settings.wallets = { base: '', tron: '', solana: '' };
    if (current.settings.cryptoConfirmations === undefined) current.settings.cryptoConfirmations = 1;
    current.users = current.users.map(migrateUser);
    fs.writeFileSync(filePath, JSON.stringify(current, null, 2));
  }
  return {
    read() { return JSON.parse(fs.readFileSync(filePath, 'utf8')); },
    write(next) { fs.writeFileSync(filePath, JSON.stringify(next, null, 2)); return this.read(); },
    mutate(fn) { const next = this.read(); const result = fn(next); this.write(next); return result === undefined ? this.read() : clone(result); }
  };
}

module.exports = { createMemoryStore, createFileStore, defaultData, DEFAULT_DOMAIN };
