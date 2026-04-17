const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, 'data');
const EVENTS_FILE = path.join(DATA_DIR, 'events.json');
const MAX_EVENTS = 500;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadEvents() {
  ensureDataDir();
  if (!fs.existsSync(EVENTS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(EVENTS_FILE, 'utf8')); } catch { return []; }
}

function appendEvent(event) {
  const events = loadEvents();
  events.unshift({ ...event, ts: event.ts || Date.now() });
  if (events.length > MAX_EVENTS) events.length = MAX_EVENTS;
  ensureDataDir();
  fs.writeFileSync(EVENTS_FILE, JSON.stringify(events, null, 2), 'utf8');
}

function getEvents({ limit = 100, processName } = {}) {
  let events = loadEvents();
  if (processName) events = events.filter((e) => e.processName === processName);
  return events.slice(0, limit);
}

module.exports = { appendEvent, getEvents };
