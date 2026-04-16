require('dotenv').config();

const path = require('node:path');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { WebSocketServer } = require('ws');
const pm2 = require('pm2');

const { sessionMiddleware, requireAuthPage, validateCredentials } = require('./auth');
const apiRouter = require('./routes/api');
const logsRouter = require('./routes/logs');

const app = express();
const port = Number(process.env.PORT) || 3003;

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

app.get('/', requireAuthPage, (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/index.html', requireAuthPage, (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use('/api', apiRouter);
app.use('/logs', logsRouter);
app.use(express.static(path.join(__dirname, 'public')));

const server = app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`PM2 Oscar dashboard running on port ${port}`);
});

const wsClients = new Set();

function connectPm2() {
  return new Promise((resolve, reject) => {
    pm2.connect((err) => {
      if (err) return reject(err);
      return resolve();
    });
  });
}

async function startPm2Bus() {
  await connectPm2();
  pm2.launchBus((err, bus) => {
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
          client.readyState === 1 &&
          (!client.processId || client.processId === String(packet.process.pm_id))
        ) {
          client.send(payload);
        }
      }
    };

    bus.on('log:out', emit('out'));
    bus.on('log:err', emit('err'));
  });
}

startPm2Bus().catch(() => {});

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
