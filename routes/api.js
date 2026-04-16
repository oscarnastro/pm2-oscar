const express = require('express');
const pm2 = require('pm2');
const { requireAuth } = require('../auth');

const router = express.Router();

function connectPm2() {
  return new Promise((resolve, reject) => {
    pm2.connect((err) => {
      if (err) return reject(err);
      return resolve();
    });
  });
}

function pm2Action(action, target) {
  return new Promise((resolve, reject) => {
    pm2[action](target, (err, data) => {
      if (err) return reject(err);
      return resolve(data);
    });
  });
}

function listPm2() {
  return new Promise((resolve, reject) => {
    pm2.list((err, list) => {
      if (err) return reject(err);
      return resolve(list);
    });
  });
}

router.use(requireAuth);

router.get('/processes', async (_req, res) => {
  try {
    await connectPm2();
    const list = await listPm2();
    const items = list.map((p) => ({
      id: p.pm_id,
      name: p.name,
      status: p.pm2_env?.status || 'unknown',
      cpu: p.monit?.cpu || 0,
      memory: p.monit?.memory || 0,
      uptime: p.pm2_env?.pm_uptime || null,
      pid: p.pid,
      restarts: p.pm2_env?.restart_time || 0
    }));
    return res.json({ processes: items });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.post('/processes/:id/start', async (req, res) => {
  try {
    await connectPm2();
    await pm2Action('start', req.params.id);
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.post('/processes/:id/stop', async (req, res) => {
  try {
    await connectPm2();
    await pm2Action('stop', req.params.id);
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.post('/processes/:id/restart', async (req, res) => {
  try {
    await connectPm2();
    await pm2Action('restart', req.params.id);
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.delete('/processes/:id', async (req, res) => {
  try {
    await connectPm2();
    await pm2Action('delete', req.params.id);
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
