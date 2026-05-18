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
  'Sports & Video Games',
  'Pop Culture',
];

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

    console.log('✅ DB schema ready');
  } finally {
    client.release();
  }
}

// ── Stats ─────────────────────────────────────────────────────────────────────
async function getUnusedCount() {
  const r = await pool.query('SELECT COUNT(*) FROM questions WHERE used = FALSE');
  return parseInt(r.rows[0].count);
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

// Returns 2 random category names that have available questions, excluding owned wedge categories
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

  // If not enough categories after exclusion, fall back without exclusion
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

// Pull a single unused question for a category (regular or pie)
async function getQuestion(category, isPie = false) {
  const r = await pool.query(`
    SELECT id, category, question, answer, is_pie, canadian
    FROM questions
    WHERE category = $1
      AND used = FALSE
      AND is_pie = $2
    ORDER BY RANDOM()
    LIMIT 1
  `, [category, isPie]);
  return r.rows[0] || null;
}

// Mark question as used (permanently consumed)
async function markUsed(questionId) {
  await pool.query(
    'UPDATE questions SET used = TRUE, used_at = NOW() WHERE id = $1',
    [questionId]
  );
}

// Check whether a pie question is available for this category
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

  if (category)          { conditions.push(`category = $${i++}`);               params.push(category); }
  if (used !== undefined) { conditions.push(`used = $${i++}`);                   params.push(used); }
  if (isPie !== undefined){ conditions.push(`is_pie = $${i++}`);                 params.push(isPie); }
  if (search)            { conditions.push(`(question ILIKE $${i} OR answer ILIKE $${i})`); params.push(`%${search}%`); i++; }

  const where  = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const offset = (page - 1) * limit;

  const [rows, countRow] = await Promise.all([
    pool.query(`SELECT * FROM questions ${where} ORDER BY created_at DESC LIMIT $${i} OFFSET $${i+1}`, [...params, limit, offset]),
    pool.query(`SELECT COUNT(*) FROM questions ${where}`, params),
  ]);

  return {
    questions:  rows.rows,
    total:      parseInt(countRow.rows[0].count),
    page,
    totalPages: Math.ceil(parseInt(countRow.rows[0].count) / limit),
  };
}

async function insertQuestions(questions) {
  if (!questions.length) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const q of questions) {
      await client.query(
        `INSERT INTO questions (category, question, answer, is_pie, canadian)
         VALUES ($1, $2, $3, $4, $5)`,
        [q.category, q.question, q.answer, q.is_pie || false, q.canadian || false]
      );
    }
    await client.query('COMMIT');
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
    `UPDATE questions SET question=$1, answer=$2, category=$3, is_pie=$4, canadian=$5 WHERE id=$6`,
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
  pool, initDB, CATEGORIES,
  getUnusedCount, getBankStats,
  getTwoCategoryOptions, getQuestion, markUsed, hasPieQuestion,
  getAdminByUsername, createAdmin,
  listQuestions, insertQuestions, deleteQuestion, updateQuestion,
  logRefill, getRefillLog,
};
