const processListEl = document.getElementById('process-list');
const logsEl = document.getElementById('logs');
const refreshBtn = document.getElementById('refresh');
const logoutBtn = document.getElementById('logout');
const notifBtn = document.getElementById('notif-toggle');
const tailSelect = document.getElementById('tail-lines');

let selectedProcessId = null;
let ws;
let csrfToken = '';
let swRegistration = null;

// ── Utilities ───────────────────────────────────────────────────────────────

const statusClass = (status) => {
  if (status === 'online') return 'online';
  if (status === 'errored') return 'errored';
  return 'stopped';
};

const formatBytes = (bytes = 0) => {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
};

const formatUptime = (uptime) => {
  if (!uptime) return '-';
  const sec = Math.floor((Date.now() - uptime) / 1000);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}h ${m}m ${s}s`;
};

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

// ── API helper ───────────────────────────────────────────────────────────────

const api = async (url, options = {}) => {
  const method = (options.method || 'GET').toUpperCase();
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && csrfToken) {
    headers['x-csrf-token'] = csrfToken;
  }

  const response = await fetch(url, { ...options, headers });

  if (response.status === 401) {
    window.location.href = '/login.html';
    return null;
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Richiesta fallita');
  return payload;
};

async function loadCsrf() {
  const response = await fetch('/auth/csrf');
  const payload = await response.json().catch(() => ({}));
  csrfToken = payload.csrfToken || '';
}

// ── Processes ─────────────────────────────────────────────────────────────────

async function loadProcesses() {
  const data = await api('/api/processes');
  if (!data) return;

  processListEl.innerHTML = '';
  data.processes.forEach((proc) => {
    const card = document.createElement('article');
    card.className = 'process-card';
    card.innerHTML = `
      <div class="process-head">
        <strong>${proc.name}</strong>
        <span class="badge ${statusClass(proc.status)}">${proc.status}</span>
      </div>
      <div class="meta">
        <span>CPU: ${proc.cpu}% · RAM: ${formatBytes(proc.memory)}</span>
        <span>Uptime: ${formatUptime(proc.uptime)}</span>
        <span>PID: ${proc.pid || '-'} · Restart: ${proc.restarts}</span>
      </div>
      <div class="actions">
        <button class="btn" data-action="start" data-id="${proc.id}">Avvia</button>
        <button class="btn" data-action="stop" data-id="${proc.id}">Ferma</button>
        <button class="btn" data-action="restart" data-id="${proc.id}">Riavvia</button>
        <button class="btn" data-action="delete" data-id="${proc.id}">Elimina</button>
      </div>
      <button class="btn" data-action="logs" data-id="${proc.id}">Apri log</button>
    `;
    processListEl.appendChild(card);
  });
}

async function runAction(action, id) {
  if (action === 'logs') {
    selectedProcessId = id;
    await loadTail();
    openWs();
    return;
  }

  const method = action === 'delete' ? 'DELETE' : 'POST';
  await api(`/api/processes/${id}/${action === 'delete' ? '' : action}`.replace(/\/$/, ''), { method });
  await loadProcesses();
}

// ── Logs ─────────────────────────────────────────────────────────────────────

async function loadTail() {
  if (!selectedProcessId) return;
  const lines = tailSelect.value;
  const data = await api(`/logs/processes/${selectedProcessId}/tail?lines=${lines}`);
  if (!data) return;
  logsEl.textContent = data.logs.map((l) => `[${l.type}] ${l.line}`).join('\n');
  logsEl.scrollTop = logsEl.scrollHeight;
}

function openWs() {
  if (ws) ws.close();
  if (!selectedProcessId) return;

  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${protocol}://${location.host}/ws/logs?processId=${selectedProcessId}`);
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.event !== 'log') return;
    logsEl.textContent += `\n[${msg.type}] ${String(msg.line).trimEnd()}`;
    logsEl.scrollTop = logsEl.scrollHeight;
  };
}

// ── PWA & Push Notifications ─────────────────────────────────────────────────

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    swRegistration = await navigator.serviceWorker.register('/sw.js');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('Service Worker registration failed:', err);
  }
}

function updateNotifButton(subscribed) {
  if (!notifBtn) return;
  const icon = notifBtn.querySelector('[data-lucide]');
  if (subscribed) {
    notifBtn.title = 'Disattiva notifiche';
    notifBtn.classList.add('active');
    if (icon) icon.setAttribute('data-lucide', 'bell-dot');
  } else {
    notifBtn.title = 'Attiva notifiche';
    notifBtn.classList.remove('active');
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
  if (!statusData || !statusData.enabled) {
    alert('Le notifiche push non sono configurate sul server.\nImposta le variabili VAPID nel file .env.');
    return;
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    alert('Permesso notifiche negato. Abilitalo nelle impostazioni del browser.');
    return;
  }

  try {
    const { publicKey } = await api('/api/push/vapid-public-key');
    const sub = await swRegistration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey)
    });
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

// ── Event listeners ──────────────────────────────────────────────────────────

processListEl.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const { action, id } = button.dataset;
  await runAction(action, id).catch((err) => alert(err.message));
});

refreshBtn.addEventListener('click', () => loadProcesses());
tailSelect.addEventListener('change', () => loadTail());

logoutBtn.addEventListener('click', async () => {
  await api('/auth/logout', { method: 'POST' });
  window.location.href = '/login.html';
});

if (notifBtn) {
  notifBtn.addEventListener('click', async () => {
    const sub = await getCurrentSubscription();
    if (sub) {
      await unsubscribePush();
    } else {
      await subscribePush();
    }
  });
}

// ── Bootstrap ────────────────────────────────────────────────────────────────

registerServiceWorker().then(() => {
  loadCsrf()
    .then(() => Promise.all([loadProcesses(), initPush()]))
    .then(() => {
      if (window.lucide) window.lucide.createIcons();
    });
});

