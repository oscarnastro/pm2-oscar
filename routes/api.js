const express = require('express');
const { requireAuth } = require('../auth');
const { connectPm2, listPm2, pm2Action } = require('../pm2-client');

const router = express.Router();

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
    // eslint-disable-next-line no-console
    console.error('Failed to list PM2 processes', error);
    return res.status(500).json({ error: 'Unable to list PM2 processes' });
  }
});

router.post('/processes/:id/start', async (req, res) => {
  try {
    await connectPm2();
    await pm2Action('start', req.params.id);
    return res.json({ ok: true });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to start PM2 process', error);
    return res.status(500).json({ error: 'Unable to start process' });
  }
});

router.post('/processes/:id/stop', async (req, res) => {
  try {
    await connectPm2();
    await pm2Action('stop', req.params.id);
    return res.json({ ok: true });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to stop PM2 process', error);
    return res.status(500).json({ error: 'Unable to stop process' });
  }
});

router.post('/processes/:id/restart', async (req, res) => {
  try {
    await connectPm2();
    await pm2Action('restart', req.params.id);
    return res.json({ ok: true });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to restart PM2 process', error);
    return res.status(500).json({ error: 'Unable to restart process' });
  }
});

router.delete('/processes/:id', async (req, res) => {
  try {
    await connectPm2();
    await pm2Action('delete', req.params.id);
    return res.json({ ok: true });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to delete PM2 process', error);
    return res.status(500).json({ error: 'Unable to delete process' });
  }
});

module.exports = router;
