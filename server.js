require('dotenv').config();

const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { WebSocketServer } = require('ws');
const WebSocket = require('ws');

const {
  sessionMiddleware,
  requireAuth,
  requireAuthPage,
  validateCredentials,
  updateUserPasswordById,
  listSessions,
  revokeOtherSessions
} = require('./auth');
const apiRouter = require('./routes/api');
const logsRouter = require('./routes/logs');
const usersRouter = require('./routes/users');
const eventsRouter = require('./routes/events');
const { connectPm2, listPm2, launchBus } = require('./pm2-client');
const pushRouter = require('./routes/push');
const { sendPushToAll } = require('./push-service');
const { recordStats } = require('./stats-store');
const { appendEvent } = require('./events-store');

const RESTART_LOOP_THRESHOLD = Number(process.env.RESTART_LOOP_THRESHOLD) || 5;
const RESTART_LOOP_WINDOW_MS = Number(process.env.RESTART_LOOP_WINDOW_MS) || 60000;
const NOTIFY_ON_RESTART = process.env.NOTIFY_ON_RESTART === 'true';

const restartWindows = new Map();

const app = express();
const port = Number(process.env.PORT) || 3003;
const csrfEntropy = process.env.JWT_SECRET || 'changeme_jwt_secret';

if (csrfEntropy === 'changeme_jwt_secret') {
  // eslint-disable-next-line no-console
  console.warn('Warning: using default JWT_SECRET. Set JWT_SECRET in .env');
}

app.set('trust proxy', 1);
app.use(express.json());
app.use(sessionMiddleware);

const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, retry later.' }
});

const pageLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false
});

app.use((req, _res, next) => {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto
      .createHash('sha256')
      .update(`${crypto.randomUUID()}:${csrfEntropy}`)
      .digest('hex');
  }
  next();
});

app.use((req, res, next) => {
  const isSafeMethod = ['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  if (isSafeMethod) return next();

  const csrfHeader = req.headers['x-csrf-token'];
  if (!csrfHeader || csrfHeader !== req.session.csrfToken) {
    return res.status(403).json({ error: 'Invalid CSRF token' });
  }
  return next();
});

// ── Public endpoints ──────────────────────────────────────────────────────────

app.get('/health', async (_req, res) => {
  try {
    await connectPm2();
    const list = await listPm2();
    return res.json({ status: 'ok', uptime: process.uptime(), processCount: list.length });
  } catch {
    return res.json({ status: 'ok', uptime: process.uptime(), processCount: 0 });
  }
});

app.get('/auth/csrf', (req, res) => {
  res.json({ csrfToken: req.session.csrfToken });
});

app.get('/login', (_req, res) => res.redirect('/login.html'));

app.post('/auth/login', loginLimiter, (req, res) => {
  const { username, password } = req.body || {};
  const user = validateCredentials(username, password);
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  req.session.authenticated = true;
  req.session.username = user.username;
  req.session.userId = user.id;
  req.session.role = user.role;
  return res.json({ ok: true });
});

app.post('/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('pm2.dashboard.sid');
    res.json({ ok: true });
  });
});

app.get('/auth/me', requireAuth, (req, res) => {
  res.json({ username: req.session.username, role: req.session.role });
});

app.post('/auth/change-password', requireAuth, (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  if (!oldPassword || !newPassword) {
    return res.status(400).json({ error: 'oldPassword and newPassword required' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }
  const user = validateCredentials(req.session.username, oldPassword);
  if (!user) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  try {
    updateUserPasswordById(user.id, newPassword);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('/auth/sessions', requireAuth, (req, res) => {
  const sessions = listSessions().map((s) => ({
    ...s,
    current: s.sessionId === req.sessionID
  }));
  return res.json({ sessions });
});

app.delete('/auth/sessions/others', requireAuth, (req, res) => {
  revokeOtherSessions(req.sessionID);
  return res.json({ ok: true });
});

app.get('/', pageLimiter, requireAuthPage, (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/index.html', pageLimiter, requireAuthPage, (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use('/api', apiRouter);
app.use('/logs', logsRouter);
app.use('/api/push', pushRouter);
app.use('/api/users', usersRouter);
app.use('/api/events', eventsRouter);
app.get('/sw.js', pageLimiter, (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'public', 'sw.js'));
});
app.use(express.static(path.join(__dirname, 'public')));

const server = app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`PM2 Oscar dashboard running on port ${port}`);
});

const wsClients = new Set();

async function startPm2Bus() {
  await connectPm2();

  // Stats collection every 5s
  setInterval(async () => {
    try {
      const list = await listPm2();
      for (const p of list) {
        recordStats(p.pm_id, p.name, p.monit?.cpu || 0, p.monit?.memory || 0);
      }
    } catch {
      // ignore transient errors
    }
  }, 5000);

  launchBus((err, bus) => {
    if (err) return;

    const emit = (type) => (packet) => {
      const payload = JSON.stringify({
        event: 'log',
        type,
        processId: String(packet.process.pm_id),
        processName: packet.process.name,
        line: packet.data
      });

      for (const client of wsClients) {
        if (
          client.readyState === WebSocket.OPEN &&
          (!client.processId || client.processId === String(packet.process.pm_id))
        ) {
          client.send(payload);
        }
      }
    };

    bus.on('log:out', emit('out'));
    bus.on('log:err', emit('err'));

    bus.on('process:event', (packet) => {
      const procEvent = packet.event;
      const proc = packet.process || {};

      // Crash / error detection
      const isUnexpectedStop =
        (procEvent === 'exit' && proc.exit_code !== 0) || procEvent === 'error';

      if (isUnexpectedStop) {
        const label = procEvent === 'error' ? 'error' : 'exit';
        appendEvent({
          ts: Date.now(),
          processName: proc.name,
          processId: proc.pm_id,
          event: label,
          exitCode: proc.exit_code ?? null
        });

        sendPushToAll({
          title: `⚠️ ${proc.name || 'Processo'} – ${procEvent === 'error' ? 'Errore' : `Crash (exit ${proc.exit_code})`}`,
          body: `Processo "${proc.name}" si e' fermato in modo inatteso.\nClicca per aprire la dashboard.`,
          tag: `pm2-crash-${proc.pm_id}`,
          url: '/'
        }).catch(() => {});
      }

      // Restart loop detection
      if (procEvent === 'restart') {
        const key = String(proc.pm_id);
        const now = Date.now();
        if (!restartWindows.has(key)) restartWindows.set(key, []);
        const times = restartWindows.get(key);
        times.push(now);
        // Remove timestamps outside window
        const cutoff = now - RESTART_LOOP_WINDOW_MS;
        while (times.length && times[0] < cutoff) times.shift();
        if (times.length >= RESTART_LOOP_THRESHOLD) {
          times.length = 0; // reset to avoid repeated alerts
          sendPushToAll({
            title: `🔁 Loop di restart rilevato: ${proc.name}`,
            body: `Il processo "${proc.name}" ha eseguito ${RESTART_LOOP_THRESHOLD}+ restart in ${Math.round(RESTART_LOOP_WINDOW_MS / 1000)}s.`,
            tag: `pm2-loop-${proc.pm_id}`,
            url: '/'
          }).catch(() => {});
        }
      }

      // Push on successful restart (optional)
      if (NOTIFY_ON_RESTART && (procEvent === 'online' || procEvent === 'restart')) {
        sendPushToAll({
          title: `✅ ${proc.name} – Riavviato`,
          body: `Il processo "${proc.name}" è tornato online.`,
          tag: `pm2-restart-${proc.pm_id}`,
          url: '/'
        }).catch(() => {});
      }
    });
  });
}

startPm2Bus().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start PM2 log bus', error);
});

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const pathname = request.url ? new URL(request.url, `http://${request.headers.host}`).pathname : '';
  if (pathname !== '/ws/logs') {
    socket.destroy();
    return;
  }

  const mockResponse = {
    getHeader() {
      return undefined;
    },
    setHeader() {},
    end() {}
  };

  sessionMiddleware(request, mockResponse, () => {
    if (!request.session || !request.session.authenticated) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });
});

wss.on('connection', (ws, request) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    ws.processId = url.searchParams.get('processId') || '';
  } catch {
    ws.processId = '';
  }

  wsClients.add(ws);
  ws.on('close', () => wsClients.delete(ws));
});
