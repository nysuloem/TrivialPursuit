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

  const maxPerRun = Math.max(1, envInt('CATEGORY_REFILL_MAX_BATCHES_PER_RUN', 8));
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

    for (const category of PRIORITY_ORDER) {
      const target = TARGETS[category] || 100;
      let deficit = Math.max(0, target - (counts[category] || 0));
      if (!deficit) continue;

      console.log(`[category-targets] ${category}: ${counts[category] || 0}/${target}; need ${deficit}.`);

      while (
        deficit > 0 &&
        batchesThisRun < maxPerRun &&
        batchesThisProcess < maxPerProcess
      ) {
        batchSequence += 1;
        batchesThisRun += 1;
        batchesThisProcess += 1;

        console.log(
          `[category-targets] generating ${category} batch ${batchesThisRun}/${maxPerRun} ` +
          `(process ${batchesThisProcess}/${maxPerProcess})`
        );

        const generated = await generateBatch(
          batchSequence,
          [category],
          usedTopics,
          dbQuestionCache
        );

        if (!Array.isArray(generated) || generated.length === 0) {
          console.warn(`[category-targets] no usable ${category} questions generated; pausing this category.`);
          break;
        }

        const toInsert = generated.slice(0, deficit);
        const insertedRaw = await db.insertQuestions(toInsert);
        const inserted = Number.parseInt(insertedRaw, 10) || 0;

        counts = await getCategoryCounts();
        deficit = Math.max(0, target - (counts[category] || 0));

        console.log(
          `[category-targets] ${category}: inserted ${inserted}; now ${counts[category] || 0}/${target}.`
        );

        if (inserted === 0) break;
      }

      if (batchesThisRun >= maxPerRun || batchesThisProcess >= maxPerProcess) break;
    }

    const finalStatus = await getCategoryTargetStatus();
    const remaining = Object.values(finalStatus.deficits).reduce((a, b) => a + b, 0);
    console.log(`[category-targets] refill pass complete; ${remaining} total question slots remain below target.`);
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
