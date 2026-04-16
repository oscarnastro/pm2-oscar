const session = require('express-session');

const SESSION_SECRET = process.env.SESSION_SECRET || 'changeme_super_secret';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme123';

if (SESSION_SECRET === 'changeme_super_secret') {
  // eslint-disable-next-line no-console
  console.warn('Warning: using default SESSION_SECRET. Set a strong secret in .env');
}
if (ADMIN_USERNAME === 'admin' && ADMIN_PASSWORD === 'changeme123') {
  // eslint-disable-next-line no-console
  console.warn('Warning: using default admin credentials. Change ADMIN_USERNAME/ADMIN_PASSWORD');
}

const sessionMiddleware = session({
  name: 'pm2.dashboard.sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 8
  }
});

function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) {
    return next();
  }
  return res.status(401).json({ error: 'Unauthorized' });
}

function requireAuthPage(req, res, next) {
  if (req.session && req.session.authenticated) {
    return next();
  }
  return res.redirect('/login.html');
}

function validateCredentials(username, password) {
  return username === ADMIN_USERNAME && password === ADMIN_PASSWORD;
}

module.exports = {
  sessionMiddleware,
  requireAuth,
  requireAuthPage,
  validateCredentials
};
