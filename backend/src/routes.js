const express = require('express');
const router  = express.Router();
const db      = require('./db');
const { requireAuth, login } = require('./auth');
const { generateBatch } = require('./refill');
const manualGeneration = require('./manual-generation');

const VALID_VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];

// Lazy-load OpenAI client so a missing key doesn't crash startup
function getOpenAI() {
  const OpenAI = require('openai');
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

// ── Auth ──────────────────────────────────────────────────────────────────────
router.post('/auth/login', login);

// ── TTS ───────────────────────────────────────────────────────────────────────
router.post('/tts', async (req, res) => {
  const { text, voice = 'nova', announcement = false } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });
  if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: 'TTS not configured — set OPENAI_API_KEY' });

  const safeVoice = VALID_VOICES.includes(voice) ? voice : 'nova';

  try {
    const openai = getOpenAI();
    const mp3 = await openai.audio.speech.create({
      model: announcement === true ? 'gpt-4o-mini-tts' : 'tts-1',
      ...(announcement === true ? {instructions: 'Shout this line joyfully and emphatically like an excited game-show host announcing a big moment. Strong projection, animated intonation and emphasis. Speak exactly the supplied words; no extra words.'} : {}),
      voice: safeVoice,
      input: text.slice(0, 4096),
      speed: 0.95,
    });

    let buffer;
    if (typeof mp3.arrayBuffer === 'function') {
      buffer = Buffer.from(await mp3.arrayBuffer());
    } else if (mp3.body) {
      const chunks = [];
      for await (const chunk of mp3.body) chunks.push(chunk);
      buffer = Buffer.concat(chunks);
    } else {
      buffer = Buffer.from(await mp3.blob().then(b => b.arrayBuffer()));
    }

    res.set({
      'Content-Type':   'audio/mpeg',
      'Content-Length': buffer.length,
      'Cache-Control':  'no-cache',
    });
    res.send(buffer);
  } catch (err) {
    console.error('TTS error:', err.message, err.stack);
    res.status(500).json({ error: 'TTS failed: ' + err.message });
  }
});

// ── Game API ──────────────────────────────────────────────────────────────────

router.post('/game/categories', async (req, res) => {
  try {
    const { ownedCategories = [] } = req.body;
    const cats = await db.getTwoCategoryOptions(ownedCategories);
    if (cats.length < 1) {
      return res.status(503).json({ error: 'Not enough questions in bank', bankEmpty: true });
    }

    const includeRollAgain = Math.random() < 0.20;
    if (includeRollAgain && cats.length >= 1) {
      cats[1] = 'ROLL_AGAIN';
    }

    res.json({ categories: cats });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/game/all-categories', async (req, res) => {
  res.json({ categories: db.CATEGORIES });
});

const recentSubcats = {};
const questionCount = {};

router.post('/game/question', async (req, res) => {
  const { category, isPie = false } = req.body;

  if (!category || !db.CATEGORIES.includes(category)) {
    return res.status(400).json({ error: 'Invalid category' });
  }

  try {
    if (!questionCount[category]) questionCount[category] = 0;
    const eraTarget = (questionCount[category] % 3 === 2) ? 'older' : 'teen';
    questionCount[category]++;

    const excludeSubcats = recentSubcats[category] || [];
    const question = await db.getQuestion(category, isPie, eraTarget, excludeSubcats);
    if (!question) {
      if (isPie) {
        const fallback = await db.getQuestion(category, false);
        if (fallback) {
          return res.json({ question: fallback, fallbackFromPie: true });
        }
      }
      return res.status(404).json({ error: 'No questions available for this category' });
    }

    if (question.subcategory && question.subcategory !== 'general') {
      if (!recentSubcats[category]) recentSubcats[category] = [];
      recentSubcats[category].push(question.subcategory);
      if (recentSubcats[category].length > 2) recentSubcats[category].shift();
    }

    const pieAvailable = await db.hasPieQuestion(category);
    res.json({ question, pieAvailable });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/game/answer', async (req, res) => {
  const { questionId } = req.body;
  if (!questionId) return res.status(400).json({ error: 'questionId required' });

  try {
    await db.markUsed(questionId);


    const count = await db.getUnusedCount();
    res.json({ success: true, bankCount: count });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/game/bank-count', async (req, res) => {
  try {
    const count = await db.getUnusedCount();
    res.json({ count, low: false });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/game/category-counts', async (req, res) => {
  try {
    const result = await db.pool.query(`
      SELECT category, COUNT(*) as count
      FROM questions
      WHERE used = FALSE
      GROUP BY category
      ORDER BY category
    `);
    const counts = {};
    result.rows.forEach(r => { counts[r.category] = parseInt(r.count); });
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    res.json({ counts, total });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Read-only refill status; useful from the game/admin UI and safe to expose.
router.get('/game/category-targets', async (req, res) => {
  try {
    res.json({ counts: (await db.getBankStats()).byCategory, targets: null, refilling: manualGeneration.getStatus().running });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Admin API (all protected) ─────────────────────────────────────────────────

router.get('/admin/stats', requireAuth, async (req, res) => {
  try {
    const [stats, refillLog] = await Promise.all([
      db.getBankStats(),
      db.getRefillLog(),
    ]);
    res.json({ stats, refillLog, refilling: manualGeneration.getStatus().running });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/admin/questions', requireAuth, async (req, res) => {
  try {
    const { page = 1, limit = 50, category, used, search, isPie } = req.query;
    const result = await db.listQuestions({
      page:     parseInt(page),
      limit:    parseInt(limit),
      category: category || undefined,
      used:     used !== undefined ? used === 'true' : undefined,
      isPie:    isPie !== undefined ? isPie === 'true' : undefined,
      search:   search || undefined,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/admin/questions', requireAuth, async (req, res) => {
  const { category, question, answer, is_pie = false, canadian = false } = req.body;
  if (!category || !question || !answer) {
    return res.status(400).json({ error: 'category, question, and answer are required' });
  }
  if (!db.CATEGORIES.includes(category)) {
    return res.status(400).json({ error: 'Invalid category' });
  }
  try {
    await db.insertQuestions([{ category, question, answer, is_pie, canadian }]);
    const count = await db.getUnusedCount();
    res.json({ success: true, bankCount: count });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/admin/questions/:id', requireAuth, async (req, res) => {
  try {
    await db.updateQuestion(parseInt(req.params.id), req.body);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/admin/questions/:id', requireAuth, async (req, res) => {
  try {
    await db.deleteQuestion(parseInt(req.params.id));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/admin/refill', requireAuth, async (req, res) => {
  const requested = req.body?.categories;
  if (!requested || typeof requested !== 'object' || Array.isArray(requested)) {
    return res.status(400).json({ error: 'Provide category-specific quantities.' });
  }
  const entries = Object.entries(requested);
  if (!entries.length || entries.some(([cat, n]) =>
    !db.CATEGORIES.includes(cat) || !Number.isInteger(n) || n < 0 || n > 100
  )) {
    return res.status(400).json({ error: 'Use whole numbers from 0 to 100 for valid categories.' });
  }
  const selected = Object.fromEntries(entries.filter(([, n]) => n > 0));
  if (!Object.keys(selected).length) return res.status(400).json({ error: 'Select at least one category.' });
  if (manualGeneration.getStatus().running) return res.status(409).json({ error: 'Generation already in progress.' });
  manualGeneration.start(selected).catch(err => console.error('[manual-generation]', err));
  res.json({ message: 'Generation started for ' + Object.values(selected).reduce((a,b)=>a+b,0) + ' requested questions.', status: manualGeneration.getStatus() });
});

router.get('/admin/refill/status', requireAuth, (req, res) => {
  res.json(manualGeneration.getStatus());
});

router.get('/admin/categories', requireAuth, async (req, res) => {
  res.json({ categories: db.CATEGORIES });
});

module.exports = router;
