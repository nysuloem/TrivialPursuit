require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const db      = require('./db');
const { initDB } = db;
const { ensureDefaultAdmin } = require('./auth');
const routes  = require('./routes');

const app  = express();
const PORT = process.env.PORT || 3001;
const FRESH_BANK_RESET_TAG = 'fresh-bank-v3-2026-10-11-post-diversity-reset';

app.use(cors({ origin: process.env.FRONTEND_URL || '*', credentials: true }));
app.use(express.json());
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date() }));
app.use('/api', routes);
app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

async function retireOldBankOnce() {
  await db.pool.query(`
    CREATE TABLE IF NOT EXISTS question_bank_resets (
      tag TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT NOW(),
      retired_count INT NOT NULL DEFAULT 0
    )
  `);
  const already = await db.pool.query(
    'SELECT 1 FROM question_bank_resets WHERE tag=$1 LIMIT 1',
    [FRESH_BANK_RESET_TAG]
  );
  if (already.rows.length) return { retired: 0, applied: false };

  const result = await db.pool.query(
    'UPDATE questions SET used=TRUE, used_at=NOW() WHERE used=FALSE RETURNING id'
  );
  await db.pool.query(
    'INSERT INTO question_bank_resets(tag, retired_count) VALUES ($1,$2)',
    [FRESH_BANK_RESET_TAG, result.rowCount]
  );
  return { retired: result.rowCount, applied: true };
}

async function installRepeatGuard() {
  const retiredMeta = await db.pool.query(`
    UPDATE questions
    SET used=TRUE, used_at=COALESCE(used_at, NOW())
    WHERE used=FALSE
      AND (question ILIKE '%trivial pursuit%' OR answer ILIKE '%trivial pursuit%')
    RETURNING id
  `);
  if (retiredMeta.rowCount) {
    console.log(`[question-ban] retired ${retiredMeta.rowCount} Trivial Pursuit meta-question(s).`);
  }

  await db.pool.query(`
    CREATE OR REPLACE FUNCTION tp_prevent_repeat_category_answer()
    RETURNS trigger AS $$
    BEGIN
      IF NEW.question ILIKE '%trivial pursuit%' OR NEW.answer ILIKE '%trivial pursuit%' THEN
        RETURN NULL;
      END IF;
      IF EXISTS (
        SELECT 1 FROM questions
        WHERE used = FALSE
          AND LOWER(category) = LOWER(NEW.category)
          AND LOWER(TRIM(answer)) = LOWER(TRIM(NEW.answer))
      ) THEN
        RETURN NULL;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);
  await db.pool.query('DROP TRIGGER IF EXISTS trg_tp_repeat_category_answer ON questions');
  await db.pool.query(`
    CREATE TRIGGER trg_tp_repeat_category_answer
    BEFORE INSERT ON questions
    FOR EACH ROW EXECUTE FUNCTION tp_prevent_repeat_category_answer()
  `);
}

async function start() {
  try {
    await initDB();
    const reset = await retireOldBankOnce();
    await installRepeatGuard();

    // Build a permanent semantic topic ledger from every historical question,
    // including retired/used ones, before generating anything new. New questions
    // are rejected if they are too close in meaning to any prior question.
    await db.backfillThemeEmbeddings();

    if (reset.applied) {
      console.log(`🧹 Retired ${reset.retired} old trivia questions; rebuilding a fresh bank from the API model.`);
    }

    await ensureDefaultAdmin();
    app.listen(PORT, async () => {
      console.log(`🚀 Trivia backend running on port ${PORT}`);
      console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (err) {
    console.error('❌ Failed to start:', err);
    process.exit(1);
  }
}

start();
