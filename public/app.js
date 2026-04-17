// ── DOM refs ────────────────────────────────────────────────────────────────
const processListEl = document.getElementById('process-list');
const logsEl = document.getElementById('logs');
const refreshBtn = document.getElementById('refresh');
const logoutBtn = document.getElementById('logout');
const notifBtn = document.getElementById('notif-toggle');
const tailSelect = document.getElementById('tail-lines');
const clearLogsBtn = document.getElementById('clear-logs');
const procSearchEl = document.getElementById('proc-search');
const autoRefreshToggle = document.getElementById('auto-refresh-toggle');
const autoRefreshInterval = document.getElementById('auto-refresh-interval');
const refreshDot = document.getElementById('refresh-dot');
const themeToggle = document.getElementById('theme-toggle');
const logSearchEl = document.getElementById('log-search');
const logTypeFilter = document.getElementById('log-type-filter');
const downloadLogBtn = document.getElementById('btn-download-log');
const btnOpenSessions = document.getElementById('btn-open-sessions');
const btnOpenChangePw = document.getElementById('btn-open-change-pw');
const btnOpenUsers = document.getElementById('btn-open-users');
const btnOpenNewProc = document.getElementById('btn-open-new-proc');
const btnLoadEvents = document.getElementById('btn-load-events');
const eventsContainer = document.getElementById('events-container');

let selectedProcessId = null;
let ws;
let csrfToken = '';
let swRegistration = null;
let currentRole = 'viewer';
let autoRefreshTimer = null;
let filterStatus = 'all';
let rawLogLines = [];       // {type, line} array of current log
let currentEnvData = {};    // for env modal
let currentEnvProcId = null;

const MAX_LOG_LINES = 500;

// ── Utilities ────────────────────────────────────────────────────────────────

const statusClass = (s) => (s === 'online' ? 'online' : s === 'errored' ? 'errored' : 'stopped');
const formatBytes = (b = 0) => `${(b / 1024 / 1024).toFixed(1)} MB`;
const formatUptime = (u) => {
  if (!u) return '-';
  const sec = Math.floor((Date.now() - u) / 1000);
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m ${sec % 60}s`;
};
const formatDate = (ts) => ts ? new Date(ts).toLocaleString() : '-';

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function urlBase64ToUint8Array(b64) {
  const padding = '='.repeat((4 - (b64.length % 4)) % 4);
  const base64 = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

// ── API helper ────────────────────────────────────────────────────────────────

const api = async (url, options = {}) => {
  const method = (options.method || 'GET').toUpperCase();
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && csrfToken) {
    headers['x-csrf-token'] = csrfToken;
  }
  const response = await fetch(url, { ...options, headers });
  if (response.status === 401) { window.location.href = '/login.html'; return null; }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Richiesta fallita');
  return payload;
};

async function loadCsrf() {
  const r = await fetch('/auth/csrf');
  const p = await r.json().catch(() => ({}));
  csrfToken = p.csrfToken || '';
}

// ── Theme ────────────────────────────────────────────────────────────────────

function applyTheme(light) {
  document.body.classList.toggle('light-theme', light);
  themeToggle.textContent = light ? '☀️' : '🌙';
}

function toggleTheme() {
  const isLight = document.body.classList.toggle('light-theme');
  themeToggle.textContent = isLight ? '☀️' : '🌙';
  localStorage.setItem('pm2-theme', isLight ? 'light' : 'dark');
}

// ── Sparkline ─────────────────────────────────────────────────────────────────

function drawSparkline(canvas, points, color) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!points || points.length < 2) return;
  const max = Math.max(...points, 0.1);
  const w = canvas.width;
  const h = canvas.height;
  const step = w / (points.length - 1);
  ctx.beginPath();
  points.forEach((v, i) => {
    const x = i * step;
    const y = h - (v / max) * (h - 2) - 1;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

async function updateSparklines(procId, cpuCanvas, ramCanvas) {
  try {
    const data = await api(`/api/processes/${procId}/stats/history`);
    if (!data || !data.points || data.points.length < 2) return;
    drawSparkline(cpuCanvas, data.points.map((p) => p.cpu), '#6366f1');
    drawSparkline(ramCanvas, data.points.map((p) => p.memory / 1024 / 1024), '#22c55e');
  } catch {
    // ignore
  }
}

// ── Processes ─────────────────────────────────────────────────────────────────

async function loadProcesses() {
  const data = await api('/api/processes');
  if (!data) return;

  processListEl.innerHTML = '';

  const search = procSearchEl.value.trim().toLowerCase();

  data.processes.forEach((proc) => {
    const hidden =
      (search && !proc.name.toLowerCase().includes(search)) ||
      (filterStatus !== 'all' && statusClass(proc.status) !== filterStatus);

    const isCluster = proc.execMode === 'cluster';
    const isAdmin = currentRole === 'admin';

    const card = document.createElement('article');
    card.className = `process-card${hidden ? ' hidden' : ''}`;
    card.dataset.status = statusClass(proc.status);
    card.dataset.name = proc.name.toLowerCase();

    card.innerHTML = `
      <div class="process-head">
        <strong>${escapeHtml(proc.name)}</strong>
        <span class="badge ${statusClass(proc.status)}">${escapeHtml(proc.status)}</span>
      </div>
      <div class="meta">
        <span>CPU: ${proc.cpu}% · RAM: ${formatBytes(proc.memory)}</span>
        <span>Uptime: ${formatUptime(proc.uptime)}</span>
        <span>PID: ${proc.pid || '-'} · Restart: ${proc.restarts}${isCluster ? ` · ${proc.instances} istanze` : ''}</span>
      </div>
      <div class="sparkline-wrap">
        <div class="sparkline-block"><div class="sparkline-label">CPU</div><canvas width="100" height="34" data-sparkline-cpu></canvas></div>
        <div class="sparkline-block"><div class="sparkline-label">RAM</div><canvas width="100" height="34" data-sparkline-ram></canvas></div>
      </div>
      <div class="actions" ${!isAdmin ? 'style="display:none"' : ''}>
        <button class="btn" data-action="start" data-id="${proc.id}">Avvia</button>
        <button class="btn" data-action="stop" data-id="${proc.id}">Ferma</button>
        <button class="btn" data-action="restart" data-id="${proc.id}">Riavvia</button>
        <button class="btn btn-danger" data-action="delete" data-id="${proc.id}">Elimina</button>
      </div>
      ${isCluster && isAdmin ? `
      <div class="scale-row">
        Istanze: <strong>${proc.instances}</strong>
        <button class="btn" data-action="scale-down" data-id="${proc.id}" data-instances="${proc.instances}">−</button>
        <button class="btn" data-action="scale-up" data-id="${proc.id}" data-instances="${proc.instances}">+</button>
      </div>` : ''}
      <div class="card-extra-actions">
        <button class="btn logs-btn" data-action="logs" data-id="${proc.id}">Apri log</button>
        <button class="btn" data-action="detail" data-id="${proc.id}">Dettagli</button>
        <button class="btn" data-action="env" data-id="${proc.id}">Variabili</button>
      </div>
    `;

    processListEl.appendChild(card);

    // Draw sparklines
    const cpuCanvas = card.querySelector('[data-sparkline-cpu]');
    const ramCanvas = card.querySelector('[data-sparkline-ram]');
    updateSparklines(proc.id, cpuCanvas, ramCanvas);
  });

  if (window.lucide) window.lucide.createIcons();
}

// ── Auto-refresh ──────────────────────────────────────────────────────────────

function startAutoRefresh() {
  clearInterval(autoRefreshTimer);
  const ms = Number(autoRefreshInterval.value) || 10000;
  autoRefreshTimer = setInterval(loadProcesses, ms);
  refreshDot.style.display = '';
}

function stopAutoRefresh() {
  clearInterval(autoRefreshTimer);
  autoRefreshTimer = null;
  refreshDot.style.display = 'none';
}

autoRefreshToggle.addEventListener('change', () => {
  if (autoRefreshToggle.checked) startAutoRefresh(); else stopAutoRefresh();
});
autoRefreshInterval.addEventListener('change', () => {
  if (autoRefreshToggle.checked) startAutoRefresh();
});

// ── Filter ────────────────────────────────────────────────────────────────────

document.querySelector('.filter-pills').addEventListener('click', (e) => {
  const pill = e.target.closest('.pill');
  if (!pill) return;
  document.querySelectorAll('.pill').forEach((p) => p.classList.remove('active'));
  pill.classList.add('active');
  filterStatus = pill.dataset.filter;
  applyClientFilter();
});

procSearchEl.addEventListener('input', applyClientFilter);

function applyClientFilter() {
  const search = procSearchEl.value.trim().toLowerCase();
  document.querySelectorAll('.process-card').forEach((card) => {
    const matchName = !search || card.dataset.name.includes(search);
    const matchStatus = filterStatus === 'all' || card.dataset.status === filterStatus;
    card.classList.toggle('hidden', !(matchName && matchStatus));
  });
}

// ── Process actions ───────────────────────────────────────────────────────────

async function runAction(action, id, extra) {
  if (action === 'logs') {
    selectedProcessId = id;
    downloadLogBtn.style.display = '';
    await loadTail();
    openWs();
    return;
  }
  if (action === 'detail') { await openDetailModal(id); return; }
  if (action === 'env') { await openEnvModal(id); return; }
  if (action === 'scale-up') { await api(`/api/processes/${id}/scale`, { method: 'POST', body: JSON.stringify({ instances: (Number(extra) || 1) + 1 }) }); await loadProcesses(); return; }
  if (action === 'scale-down') { const n = (Number(extra) || 2) - 1; if (n < 1) return; await api(`/api/processes/${id}/scale`, { method: 'POST', body: JSON.stringify({ instances: n }) }); await loadProcesses(); return; }

  const method = action === 'delete' ? 'DELETE' : 'POST';
  await api(`/api/processes/${id}/${action === 'delete' ? '' : action}`.replace(/\/$/, ''), { method });
  await loadProcesses();
}

processListEl.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const { action, id, instances } = btn.dataset;
  await runAction(action, id, instances).catch((err) => alert(err.message));
});

// ── Logs ──────────────────────────────────────────────────────────────────────

async function loadTail() {
  if (!selectedProcessId) return;
  const lines = tailSelect.value;
  const data = await api(`/logs/processes/${selectedProcessId}/tail?lines=${lines}`);
  if (!data) return;
  rawLogLines = data.logs;
  renderLogs();
}

function renderLogs() {
  const search = logSearchEl.value.trim();
  const typeFilter = logTypeFilter.value;

  let lines = rawLogLines;
  if (typeFilter !== 'all') lines = lines.filter((l) => l.type === typeFilter);

  if (!search) {
    logsEl.textContent = lines.map((l) => `[${l.type}] ${l.line}`).join('\n');
  } else {
    const reEscaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(${reEscaped})`, 'gi');
    logsEl.innerHTML = lines
      .map((l) => `[${escapeHtml(l.type)}] ${escapeHtml(l.line).replace(re, '<mark>$1</mark>')}`)
      .join('\n');
  }
  logsEl.scrollTop = logsEl.scrollHeight;
}

logSearchEl.addEventListener('input', renderLogs);
logTypeFilter.addEventListener('change', renderLogs);

function openWs() {
  if (ws) ws.close();
  if (!selectedProcessId) return;
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${protocol}://${location.host}/ws/logs?processId=${selectedProcessId}`);
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.event !== 'log') return;
    rawLogLines.push({ type: msg.type, line: String(msg.line).trimEnd() });
    if (rawLogLines.length > MAX_LOG_LINES) rawLogLines.shift();
    renderLogs();
  };
}

tailSelect.addEventListener('change', () => loadTail());

// ── Log download ──────────────────────────────────────────────────────────────

downloadLogBtn.addEventListener('click', () => {
  if (!selectedProcessId) return;
  const type = logTypeFilter.value === 'all' ? 'all' : logTypeFilter.value;
  const a = document.createElement('a');
  a.href = `/logs/processes/${selectedProcessId}/download?type=${type}`;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
});

// ── Detail modal ──────────────────────────────────────────────────────────────

async function openDetailModal(id) {
  const data = await api(`/api/processes/${id}/detail`).catch((err) => { alert(err.message); return null; });
  if (!data) return;
  const fields = [
    ['Nome', data.name], ['Stato', data.status], ['PID', data.pid],
    ['Script', data.script], ['CWD', data.cwd],
    ['Modalità', data.execMode], ['Istanze', data.instances],
    ['Node', data.nodeVersion], ['Restart', data.restarts],
    ['Unstable restart', data.unstableRestarts], ['Avviato il', formatDate(data.createdAt)]
  ];
  const rows = fields.map(([k, v]) =>
    `<div class="detail-row"><span class="key">${escapeHtml(k)}</span><span class="val">${escapeHtml(String(v ?? '-'))}</span></div>`
  ).join('');

  const envRows = Object.entries(data.env || {})
    .map(([k, v]) => `<div class="detail-row"><span class="key">${escapeHtml(k)}</span><span class="val">${escapeHtml(String(v))}</span></div>`)
    .join('');

  document.getElementById('detail-content').innerHTML = rows +
    (envRows ? `<h4 style="margin:12px 0 6px">Variabili d'ambiente</h4>${envRows}` : '');
  openModal('modal-detail');
}

// ── Env modal ─────────────────────────────────────────────────────────────────

let _envIsAdmin = false;
let _envFilter = '';

function renderEnvTable(isAdmin, filter) {
  _envIsAdmin = isAdmin;
  _envFilter = filter || '';
  const entries = Object.entries(currentEnvData);
  const q = _envFilter.toLowerCase();
  const filtered = q
    ? entries.filter(([k, v]) => k.toLowerCase().includes(q) || String(v).toLowerCase().includes(q))
    : entries;

  const rows = filtered.map(([k, v]) => `
    <tr>
      <td>${escapeHtml(k)}</td>
      <td>${isAdmin
        ? `<input data-key="${escapeHtml(k)}" type="text" value="${escapeHtml(String(v))}" ${v === '***' ? 'placeholder="(mascherato)"' : ''} />`
        : escapeHtml(String(v))
      }</td>
    </tr>
  `).join('');

  const countNote = entries.length
    ? `<p style="font-size:12px;color:var(--muted);margin:0 0 6px">${filtered.length} di ${entries.length} variabili</p>`
    : '';
  const searchInput = `<input type="search" id="env-search" placeholder="Cerca variabile…" value="${escapeHtml(_envFilter)}" style="width:100%;margin-bottom:8px;padding:6px 10px;box-sizing:border-box" />`;
  const tableHtml = rows
    ? `<div style="overflow-y:auto;max-height:50vh"><table class="env-table"><thead><tr><th>Chiave</th><th>Valore</th></tr></thead><tbody>${rows}</tbody></table></div>`
    : '<p style="color:var(--muted)">Nessun risultato</p>';
  const emptyMsg = '<p style="color:var(--muted)">Nessuna variabile</p>';

  document.getElementById('env-content').innerHTML = countNote + searchInput + (entries.length ? tableHtml : emptyMsg);

  const searchEl = document.getElementById('env-search');
  if (searchEl) searchEl.focus();
}

// Single delegated listener on the stable #env-content container
document.getElementById('env-content').addEventListener('input', (e) => {
  if (e.target.id === 'env-search') {
    renderEnvTable(_envIsAdmin, e.target.value);
  } else if (_envIsAdmin && e.target.dataset.key) {
    currentEnvData[e.target.dataset.key] = e.target.value;
  }
});

async function openEnvModal(id) {
  const data = await api(`/api/processes/${id}/env`).catch((err) => { alert(err.message); return null; });
  if (!data) return;
  currentEnvData = data.env || {};
  currentEnvProcId = id;
  const isAdmin = currentRole === 'admin';
  const saveBtn = document.getElementById('btn-save-env');
  saveBtn.style.display = isAdmin ? '' : 'none';
  renderEnvTable(isAdmin, '');
  openModal('modal-env');
}

document.getElementById('btn-save-env').addEventListener('click', async () => {
  await api(`/api/processes/${currentEnvProcId}/env`, { method: 'PUT', body: JSON.stringify({ env: currentEnvData }) }).catch((err) => alert(err.message));
  closeModal('modal-env');
  await loadProcesses();
});

// ── New process modal ─────────────────────────────────────────────────────────

document.getElementById('form-new-proc').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = Object.fromEntries(fd.entries());
  if (body.instances) body.instances = Number(body.instances);
  try {
    await api('/api/processes', { method: 'POST', body: JSON.stringify(body) });
    closeModal('modal-new-proc');
    e.target.reset();
    await loadProcesses();
  } catch (err) {
    document.getElementById('new-proc-error').textContent = err.message;
  }
});

// ── Change password modal ─────────────────────────────────────────────────────

document.getElementById('form-change-pw').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const msg = document.getElementById('change-pw-msg');
  msg.className = 'error';
  msg.textContent = '';
  if (fd.get('newPassword') !== fd.get('confirmPassword')) {
    msg.textContent = 'Le password non coincidono';
    return;
  }
  try {
    await api('/auth/change-password', { method: 'POST', body: JSON.stringify({ oldPassword: fd.get('oldPassword'), newPassword: fd.get('newPassword') }) });
    msg.className = 'success';
    msg.textContent = 'Password aggiornata!';
    setTimeout(() => closeModal('modal-change-pw'), 1200);
    e.target.reset();
  } catch (err) {
    msg.textContent = err.message;
  }
});

// ── Sessions modal ────────────────────────────────────────────────────────────

async function openSessionsModal() {
  const data = await api('/auth/sessions').catch((err) => { alert(err.message); return null; });
  if (!data) return;
  const rows = data.sessions.map((s) => `
    <tr>
      <td>${escapeHtml(s.username)}${s.current ? ' <span class="current-session">(corrente)</span>' : ''}</td>
      <td>${escapeHtml(s.ip || '-')}</td>
      <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis">${escapeHtml((s.userAgent || '').slice(0, 60))}</td>
      <td>${formatDate(s.lastActivity)}</td>
    </tr>
  `).join('');
  document.getElementById('sessions-content').innerHTML = `
    <table class="sessions-table">
      <thead><tr><th>Utente</th><th>IP</th><th>User-Agent</th><th>Ultima attività</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4">Nessuna sessione</td></tr>'}</tbody>
    </table>`;
  openModal('modal-sessions');
}

document.getElementById('btn-revoke-others').addEventListener('click', async () => {
  await api('/auth/sessions/others', { method: 'DELETE' }).catch((err) => alert(err.message));
  await openSessionsModal();
});

// ── Users modal ───────────────────────────────────────────────────────────────

async function loadUsersModal() {
  const data = await api('/api/users').catch(() => null);
  if (!data) return;
  const rows = data.users.map((u) => `
    <tr>
      <td>${escapeHtml(u.username)}</td>
      <td>${escapeHtml(u.role)}</td>
      <td>${formatDate(u.createdAt)}</td>
      <td><button class="btn btn-danger" data-del-user="${escapeHtml(u.id)}" style="padding:3px 8px;font-size:11px">Elimina</button></td>
    </tr>
  `).join('');
  document.getElementById('users-list-content').innerHTML = `
    <table class="users-table">
      <thead><tr><th>Username</th><th>Ruolo</th><th>Creato</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4">Nessun utente</td></tr>'}</tbody>
    </table>`;
}

document.getElementById('modal-users').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-del-user]');
  if (!btn) return;
  if (!confirm('Eliminare questo utente?')) return;
  await api(`/api/users/${btn.dataset.delUser}`, { method: 'DELETE' }).catch((err) => alert(err.message));
  await loadUsersModal();
});

document.getElementById('form-new-user').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const errEl = document.getElementById('new-user-error');
  errEl.textContent = '';
  try {
    await api('/api/users', { method: 'POST', body: JSON.stringify(Object.fromEntries(fd.entries())) });
    e.target.reset();
    await loadUsersModal();
  } catch (err) {
    errEl.textContent = err.message;
  }
});

// ── Events ────────────────────────────────────────────────────────────────────

btnLoadEvents.addEventListener('click', async () => {
  const data = await api('/api/events?limit=50').catch(() => null);
  if (!data) return;
  if (!data.events.length) { eventsContainer.innerHTML = '<p style="color:var(--muted);font-size:13px">Nessun evento</p>'; return; }
  const rows = data.events.map((ev) => `
    <tr>
      <td>${formatDate(ev.ts)}</td>
      <td>${escapeHtml(ev.processName || '-')}</td>
      <td>${escapeHtml(ev.event || '-')}</td>
      <td>${ev.exitCode ?? '-'}</td>
    </tr>
  `).join('');
  eventsContainer.innerHTML = `<table class="events-table"><thead><tr><th>Timestamp</th><th>Processo</th><th>Evento</th><th>Exit</th></tr></thead><tbody>${rows}</tbody></table>`;
});

// ── Modal helpers ─────────────────────────────────────────────────────────────

function openModal(id) {
  document.getElementById(id).classList.add('open');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-close]');
  if (btn) closeModal(btn.dataset.close);
  if (e.target.classList.contains('modal-overlay')) closeModal(e.target.id);
});

// ── PWA / Push ────────────────────────────────────────────────────────────────

let swListenersRegistered = false;

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    swRegistration = await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });
    if (!swListenersRegistered) {
      swListenersRegistered = true;
      swRegistration.addEventListener('updatefound', () => {
        const nw = swRegistration.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) nw.postMessage({ type: 'SKIP_WAITING' });
        });
      });
      navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload());
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('Service Worker registration failed:', err);
  }
}

function updateNotifButton(subscribed) {
  if (!notifBtn) return;
  const icon = notifBtn.querySelector('[data-lucide]');
  if (subscribed) {
    notifBtn.title = 'Disattiva notifiche'; notifBtn.classList.add('active');
    if (icon) icon.setAttribute('data-lucide', 'bell-dot');
  } else {
    notifBtn.title = 'Attiva notifiche'; notifBtn.classList.remove('active');
    if (icon) icon.setAttribute('data-lucide', 'bell');
  }
  if (window.lucide) window.lucide.createIcons();
}

async function getCurrentSubscription() {
  if (!swRegistration) return null;
  return swRegistration.pushManager.getSubscription();
}

async function subscribePush() {
  if (!swRegistration) return;
  const statusData = await api('/api/push/status').catch(() => null);
  if (!statusData || !statusData.enabled) { alert('Push non configurati. Imposta VAPID nel .env.'); return; }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') { alert('Permesso notifiche negato.'); return; }
  try {
    const { publicKey } = await api('/api/push/vapid-public-key');
    const sub = await swRegistration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
    await api('/api/push/subscribe', { method: 'POST', body: JSON.stringify(sub) });
    updateNotifButton(true);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Errore durante la sottoscrizione push:', err);
    alert('Impossibile attivare le notifiche: ' + err.message);
  }
}

async function unsubscribePush() {
  const sub = await getCurrentSubscription();
  if (sub) {
    await api('/api/push/subscribe', { method: 'DELETE', body: JSON.stringify(sub) }).catch(() => {});
    await sub.unsubscribe();
  }
  updateNotifButton(false);
}

async function initPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    if (notifBtn) notifBtn.style.display = 'none';
    return;
  }
  const sub = await getCurrentSubscription();
  updateNotifButton(!!sub);
}

// ── Event listeners ───────────────────────────────────────────────────────────

refreshBtn.addEventListener('click', () => loadProcesses());

if (clearLogsBtn) {
  clearLogsBtn.addEventListener('click', () => { rawLogLines = []; logsEl.textContent = ''; });
}

logoutBtn.addEventListener('click', async () => {
  await api('/auth/logout', { method: 'POST' });
  window.location.href = '/login.html';
});

themeToggle.addEventListener('click', toggleTheme);

if (notifBtn) {
  notifBtn.addEventListener('click', async () => {
    const sub = await getCurrentSubscription();
    if (sub) await unsubscribePush(); else await subscribePush();
  });
}

btnOpenSessions.addEventListener('click', openSessionsModal);
btnOpenChangePw.addEventListener('click', () => openModal('modal-change-pw'));
btnOpenUsers.addEventListener('click', async () => { await loadUsersModal(); openModal('modal-users'); });
btnOpenNewProc.addEventListener('click', () => openModal('modal-new-proc'));

// ── Bootstrap ─────────────────────────────────────────────────────────────────

registerServiceWorker().then(() => {
  loadCsrf().then(async () => {
    // Load identity
    const me = await api('/auth/me').catch(() => null);
    if (me) {
      currentRole = me.role;
      if (me.role === 'admin') {
        btnOpenUsers.style.display = '';
        btnOpenNewProc.style.display = '';
      }
    }

    // Apply saved theme
    const savedTheme = localStorage.getItem('pm2-theme');
    applyTheme(savedTheme === 'light');

    await Promise.all([loadProcesses(), initPush()]);
    if (window.lucide) window.lucide.createIcons();
  });
});
