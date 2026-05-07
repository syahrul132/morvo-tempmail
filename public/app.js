let settings = null;
let mailbox = JSON.parse(localStorage.getItem('adzMailbox') || 'null');
let timerHandle;
const $ = (id) => document.getElementById(id);

async function api(path, options = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.error || 'Request failed');
  return data;
}
function rupiah(n) { return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n || 0); }
function toast(msg) { const el = $('toast'); el.textContent = msg; el.classList.add('show'); clearTimeout(window.t); window.t = setTimeout(() => el.classList.remove('show'), 2300); }
function esc(s) { return String(s ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function renderAd(slot, ad) { const el = $(slot === 'header' ? 'adHeader' : 'adSidebar'); if (!el || !ad) return; el.classList.remove('hide'); el.innerHTML = `<div><b>${esc(ad.title)}</b><br><span>${esc(ad.body)}</span></div><a target="_blank" href="${esc(ad.url)}">Buka</a>`; }

async function loadSettings() {
  settings = await api('/api/settings');
  $('brandName').textContent = settings.siteName;
  $('heroTitle').textContent = settings.heroTitle;
  $('heroSubtitle').textContent = settings.heroSubtitle;
  $('priceText').textContent = rupiah(settings.unlimitedPrice);
  renderAd('header', settings.ads.header);
  renderAd('sidebar', settings.ads.sidebar);
}
async function createMailbox() {
  mailbox = await api('/api/mailboxes', { method: 'POST', body: '{}' });
  localStorage.setItem('adzMailbox', JSON.stringify(mailbox));
  renderMailbox();
  await refreshMessages();
  toast('Email baru dibuat');
}
async function reloadMailbox() { if (!mailbox) return; mailbox = await api(`/api/mailboxes/${mailbox.id}`); localStorage.setItem('adzMailbox', JSON.stringify(mailbox)); renderMailbox(); }
function renderMailbox() {
  if (!mailbox) return;
  $('address').textContent = mailbox.address;
  $('fromField').value = mailbox.address;
  $('planBadge').textContent = mailbox.plan.toUpperCase();
  $('balance').textContent = rupiah(mailbox.balance);
  startTimer();
}
function startTimer() {
  clearInterval(timerHandle);
  function tick() {
    if (!mailbox) return $('timer').textContent = '--:--:--';
    if (mailbox.plan === 'unlimited' || !mailbox.expiresAt) return $('timer').textContent = 'UNLIMITED';
    const diff = Math.max(0, new Date(mailbox.expiresAt).getTime() - Date.now());
    const h = String(Math.floor(diff / 3600000)).padStart(2,'0');
    const m = String(Math.floor(diff % 3600000 / 60000)).padStart(2,'0');
    const s = String(Math.floor(diff % 60000 / 1000)).padStart(2,'0');
    $('timer').textContent = diff ? `${h}:${m}:${s}` : 'EXPIRED';
  }
  tick(); timerHandle = setInterval(tick, 1000);
}
async function refreshMessages() {
  if (!mailbox) return;
  const data = await api(`/api/mailboxes/${mailbox.id}/messages`);
  $('mailList').innerHTML = data.messages.length ? data.messages.map(m => `<button class="mail-item ${m.read ? '' : 'unread'}" onclick="openMail('${m.id}')"><div class="mail-from">${esc(m.from)}</div><div class="mail-subject">${esc(m.subject)}</div><div class="mail-preview">${esc(m.body).slice(0,120)}...</div><div class="mail-time">${new Date(m.createdAt).toLocaleString('id-ID')}</div></button>`).join('') : '<div class="panel muted">Inbox masih kosong.</div>';
}
async function openMail(id) {
  const data = await api(`/api/mailboxes/${mailbox.id}/messages`);
  const m = data.messages.find(x => x.id === id); if (!m) return;
  await api(`/api/mailboxes/${mailbox.id}/messages/${id}/read`, { method: 'POST', body: '{}' });
  $('reader').innerHTML = `<h3>${esc(m.subject)}</h3><div class="mail-from">from: ${esc(m.from)} · to: ${esc(m.to)}</div><p>${esc(m.body)}</p>`;
  refreshMessages();
}
async function sendEmail() {
  if (!mailbox) return toast('Buat email dulu');
  await api(`/api/mailboxes/${mailbox.id}/send`, { method: 'POST', body: JSON.stringify({ to: $('toField').value, subject: $('subjectField').value, body: $('bodyField').value }) });
  $('toField').value = $('subjectField').value = $('bodyField').value = '';
  await refreshSent(); showTab('sent'); toast('Email tercatat terkirim');
}
async function refreshSent() { if (!mailbox) return; const data = await api(`/api/mailboxes/${mailbox.id}/sent`); $('sentList').innerHTML = data.sent.length ? data.sent.map(m => `<div class="mail-item"><div class="mail-from">to: ${esc(m.to)}</div><div class="mail-subject">${esc(m.subject)}</div><div class="mail-preview">${esc(m.body).slice(0,120)}...</div><div class="mail-time">${esc(m.status)}</div></div>`).join('') : '<div class="panel muted">Belum ada email terkirim.</div>'; }
async function simulateInbound() { if (!mailbox) await createMailbox(); await api('/api/inbound', { method:'POST', body: JSON.stringify({ to: mailbox.address, from:'otp@example.com', subject:'Kode verifikasi demo', body:`Kode OTP untuk ${mailbox.address}: ${Math.floor(100000 + Math.random()*899999)}` }) }); await refreshMessages(); toast('Email masuk diterima'); }
async function topupMailbox() { if (!mailbox) return toast('Buat email dulu'); mailbox = await api(`/api/mailboxes/${mailbox.id}/topup`, { method:'POST', body: JSON.stringify({ amount: 50000 }) }); localStorage.setItem('adzMailbox', JSON.stringify(mailbox)); renderMailbox(); toast('Topup demo +Rp 50.000'); }
async function upgradeMailbox() { if (!mailbox) return toast('Buat email dulu'); try { mailbox = await api(`/api/mailboxes/${mailbox.id}/upgrade`, { method:'POST', body:'{}' }); localStorage.setItem('adzMailbox', JSON.stringify(mailbox)); renderMailbox(); toast('Email sekarang unlimited'); } catch(e) { toast(e.message + ' — topup dulu'); } }
function copyAddress() { if (!mailbox) return; navigator.clipboard?.writeText(mailbox.address); toast('Alamat dicopy'); }
function showTab(tab) { ['Inbox','Compose','Sent'].forEach(n => $('tab'+n).classList.remove('active')); ['inboxView','composeView','sentView'].forEach(id => $(id).classList.add('hide')); if(tab==='inbox'){ $('tabInbox').classList.add('active'); $('inboxView').classList.remove('hide'); refreshMessages(); } if(tab==='compose'){ $('tabCompose').classList.add('active'); $('composeView').classList.remove('hide'); } if(tab==='sent'){ $('tabSent').classList.add('active'); $('sentView').classList.remove('hide'); refreshSent(); } }
(async function init(){ await loadSettings(); if (mailbox) { try { await reloadMailbox(); await refreshMessages(); await refreshSent(); } catch { mailbox = null; localStorage.removeItem('adzMailbox'); } } startTimer(); })();
