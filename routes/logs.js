const express = require('express');
const fs = require('node:fs/promises');
const { requireAuth } = require('../auth');
const { connectPm2, describeProcess } = require('../pm2-client');

const router = express.Router();

async function readTail(filePath, lines) {
  if (!filePath) return [];
  try {
    const data = await fs.readFile(filePath, 'utf8');
    return data.split('\n').filter(Boolean).slice(-lines);
  } catch {
    return [];
  }
}

async function readFull(filePath) {
  if (!filePath) return '';
  try { return await fs.readFile(filePath, 'utf8'); } catch { return ''; }
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
    // eslint-disable-next-line no-console
    console.error('Failed to read PM2 logs', error);
    return res.status(500).json({ error: 'Unable to read logs' });
  }
});

router.get('/processes/:id/download', async (req, res) => {
  try {
    await connectPm2();
    const proc = await describeProcess(req.params.id);
    if (!proc) return res.status(404).json({ error: 'Process not found' });

    const type = req.query.type || 'all';
    const outPath = proc.pm2_env?.pm_out_log_path;
    const errPath = proc.pm2_env?.pm_err_log_path;

    let content = '';
    if (type === 'out' || type === 'all') {
      const text = await readFull(outPath);
      if (text) content += `=== stdout ===\n${text}`;
    }
    if (type === 'err' || type === 'all') {
      const text = await readFull(errPath);
      if (text) content += `${content ? '\n' : ''}=== stderr ===\n${text}`;
    }

    const filename = `${proc.name || req.params.id}-${type}.txt`;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(content || '');
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to download PM2 logs', error);
    return res.status(500).json({ error: 'Unable to download logs' });
  }
});

module.exports = router;
