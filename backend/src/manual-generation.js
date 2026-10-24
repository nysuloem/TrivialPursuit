const db = require('./db');
const { generateBatch } = require('./refill');

let status = {
  running: false, perCategory: 0, requestedTotal: 0,
  totalAdded: 0, byCategory: {}, startedAt: null, finishedAt: null, error: null,
};

function getStatus() { return { ...status, byCategory: { ...status.byCategory } }; }

async function start(perCategory) {
  if (status.running) throw new Error('Generation already running');
  status = { running: true, perCategory, requestedTotal: perCategory * db.CATEGORIES.length,
    totalAdded: 0, byCategory: {}, startedAt: new Date().toISOString(), finishedAt: null, error: null };
  const usedTopics = [];
  const cache = new Map();
  let before = 0;
  try {
    before = await db.getUnusedCount();
    for (const category of db.CATEGORIES) {
      let added = 0;
      let attempts = 0;
      const maxAttempts = Math.max(6, Math.ceil(perCategory / 5) * 5);
      while (added < perCategory && attempts < maxAttempts) {
        const batchIndex = attempts * db.CATEGORIES.length + db.CATEGORIES.indexOf(category);
        const generated = await generateBatch(batchIndex, [category], usedTopics, cache);
        const remaining = perCategory - added;
        const inserted = Number(await db.insertQuestions(generated.slice(0, remaining))) || 0;
        added += inserted;
        status.totalAdded += inserted;
        status.byCategory[category] = added;
        attempts++;
        if (!generated.length && attempts > 2) break;
      }
      status.byCategory[category] = added;
    }
    const shortages = db.CATEGORIES.filter(cat => status.byCategory[cat] < perCategory);
    if (shortages.length) status.error = 'Duplicate checks prevented full quota in: ' + shortages.join(', ');
    await db.logRefill(before, status.totalAdded, shortages.length ? 'partial' : 'success');
  } catch (err) {
    status.error = err.message;
    console.error('[manual-generation] failed', err);
    try { await db.logRefill(before, status.totalAdded, 'error: ' + err.message); } catch {}
  } finally {
    status.running = false;
    status.finishedAt = new Date().toISOString();
  }
  return getStatus();
}

module.exports = { start, getStatus };
