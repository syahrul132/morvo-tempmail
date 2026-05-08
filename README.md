# MORVO TempMail Fullstack

Fullstack prototype temporary email dengan domain mailbox `morvo.me`.

## Run

```bash
npm install
npm start
```

Default URL:

- Website: http://127.0.0.1:3000/
- Admin: http://127.0.0.1:3000/admin.html

Default admin:

- Username: `admin`
- Password: `admin123`

Ganti password dari admin panel sebelum deploy.

## Test

```bash
npm test
```

## Fitur

User:

- Generate temporary email `*@morvo.me`
- Free plan 24 jam sesuai setting admin
- Inbox API
- Send email API mode demo/queued
- Topup balance demo
- Upgrade mailbox ke unlimited
- Ads slot header/sidebar/pricing dari admin

Admin:

- Login role admin
- Setting nama website, hero text, durasi free, harga unlimited
- Toggle kirim email
- SMTP mode demo/queued
- CRUD ads
- Lihat statistik mailbox, inbox, sent, ads
- Ganti username/password admin

## API utama

```bash
POST /api/mailboxes                 # body: {"prefix":"demo"} optional
GET  /api/mailboxes/:id/messages
POST /api/inbound
POST /api/mailboxes/:id/send
POST /api/mailboxes/:id/topup
POST /api/mailboxes/:id/upgrade
GET  /api/settings
POST /api/admin/login
PUT  /api/admin/settings
POST /api/admin/ads
```

## Deploy Vercel

Project ini sudah disiapkan sebagai Express serverless handler:

- `api/index.js` mengekspor Express app, tanpa `listen()`.
- `vercel.json` mengarahkan request ke handler.
- `npm run vercel-build` adalah no-op agar Vercel tidak salah mendeteksi Next.js.

Catatan: JSON file store tidak durable di serverless. Untuk produksi gunakan DB eksternal.

Contoh inbound webhook:

```bash
curl -X POST http://127.0.0.1:3000/api/inbound \
  -H 'Content-Type: application/json' \
  -d '{"to":"akses12345@morvo.me","from":"otp@example.com","subject":"OTP","body":"Kode 123456"}'
```

## Catatan produksi

Project ini sudah fullstack, tapi receive/send email real masih perlu integrasi infra:

1. DNS domain `morvo.me`:
   - MX record mengarah ke mail server inbound.
   - SPF/DKIM/DMARC untuk pengiriman.
2. Inbound mail server:
   - Mail server atau provider webhook meneruskan email ke `POST /api/inbound`.
3. Outbound SMTP:
   - Implement worker untuk membaca item sent dengan status queued lalu kirim via SMTP/API.
4. Database produksi:
   - Ganti JSON file store ke PostgreSQL/MySQL.
5. Payment gateway:
   - Ganti topup demo ke Midtrans/Xendit/Tripay/dll.
6. Security:
   - HTTPS, CSRF, rate limit, audit log, abuse detection, captcha opsional, dan password admin kuat.
