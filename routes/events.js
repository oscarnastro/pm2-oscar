const express = require('express');
const { requireAuth } = require('../auth');
const { getEvents } = require('../events-store');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const processName = req.query.process || undefined;
  return res.json({ events: getEvents({ limit, processName }) });
});

module.exports = router;
