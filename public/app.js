/**
 * MORVO TempMail Express - Main SPA Application
 * Hash-based routing, auth, inbox management, credits system
 */

(function () {
  'use strict';

  // ─── State ───────────────────────────────────────────────────────────────────
  let currentUser = null;
  let currentMailbox = null;
  let mailboxes = [];
  let credits = 0;
  let currentPlan = 'free';
  let apiKey = '';
  let inboxInterval = null;
  let currentView = 'dashboard';

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  function formatRupiah(number) {
    return 'Rp ' + Number(number).toLocaleString('id-ID');
  }

  function timeAgo(isoString) {
    if (!isoString) return '';
    const seconds = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
    if (seconds < 60) return 'baru saja';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes + ' menit lalu';
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + ' jam lalu';
    const days = Math.floor(hours / 24);
    if (days < 30) return days + ' hari lalu';
    const months = Math.floor(days / 30);
    return months + ' bulan lalu';
  }

  function copyToClipboard(text) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(function () {
        showToast('Tersalin ke clipboard!');
      });
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToast('Tersalin ke clipboard!');
    }
  }

  async function api(method, url, body) {
    const opts = {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
    };
    if (body) opts.body = JSON.stringify(body);
    try {
      const res = await fetch(url, opts);
      const data = await res.json();
      if (!res.ok) {
        const err = new Error(data.error || data.message || 'Terjadi kesalahan');
        err.status = res.status;
        err.data = data;
        throw err;
      }
      return data;
    } catch (e) {
      if (e.status) throw e;
      throw new Error('Gagal terhubung ke server');
    }
  }

  // ─── Toast ───────────────────────────────────────────────────────────────────

  function showToast(message, type) {
    type = type || 'success';
    let container = document.getElementById('toastContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toastContainer';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    toast.textContent = message;
    container.appendChild(toast);
    requestAnimationFrame(function () {
      toast.classList.add('show');
    });
    setTimeout(function () {
      toast.classList.remove('show');
      setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 300);
    }, 3000);
  }

  // ─── Routing ─────────────────────────────────────────────────────────────────

  function showPage(pageId) {
    var pages = ['landingPage', 'authPage', 'dashboardPage'];
    pages.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) {
        if (id === pageId) {
          el.classList.add('page-active');
          el.style.display = '';
        } else {
          el.classList.remove('page-active');
          el.style.display = 'none';
        }
      }
    });
    if (pageId === 'dashboardPage') {
      startInboxRefresh();
    } else {
      stopInboxRefresh();
    }
  }

  function showView(viewId) {
    // Strip 'View' suffix if present (sidebar passes 'dashboardView', we need 'dashboard')
    var cleanId = viewId.replace(/View$/, '');
    currentView = cleanId;
    document.querySelectorAll('.view-section').forEach(function (v) {
      v.classList.toggle('view-active', v.id === cleanId + 'View');
    });
    document.querySelectorAll('.sidebar-link').forEach(function (item) {
      item.classList.toggle('sidebar-link-active', item.dataset.view === viewId || item.dataset.view === cleanId);
    });
    // Load view data
    if (cleanId === 'dashboard') loadDashboardStats();
    else if (cleanId === 'inbox') loadInbox();
    else if (cleanId === 'compose') loadComposeView();
    else if (cleanId === 'apikey') loadApiKeyView();
    else if (cleanId === 'plan') loadPlanView();
  }

  function handleRoute() {
    const hash = window.location.hash || '#/';
    if (hash === '#/login') {
      showPage('authPage');
      showAuthTab('login');
    } else if (hash === '#/register') {
      showPage('authPage');
      showAuthTab('register');
    } else if (hash === '#/dashboard') {
      if (!currentUser) {
        window.location.hash = '#/login';
        return;
      }
      showPage('dashboardPage');
      showView('dashboard');
    } else {
      showPage('landingPage');
    }
  }

  function showAuthTab(tab) {
    var loginForm = document.getElementById('loginForm');
    var registerForm = document.getElementById('registerForm');
    document.querySelectorAll('.auth-tab').forEach(function(t) {
      t.classList.toggle('auth-tab-active', t.dataset.tab === tab);
    });
    if (loginForm) loginForm.classList.toggle('auth-form-hidden', tab !== 'login');
    if (registerForm) registerForm.classList.toggle('auth-form-hidden', tab !== 'register');
  }

  // ─── Auth ────────────────────────────────────────────────────────────────────

  async function checkSession() {
    try {
      const data = await api('GET', '/api/auth/me');
      if (data && data.user) {
        currentUser = data.user;
        window.currentUser = currentUser;
        if (window.location.hash === '#/login' || window.location.hash === '#/register' || window.location.hash === '#/' || !window.location.hash) {
          window.location.hash = '#/dashboard';
        }
      }
    } catch (e) {
      currentUser = null;
      window.currentUser = null;
    }
    handleRoute();
  }

  function initAuth() {
    var loginForm = document.getElementById('loginForm');
    var registerForm = document.getElementById('registerForm');

    if (loginForm) {
      loginForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        var email = document.getElementById('loginEmail').value.trim();
        var password = document.getElementById('loginPassword').value;
        if (!email || !password) return showToast('Email dan password wajib diisi', 'error');
        try {
          var data = await api('POST', '/api/auth/login', { email: email, password: password });
          currentUser = data.user;
          window.currentUser = currentUser;
          showToast('Login berhasil!');
          window.location.hash = '#/dashboard';
        } catch (e) {
          showToast(e.message, 'error');
        }
      });
    }

    if (registerForm) {
      registerForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        var name = document.getElementById('regName').value.trim();
        var email = document.getElementById('regEmail').value.trim();
        var password = document.getElementById('regPassword').value;
        if (!name || !email || !password) return showToast('Semua field wajib diisi', 'error');
        try {
          var data = await api('POST', '/api/auth/register', { name: name, email: email, password: password });
          currentUser = data.user;
          window.currentUser = currentUser;
          showToast('Registrasi berhasil! Anda mendapat 3 kredit gratis.');
          window.location.hash = '#/dashboard';
        } catch (e) {
          showToast(e.message, 'error');
        }
      });
    }
  }

  async function logout() {
    try {
      await api('POST', '/api/auth/logout');
    } catch (e) { /* ignore */ }
    currentUser = null;
    window.currentUser = null;
    window.location.hash = '#/';
  }

  // ─── Sidebar ─────────────────────────────────────────────────────────────────

  function initSidebar() {
    var hamburger = document.getElementById('hamburgerBtn');
    var overlay = document.getElementById('sidebarOverlay');
    var items = document.querySelectorAll('.sidebar-link[data-view]');
    var submenuToggles = document.querySelectorAll('.sidebar-submenu-toggle[data-submenu]');

    var sidebar = document.getElementById('sidebar');
    var sidebarClose = document.getElementById('sidebarClose');

    function openSidebar() {
      if (sidebar) sidebar.classList.add('open');
      if (overlay) overlay.classList.add('active');
    }

    function closeSidebar() {
      if (sidebar) sidebar.classList.remove('open');
      if (overlay) overlay.classList.remove('active');
    }

    if (hamburger) {
      hamburger.addEventListener('click', function () {
        if (sidebar && sidebar.classList.contains('open')) {
          closeSidebar();
        } else {
          openSidebar();
        }
      });
    }

    if (sidebarClose) {
      sidebarClose.addEventListener('click', closeSidebar);
    }

    if (overlay) {
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) closeSidebar();
      });
    }

    items.forEach(function (item) {
      item.addEventListener('click', function (e) {
        e.preventDefault();
        var view = item.dataset.view;
        if (view) showView(view);
        // Update active state
        document.querySelectorAll('.sidebar-link').forEach(function(l) { l.classList.remove('sidebar-link-active'); });
        item.classList.add('sidebar-link-active');
        closeSidebar();
      });
    });

    submenuToggles.forEach(function (toggle) {
      toggle.addEventListener('click', function () {
        var submenu = document.getElementById(toggle.dataset.submenu);
        if (submenu) submenu.classList.toggle('sidebar-submenu-collapsed');
        toggle.classList.toggle('expanded');
      });
    });
  }

  // ─── Credits ─────────────────────────────────────────────────────────────────

  async function loadCredits() {
    try {
      const data = await api('GET', '/api/credits');
      credits = data.credits;
      currentPlan = data.plan || 'free';
      apiKey = data.apiKey || '';
      updateCreditsDisplay();
    } catch (e) {
      // silent
    }
  }

  function updateCreditsDisplay() {
    var creditEl = document.getElementById('creditCount');
    if (creditEl) creditEl.textContent = credits;
    var displays = document.querySelectorAll('.stat-plan-display');
    displays.forEach(function (el) {
      el.textContent = currentPlan === 'unlimited' ? 'Unlimited' : 'Free';
    });
  }

  // ─── Dashboard Stats ────────────────────────────────────────────────────────

  async function loadDashboardStats() {
    await loadCredits();
    var mailboxCount = 0;
    var messageCount = 0;
    try {
      var data = await api('GET', '/api/account');
      mailboxes = data.mailboxes || [];
      mailboxCount = mailboxes.length;
      messageCount = mailboxes.reduce(function (sum, mb) {
        return sum + (mb.messageCount || 0);
      }, 0);
    } catch (e) { /* silent */ }

    setStatValue('statCredits', credits);
    setStatValue('statPlan', currentPlan === 'unlimited' ? 'Unlimited' : 'Free');
    setStatValue('statMailboxes', mailboxCount);
    setStatValue('statMessages', messageCount);

    // Animate credit ring
    var maxCredits = 10;
    var pct = Math.min(credits / maxCredits, 1);
    var circumference = 326.73;
    var ring = document.getElementById('creditRing');
    if (ring) {
      ring.style.strokeDashoffset = circumference; // reset
      requestAnimationFrame(function() {
        requestAnimationFrame(function() {
          ring.style.strokeDashoffset = circumference * (1 - pct);
        });
      });
      // Change color based on level
      if (pct <= 0.2) ring.style.stroke = 'var(--danger)';
      else if (pct <= 0.5) ring.style.stroke = 'var(--warning)';
      else ring.style.stroke = 'var(--accent)';
    }
    var ringVal = document.getElementById('ringCreditVal');
    if (ringVal) {
      ringVal.textContent = credits;
      ringVal.classList.add('pulse');
      setTimeout(function() { ringVal.classList.remove('pulse'); }, 600);
    }
    var ringLabel = document.querySelector('.ring-label');
    if (ringLabel) ringLabel.textContent = currentPlan === 'unlimited' ? '/ ∞' : '/ max';

    // Animate progress bars
    var maxMbox = Math.max(mailboxCount, 5);
    var maxMsg = Math.max(messageCount, 10);
    var initialCredits = 3;
    var creditsUsed = currentPlan === 'unlimited' ? 0 : Math.max(initialCredits - credits, 0);
    var maxUsed = Math.max(creditsUsed, 3);

    setBar('barMailbox', mailboxCount, maxMbox);
    setBar('barMsg', messageCount, maxMsg);
    setBar('barCredit', creditsUsed, maxUsed);
    setBarText('barMailboxCount', mailboxCount);
    setBarText('barMsgCount', messageCount);
    setBarText('barCreditUsed', creditsUsed);

    // Also update landing page pricing if present
    loadLandingPricing();
  }

  function setBar(id, val, max) {
    var el = document.getElementById(id);
    if (!el) return;
    el.style.width = '0';
    requestAnimationFrame(function() {
      requestAnimationFrame(function() {
        el.style.width = (max > 0 ? (val / max) * 100 : 0) + '%';
      });
    });
  }

  function setBarText(id, val) {
    var el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  function setStatValue(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  // ── Email Dropdown (topbar avatar) ───────────────────────────────

  var topbarEmailTimerInterval = null;

  function renderTopbarEmailList() {
    var list = document.getElementById('topbarEmailList');
    if (!list) return;

    // Fetch latest mailboxes
    api('GET', '/api/account').then(function(data) {
      mailboxes = data.mailboxes || [];
      renderEmailListItems(list);
      startEmailCountdown();
    }).catch(function() {
      list.innerHTML = '<div class="topbar-email-empty">Gagal memuat email</div>';
    });
  }

  function renderEmailListItems(list) {
    if (!mailboxes.length) {
      list.innerHTML = '<div class="topbar-email-empty">Belum ada email. Buat di Inbox!</div>';
      return;
    }

    var html = '';
    mailboxes.forEach(function(mb) {
      var isExpired = mb.expiresAt && new Date(mb.expiresAt).getTime() < Date.now();
      var isActive = currentMailbox && currentMailbox.id === mb.id;
      var planLabel = mb.plan === 'unlimited' ? 'PRO' : 'FREE';
      var planClass = mb.plan === 'unlimited' ? 'plan-unlimited' : 'plan-free';
      var timerClass = 'timer-ok';
      var timerIcon = 'fa-clock';
      var timeStr = '';

      if (isExpired) {
        timerClass = 'timer-expired';
        timerIcon = 'fa-times-circle';
        timeStr = 'Expired';
      } else if (mb.expiresAt) {
        var remaining = new Date(mb.expiresAt).getTime() - Date.now();
        var totalHours = Math.floor(remaining / 3600000);
        var days = Math.floor(totalHours / 24);
        var hours = totalHours % 24;
        var mins = Math.floor((remaining % 3600000) / 60000);
        var secs = Math.floor((remaining % 60000) / 1000);

        if (days > 0) {
          timeStr = days + 'd ' + hours + 'j ' + mins + 'm';
        } else if (hours > 0) {
          timeStr = hours + 'j ' + mins + 'm ' + secs + 'd';
        } else {
          timeStr = mins + 'm ' + secs + 'd';
          timerClass = 'timer-warn';
        }

        // If less than 2 hours, switch to warning
        if (remaining < 2 * 3600000) timerClass = 'timer-warn';
      }

      html += '<div class="topbar-email-item' + (isActive ? ' active' : '') + (isExpired ? ' expired' : '') + '" data-mb-id="' + mb.id + '">' +
        '<div class="topbar-email-addr">' + escapeHtml(mb.address) + '</div>' +
        '<div class="topbar-email-meta">' +
          '<span class="topbar-email-plan ' + planClass + '">' + planLabel + '</span>' +
          '<span class="topbar-email-timer ' + timerClass + '" data-expires="' + (mb.expiresAt || '') + '">' +
            '<i class="fas ' + timerIcon + '"></i> ' + timeStr +
          '</span>' +
        '</div>' +
      '</div>';
    });

    list.innerHTML = html;

    // Wire click events
    list.querySelectorAll('.topbar-email-item').forEach(function(item) {
      item.addEventListener('click', function() {
        var mbId = item.dataset.mbId;
        var mb = mailboxes.find(function(m) { return m.id === mbId; });
        if (mb) {
          var isExpired = mb.expiresAt && new Date(mb.expiresAt).getTime() < Date.now();
          if (isExpired) {
            showToast('Email sudah expired!', 'error');
            return;
          }
          currentMailbox = mb;
          showView('inbox');
          selectMailbox(mb.id);
          updateMailboxSelectorValue(mb.id);
          // Close dropdown
          var dropdown = document.getElementById('topbarEmailDropdown');
          if (dropdown) dropdown.classList.remove('open');
        }
      });
    });
  }

  function startEmailCountdown() {
    if (topbarEmailTimerInterval) clearInterval(topbarEmailTimerInterval);
    topbarEmailTimerInterval = setInterval(function() {
      var list = document.getElementById('topbarEmailList');
      if (!list) { clearInterval(topbarEmailTimerInterval); return; }
      var timers = list.querySelectorAll('.topbar-email-timer');
      timers.forEach(function(timer) {
        var expires = timer.dataset.expires;
        if (!expires) return;
        var remaining = new Date(expires).getTime() - Date.now();
        var icon = timer.querySelector('i');
        if (remaining <= 0) {
          timer.className = 'topbar-email-timer timer-expired';
          if (icon) icon.className = 'fas fa-times-circle';
          timer.childNodes[timer.childNodes.length - 1].textContent = ' Expired';
          var item = timer.closest('.topbar-email-item');
          if (item) { item.classList.add('expired'); }
          return;
        }
        var totalHours = Math.floor(remaining / 3600000);
        var days = Math.floor(totalHours / 24);
        var hours = totalHours % 24;
        var mins = Math.floor((remaining % 3600000) / 60000);
        var secs = Math.floor((remaining % 60000) / 1000);
        var timeStr = '';
        var timerClass = 'timer-ok';

        if (days > 0) {
          timeStr = days + 'd ' + hours + 'j ' + mins + 'm';
        } else if (hours > 0) {
          timeStr = hours + 'j ' + mins + 'm ' + secs + 'd';
        } else {
          timeStr = mins + 'm ' + secs + 'd';
        }

        if (remaining < 2 * 3600000) timerClass = 'timer-warn';
        timer.className = 'topbar-email-timer ' + timerClass;
        timer.childNodes[timer.childNodes.length - 1].textContent = ' ' + timeStr;
      });
    }, 1000);
  }

  // ─── Plan / Credits Purchase ─────────────────────────────────────────────────

  function loadPlanView() {
    loadCredits().then(function () {
      document.querySelectorAll('.plan-card').forEach(function (card) {
        card.classList.remove('plan-active');
      });
      const freeCard = document.getElementById('planFree');
      const unlimCard = document.getElementById('planUnlimited');
      if (currentPlan === 'unlimited') {
        if (unlimCard) unlimCard.classList.add('plan-active');
      } else {
        if (freeCard) freeCard.classList.add('plan-active');
      }
      updateCreditsDisplay();
    });
    loadPayments();
  }

  async function loadPayments() {
    try {
      const data = await api('GET', '/api/account');
      const payments = data.payments || [];
      const el = document.getElementById('paymentHistory');
      if (!el) return;
      if (payments.length === 0) {
        el.innerHTML = '<p style="color:var(--text-muted);text-align:center">Belum ada riwayat pembayaran</p>';
        return;
      }
      const typeLabels = { credits: 'Beli Kredit', upgrade: 'Upgrade Unlimited' };
      const statusColors = { pending: '#f59e0b', approved: '#10b981', rejected: '#ef4444' };
      const statusLabels = { pending: 'Menunggu', approved: 'Disetujui', rejected: 'Ditolak' };
      el.innerHTML = payments.map(function(p) {
        const date = new Date(p.createdAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        const color = statusColors[p.status] || '#888';
        const statusLabel = statusLabels[p.status] || p.status;
        const typeLabel = typeLabels[p.type] || 'Pembayaran';
        return '<div style="display:flex;justify-content:space-between;align-items:center;padding:0.75rem 0;border-bottom:1px solid rgba(255,255,255,0.05)">' +
          '<div>' +
            '<div style="font-weight:600;color:var(--text-primary)">' + typeLabel + '</div>' +
            '<div style="font-size:0.8rem;color:var(--text-muted)">' + date + (p.note ? ' &middot; ' + p.note : '') + '</div>' +
          '</div>' +
          '<div style="text-align:right">' +
            '<div style="font-weight:600;color:var(--accent)">Rp ' + Number(p.amount).toLocaleString('id-ID') + '</div>' +
            '<div style="font-size:0.75rem;color:' + color + ';font-weight:600">' + statusLabel + '</div>' +
          '</div>' +
        '</div>';
      }).join('');
    } catch (e) { /* silent */ }
  }

  async function buyCredits() {
    const input = document.getElementById('creditAmount');
    const amount = parseInt(input ? input.value : 0, 10);
    if (!amount || amount < 1) return showToast('Jumlah kredit minimal 1', 'error');
    try {
      const data = await api('POST', '/api/credits/buy', { amount: amount });
      showToast('Pembayaran dibuat! Menunggu persetujuan admin.', 'success');
      loadPayments();
      loadCredits();
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  async function upgradeUnlimited() {
    try {
      const data = await api('POST', '/api/plan/upgrade', { plan: 'unlimited' });
      showToast('Pembayaran dibuat! Menunggu persetujuan admin.', 'success');
      loadPayments();
      loadCredits();
      closeUpgradeModal();
    } catch (e) {
      showToast(e.message, 'error');
    }
  }



  // ─── Credits Slide Panel ──────────────────────────────────────────────────
  (function() {
    var CREDIT_PRICE = 1000; // will be updated from settings
    var panel = document.getElementById('creditsPanel');
    var overlay = document.getElementById('creditsPanelOverlay');
    var closeBtn = document.getElementById('creditsPanelClose');
    var slider = document.getElementById('creditsSlider');
    var input = document.getElementById('creditsInput');
    var minusBtn = document.getElementById('creditsMinus');
    var plusBtn = document.getElementById('creditsPlus');
    var priceEach = document.getElementById('creditsPriceEach');
    var totalPrice = document.getElementById('creditsTotalPrice');
    var buyBtn = document.getElementById('creditsPanelBuy');
    var balanceEl = document.getElementById('creditsPanelBalance');
    var presets = document.querySelectorAll('.credits-preset');

    function updateSummary() {
      var val = parseInt(input.value, 10) || 1;
      val = Math.max(1, Math.min(100, val));
      slider.value = val;
      input.value = val;
      priceEach.textContent = formatRupiah(CREDIT_PRICE);
      totalPrice.textContent = formatRupiah(val * CREDIT_PRICE);
      presets.forEach(function(btn) {
        btn.classList.toggle('active', parseInt(btn.dataset.amount, 10) === val);
      });
    }

    function setAmount(val) {
      val = Math.max(1, Math.min(100, parseInt(val, 10) || 1));
      input.value = val;
      slider.value = val;
      updateSummary();
    }

    function openPanel() {
      loadCredits().then(function() {
        if (balanceEl) balanceEl.textContent = credits;
        // Fetch latest credit price
        api('GET', '/api/settings').then(function(s) {
          if (s && s.creditPrice) CREDIT_PRICE = s.creditPrice;
          updateSummary();
        }).catch(function() { updateSummary(); });
      });
      panel.classList.add('open');
      overlay.classList.add('open');
      document.body.style.overflow = 'hidden';
    }

    function closePanel() {
      panel.classList.remove('open');
      overlay.classList.remove('open');
      document.body.style.overflow = '';
    }

    // Sync slider <-> input
    slider.addEventListener('input', function() { setAmount(slider.value); });
    input.addEventListener('input', function() { setAmount(input.value); });
    minusBtn.addEventListener('click', function() { setAmount(parseInt(input.value, 10) - 1); });
    plusBtn.addEventListener('click', function() { setAmount(parseInt(input.value, 10) + 1); });

    // Preset buttons
    presets.forEach(function(btn) {
      btn.addEventListener('click', function() { setAmount(btn.dataset.amount); });
    });

    // Buy button
    buyBtn.addEventListener('click', async function() {
      var amount = parseInt(input.value, 10);
      if (!amount || amount < 1) return showToast('Jumlah kredit minimal 1', 'error');
      buyBtn.disabled = true;
      buyBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Memproses...';
      try {
        var data = await api('POST', '/api/credits/buy', { amount: amount });
        showToast('Pembayaran dibuat! Menunggu persetujuan admin.', 'success');
        closePanel();
        loadCredits();
      } catch (e) {
        showToast(e.message, 'error');
      } finally {
        buyBtn.disabled = false;
        buyBtn.innerHTML = '<i class="fas fa-bolt"></i> Beli Sekarang';
      }
    });

    // Close panel
    closeBtn.addEventListener('click', closePanel);
    overlay.addEventListener('click', closePanel);
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && panel.classList.contains('open')) closePanel();
    });

    // Open panel from topbar credits badge
    var topbarCredits = document.getElementById('topbarCredits');
    if (topbarCredits) {
      topbarCredits.style.cursor = 'pointer';
      topbarCredits.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        openPanel();
      });
    }

    // Initialize
    updateSummary();
  })();


  // ─── Inbox ───────────────────────────────────────────────────────────────────

  async function loadInbox() {
    try {
      const data = await api('GET', '/api/account');
      mailboxes = data.mailboxes || [];
      renderMailboxSelector();
      if (mailboxes.length === 0) {
        showNoMailboxPrompt();
        return;
      }
      if (!currentMailbox || !mailboxes.find(function (m) { return m.id === currentMailbox.id; })) {
        currentMailbox = mailboxes[0];
      }
      selectMailbox(currentMailbox.id);
    } catch (e) {
      showToast('Gagal memuat inbox', 'error');
    }
  }

  function renderMailboxSelector() {
    var selector = document.getElementById('mailboxSelect');
    if (!selector) return;
    // Remove old listeners by cloning
    var newSelector = selector.cloneNode(false);
    selector.parentNode.replaceChild(newSelector, selector);
    mailboxes.forEach(function (mb) {
      var opt = document.createElement('option');
      opt.value = mb.id;
      opt.textContent = mb.address || mb.email;
      if (currentMailbox && currentMailbox.id === mb.id) opt.selected = true;
      newSelector.appendChild(opt);
    });
    newSelector.addEventListener('change', function () {
      var mb = mailboxes.find(function (m) { return m.id === newSelector.value; });
      if (mb) selectMailbox(mb.id);
    });
  }

  function updateMailboxSelectorValue(id) {
    var selector = document.getElementById('mailboxSelect');
    if (selector) selector.value = id;
  }

  function showNoMailboxPrompt() {
    var list = document.getElementById('mailList');
    if (list) {
      list.innerHTML = '<div class="inbox-empty"><i class="fas fa-envelope"></i><p>Anda belum memiliki mailbox.</p>' +
        '<button class="btn btn-primary" data-action="openNewMailbox">Buat Mailbox Baru</button></div>';
    }
  }

  async function selectMailbox(mailboxId) {
    const mb = mailboxes.find(function (m) { return m.id === mailboxId; });
    currentMailbox = mb || mailboxes[0];
    updateAddressDisplay();
    await loadMessages();
  }

  function updateAddressDisplay() {
    var addrEl = document.getElementById('activeMailboxAddr');
    if (addrEl && currentMailbox) {
      addrEl.textContent = currentMailbox.address || currentMailbox.email;
    }
    const composeFrom = document.getElementById('composeFrom');
    if (composeFrom && currentMailbox) {
      composeFrom.value = currentMailbox.address || currentMailbox.email;
    }
  }

  async function loadMessages() {
    if (!currentMailbox) return;
    try {
      const data = await api('GET', '/api/mailboxes/' + currentMailbox.id + '/messages');
      renderMessages(data.messages || []);
    } catch (e) {
      // silent
    }
  }

  function renderMessages(messages) {
    var list = document.getElementById('mailList');
    if (!list) return;
    if (messages.length === 0) {
      list.innerHTML = '<div class="inbox-empty"><i class="fas fa-envelope-open"></i><p>Belum ada pesan masuk</p></div>';
      return;
    }
    list.innerHTML = '';
    messages.forEach(function (msg) {
      const item = document.createElement('div');
      item.className = 'mail-item' + (msg.read ? '' : ' unread');
      item.dataset.id = msg.id;
      item.innerHTML =
        '<div class="mail-from">' + escapeHtml(msg.from || 'Unknown') + '</div>' +
        '<div class="mail-subject">' + escapeHtml(msg.subject || '(Tanpa Subjek)') + '</div>' +
        '<div class="mail-time">' + timeAgo(msg.createdAt || msg.date) + '</div>';
      item.addEventListener('click', function () {
        openMessage(currentMailbox.id, msg.id);
      });
      list.appendChild(item);
    });
  }

  async function openMessage(mailboxId, msgId) {
    try {
      const data = await api('GET', '/api/mailboxes/' + mailboxId + '/messages/' + msgId);
      const msg = data.message || data;
      var reader = document.getElementById('mailReader');
      if (reader) {
        reader.innerHTML =
          '<div class="reader-header">' +
            '<h3>' + escapeHtml(msg.subject || '(Tanpa Subjek)') + '</h3>' +
            '<p class="reader-from">Dari: ' + escapeHtml(msg.from || 'Unknown') + '</p>' +
            '<p class="reader-date">' + timeAgo(msg.createdAt || msg.date) + '</p>' +
          '</div>' +
          '<div class="reader-body">' + (msg.html || escapeHtml(msg.body || msg.text || '')) + '</div>';
        reader.style.display = '';
      }
      // Mark as read in list
      document.querySelectorAll('.mail-item[data-id="' + msgId + '"]').forEach(function (el) {
        el.classList.remove('unread');
      });
    } catch (e) {
      showToast('Gagal membuka pesan', 'error');
    }
  }

  function startInboxRefresh() {
    stopInboxRefresh();
    inboxInterval = setInterval(function () {
      if (currentView === 'inbox' && currentMailbox) {
        loadMessages();
      }
    }, 10000);
  }

  function stopInboxRefresh() {
    if (inboxInterval) {
      clearInterval(inboxInterval);
      inboxInterval = null;
    }
  }

  // ─── Compose ─────────────────────────────────────────────────────────────────

  function loadComposeView() {
    updateAddressDisplay();
    loadSentHistory();
  }

  function initCompose() {
    var composeForm = document.getElementById('composeForm');
    if (composeForm) {
      composeForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        if (!currentMailbox) return showToast('Pilih mailbox terlebih dahulu', 'error');
        var to = document.getElementById('composeTo').value.trim();
        var subject = document.getElementById('composeSubject').value.trim();
        var body = document.getElementById('composeBody').value;
        if (!to) return showToast('Alamat tujuan wajib diisi', 'error');
        try {
          await api('POST', '/api/mailboxes/' + currentMailbox.id + '/send', {
            to: to,
            subject: subject,
            body: body
          });
          showToast('Pesan berhasil dikirim!');
          composeForm.reset();
          updateAddressDisplay();
          loadSentHistory();
        } catch (e) {
          showToast(e.message, 'error');
        }
      });
    }
  }

  async function loadSentHistory() {
    if (!currentMailbox) return;
    var container = document.getElementById('sentList');
    if (!container) return;
    try {
      const data = await api('GET', '/api/mailboxes/' + currentMailbox.id + '/sent');
      const sent = data.messages || data.sent || [];
      if (sent.length === 0) {
        container.innerHTML = '<p class="text-muted">Belum ada pesan terkirim.</p>';
        return;
      }
      container.innerHTML = '';
      sent.forEach(function (msg) {
        const item = document.createElement('div');
        item.className = 'mail-item sent-item';
        item.innerHTML =
          '<div class="mail-from">Ke: ' + escapeHtml(msg.to || '') + '</div>' +
          '<div class="mail-subject">' + escapeHtml(msg.subject || '') + '</div>' +
          '<div class="mail-time">' + timeAgo(msg.createdAt || msg.date) + '</div>';
        container.appendChild(item);
      });
    } catch (e) {
      // silent
    }
  }

  // ─── API Key ─────────────────────────────────────────────────────────────────

  async function loadApiKeyView() {
    await loadCredits();
    var notice = document.querySelector('.apikey-notice');
    var card = document.querySelector('.apikey-card');
    var keyDisplay = document.getElementById('apikeyValue');

    if (currentPlan !== 'unlimited') {
      if (notice) notice.style.display = '';
      if (card) card.style.opacity = '0.4';
      if (keyDisplay) keyDisplay.textContent = 'Upgrade ke Premium';
      return;
    }

    if (notice) notice.style.display = 'none';
    if (card) card.style.opacity = '1';

    try {
      var data = await api('GET', '/api/apikey');
      var key = data.apiKey || data.key || '';
      if (keyDisplay) keyDisplay.textContent = key || 'Tidak tersedia';
    } catch (e) {
      if (keyDisplay) keyDisplay.textContent = 'Tidak tersedia';
    }
  }

  function renderApiDocs() {
    // Docs are static in HTML, no dynamic rendering needed
  }

  async function regenerateApiKey() {
    if (!confirm('Yakin ingin meregenerasi API Key? Key lama akan berhenti berfungsi.')) return;
    try {
      const data = await api('POST', '/api/apikey/regenerate');
      const key = data.apiKey || data.key || '';
      const keyDisplay = document.getElementById('apikeyValue');
      if (keyDisplay) keyDisplay.textContent = key || 'Tidak tersedia';
      showToast('API Key berhasil diregenerasi!');
      renderApiDocs();
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  // ─── New Mailbox ─────────────────────────────────────────────────────────────

  function openNewMailboxModal() {
    var modal = document.getElementById('newMailboxModal');
    if (modal) {
      modal.classList.remove('modal-hidden');
      modal.style.display = 'flex';
      var input = document.getElementById('newMailPrefix');
      if (input) input.value = '';
      // Populate domain selector
      var domainSelect = document.getElementById('newMailDomain');
      if (domainSelect) {
        domainSelect.innerHTML = '<option value="">Loading...</option>';
        api('GET', '/api/settings').then(function(s) {
          var domain = s.domain || 'morvo.me';
          domainSelect.innerHTML = '<option value="' + domain + '">@' + domain + '</option>';
        }).catch(function() {
          domainSelect.innerHTML = '<option value="morvo.me">@morvo.me</option>';
        });
      }
    }
  }

  function closeNewMailboxModal() {
    var modal = document.getElementById('newMailboxModal');
    if (modal) {
      modal.classList.add('modal-hidden');
      modal.style.display = 'none';
    }
  }

  async function createMailbox() {
    const modal = document.getElementById('newMailboxModal');
    var input = document.getElementById('newMailPrefix');
    const localPart = input ? input.value.trim() : '';
    try {
      var result = await api('POST', '/api/mailboxes', localPart ? { localPart: localPart } : {});
      closeNewMailboxModal();
      showToast('Mailbox berhasil dibuat!');
      // Select the newly created mailbox
      var newMb = result.mailbox || result;
      if (newMb && newMb.id) {
        currentMailbox = null; // Reset so loadInbox doesn't keep old selection
        await loadInbox();
        // Find and select the new mailbox
        var found = mailboxes.find(function(m) { return m.id === newMb.id; });
        if (found) {
          currentMailbox = found;
          selectMailbox(found.id);
          updateMailboxSelectorValue(found.id);
        }
      } else {
        currentMailbox = null;
        await loadInbox();
      }
    } catch (e) {
      if (e.status === 402 && e.data && e.data.code === 'CREDITS_EMPTY') {
        closeNewMailboxModal();
        openUpgradeModal();
      } else {
        showToast(e.message, 'error');
      }
    }
  }

  // ─── Upgrade Modal ───────────────────────────────────────────────────────────

  function openUpgradeModal() {
    var modal = document.getElementById('upgradeModal');
    if (modal) { modal.classList.remove('modal-hidden'); modal.style.display = 'flex'; }
  }

  function closeUpgradeModal() {
    var modal = document.getElementById('upgradeModal');
    if (modal) { modal.classList.add('modal-hidden'); modal.style.display = 'none'; }
  }

  // ─── Landing Page ────────────────────────────────────────────────────────────

  async function loadLandingPricing() {
    try {
      const data = await api('GET', '/api/settings');
      const creditPriceEl = document.getElementById('landingCreditPrice');
      const unlimPriceEl = document.getElementById('landingUnlimitedPrice');
      if (creditPriceEl && data.creditPrice != null) creditPriceEl.textContent = formatRupiah(data.creditPrice);
      if (unlimPriceEl && data.unlimitedPrice != null) unlimPriceEl.textContent = formatRupiah(data.unlimitedPrice);
    } catch (e) { /* silent */ }
  }

  function initLandingPage() {
    // Mobile nav toggle
    var navMobileToggle = document.getElementById('navMobileToggle');
    var navLinks = document.querySelector('.nav-links');
    if (navMobileToggle && navLinks) {
      navMobileToggle.addEventListener('click', function() {
        navLinks.classList.toggle('nav-links-open');
      });
    }
    // Countdown timer animation
    const countdownEls = document.querySelectorAll('.countdown-number');
    if (countdownEls.length > 0) {
      animateCountdown(countdownEls);
    }
    // Smooth scroll
    document.querySelectorAll('a[href^="#"]').forEach(function (anchor) {
      anchor.addEventListener('click', function (e) {
        const target = document.querySelector(anchor.getAttribute('href'));
        if (target) {
          e.preventDefault();
          target.scrollIntoView({ behavior: 'smooth' });
        }
      });
    });
    loadLandingPricing();
  }

  function animateCountdown(elements) {
    const values = ['10K+', '∞', '24/7'];
    elements.forEach(function (el, i) {
      let count = 0;
      const target = values[i] || '0';
      const interval = setInterval(function () {
        count++;
        if (count >= 20) {
          el.textContent = target;
          clearInterval(interval);
        } else {
          el.textContent = Math.floor(Math.random() * 1000);
        }
      }, 50);
    });
  }

  // ─── Escape HTML ─────────────────────────────────────────────────────────────

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  // ─── Global Action Handler ───────────────────────────────────────────────────

  function handleAction(action) {
    switch (action) {
      case 'logout': logout(); break;
      case 'openNewMailbox': openNewMailboxModal(); break;
      case 'createMailbox': createMailbox(); break;
      case 'closeNewMailbox': closeNewMailboxModal(); break;
      case 'closeUpgrade': closeUpgradeModal(); break;
      case 'upgradeUnlimited': upgradeUnlimited(); break;
      case 'buyCredits': buyCredits(); break;
      case 'regenerateApiKey': regenerateApiKey(); break;
      case 'refreshInbox': loadMessages(); break;
      case 'copyAddress':
        if (currentMailbox) copyToClipboard(currentMailbox.address || currentMailbox.email);
        break;
      case 'copyApiKey':
        var el = document.getElementById('apikeyValue');
        if (el && el.textContent !== 'Tidak tersedia') copyToClipboard(el.textContent);
        break;
      case 'showLogin': window.location.hash = '#/login'; break;
      case 'showRegister': window.location.hash = '#/register'; break;
      case 'goDashboard': window.location.hash = '#/dashboard'; break;
      case 'goLanding': window.location.hash = '#/'; break;
      case 'planUpgradeFromApikey':
        showView('plan');
        break;
      case 'upgradeFromModal':
        buyCredits();
        closeUpgradeModal();
        break;
    }
  }

  // ─── Button Wiring ─────────────────────────────────────────────────────────

  function wireButtons() {
    // Inbox buttons
    var btnCopy = document.getElementById('btnCopyMailbox');
    if (btnCopy) btnCopy.addEventListener('click', function() { if (currentMailbox) copyToClipboard(currentMailbox.address); });

    var btnNew = document.getElementById('btnNewMailbox');
    if (btnNew) btnNew.addEventListener('click', function() { openNewMailboxModal(); });

    var btnRefresh = document.getElementById('btnRefreshInbox');
    if (btnRefresh) btnRefresh.addEventListener('click', function() { loadMessages(); });

    // Mailbox selector change — handled in renderMailboxSelector (no duplicate needed here)

    // API Key buttons
    var btnCopyKey = document.getElementById('btnCopyApiKey');
    if (btnCopyKey) btnCopyKey.addEventListener('click', function() {
      var el = document.getElementById('apikeyValue');
      if (el && el.textContent && !el.textContent.includes('•') && !el.textContent.includes('Upgrade')) copyToClipboard(el.textContent);
    });

    var btnRegenKey = document.getElementById('btnRegenApiKey');
    if (btnRegenKey) btnRegenKey.addEventListener('click', function() { regenerateApiKey(); });

    // Plan buttons
    document.querySelectorAll('.btnBuyCredits').forEach(function(btn) {
      btn.addEventListener('click', function() { buyCredits(); });
    });
    document.querySelectorAll('.btnUpgradePlan').forEach(function(btn) {
      btn.addEventListener('click', function() { upgradeUnlimited(); });
    });

    // New mailbox form submit
    var newMbForm = document.getElementById('newMailboxForm');
    if (newMbForm) newMbForm.addEventListener('submit', function(e) { e.preventDefault(); createMailbox(); });

    // Modal close buttons
    document.querySelectorAll('[data-action="closeNewMailbox"]').forEach(function(btn) {
      btn.addEventListener('click', function() { closeNewMailboxModal(); });
    });
    document.querySelectorAll('[data-action="closeUpgrade"]').forEach(function(btn) {
      btn.addEventListener('click', function() { closeUpgradeModal(); });
    });

    // Sidebar logout
    var sidebarLogout = document.getElementById('btnLogout');
    if (sidebarLogout) sidebarLogout.addEventListener('click', function() { logout(); });

    // Sidebar close (handled in initSidebar, but ensure it works)
    var sidebarCloseBtn = document.getElementById('sidebarClose');
    if (sidebarCloseBtn && !sidebarCloseBtn._wired) {
      sidebarCloseBtn._wired = true;
      sidebarCloseBtn.addEventListener('click', function() {
        var sidebar = document.getElementById('sidebar');
        var overlay = document.getElementById('sidebarOverlay');
        if (sidebar) sidebar.classList.remove('open');
        if (overlay) overlay.classList.remove('active');
      });
    }

    // Topbar avatar → toggle email dropdown
    var topbarAvatar = document.getElementById('topbarAvatar');
    var emailDropdown = document.getElementById('topbarEmailDropdown');
    if (topbarAvatar && emailDropdown) {
      topbarAvatar.addEventListener('click', function(e) {
        e.stopPropagation();
        emailDropdown.classList.toggle('open');
        if (emailDropdown.classList.contains('open')) {
          renderTopbarEmailList();
        }
      });
      // Close on outside click
      document.addEventListener('click', function(e) {
        if (!emailDropdown.contains(e.target) && e.target !== topbarAvatar) {
          emailDropdown.classList.remove('open');
        }
      });
    }

    // Topbar credits badge → handled by Credits Slide Panel (see above)

    // Quick action: "Buat Email Baru" button on dashboard
    var btnQuickNew = document.getElementById('btnQuickNewMailbox');
    if (btnQuickNew) {
      btnQuickNew.addEventListener('click', function() { openNewMailboxModal(); });
    }

    // Quick action: "Buka Inbox" button on dashboard
    document.querySelectorAll('[data-nav-view]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        showView(btn.dataset.navView);
        document.querySelectorAll('.sidebar-link').forEach(function(l) { l.classList.remove('sidebar-link-active'); });
        var target = document.querySelector('.sidebar-link[data-view="' + btn.dataset.navView + '"]');
        if (target) target.classList.add('sidebar-link-active');
      });
    });

    // Back to landing button
    var btnBackLanding = document.getElementById('btnBackLanding');
    if (btnBackLanding) {
      btnBackLanding.addEventListener('click', function() {
        window.location.hash = '#/';
      });
    }

    // Upgrade modal buttons
    document.querySelectorAll('.btnUpgradeFromModal').forEach(function(btn) {
      btn.addEventListener('click', function() {
        closeUpgradeModal();
        showView('plan');
      });
    });

    // Modal overlay click to close (generic)
    document.querySelectorAll('.modal-overlay').forEach(function(modal) {
      modal.addEventListener('click', function(e) {
        if (e.target === modal) {
          modal.classList.add('modal-hidden');
          modal.style.display = 'none';
        }
      });
    });

    // Modal close X buttons
    document.querySelectorAll('.modal-close').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var modal = btn.closest('.modal-overlay');
        if (modal) {
          modal.classList.add('modal-hidden');
          modal.style.display = 'none';
        }
      });
    });

    // Modal close button (secondary)
    document.querySelectorAll('.modal-close-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var modal = btn.closest('.modal-overlay');
        if (modal) {
          modal.classList.add('modal-hidden');
          modal.style.display = 'none';
        }
      });
    });
  }

  // ─── Init ────────────────────────────────────────────────────────────────────

  function init() {
    initAuth();
    initSidebar();
    initCompose();
    initLandingPage();

    // Direct button wiring for inbox/compose/apikey/plan
    wireButtons();

    // Delegated click handler for [data-action]
    document.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-action]');
      if (btn) {
        e.preventDefault();
        handleAction(btn.dataset.action);
      }
    });

    // Hash change
    window.addEventListener('hashchange', handleRoute);

    // Auth tab clicks
    document.querySelectorAll('.auth-tab').forEach(function(tab) {
      tab.addEventListener('click', function() {
        showAuthTab(this.dataset.tab);
      });
    });

    // Check session and route
    checkSession();

    // Init animations
    initAnimations();
  }

  // ─── Animations ──────────────────────────────────────────────────────────

  function initAnimations() {
    // 1. Scroll reveal observer
    var revealEls = document.querySelectorAll('.animate-in, .feature-card, .pricing-card, .plan-card, .stat-card, .section-header, .auth-card');
    if ('IntersectionObserver' in window && revealEls.length) {
      var observer = new IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            entry.target.style.opacity = '';
            entry.target.style.transform = '';
          }
        });
      }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
      revealEls.forEach(function(el) { observer.observe(el); });
    }

    // 2. Navbar scroll effect
    var nav = document.querySelector('.landing-nav');
    if (nav) {
      window.addEventListener('scroll', function() {
        nav.classList.toggle('scrolled', window.scrollY > 40);
      }, { passive: true });
    }

    // 3. Background particles
    spawnParticles();

    // 4. Stat value counter animation
    animateCounters();

    // 5. Copy button feedback
    document.addEventListener('click', function(e) {
      var btn = e.target.closest('.btn-icon');
      if (btn && btn.id && (btn.id.includes('Copy') || btn.id.includes('copy'))) {
        btn.classList.add('copied');
        setTimeout(function() { btn.classList.remove('copied'); }, 800);
      }
    });

    // 6. Refresh button spin
    document.addEventListener('click', function(e) {
      var btn = e.target.closest('[data-action="refreshInbox"]');
      if (btn) {
        var icon = btn.querySelector('i, .fa-rotate');
        if (icon) { icon.classList.add('loading-spin'); setTimeout(function() { icon.classList.remove('loading-spin'); }, 800); }
      }
    });
  }

  function spawnParticles() {
    var container = document.body;
    var count = window.innerWidth < 768 ? 8 : 15;
    for (var i = 0; i < count; i++) {
      var p = document.createElement('div');
      p.className = 'particle';
      p.style.left = Math.random() * 100 + '%';
      p.style.width = p.style.height = (Math.random() * 4 + 2) + 'px';
      p.style.animationDuration = (Math.random() * 15 + 10) + 's';
      p.style.animationDelay = (Math.random() * 10) + 's';
      p.style.opacity = (Math.random() * 0.4 + 0.1);
      p.style.background = 'rgba(99,102,241,' + (Math.random() * 0.3 + 0.1) + ')';
      container.appendChild(p);
    }
  }

  function animateCounters() {
    var counters = document.querySelectorAll('.stat-value');
    counters.forEach(function(el) {
      var target = parseInt(el.textContent, 10);
      if (isNaN(target) || target === 0) return;
      var start = 0;
      var duration = 1000;
      var startTime = null;
      function step(ts) {
        if (!startTime) startTime = ts;
        var progress = Math.min((ts - startTime) / duration, 1);
        var eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
        el.textContent = Math.floor(eased * target);
        if (progress < 1) requestAnimationFrame(step);
        else { el.textContent = target; el.classList.add('flash'); setTimeout(function() { el.classList.remove('flash'); }, 600); }
      }
      requestAnimationFrame(step);
    });
  }

  // Re-animate counters when dashboard view loads
  var origLoadDash = typeof loadDashboardStats === 'function' ? loadDashboardStats : null;
  if (origLoadDash) {
    var _loadDashboardStats = loadDashboardStats;
    loadDashboardStats = async function() {
      await _loadDashboardStats();
      setTimeout(animateCounters, 100);
    };
  }

  // ─── Boot ────────────────────────────────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose for external use
  window.MorvoApp = {
    showToast: showToast,
    copyToClipboard: copyToClipboard,
    loadCredits: loadCredits,
    refreshInbox: loadMessages
  };

})();
