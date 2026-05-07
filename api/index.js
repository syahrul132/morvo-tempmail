const path = require('node:path');
const { createApp } = require('../src/app');
const { createFileStore } = require('../src/store');

const DATA_FILE = process.env.DATA_FILE || path.join('/tmp', 'adz-tempmail-vercel-db.json');
const SESSION_SECRET = process.env.SESSION_SECRET || 'vercel-dev-secret-change-this';

module.exports = createApp({
  store: createFileStore(DATA_FILE),
  sessionSecret: SESSION_SECRET
});
