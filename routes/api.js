const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const dotenv = require('dotenv');
const { requireAuth, requireWriteAccess, requireAdmin } = require('../auth');
const { connectPm2, listPm2, pm2Action, describeProcess, startProcess, scaleProcess } = require('../pm2-client');
const { getHistory } = require('../stats-store');

const router = express.Router();
router.use(requireAuth);

const SECRET_KEYS = /secret|password|pass|key|token|auth|credential/i;

/**
 * Read and parse the .env file located in the given working directory.
 * Returns the parsed key/value object, or null if the file does not exist.
 */
function readDotEnvFile(cwd) {
  if (!cwd || typeof cwd !== 'string') return null;
  const envPath = path.join(cwd, '.env');
  try {
    const raw = fs.readFileSync(envPath, 'utf8');
    return dotenv.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Write key/value pairs back to {cwd}/.env.
 * Values containing whitespace, quotes, or shell-special characters are
 * double-quoted; all other values are written as bare KEY=VALUE pairs.
 */
function writeDotEnvFile(cwd, env) {
  const envPath = path.join(cwd, '.env');
  const lines = Object.entries(env).map(([k, v]) => {
    const val = String(v ?? '');
    if (val === '' || /[\s"'`#\\$!]/.test(val)) {
      return `${k}="${val.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    }
    return `${k}=${val}`;
  });
  fs.writeFileSync(envPath, lines.join('\n') + '\n', 'utf8');
}

function maskEnv(env) {
  if (!env || typeof env !== 'object') return {};
  const masked = {};
  for (const [k, v] of Object.entries(env)) {
    masked[k] = SECRET_KEYS.test(k) ? '***' : v;
  }
  return masked;
}

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
      restarts: p.pm2_env?.restart_time || 0,
      execMode: p.pm2_env?.exec_mode || 'fork',
      instances: p.pm2_env?.instances || 1
    }));
    return res.json({ processes: items });
  } catch (error) {
    console.error('Failed to list PM2 processes', error);
    return res.status(500).json({ error: 'Unable to list PM2 processes' });
  }
});

router.get('/processes/:id/stats/history', async (req, res) => {
  const history = getHistory(req.params.id);
  if (!history) return res.json({ points: [] });
  return res.json({ points: history.points });
});

router.get('/processes/:id/detail', async (req, res) => {
  try {
    await connectPm2();
    const proc = await describeProcess(req.params.id);
    if (!proc) return res.status(404).json({ error: 'Process not found' });
    const cwd = proc.pm2_env?.pm_cwd;
    const parsed = readDotEnvFile(cwd);
    const env = parsed ? maskEnv(parsed) : null;
    return res.json({
      id: proc.pm_id,
      name: proc.name,
      status: proc.pm2_env?.status,
      pid: proc.pid,
      execMode: proc.pm2_env?.exec_mode,
      instances: proc.pm2_env?.instances,
      script: proc.pm2_env?.pm_exec_path,
      cwd,
      args: proc.pm2_env?.args,
      nodeVersion: proc.pm2_env?.node_version,
      createdAt: proc.pm2_env?.created_at,
      restarts: proc.pm2_env?.restart_time,
      unstableRestarts: proc.pm2_env?.unstable_restarts,
      env,
      envFileExists: parsed !== null
    });
  } catch (error) {
    console.error('Failed to describe PM2 process', error);
    return res.status(500).json({ error: 'Unable to describe process' });
  }
});

router.get('/processes/:id/env', async (req, res) => {
  try {
    await connectPm2();
    const proc = await describeProcess(req.params.id);
    if (!proc) return res.status(404).json({ error: 'Process not found' });
    const cwd = proc.pm2_env?.pm_cwd;
    const parsed = readDotEnvFile(cwd);
    if (!parsed) return res.json({ env: {}, envFileExists: false, cwd: cwd || null });
    return res.json({ env: maskEnv(parsed), envFileExists: true, cwd });
  } catch (error) {
    console.error('Failed to get env', error);
    return res.status(500).json({ error: 'Unable to get env' });
  }
});

router.put('/processes/:id/env', requireWriteAccess, async (req, res) => {
  try {
    const patch = req.body?.env;
    if (!patch || typeof patch !== 'object') return res.status(400).json({ error: 'env object required' });
    await connectPm2();
    const proc = await describeProcess(req.params.id);
    if (!proc) return res.status(404).json({ error: 'Process not found' });
    const cwd = proc.pm2_env?.pm_cwd;
    if (!cwd) return res.status(400).json({ error: 'Process has no working directory' });
    const existing = readDotEnvFile(cwd) || {};
    const merged = { ...existing, ...patch };
    writeDotEnvFile(cwd, merged);
    await pm2Action('restart', req.params.id);
    return res.json({ ok: true });
  } catch (error) {
    console.error('Failed to update env', error);
    return res.status(500).json({ error: 'Unable to update env' });
  }
});

router.post('/processes', requireWriteAccess, async (req, res) => {
  try {
    const { name, script, args, cwd, instances, execMode } = req.body || {};
    if (!script || typeof script !== 'string') return res.status(400).json({ error: 'script is required' });
    // Resolve the script path and ensure it does not escape via traversal
    const scriptPath = path.resolve(process.cwd(), script);
    const normalised = path.normalize(scriptPath);
    // Reject if resolved path still contains a traversal sequence or is suspiciously short
    if (normalised.includes('\0') || normalised !== scriptPath) {
      return res.status(400).json({ error: 'Invalid script path' });
    }
    await connectPm2();
    await startProcess({ name, script: normalised, args, cwd, instances: instances || 1, exec_mode: execMode || 'fork' });
    return res.json({ ok: true });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to start new process', error);
    return res.status(500).json({ error: 'Unable to start process' });
  }
});

router.post('/processes/:id/start', requireWriteAccess, async (req, res) => {
  try { await connectPm2(); await pm2Action('start', req.params.id); return res.json({ ok: true }); }
  catch (error) { console.error('Failed to start PM2 process', error); return res.status(500).json({ error: 'Unable to start process' }); }
});

router.post('/processes/:id/stop', requireWriteAccess, async (req, res) => {
  try { await connectPm2(); await pm2Action('stop', req.params.id); return res.json({ ok: true }); }
  catch (error) { console.error('Failed to stop PM2 process', error); return res.status(500).json({ error: 'Unable to stop process' }); }
});

router.post('/processes/:id/restart', requireWriteAccess, async (req, res) => {
  try { await connectPm2(); await pm2Action('restart', req.params.id); return res.json({ ok: true }); }
  catch (error) { console.error('Failed to restart PM2 process', error); return res.status(500).json({ error: 'Unable to restart process' }); }
});

router.post('/processes/:id/scale', requireWriteAccess, async (req, res) => {
  try {
    const instances = Number(req.body?.instances);
    if (!instances || instances < 1) return res.status(400).json({ error: 'instances must be >= 1' });
    await connectPm2();
    const proc = await describeProcess(req.params.id);
    if (!proc) return res.status(404).json({ error: 'Process not found' });
    await scaleProcess(proc.name, instances);
    return res.json({ ok: true });
  } catch (error) {
    console.error('Failed to scale PM2 process', error);
    return res.status(500).json({ error: 'Unable to scale process' });
  }
});

router.delete('/processes/:id', requireWriteAccess, async (req, res) => {
  try { await connectPm2(); await pm2Action('delete', req.params.id); return res.json({ ok: true }); }
  catch (error) { console.error('Failed to delete PM2 process', error); return res.status(500).json({ error: 'Unable to delete process' }); }
});

module.exports = router;
