const processListEl = document.getElementById('process-list');
const logsEl = document.getElementById('logs');
const refreshBtn = document.getElementById('refresh');
const logoutBtn = document.getElementById('logout');
const tailSelect = document.getElementById('tail-lines');

let selectedProcessId = null;
let ws;
let csrfToken = '';

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

const api = async (url, options = {}) => {
  const method = (options.method || 'GET').toUpperCase();
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && csrfToken) {
    headers['x-csrf-token'] = csrfToken;
  }

  const response = await fetch(url, {
    ...options,
    headers
  });

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

loadCsrf().then(() => loadProcesses()).then(() => {
  if (window.lucide) window.lucide.createIcons();
});
