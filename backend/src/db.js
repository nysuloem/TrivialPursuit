const {asksForMemeName} = require('./question-policy');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const CATEGORIES = [
  'Geography',
  'TV, Movies & Music',
  'History',
  'Science & Nature',
  'Sports & Games',
  'Pop Culture & Current Events',
];

const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';
const THEME_SIMILARITY_THRESHOLD = Number.parseFloat(process.env.THEME_SIMILARITY_THRESHOLD || '0.80');

async function embedTexts(texts) {
  if (!texts.length) return [];
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required for semantic theme deduplication');
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts }),
  });
  if (!response.ok) throw new Error(`Embedding request failed (${response.status}): ${await response.text()}`);
  const data = await response.json();
  return (data.data || []).sort((a, b) => a.index - b.index).map(item => item.embedding);
}

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) return 0;
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  if (!aa || !bb) return 0;
  return dot / (Math.sqrt(aa) * Math.sqrt(bb));
}

// ── Schema ────────────────────────────────────────────────────────────────────
async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS questions (
        id            SERIAL PRIMARY KEY,
        category      TEXT NOT NULL,
        question      TEXT NOT NULL,
        answer        TEXT NOT NULL,
        is_pie        BOOLEAN DEFAULT FALSE,
        canadian      BOOLEAN DEFAULT FALSE,
        used          BOOLEAN DEFAULT FALSE,
        used_at       TIMESTAMPTZ,
        created_at    TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS admins (
        id            SERIAL PRIMARY KEY,
        username      TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at    TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS refill_log (
        id                SERIAL PRIMARY KEY,
        triggered_at      TIMESTAMPTZ DEFAULT NOW(),
        questions_added   INT,
        bank_count_before INT,
        status            TEXT DEFAULT 'pending'
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_q_cat_used ON questions(category, used)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_q_used ON questions(used)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_q_pie ON questions(is_pie, used)`);

    await client.query(`ALTER TABLE questions ADD COLUMN IF NOT EXISTS subcategory TEXT DEFAULT 'general'`);
    await client.query(`ALTER TABLE questions ADD COLUMN IF NOT EXISTS era TEXT DEFAULT 'millennial'`);
    await client.query(`ALTER TABLE questions ADD COLUMN IF NOT EXISTS theme_embedding REAL[]`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_q_subcat ON questions(category, subcategory, used)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_q_era ON questions(category, era, used)`);

    await client.query(`
      DELETE FROM questions
      WHERE id NOT IN (
        SELECT MIN(id) FROM questions GROUP BY LOWER(question)
      )
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_q_unique_question
      ON questions(LOWER(question))
    `);

    console.log('✅ DB schema ready');
  } finally {
    client.release();
  }
}

async function backfillThemeEmbeddings() {
  const missing = await pool.query(`
    SELECT id, question FROM questions
    WHERE theme_embedding IS NULL
    ORDER BY id
  `);
  if (!missing.rows.length) {
    console.log('[theme-dedupe] semantic ledger already complete.');
    return 0;
  }

  let updated = 0;
  const batchSize = 100;
  for (let i = 0; i < missing.rows.length; i += batchSize) {
    const batch = missing.rows.slice(i, i + batchSize);
    const vectors = await embedTexts(batch.map(row => row.question));
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (let j = 0; j < batch.length; j++) {
        if (!vectors[j]) continue;
        await client.query('UPDATE questions SET theme_embedding=$1 WHERE id=$2', [vectors[j], batch[j].id]);
        updated += 1;
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  console.log(`[theme-dedupe] embedded ${updated} historical questions for permanent theme memory.`);
  return updated;
}

// ── Stats ─────────────────────────────────────────────────────────────────────
async function getUnusedCount() {
  const r = await pool.query('SELECT COUNT(*) FROM questions WHERE used = FALSE');
  return parseInt(r.rows[0].count);
}

const MIN_PER_CATEGORY = 50;
async function getLowCategories() {
  const r = await pool.query(`
    SELECT category, COUNT(*) FILTER (WHERE used = FALSE) as available
    FROM questions
    GROUP BY category
    HAVING COUNT(*) FILTER (WHERE used = FALSE) < $1
  `, [MIN_PER_CATEGORY]);
  return r.rows;
}

async function getBankStats() {
  const r = await pool.query(`
    SELECT
      category,
      COUNT(*) FILTER (WHERE used = FALSE) AS available,
      COUNT(*) FILTER (WHERE used = TRUE)  AS used_count,
      COUNT(*) FILTER (WHERE used = FALSE AND is_pie = FALSE) AS regular,
      COUNT(*) FILTER (WHERE used = FALSE AND is_pie = TRUE)  AS pie
    FROM questions
    GROUP BY category
    ORDER BY category
  `);
  const total = await getUnusedCount();
  return { byCategory: r.rows, total };
}

// ── Game queries ──────────────────────────────────────────────────────────────
async function getTwoCategoryOptions(ownedCategories = []) {
  const r = await pool.query(`
    SELECT category
    FROM questions
    WHERE used = FALSE
      AND ($1::text[] IS NULL OR category != ALL($1::text[]))
    GROUP BY category
    HAVING COUNT(*) > 0
    ORDER BY RANDOM()
    LIMIT 2
  `, [ownedCategories.length > 0 ? ownedCategories : null]);

  if (r.rows.length < 2) {
    const fallback = await pool.query(`
      SELECT category
      FROM questions
      WHERE used = FALSE
      GROUP BY category
      HAVING COUNT(*) > 0
      ORDER BY RANDOM()
      LIMIT 2
    `);
    return fallback.rows.map(row => row.category);
  }
  return r.rows.map(row => row.category);
}

async function getQuestionCandidate(category, isPie = false, eraTarget = null, excludeSubcats = [], excludedIds = []) {
  let eraClause = '';
  let params = [category, isPie];

  if (eraTarget === 'teen') eraClause = "AND era = 'teen'";
  else if (eraTarget === 'older') eraClause = "AND era != 'teen'";

  let subcatClause = '';
  if (excludeSubcats.length > 0) {
    subcatClause = `AND subcategory != ALL($${params.length + 1}::text[])`;
    params.push(excludeSubcats);
  }

  const skipClause = `AND id != ALL($${params.length + 1}::integer[])`;
  params.push(excludedIds);

  const r = await pool.query(`
    SELECT id, category, question, answer, is_pie, canadian, subcategory, era
    FROM questions
    WHERE category = $1
      AND used = FALSE
      AND is_pie = $2
      ${eraClause}
      ${subcatClause}
      ${skipClause}
    ORDER BY RANDOM()
    LIMIT 1
  `, params);

  if (!r.rows[0] && excludeSubcats.length > 0) {
    const fallback = await pool.query(`
      SELECT id, category, question, answer, is_pie, canadian, subcategory, era
      FROM questions
      WHERE category = $1
        AND used = FALSE
        AND is_pie = $2
        ${eraClause}
        AND id != ALL($3::integer[])
      ORDER BY RANDOM()
      LIMIT 1
    `, [category, isPie, excludedIds]);
    if (fallback.rows[0]) return fallback.rows[0];
  }

  if (!r.rows[0]) {
    const final = await pool.query(`
      SELECT id, category, question, answer, is_pie, canadian, subcategory, era
      FROM questions
      WHERE category = $1
        AND used = FALSE
        AND is_pie = $2
        AND id != ALL($3::integer[])
      ORDER BY RANDOM()
      LIMIT 1
    `, [category, isPie, excludedIds]);
    return final.rows[0] || null;
  }

  return r.rows[0];
}

// Skip blocked legacy questions without deleting or marking bank entries used.
async function getQuestion(category, isPie = false, eraTarget = null, excludeSubcats = []) {
  const excludedIds = [];
  while (true) {
    const question = await getQuestionCandidate(category, isPie, eraTarget, excludeSubcats, excludedIds);
    if (!question || !asksForMemeName(question)) return question;
    excludedIds.push(question.id);
  }
}

async function markUsed(questionId) {
  await pool.query(
    'UPDATE questions SET used = TRUE, used_at = NOW() WHERE id = $1',
    [questionId]
  );
}

async function hasPieQuestion(category) {
  const r = await pool.query(
    'SELECT 1 FROM questions WHERE category=$1 AND is_pie=TRUE AND used=FALSE LIMIT 1',
    [category]
  );
  return r.rows.length > 0;
}

// ── Admin queries ─────────────────────────────────────────────────────────────
async function getAdminByUsername(username) {
  const r = await pool.query('SELECT * FROM admins WHERE username = $1', [username]);
  return r.rows[0] || null;
}

async function createAdmin(username, passwordHash) {
  await pool.query(
    'INSERT INTO admins (username, password_hash) VALUES ($1, $2) ON CONFLICT (username) DO NOTHING',
    [username, passwordHash]
  );
}

async function listQuestions({ page = 1, limit = 50, category, used, search, isPie } = {}) {
  const conditions = [];
  const params = [];
  let i = 1;

  if (category)           { conditions.push(`category = $${i++}`); params.push(category); }
  if (used !== undefined) { conditions.push(`used = $${i++}`); params.push(used); }
  if (isPie !== undefined){ conditions.push(`is_pie = $${i++}`); params.push(isPie); }
  if (search)             { conditions.push(`(question ILIKE $${i} OR answer ILIKE $${i})`); params.push(`%${search}%`); i++; }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const offset = (page - 1) * limit;

  const [rows, countRow] = await Promise.all([
    pool.query(`SELECT * FROM questions ${where} ORDER BY created_at DESC LIMIT $${i} OFFSET $${i+1}`, [...params, limit, offset]),
    pool.query(`SELECT COUNT(*) FROM questions ${where}`, params),
  ]);

  return {
    questions: rows.rows,
    total: parseInt(countRow.rows[0].count),
    page,
    totalPages: Math.ceil(parseInt(countRow.rows[0].count) / limit),
  };
}

async function insertQuestions(questions) {
  if (!questions.length) return 0;

  // Theme-level duplicate protection: compare every proposed question to the
  // permanent semantic ledger, including already-used/retired questions. This
  // prevents a topic from returning through a different angle or answer.
  const vectors = await embedTexts(questions.map(q => q.question));
  const existingRows = await pool.query(`
    SELECT id, question, theme_embedding
    FROM questions
    WHERE theme_embedding IS NOT NULL
  `);
  const semanticLedger = existingRows.rows
    .filter(row => Array.isArray(row.theme_embedding))
    .map(row => ({ id: row.id, question: row.question, vector: row.theme_embedding.map(Number) }));

  const client = await pool.connect();
  let inserted = 0;
  try {
    await client.query('BEGIN');
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const vector = vectors[i];
      if (!vector) {
        console.warn('[theme-dedupe] rejected question because no semantic embedding was returned.');
        continue;
      }

      let best = null;
      for (const prior of semanticLedger) {
        const similarity = cosineSimilarity(vector, prior.vector);
        if (!best || similarity > best.similarity) best = { ...prior, similarity };
      }

      if (best && best.similarity >= THEME_SIMILARITY_THRESHOLD) {
        console.log(
          `[theme-dedupe] rejected repeated theme (${best.similarity.toFixed(3)}): ` +
          `"${q.question}" ~ "${best.question}"`
        );
        continue;
      }

      const r = await client.query(
        `INSERT INTO questions (category, question, answer, is_pie, canadian, subcategory, era, theme_embedding)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (LOWER(question)) DO NOTHING`,
        [q.category, q.question, q.answer, q.is_pie || false, q.canadian || false,
         q.subcategory || 'untagged', q.era || 'millennial', vector]
      );
      inserted += r.rowCount;
      if (r.rowCount) semanticLedger.push({ id: null, question: q.question, vector });
    }
    await client.query('COMMIT');
    return inserted;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function deleteQuestion(id) {
  await pool.query('DELETE FROM questions WHERE id = $1', [id]);
}

async function updateQuestion(id, fields) {
  const { question, answer, category, is_pie, canadian } = fields;
  await pool.query(
    `UPDATE questions SET question=$1, answer=$2, category=$3, is_pie=$4, canadian=$5, theme_embedding=NULL WHERE id=$6`,
    [question, answer, category, is_pie, canadian, id]
  );
}

async function logRefill(before, added, status = 'success') {
  await pool.query(
    `INSERT INTO refill_log (bank_count_before, questions_added, status) VALUES ($1,$2,$3)`,
    [before, added, status]
  );
}

async function getRefillLog() {
  const r = await pool.query('SELECT * FROM refill_log ORDER BY triggered_at DESC LIMIT 20');
  return r.rows;
}

module.exports = {
  pool, initDB, backfillThemeEmbeddings, CATEGORIES,
  getUnusedCount, getBankStats, getLowCategories,
  getTwoCategoryOptions, getQuestion, markUsed, hasPieQuestion,
  getAdminByUsername, createAdmin,
  listQuestions, insertQuestions, deleteQuestion, updateQuestion,
  logRefill, getRefillLog,
};
