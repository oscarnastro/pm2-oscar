const webpush = require('web-push');
const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, 'data');
const SUBS_FILE = path.join(DATA_DIR, 'subscriptions.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadSubscriptions() {
  ensureDataDir();
  if (!fs.existsSync(SUBS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(SUBS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function persistSubscriptions(subs) {
  ensureDataDir();
  fs.writeFileSync(SUBS_FILE, JSON.stringify(subs, null, 2), 'utf8');
}

let pushEnabled = false;

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_EMAIL = process.env.VAPID_EMAIL || 'admin@example.com';

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  try {
    webpush.setVapidDetails(`mailto:${VAPID_EMAIL}`, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    pushEnabled = true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('Push notifications disabled: invalid VAPID keys -', err.message);
  }
} else {
  // eslint-disable-next-line no-console
  console.warn('Push notifications disabled: set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in .env');
}

function getVapidPublicKey() {
  return VAPID_PUBLIC_KEY;
}

function isPushEnabled() {
  return pushEnabled;
}

function saveSubscription(sub) {
  if (!sub || !sub.endpoint) return;
  const subs = loadSubscriptions();
  const exists = subs.some((s) => s.endpoint === sub.endpoint);
  if (!exists) {
    subs.push(sub);
    persistSubscriptions(subs);
  }
}

function removeSubscription(sub) {
  if (!sub || !sub.endpoint) return;
  const subs = loadSubscriptions().filter((s) => s.endpoint !== sub.endpoint);
  persistSubscriptions(subs);
}

async function sendPushToAll(payload) {
  if (!pushEnabled) return;
  const subs = loadSubscriptions();
  const stale = [];

  await Promise.allSettled(
    subs.map((sub) =>
      webpush
        .sendNotification(sub, JSON.stringify(payload))
        .catch((err) => {
          if (err.statusCode === 404 || err.statusCode === 410) {
            stale.push(sub.endpoint);
          } else {
            // eslint-disable-next-line no-console
            console.error('Push send error:', err.message);
          }
        })
    )
  );

  if (stale.length > 0) {
    const cleaned = loadSubscriptions().filter((s) => !stale.includes(s.endpoint));
    persistSubscriptions(cleaned);
  }
}

module.exports = {
  getVapidPublicKey,
  isPushEnabled,
  saveSubscription,
  removeSubscription,
  sendPushToAll
};
