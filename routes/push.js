const express = require('express');
const { requireAuth } = require('../auth');
const { getVapidPublicKey, isPushEnabled, saveSubscription, removeSubscription } = require('../push-service');

const router = express.Router();

router.use(requireAuth);

router.get('/vapid-public-key', (_req, res) => {
  const key = getVapidPublicKey();
  if (!key) {
    return res.status(503).json({ error: 'Push notifications not configured' });
  }
  return res.json({ publicKey: key });
});

router.get('/status', (_req, res) => {
  res.json({ enabled: isPushEnabled() });
});

router.post('/subscribe', (req, res) => {
  const sub = req.body;
  if (!sub || !sub.endpoint) {
    return res.status(400).json({ error: 'Invalid subscription' });
  }
  saveSubscription(sub);
  return res.json({ ok: true });
});

router.delete('/subscribe', (req, res) => {
  const sub = req.body;
  if (!sub || !sub.endpoint) {
    return res.status(400).json({ error: 'Invalid subscription' });
  }
  removeSubscription(sub);
  return res.json({ ok: true });
});

module.exports = router;
