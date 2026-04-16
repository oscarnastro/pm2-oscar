const express = require('express');
const fs = require('node:fs/promises');
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

function describeProcess(id) {
  return new Promise((resolve, reject) => {
    pm2.describe(id, (err, desc) => {
      if (err) return reject(err);
      return resolve(desc && desc[0]);
    });
  });
}

async function readTail(path, lines) {
  if (!path) return [];
  try {
    const data = await fs.readFile(path, 'utf8');
    return data.split('\n').filter(Boolean).slice(-lines);
  } catch {
    return [];
  }
}

router.use(requireAuth);

router.get('/processes/:id/tail', async (req, res) => {
  try {
    await connectPm2();
    const lines = Math.min(Number(req.query.lines) || 100, 500);
    const proc = await describeProcess(req.params.id);
    if (!proc) return res.status(404).json({ error: 'Process not found' });

    const outPath = proc.pm2_env?.pm_out_log_path;
    const errPath = proc.pm2_env?.pm_err_log_path;

    const [outLines, errLines] = await Promise.all([
      readTail(outPath, lines),
      readTail(errPath, lines)
    ]);

    return res.json({
      logs: [
        ...outLines.map((line) => ({ type: 'out', line })),
        ...errLines.map((line) => ({ type: 'err', line }))
      ].slice(-lines)
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
