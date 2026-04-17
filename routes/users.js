const express = require('express');
const { requireAuth, requireAdmin, listUsers, createUser, updateUserPasswordById, deleteUser, getUserById } = require('../auth');

const router = express.Router();
router.use(requireAuth, requireAdmin);

router.get('/', (_req, res) => {
  return res.json({ users: listUsers() });
});

router.post('/', (req, res) => {
  const { username, password, role } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password required' });
  }
  try {
    const user = createUser(username, password, role || 'viewer');
    return res.json({ user });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.put('/:id/password', (req, res) => {
  const { newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'newPassword must be at least 8 characters' });
  }
  try {
    updateUserPasswordById(req.params.id, newPassword);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', (req, res) => {
  if (req.params.id === req.session.userId) {
    return res.status(400).json({ error: 'Cannot delete your own account' });
  }
  if (!getUserById(req.params.id)) {
    return res.status(404).json({ error: 'User not found' });
  }
  try {
    deleteUser(req.params.id);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

module.exports = router;
