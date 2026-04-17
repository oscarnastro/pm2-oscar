const MAX_POINTS = 60;
const store = new Map();

function recordStats(id, name, cpu, memory) {
  const key = String(id);
  if (!store.has(key)) store.set(key, { name, points: [] });
  const entry = store.get(key);
  entry.name = name;
  entry.points.push({ ts: Date.now(), cpu, memory });
  if (entry.points.length > MAX_POINTS) entry.points.shift();
}

function getHistory(id) {
  return store.get(String(id)) || null;
}

module.exports = { recordStats, getHistory };
