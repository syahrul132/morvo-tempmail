const path = require('node:path');
const { createApp } = require('./app');
const { createFileStore } = require('./store');
const { startSmtpServer } = require('./smtp');

const PORT = Number(process.env.PORT || 3000);
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, '..', 'data', 'db.json');

const store = createFileStore(DATA_FILE);
const app = createApp({
  store,
  sessionSecret: process.env.SESSION_SECRET || 'dev-secret-change-this'
});

app.listen(PORT, () => {
  console.log(`MORVO TempMail running on http://127.0.0.1:${PORT}`);
  console.log(`Temp mail domain: morvo.me`);
  console.log(`Admin: /admin username=admin`);
});


if (process.env.SMTP_ENABLED !== 'false') {
  startSmtpServer({
    store,
    port: Number(process.env.SMTP_PORT || 25),
    host: process.env.SMTP_HOST || '0.0.0.0'
  });
}
