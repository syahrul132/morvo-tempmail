# MORVO TempMail Express

Disposable email service — buat alamat email sementara dalam hitungan detik untuk protect privacy.

**Live:** https://morvo.me  
**Email domain:** adzstore.my.id  
**Repo:** https://github.com/syahrul132/morvo-tempmail

---

## Fitur

- 📧 **Temp Email** — buat mailbox sementara dengan 1 kredit
- 💳 **Credits System** — free 3 credits, beli Rp 1.000/credit, unlimited Rp 150.000/3 bulan
- 🔄 **Real-time Inbox** — terima email masuk langsung (SMTP inbound)
- 🛡️ **Admin Panel** — manage users, payments, pengaturan site
- 🔑 **REST API** — API key untuk premium users
- 📱 **Mobile-first** — dark theme, floating nav-dock, responsive
- 📖 **API Docs** — dokumentasi API lengkap di /api/docs

## Tech Stack

- **Backend:** Node.js 22 + Express.js
- **Frontend:** Vanilla HTML/CSS/JS SPA (hash routing)
- **Database:** JSON flat-file store
- **SMTP:** Custom inbound SMTP server (port 25)
- **Auth:** bcrypt + express-session
- **Process:** PM2
- **Proxy:** Nginx + Let's Encrypt SSL

## Quick Start (Development)

```bash
git clone https://github.com/syahrul132/morvo-tempmail.git
cd morvo-tempmail
npm install
npm start
# Open http://localhost:3000
```

## Production Deployment (New VPS)

### 1. Setup from scratch

```bash
# On fresh Ubuntu 22.04+ VPS as root:
git clone https://github.com/syahrul132/morvo-tempmail.git /var/www/morvo-tempmail
cd /var/www/morvo-tempmail
bash deploy/setup.sh
```

Setup script handles: Node.js 22, PM2, Nginx, SSL cert, firewall, auto-startup.

### 2. DNS Records

```
morvo.me              A      → YOUR_SERVER_IP
www.morvo.me          A      → YOUR_SERVER_IP
adzstore.my.id        MX     → 10 mail.adzstore.my.id
mail.adzstore.my.id   A      → YOUR_SERVER_IP
```

### 3. Migrate from old VPS

```bash
# On OLD VPS — create backup:
bash deploy/backup.sh
# Output: /tmp/morvo-full-backup-YYYYMMDD_HHMMSS.tar.gz

# Transfer to new VPS:
scp /tmp/morvo-full-backup-*.tar.gz root@NEW_VPS:/tmp/

# On NEW VPS — restore:
mkdir -p /var/www
tar -xzf /tmp/morvo-full-backup-*.tar.gz --strip-components=1 -C /var/www/morvo-tempmail
bash /var/www/morvo-tempmail/deploy/restore.sh /tmp/morvo-full-backup-*.tar.gz

# Then:
# 1. Update DNS to new server IP
# 2. certbot --nginx -d morvo.me -d www.morvo.me
```

## API Endpoints

```
POST   /api/auth/register     — Register new user
POST   /api/auth/login        — Login
POST   /api/auth/logout       — Logout
GET    /api/auth/me           — Current user info

POST   /api/mailbox           — Create temp mailbox (1 credit)
GET    /api/mailbox           — List user's mailboxes
GET    /api/mailbox/:id       — Get mailbox with messages
DELETE /api/mailbox/:id       — Delete mailbox

POST   /api/payments/buy      — Purchase credits
GET    /api/payments/history  — Payment history

GET    /admin                 — Admin panel (admin only)
GET    /api/docs              — API documentation
```

## Ports

| Port | Service | Description |
|------|---------|-------------|
| 25   | SMTP    | Inbound email receiver (adzstore.my.id) |
| 80   | Nginx   | HTTP → HTTPS redirect |
| 443  | Nginx   | HTTPS reverse proxy → Node.js :3000 |
| 3000 | Node.js | App server (internal) |

## Database

Data stored in `data/db.json`. Backed up automatically in `deploy/backup.sh`.

Schema:
- `users` — accounts, credits, plan
- `mailboxes` — temporary email addresses
- `messages` — received emails
- `payments` — transaction history
- `admin` — site settings

## File Structure

```
morvo-tempmail/
├── src/
│   ├── server.js      # Entry point (Express + SMTP)
│   ├── app.js         # Routes & middleware
│   ├── services.js    # Business logic (users, mailboxes, payments)
│   ├── store.js       # JSON file database
│   └── smtp.js        # Inbound SMTP server
├── public/
│   ├── index.html     # Main SPA shell
│   ├── app.js         # Frontend app logic
│   ├── styles.css     # All styles
│   ├── admin.html     # Admin panel
│   ├── api-docs.html  # API documentation
│   └── src/           # Component modules
├── deploy/
│   ├── setup.sh       # Fresh VPS setup
│   ├── backup.sh      # Create migration backup
│   ├── restore.sh     # Restore from backup
│   ├── nginx-morvo.conf
│   └── dns-records.txt
├── ecosystem.config.js # PM2 config
├── package.json
└── README.md
```

## License

Private — All rights reserved.
