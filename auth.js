const session = require('express-session');
const MemoryStore = require('memorystore')(session);
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

const SESSION_SECRET = process.env.SESSION_SECRET || 'changeme_super_secret';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme123';

if (SESSION_SECRET === 'changeme_super_secret') {
  console.warn('Warning: using default SESSION_SECRET. Set a strong secret in .env');
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function hashPassword(password, salt) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, s, 100000, 64, 'sha512').toString('hex');
  return { hash, salt: s };
}

function verifyPassword(password, hash, salt) {
  const result = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(result, 'hex'), Buffer.from(hash, 'hex'));
}

function loadUsers() {
  ensureDataDir();
  if (!fs.existsSync(USERS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch { return []; }
}

function persistUsers(users) {
  ensureDataDir();
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
}

function bootstrapAdminUser() {
  const users = loadUsers();
  if (users.length === 0) {
    const { hash, salt } = hashPassword(ADMIN_PASSWORD);
    const admin = { id: crypto.randomUUID(), username: ADMIN_USERNAME, hash, salt, role: 'admin', createdAt: Date.now() };
    persistUsers([admin]);
    console.log(`Bootstrapped admin user: ${ADMIN_USERNAME}`);
  }
}

bootstrapAdminUser();

function listUsers() {
  return loadUsers().map(({ id, username, role, createdAt }) => ({ id, username, role, createdAt }));
}

function getUserById(id) {
  return loadUsers().find((u) => u.id === id) || null;
}

function getUserByUsername(username) {
  return loadUsers().find((u) => u.username === username) || null;
}

function createUser(username, password, role = 'viewer') {
  if (!username || !password) throw new Error('Username and password required');
  if (!['admin', 'viewer'].includes(role)) throw new Error('Invalid role');
  const users = loadUsers();
  if (users.some((u) => u.username === username)) throw new Error('Username already exists');
  const { hash, salt } = hashPassword(password);
  const user = { id: crypto.randomUUID(), username, hash, salt, role, createdAt: Date.now() };
  users.push(user);
  persistUsers(users);
  return { id: user.id, username: user.username, role: user.role, createdAt: user.createdAt };
}

function updateUserPasswordById(id, newPassword) {
  const users = loadUsers();
  const idx = users.findIndex((u) => u.id === id);
  if (idx === -1) throw new Error('User not found');
  const { hash, salt } = hashPassword(newPassword);
  users[idx].hash = hash;
  users[idx].salt = salt;
  persistUsers(users);
}

function deleteUser(id) {
  const users = loadUsers();
  const idx = users.findIndex((u) => u.id === id);
  if (idx === -1) throw new Error('User not found');
  users.splice(idx, 1);
  persistUsers(users);
}

function validateCredentials(username, password) {
  const user = getUserByUsername(username);
  if (!user) return null;
  try {
    if (!verifyPassword(password, user.hash, user.salt)) return null;
  } catch { return null; }
  return { id: user.id, username: user.username, role: user.role };
}

const activeSessions = new Map();

function trackSession(sessionId, info) {
  activeSessions.set(sessionId, { ...info, lastActivity: Date.now() });
}

function listSessions() {
  return Array.from(activeSessions.entries()).map(([id, info]) => ({ sessionId: id, ...info }));
}

function revokeSession(sessionId) {
  activeSessions.delete(sessionId);
  sessionStore.destroy(sessionId, () => {});
}

function revokeOtherSessions(currentSessionId) {
  for (const [id] of activeSessions) {
    if (id !== currentSessionId) revokeSession(id);
  }
}

const sessionStore = new MemoryStore({ checkPeriod: 1000 * 60 * 60 });

const sessionMiddleware = session({
  name: 'pm2.dashboard.sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  cookie: {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 8
  }
});

function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) {
    if (req.session.userId) {
      trackSession(req.sessionID, {
        id: req.session.userId,
        username: req.session.username,
        role: req.session.role,
        ip: req.ip,
        userAgent: req.headers['user-agent'] || '',
        lastActivity: Date.now(),
        createdAt: activeSessions.get(req.sessionID)?.createdAt || Date.now()
      });
    }
    return next();
  }
  return res.status(401).json({ error: 'Unauthorized' });
}

function requireAuthPage(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  return res.redirect('/login.html');
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.authenticated && req.session.role === 'admin') return next();
  return res.status(403).json({ error: 'Forbidden: admin required' });
}

function requireWriteAccess(req, res, next) {
  if (!req.session || !req.session.authenticated) return res.status(401).json({ error: 'Unauthorized' });
  if (req.session.role !== 'admin' && req.session.role !== 'viewer') return res.status(403).json({ error: 'Forbidden' });
  if (req.session.role === 'viewer') return res.status(403).json({ error: 'Forbidden: write access required' });
  return next();
}

module.exports = {
  sessionMiddleware,
  requireAuth,
  requireAuthPage,
  requireAdmin,
  requireWriteAccess,
  validateCredentials,
  createUser,
  updateUserPasswordById,
  deleteUser,
  listUsers,
  getUserById,
  listSessions,
  revokeSession,
  revokeOtherSessions,
  trackSession
};
