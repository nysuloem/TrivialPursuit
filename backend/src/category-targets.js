const db = require('./db');
const { generateBatch, isRefilling } = require('./refill');

const TARGETS = {
  'Pop Culture & Current Events': parseInt(process.env.CATEGORY_TARGET_POP_CURRENT || '150', 10),
  Geography: parseInt(process.env.CATEGORY_TARGET_DEFAULT || '100', 10),
  'TV, Movies & Music': parseInt(process.env.CATEGORY_TARGET_DEFAULT || '100', 10),
  History: parseInt(process.env.CATEGORY_TARGET_DEFAULT || '100', 10),
  'Science & Nature': parseInt(process.env.CATEGORY_TARGET_DEFAULT || '100', 10),
  'Sports & Games': parseInt(process.env.CATEGORY_TARGET_DEFAULT || '100', 10),
};

const PRIORITY_ORDER = [
  'Pop Culture & Current Events',
  'TV, Movies & Music',
  'Sports & Games',
  'Science & Nature',
  'Geography',
  'History',
];

let targetRefilling = false;
let batchesThisProcess = 0;
let batchSequence = 0;

function envInt(name, fallback) {
  const n = parseInt(process.env[name] || '', 10);
  return Number.isFinite(n) ? n : fallback;
}

async function getCategoryCounts() {
  const result = await db.pool.query(`
    SELECT category, COUNT(*)::int AS count
    FROM questions
    WHERE used = FALSE
    GROUP BY category
  `);
  const counts = {};
  for (const category of db.CATEGORIES) counts[category] = 0;
  for (const row of result.rows) counts[row.category] = Number(row.count) || 0;
  return counts;
}

async function getCategoryTargetStatus() {
  const counts = await getCategoryCounts();
  const targets = { ...TARGETS };
  const deficits = {};
  for (const [category, target] of Object.entries(targets)) {
    deficits[category] = Math.max(0, target - (counts[category] || 0));
  }
  return {
    counts,
    targets,
    deficits,
    refilling: targetRefilling,
    batchesThisProcess,
    processBatchCap: envInt('CATEGORY_REFILL_MAX_BATCHES_PER_PROCESS', 45),
  };
}

async function checkCategoryTargets() {
  if (targetRefilling || isRefilling()) return;

  // A fresh bank must become playable across ALL six colours quickly. Use at
  // least two generation slots per category each pass, even if the old env var
  // was set lower, then continue refilling in the background.
  const maxPerRun = Math.max(12, envInt('CATEGORY_REFILL_MAX_BATCHES_PER_RUN', 8));
  const maxPerProcess = Math.max(maxPerRun, envInt('CATEGORY_REFILL_MAX_BATCHES_PER_PROCESS', 45));
  if (batchesThisProcess >= maxPerProcess) {
    console.log('[category-targets] process generation cap reached; leaving remaining deficits for a future deploy.');
    return;
  }

  targetRefilling = true;
  const usedTopics = [];
  const dbQuestionCache = new Map();
  let batchesThisRun = 0;

  try {
    let counts = await getCategoryCounts();
    const paused = new Set();

    // Round-robin rather than filling one category to 100 before touching the
    // others. This gives a newly reset bank broad coverage immediately.
    while (batchesThisRun < maxPerRun && batchesThisProcess < maxPerProcess) {
      let didWork = false;

      for (const category of PRIORITY_ORDER) {
        if (batchesThisRun >= maxPerRun || batchesThisProcess >= maxPerProcess) break;
        if (paused.has(category)) continue;

        const target = TARGETS[category] || 100;
        const deficit = Math.max(0, target - (counts[category] || 0));
        if (!deficit) continue;

        batchSequence += 1;
        batchesThisRun += 1;
        batchesThisProcess += 1;
        didWork = true;

        console.log(
          `[category-targets] generating ${category} batch ${batchesThisRun}/${maxPerRun} ` +
          `(process ${batchesThisProcess}/${maxPerProcess}; ${counts[category] || 0}/${target})`
        );

        const generated = await generateBatch(
          batchSequence,
          [category],
          usedTopics,
          dbQuestionCache
        );

        if (!Array.isArray(generated) || generated.length === 0) {
          console.warn(`[category-targets] no usable ${category} questions generated; pausing this category for this pass.`);
          paused.add(category);
          continue;
        }

        const insertedRaw = await db.insertQuestions(generated.slice(0, deficit));
        const inserted = Number.parseInt(insertedRaw, 10) || 0;
        counts = await getCategoryCounts();
        console.log(`[category-targets] ${category}: inserted ${inserted}; now ${counts[category] || 0}/${target}.`);

        if (inserted === 0) paused.add(category);
      }

      const remaining = PRIORITY_ORDER.some(category =>
        !paused.has(category) && (counts[category] || 0) < (TARGETS[category] || 100)
      );
      if (!didWork || !remaining) break;
    }

    const finalStatus = await getCategoryTargetStatus();
    const remainingSlots = Object.values(finalStatus.deficits).reduce((a, b) => a + b, 0);
    console.log(`[category-targets] refill pass complete; ${remainingSlots} total question slots remain below target.`);
  } catch (err) {
    console.error('[category-targets] refill pass failed:', err.message);
  } finally {
    targetRefilling = false;
  }
}

module.exports = {
  TARGETS,
  checkCategoryTargets,
  getCategoryTargetStatus,
  isTargetRefilling: () => targetRefilling,
};
