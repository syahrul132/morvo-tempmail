let settings = null;
let account = null;
let user = null;
let mailbox = null;
let timerHandle;
let landingTimerHandle;
let selectedMailId = null;
const $ = (id) => document.getElementById(id);

function getToken() { return localStorage.getItem('jwt'); }
function setToken(t) { if (t) localStorage.setItem('jwt', t); else localStorage.removeItem('jwt'); }

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(path, { headers, ...options });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.error || 'Request failed');
  return data;
}
function rupiah(n) { return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n || 0); }
function toast(msg) { const el = $('toast'); if (!el) return; el.textContent = msg; el.classList.add('show'); clearTimeout(window.toastTimer); window.toastTimer = setTimeout(() => el.classList.remove('show'), 2600); }
function esc(s) { return String(s ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function safeBody(m) { return String(m?.body || m?.text || '').trim(); }
function mailType(m) { const s = `${m.subject || ''} ${safeBody(m)}`.toLowerCase(); if (/otp|kode|code|verify|verifikasi|verification|login|reset|password|token/.test(s)) return 'code'; if (/promo|sale|discount|diskon|offer|newsletter/.test(s)) return 'promo'; return m.read ? 'read' : 'unread'; }
function timeAgo(value) { const d = Date.now() - new Date(value || Date.now()).getTime(); const m = Math.max(0, Math.floor(d/60000)); if (m < 1) return 'baru'; if (m < 60) return `${m} menit lalu`; const h = Math.floor(m/60); if (h < 24) return `${h} jam lalu`; return `${Math.floor(h/24)} hari lalu`; }

function setRoute(path, mode) {
  const url = new URL(location.href);
  url.pathname = path;
  if (mode) url.searchParams.set('mode', mode); else url.searchParams.delete('mode');
  history.pushState({}, '', url);
  renderRoute();
}
function hidePages() { ['landingPage','authPage','dashboardPage'].forEach(id => $(id)?.classList.add('hide')); }
function authModeFromUrl() { return new URL(location.href).searchParams.get('mode') === 'register' ? 'register' : 'login'; }
function showLanding() { hidePages(); $('landingPage')?.classList.remove('hide'); $('navDock')?.classList.add('hide'); startLandingTimer(); }
function showAuth(mode = authModeFromUrl()) {
  hidePages(); $('authPage')?.classList.remove('hide'); $('navDock')?.classList.add('hide');
  const isRegister = mode === 'register';
  const fc = $('fezContainer');
  if (fc) { isRegister ? fc.classList.add('active') : fc.classList.remove('active'); }
  /* Fallback jika FEZ belum dimuat atau terjadi masalah */
  $('loginForm')?.classList.toggle('hide', isRegister);
  $('registerForm')?.classList.toggle('hide', !isRegister);
  const title = $('authTitle'); if (title) title.textContent = isRegister ? 'Buat Akun Gratis' : 'Masuk ke Akun';
  const sub = $('authSubtitle'); if (sub) sub.textContent = isRegister ? 'Daftar untuk generate dan mengelola email temporary kamu' : 'Masuk untuk mengelola email temporary kamu';
  const st = $('switchAuthText'); if (st) st.innerHTML = isRegister ? 'Sudah punya akun? <a href="/dashboard" data-auth-mode="login">Masuk di sini</a>' : 'Belum punya akun? <a href="/dashboard" data-auth-mode="register">Daftar di sini</a>';
}
function showDashboard() { hidePages(); $('dashboardPage')?.classList.remove('hide'); $('navDock')?.classList.remove('hide'); }
async function renderRoute() {
  if (location.pathname === '/dashboard') {
    if (user && account) { showDashboard(); renderAll(); showAppTab('inbox'); }
    else showAuth(authModeFromUrl());
    return;
  }
  showLanding();
}

async function loadSettings() {
  settings = await api('/api/settings');
  $('previewAddress').textContent = `user_abc123@${settings.domain}`;
  $('landingPrice').textContent = rupiah(settings.unlimitedPrice);
  $('priceText').textContent = rupiah(settings.unlimitedPrice);
}
function startLandingTimer() {
  clearInterval(landingTimerHandle);
  let seconds = 23 * 3600 + 42 * 60 + 15;
  const tick = () => {
    if (!$('landingTimer')) return;
    seconds = Math.max(0, seconds - 1);
    const h = String(Math.floor(seconds / 3600)).padStart(2,'0');
    const m = String(Math.floor(seconds % 3600 / 60)).padStart(2,'0');
    const s = String(seconds % 60).padStart(2,'0');
    $('landingTimer').textContent = `${h}:${m}:${s}`;
  };
  tick(); landingTimerHandle = setInterval(tick, 1000);
}
async function checkSession() {
  try { const data = await api('/api/auth/me'); user = data.user; await loadAccount(false); }
  catch { user = account = mailbox = null; setToken(null); await renderRoute(); }
}
async function registerUser() {
  try {
    const data = await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ name: $('registerName').value, email: $('registerEmail').value, password: $('registerPassword').value }) });
    user = data.user;
    if (data.token) setToken(data.token);
    await loadAccount(true);
    if (!mailbox) await createMailbox(false);
    toast('Akun berhasil dibuat');
  } catch (e) { toast(e.message); }
}
async function loginUser() {
  try {
    const data = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: $('loginEmail').value, password: $('loginPassword').value }) });
    user = data.user;
    if (data.token) setToken(data.token);
    await loadAccount(true);
    toast('Login berhasil');
  } catch (e) { toast(e.message); }
}
async function logoutUser() {
  await api('/api/auth/logout', { method: 'POST', body: '{}' }).catch(() => {});
  user = account = mailbox = null; selectedMailId = null;
  localStorage.removeItem('activeMailboxId');
  setToken(null);
  setRoute('/', null);
}
async function loadAccount(goDashboard = true) {
  account = await api('/api/account');
  user = account.user;
  const savedId = localStorage.getItem('activeMailboxId');
  mailbox = account.mailboxes.find(m => m.id === savedId) || account.mailboxes[0] || null;
  renderAll();
  if (mailbox) { await refreshMessages(); await refreshSent(); }
  if (goDashboard) setRoute('/dashboard', null); else await renderRoute();
}
function renderAll() { renderMailbox(); renderDashboard(); renderPayments(); }
async function createMailbox(showMessage = true) {
  try {
    mailbox = await api('/api/mailboxes', { method: 'POST', body: '{}' });
    localStorage.setItem('activeMailboxId', mailbox.id); selectedMailId = null;
    account = await api('/api/account'); user = account.user;
    renderAll(); await refreshMessages(); await refreshSent(); showAppTab('inbox');
    if (showMessage) toast('Email baru berhasil dibuat');
  } catch (e) { toast(e.message); }
}
function selectMailbox(id) { mailbox = account.mailboxes.find(m => m.id === id); if (!mailbox) return; localStorage.setItem('activeMailboxId', mailbox.id); selectedMailId = null; renderAll(); refreshMessages(); refreshSent(); showAppTab('inbox'); }
function renderMailbox() {
  const address = mailbox?.address || 'Belum ada email';
  if ($('address')) $('address').textContent = address;
  if ($('fromField')) $('fromField').value = mailbox?.address || '';
  if ($('paymentBalance')) $('paymentBalance').textContent = rupiah(user?.balance || 0);
  if ($('navUserName')) $('navUserName').textContent = user?.name || 'Akun';
  if ($('navUserEmail')) $('navUserEmail').textContent = user?.email || '-';
  if ($('planBadge')) {
    const plan = user?.plan || 'Free';
    $('planBadge').textContent = plan === 'unlimited' ? 'Pro Plan' : 'Free Plan';
    $('planBadge').classList.toggle('pro', plan === 'unlimited');
  }
  if ($('navUser')) $('navUser').textContent = rupiah(user?.balance || 0);
  if ($('userAvatar')) $('userAvatar').textContent = user?.name ? user.name.charAt(0).toUpperCase() : '?';
  startTimer();
}
function startTimer() { clearInterval(timerHandle); timerHandle = setInterval(() => {}, 1000); }
function renderDashboard() {
  const mailboxMarkup = account?.mailboxes.length ? account.mailboxes.map(m => `<button type="button" class="kanban-card ${mailbox?.id === m.id ? 'selected' : ''}" onclick="selectMailbox('${m.id}')"><div class="card-top"><div class="card-title">${esc(m.address)}</div><span class="badge ${m.plan === 'unlimited' ? 'read' : 'unread'}">${esc(m.plan)}</span></div><div class="card-preview">Klik untuk membuka inbox mailbox ini.</div><div class="card-meta"><span>${m.expiresAt ? new Date(m.expiresAt).toLocaleString('id-ID') : 'unlimited'}</span><span>↗</span></div></button>`).join('') : '<div class="empty-state">Belum ada mailbox. Klik Email Baru.</div>';
  if ($('mailboxList')) $('mailboxList').innerHTML = mailboxMarkup;
  if ($('mailboxListLegacy')) $('mailboxListLegacy').innerHTML = mailboxMarkup;
  if ($('dashboardStats')) $('dashboardStats').innerHTML = `<div class="statbox"><span>Mailbox</span><b>${account?.mailboxes.length || 0}</b></div><div class="statbox"><span>Balance</span><b>${rupiah(user?.balance || 0)}</b></div><div class="statbox"><span>Domain</span><b>${esc(settings?.domain || '')}</b></div>`;
}
function renderMailCard(m) {
  const body = safeBody(m); const type = mailType(m); const preview = body.slice(0, 92) + (body.length > 92 ? '...' : ''); const from = m.from || '(unknown sender)';
  return `<button type="button" class="kanban-card ${m.read ? '' : 'unread'} ${selectedMailId === m.id ? 'selected' : ''}" data-message-id="${esc(m.id)}"><div class="card-top"><div class="card-title">${esc(m.subject || '(Tanpa subject)')}</div><span class="badge ${type}">${type === 'code' ? 'Code' : type === 'promo' ? 'Promo' : m.read ? 'Read' : 'Unread'}</span></div><div class="card-preview">${esc(preview || 'HTML email / tanpa text preview')}</div><div class="card-meta"><span><i class="avatar-dot"></i>${esc(String(from).split('@').pop() || from)}</span><span>${timeAgo(m.createdAt)}</span></div></button>`;
}
async function refreshMessages() {
  if (!$('mailList')) return;
  if (!mailbox) { $('mailList').innerHTML = '<div class="empty-state">Buat mailbox dulu.</div>'; $('codeList').innerHTML = $('savedList').innerHTML = ''; return; }
  const data = await api(`/api/mailboxes/${mailbox.id}/messages`);
  const all = data.messages;
  const codes = all.filter(m => mailType(m) === 'code');
  const saved = all.filter(m => m.read && mailType(m) !== 'code');
  const inbox = all.filter(m => !codes.includes(m) && !saved.includes(m));
  $('inboxCount').textContent = inbox.length; $('codeCount').textContent = codes.length; $('savedCount').textContent = saved.length;
  $('mailList').innerHTML = inbox.length ? inbox.map(renderMailCard).join('') : '<div class="empty-state">Inbox kosong. Email baru akan masuk di sini.</div>';
  $('codeList').innerHTML = codes.length ? codes.map(renderMailCard).join('') : '<div class="empty-state">Kode OTP/verifikasi otomatis dipisahkan di sini.</div>';
  $('savedList').innerHTML = saved.length ? saved.map(renderMailCard).join('') : '<div class="empty-state">Email yang sudah dibaca muncul di sini.</div>';
}
function renderReader(m) {
  const body = safeBody(m); const type = mailType(m);
  $('reader').innerHTML = `<div class="reader-head"><div><span class="mini-eyebrow">Email detail</span><h3>${esc(m.subject || '(Tanpa subject)')}</h3></div><span class="badge ${type}">${type === 'code' ? 'Code' : 'Read'}</span></div><div class="mail-meta"><b>From</b><span>${esc(m.from || '-')}</span><b>To</b><span>${esc(m.to || mailbox?.address || '-')}</span><b>Received</b><span>${new Date(m.createdAt || m.date || Date.now()).toLocaleString('id-ID')}</span></div><div class="mail-body">${body ? esc(body).replace(/\n/g,'<br>') : '<span class="muted">Tidak ada text body. Cek HTML body di bawah.</span>'}</div>${m.html ? `<details class="html-preview" open><summary>HTML body</summary><iframe sandbox srcdoc="${esc(m.html)}"></iframe></details>` : ''}`;
}
async function openMail(id) { if (!mailbox || !id) return; try { selectedMailId = id; const m = await api(`/api/mailboxes/${mailbox.id}/messages/${encodeURIComponent(id)}/read`, { method: 'POST', body: '{}' }); renderReader(m); await refreshMessages(); $('reader').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (e) { toast(e.message); } }
async function sendEmail() { if (!mailbox) return toast('Buat email dulu'); try { await api(`/api/mailboxes/${mailbox.id}/send`, { method: 'POST', body: JSON.stringify({ to: $('toField').value, subject: $('subjectField').value, body: $('bodyField').value }) }); $('toField').value = $('subjectField').value = $('bodyField').value = ''; await refreshSent(); toast('Email diproses'); } catch (e) { toast(e.message); } }
async function refreshSent() { if (!mailbox || !$('sentList')) return; const data = await api(`/api/mailboxes/${mailbox.id}/sent`); $('sentList').innerHTML = data.sent.length ? data.sent.map(m => `<div class="kanban-card"><div class="card-top"><div class="card-title">${esc(m.subject)}</div><span class="badge read">${esc(m.status)}</span></div><div class="card-preview">${esc(m.body).slice(0,120)}</div><div class="card-meta"><span>to: ${esc(m.to)}</span><span>${timeAgo(m.createdAt)}</span></div></div>`).join('') : '<div class="empty-state">Belum ada email terkirim.</div>'; }
async function createPayment() { try { await api('/api/payments', { method: 'POST', body: JSON.stringify({ amount: $('paymentAmount').value, method: $('paymentMethod').value, note: $('paymentNote').value }) }); $('paymentNote').value = ''; await loadAccount(false); toast('Request payment dikirim ke admin'); } catch (e) { toast(e.message); } }
function renderPayments() { if (!$('paymentList')) return; $('paymentList').innerHTML = account?.payments?.length ? account.payments.map(p => `<div class="kanban-card"><div class="card-top"><div class="card-title">${rupiah(p.amount)}</div><span class="badge ${p.status === 'approved' ? 'read' : 'promo'}">${esc(p.status)}</span></div><div class="card-preview">${esc(p.method)}${p.note ? ' · '+esc(p.note) : ''}</div><div class="card-meta"><span>payment</span><span>${timeAgo(p.createdAt)}</span></div></div>`).join('') : '<div class="empty-state">Belum ada request payment.</div>'; }
async function upgradeMailbox() { if (!mailbox) return toast('Buat email dulu'); try { const data = await api(`/api/mailboxes/${mailbox.id}/upgrade`, { method:'POST', body:'{}' }); mailbox = data.mailbox; user = data.user; await loadAccount(false); toast('Mailbox sekarang unlimited'); } catch(e) { toast(e.message + ' — buka menu Payment untuk topup'); } }
function copyAddress() { if (!mailbox) return toast('Belum ada email'); navigator.clipboard?.writeText(mailbox.address); toast('Alamat dicopy'); }
function showAppTab(tab) {
  const map = { inbox: 'inboxView', addresses: 'addressesView', compose: 'composeView', payment: 'paymentView' };
  Object.values(map).forEach(id => $(id)?.classList.add('hide'));
  $(map[tab] || 'inboxView')?.classList.remove('hide');
  document.querySelectorAll('[data-tab]').forEach(el => el.classList.toggle('active', el.dataset.tab === tab));
  if(tab === 'inbox') refreshMessages();
  if(tab === 'compose') refreshSent();
  if(tab === 'payment') renderPayments();
}

window.addEventListener('popstate', renderRoute);
window.addEventListener('DOMContentLoaded', async () => {
  document.body.addEventListener('click', (event) => {
    const home = event.target.closest('[data-link="home"]');
    if (home) { event.preventDefault(); setRoute('/', null); return; }
    const auth = event.target.closest('[data-auth-mode]');
    if (auth) { event.preventDefault(); setRoute('/dashboard', auth.dataset.authMode); return; }
    const tab = event.target.closest('[data-tab]');
    if (tab) { event.preventDefault(); showAppTab(tab.dataset.tab); }
  });
  $('loginForm')?.addEventListener('submit', (e) => { e.preventDefault(); loginUser(); });
  $('registerForm')?.addEventListener('submit', (e) => { e.preventDefault(); registerUser(); });
  $('logoutBtn')?.addEventListener('click', logoutUser);
  $('logoutBtn2')?.addEventListener('click', logoutUser);
  $('newMailboxBtn')?.addEventListener('click', () => createMailbox(true));
  $('newMailboxBtn2')?.addEventListener('click', () => createMailbox(true));
  $('copyBtn')?.addEventListener('click', copyAddress);
  $('refreshBtn')?.addEventListener('click', refreshMessages);
  $('sendBtn')?.addEventListener('click', sendEmail);
  $('paymentBtn')?.addEventListener('click', createPayment);
  $('upgradeBtn')?.addEventListener('click', upgradeMailbox);
  $('googleLoginBtn')?.addEventListener('click', () => toast('Google sign-in belum aktif di versi VPS ini'));
  $('googleRegisterBtn')?.addEventListener('click', () => toast('Google sign-in belum aktif di versi VPS ini'));
  $('fezSignIn')?.addEventListener('click', () => $('fezContainer')?.classList.remove('active'));
  $('fezSignUp')?.addEventListener('click', () => $('fezContainer')?.classList.add('active'));
  ['mailList','codeList','savedList'].forEach(id => $(id)?.addEventListener('click', (event) => { const item = event.target.closest('[data-message-id]'); if (item) openMail(item.dataset.messageId); }));
  window.addEventListener('keydown', (event) => { if (event.target.matches('input,textarea,select')) return; if (event.key.toLowerCase() === 'r') refreshMessages(); if (event.key.toLowerCase() === 'c') copyAddress(); if (event.key.toLowerCase() === 'n') createMailbox(); });
  await loadSettings();
  await checkSession();
});
