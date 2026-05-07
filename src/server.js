const path = require('node:path');
const { createApp } = require('./app');
const { createFileStore } = require('./store');

const PORT = Number(process.env.PORT || 3000);
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, '..', 'data', 'db.json');

const app = createApp({
  store: createFileStore(DATA_FILE),
  sessionSecret: process.env.SESSION_SECRET || 'dev-secret-change-this'
});

app.listen(PORT, () => {
  console.log(`ADZ TempMail fullstack running on http://127.0.0.1:${PORT}`);
  console.log(`Temp mail domain: adzstore.my.id`);
  console.log(`Admin: /admin.html username=admin password=admin123`);
});
