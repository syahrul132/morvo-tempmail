# ADZ TempMail Fullstack

Fullstack prototype temporary email dengan domain mailbox `adzstore.my.id`.

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

- Generate temporary email `*@adzstore.my.id`
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
POST /api/mailboxes
GET  /api/mailboxes/:id/messages
POST /api/inbound
POST /api/mailboxes/:id/send
POST /api/mailboxes/:id/topup
POST /api/mailboxes/:id/upgrade
GET  /api/settings
```

Contoh inbound webhook:

```bash
curl -X POST http://127.0.0.1:3000/api/inbound \
  -H 'Content-Type: application/json' \
  -d '{"to":"akses12345@adzstore.my.id","from":"otp@example.com","subject":"OTP","body":"Kode 123456"}'
```

## Catatan produksi

Project ini sudah fullstack, tapi receive/send email real masih perlu integrasi infra:

1. DNS domain `adzstore.my.id`:
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
