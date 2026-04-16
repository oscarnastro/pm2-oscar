require('dotenv').config();

const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { WebSocketServer } = require('ws');
const WebSocket = require('ws');

const { sessionMiddleware, requireAuthPage, validateCredentials } = require('./auth');
const apiRouter = require('./routes/api');
const logsRouter = require('./routes/logs');
const { connectPm2, launchBus } = require('./pm2-client');
const pushRouter = require('./routes/push');
const { sendPushToAll } = require('./push-service');

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

app.get('/auth/csrf', (req, res) => {
  res.json({ csrfToken: req.session.csrfToken });
});

app.get('/login', (_req, res) => res.redirect('/login.html'));

app.post('/auth/login', loginLimiter, (req, res) => {
  const { username, password } = req.body || {};
  if (!validateCredentials(username, password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  req.session.authenticated = true;
  req.session.username = username;
  return res.json({ ok: true });
});

app.post('/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('pm2.dashboard.sid');
    res.json({ ok: true });
  });
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
app.use(express.static(path.join(__dirname, 'public')));

const server = app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`PM2 Oscar dashboard running on port ${port}`);
});

const wsClients = new Set();

async function startPm2Bus() {
  await connectPm2();
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

      const isUnexpectedStop =
        (procEvent === 'exit' && proc.exit_code !== 0) ||
        procEvent === 'error';

      if (!isUnexpectedStop) return;

      const label = procEvent === 'error' ? 'Errore' : `Crash (exit ${proc.exit_code})`;
      sendPushToAll({
        title: `⚠️ ${proc.name || 'Processo'} – ${label}`,
        body: `Processo "${proc.name}" si e' fermato in modo inatteso.\nClicca per aprire la dashboard.`,
        tag: `pm2-crash-${proc.pm_id}`,
        url: '/'
      }).catch(() => {});
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
