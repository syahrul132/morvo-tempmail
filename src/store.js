const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcryptjs');

const DEFAULT_DOMAIN = 'adzstore.my.id';
const DEFAULT_ADMIN_PASSWORD_HASH = bcrypt.hashSync('admin123', 10);

function defaultData() {
  return {
    settings: {
      siteName: 'ADZ TempMail',
      domain: DEFAULT_DOMAIN,
      freeHours: 24,
      unlimitedPrice: 25000,
      allowSending: true,
      adminUsername: 'admin',
      adminPasswordHash: DEFAULT_ADMIN_PASSWORD_HASH,
      heroTitle: 'Email sementara gratis 24 jam.',
      heroSubtitle: 'Buat inbox temporary dengan domain adzstore.my.id, terima email, kirim email, dan upgrade unlimited lewat balance.',
      smtpMode: 'demo'
    },
    mailboxes: [],
    messages: [],
    sent: [],
    ads: [
      { id: 'ad-header-demo', slot: 'header', title: 'Pasang iklan di ADZ TempMail', body: 'Slot header bisa diatur dari admin panel.', url: 'https://adzstore.my.id', active: true, createdAt: new Date().toISOString() },
      { id: 'ad-sidebar-demo', slot: 'sidebar', title: 'Promo Digital Product', body: 'Iklan sidebar untuk affiliate, hosting, panel, atau toko digital.', url: 'https://adzstore.my.id', active: true, createdAt: new Date().toISOString() }
    ]
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createMemoryStore(initial = defaultData()) {
  let data = clone(initial);
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
  return {
    read() { return JSON.parse(fs.readFileSync(filePath, 'utf8')); },
    write(next) { fs.writeFileSync(filePath, JSON.stringify(next, null, 2)); return this.read(); },
    mutate(fn) { const next = this.read(); const result = fn(next); this.write(next); return result === undefined ? this.read() : clone(result); }
  };
}

module.exports = { createMemoryStore, createFileStore, defaultData, DEFAULT_DOMAIN };
