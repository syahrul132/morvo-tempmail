const { SMTPServer } = require('smtp-server');
const { simpleParser } = require('mailparser');
const { findMailboxByAddress, isMailboxExpired } = require('./services');

function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

function normalizeAddress(value) {
  return String(value || '').trim().replace(/^<|>$/g, '').toLowerCase();
}

function parsedAddresses(field) {
  if (!field) return [];
  const list = Array.isArray(field.value) ? field.value : [];
  return list.map((item) => item.address).filter(Boolean);
}

function storeParsedMessage(store, recipient, parsed, rawSource, session) {
  return store.mutate((data) => {
    const mailbox = findMailboxByAddress(data, recipient);
    if (!mailbox) {
      const err = new Error('Recipient mailbox not found');
      err.status = 404;
      throw err;
    }

    const textBody = parsed.text || '';
    const htmlBody = parsed.html || '';
    const body = textBody || (htmlBody ? String(htmlBody).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '');
    const msg = {
      id: `msg_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      mailboxId: mailbox.id,
      to: mailbox.address,
      from: parsed.from?.text || session.envelope.mailFrom?.address || '',
      subject: parsed.subject || '(Tanpa subject)',
      body,
      text: textBody,
      html: htmlBody,
      headers: parsed.headerLines || [],
      messageId: parsed.messageId || '',
      date: parsed.date ? parsed.date.toISOString() : new Date().toISOString(),
      attachments: (parsed.attachments || []).map((att) => ({
        filename: att.filename || '',
        contentType: att.contentType || '',
        size: att.size || att.content?.length || 0,
        contentId: att.contentId || ''
      })),
      rawSize: rawSource.length,
      recipients: {
        to: parsedAddresses(parsed.to),
        cc: parsedAddresses(parsed.cc),
        bcc: parsedAddresses(parsed.bcc)
      },
      read: false,
      createdAt: new Date().toISOString()
    };
    data.messages.unshift(msg);
    return msg;
  });
}

function startSmtpServer({ store, port = 25, host = '0.0.0.0' }) {
  const server = new SMTPServer({
    name: 'mail.adzstore.my.id',
    authOptional: true,
    disabledCommands: ['AUTH'],
    size: 25 * 1024 * 1024,
    onRcptTo(address, session, callback) {
      const rcpt = normalizeAddress(address.address);
      const data = store.read();
      const mailbox = findMailboxByAddress(data, rcpt);
      if (!mailbox) {
        const err = new Error('550 mailbox not found');
        err.responseCode = 550;
        return callback(err);
      }
      if (isMailboxExpired(mailbox)) {
        const err = new Error('550 mailbox expired');
        err.responseCode = 550;
        return callback(err);
      }
      return callback();
    },
    async onData(stream, session, callback) {
      try {
        const raw = await streamToBuffer(stream);
        const parsed = await simpleParser(raw);
        const recipients = [...new Set((session.envelope.rcptTo || []).map((addr) => normalizeAddress(addr.address)).filter(Boolean))];
        const saved = recipients.map((recipient) => storeParsedMessage(store, recipient, parsed, raw, session));
        console.log(`SMTP inbound saved: ${saved.length} recipient(s), subject=${JSON.stringify(parsed.subject || '')}`);
        callback(null, `Message accepted for ${saved.length} recipient(s)`);
      } catch (err) {
        console.error('SMTP inbound error:', err);
        err.responseCode = err.status === 404 ? 550 : 451;
        callback(err);
      }
    },
    onError(err) {
      console.error('SMTP server error:', err);
    }
  });

  server.listen(port, host, () => {
    console.log(`SMTP inbound server listening on ${host}:${port} for adzstore.my.id`);
  });

  return server;
}

module.exports = { startSmtpServer };
