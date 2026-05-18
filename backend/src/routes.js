const express = require('express');
const router  = express.Router();
const db      = require('./db');
const { requireAuth, login } = require('./auth');
const { checkAndRefillIfNeeded, refillBank, isRefilling } = require('./refill');

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
  const { text, voice = 'nova' } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });
  if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: 'TTS not configured — set OPENAI_API_KEY' });

  const safeVoice = VALID_VOICES.includes(voice) ? voice : 'nova';

  try {
    const openai = getOpenAI();
    const mp3 = await openai.audio.speech.create({
      model: 'tts-1',
      voice: safeVoice,
      input: text.slice(0, 4096),
      speed: 0.95,
    });

    const buffer = Buffer.from(await mp3.arrayBuffer());
    res.set({
      'Content-Type':   'audio/mpeg',
      'Content-Length': buffer.length,
      'Cache-Control':  'no-cache',
    });
    res.send(buffer);
  } catch (err) {
    console.error('TTS error:', err.message);
    res.status(500).json({ error: 'TTS failed: ' + err.message });
  }
});

// ── Game API ──────────────────────────────────────────────────────────────────

// POST /api/game/categories — returns 2 random category options, excluding owned wedges
// Body: { ownedCategories: [...] }
router.post('/game/categories', async (req, res) => {
  try {
    const { ownedCategories = [] } = req.body;
    const cats = await db.getTwoCategoryOptions(ownedCategories);
    if (cats.length < 1) {
      return res.status(503).json({ error: 'Not enough questions in bank', bankEmpty: true });
    }

    // 20% chance one of the two options is "Roll Again"
    // Roll Again replaces the second option
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

// GET /api/game/all-categories — returns all categories (for final question opponent pick)
router.get('/game/all-categories', async (req, res) => {
  res.json({ categories: db.CATEGORIES });
});

// POST /api/game/question — get a question for chosen category
// Body: { category, isPie }
router.post('/game/question', async (req, res) => {
  const { category, isPie = false } = req.body;

  if (!category || !db.CATEGORIES.includes(category)) {
    return res.status(400).json({ error: 'Invalid category' });
  }

  try {
    const question = await db.getQuestion(category, isPie);
    if (!question) {
      // Try regular question as fallback if no pie available
      if (isPie) {
        const fallback = await db.getQuestion(category, false);
        if (fallback) {
          return res.json({ question: fallback, fallbackFromPie: true });
        }
      }
      return res.status(404).json({ error: 'No questions available for this category' });
    }

    // Check if a pie question exists for this category (for streak tracking on frontend)
    const pieAvailable = await db.hasPieQuestion(category);

    res.json({ question, pieAvailable });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/game/answer — mark a question as used and trigger refill check
// Body: { questionId }
router.post('/game/answer', async (req, res) => {
  const { questionId } = req.body;
  if (!questionId) return res.status(400).json({ error: 'questionId required' });

  try {
    await db.markUsed(questionId);

    // Fire-and-forget refill check
    checkAndRefillIfNeeded().catch(console.error);

    const count = await db.getUnusedCount();
    res.json({ success: true, bankCount: count });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/game/bank-count — lightweight count check
router.get('/game/bank-count', async (req, res) => {
  try {
    const count = await db.getUnusedCount();
    res.json({ count, low: count < parseInt(process.env.LOW_QUESTION_THRESHOLD || '250') });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Admin API (all protected) ─────────────────────────────────────────────────

// GET /api/admin/stats
router.get('/admin/stats', requireAuth, async (req, res) => {
  try {
    const [stats, refillLog] = await Promise.all([
      db.getBankStats(),
      db.getRefillLog(),
    ]);
    res.json({ stats, refillLog, refilling: isRefilling() });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/admin/questions
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

// POST /api/admin/questions — add one question manually
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

// PUT /api/admin/questions/:id — edit a question
router.put('/admin/questions/:id', requireAuth, async (req, res) => {
  try {
    await db.updateQuestion(parseInt(req.params.id), req.body);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/admin/questions/:id
router.delete('/admin/questions/:id', requireAuth, async (req, res) => {
  try {
    await db.deleteQuestion(parseInt(req.params.id));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/admin/refill — manually trigger AI refill
router.post('/admin/refill', requireAuth, async (req, res) => {
  if (isRefilling()) {
    return res.json({ message: 'Refill already in progress' });
  }
  refillBank().catch(console.error); // fire and forget
  res.json({ message: 'Refill started in background' });
});

// GET /api/admin/categories — list valid categories
router.get('/admin/categories', requireAuth, async (req, res) => {
  res.json({ categories: db.CATEGORIES });
});

module.exports = router;
