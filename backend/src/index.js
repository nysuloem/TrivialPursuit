require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const { initDB, insertQuestions } = require('./db');
const { ADDITIONAL_QUESTIONS } = require('./additionalQuestions');
const { RECENT_QUESTIONS } = require('./recentQuestions');
const { ensureDefaultAdmin } = require('./auth');
const { checkCategoryTargets, getCategoryTargetStatus } = require('./category-targets');
const routes  = require('./routes');

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true,
}));
app.use(express.json());

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date() }));

// All routes under /api
app.use('/api', routes);

// Catch-all 404
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

async function start() {
  try {
    await initDB();
    const added=await insertQuestions(ADDITIONAL_QUESTIONS);
    console.log(`📚 Curated expansion pack: ${added} new questions inserted (${ADDITIONAL_QUESTIONS.length} checked)`);
    const recentAdded=await insertQuestions(RECENT_QUESTIONS);
    console.log(`📰 Fresh current-events pack: ${recentAdded} new questions inserted (${RECENT_QUESTIONS.length} checked)`);
    await ensureDefaultAdmin();
    app.listen(PORT, async () => {
      console.log(`🚀 Trivia backend running on port ${PORT}`);
      console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);

      // Start a bounded background pass immediately, then re-check every five
      // minutes. Each pass and each process has hard generation caps, while the
      // DB counts prevent categories from intentionally exceeding their target.
      try {
        const status = await getCategoryTargetStatus();
        console.log('🎯 Category targets:', JSON.stringify(status));
      } catch (err) {
        console.warn('Could not read category targets at startup:', err.message);
      }

      checkCategoryTargets().catch(console.error);
      const intervalMs = parseInt(process.env.CATEGORY_REFILL_INTERVAL_MS || '300000', 10);
      setInterval(() => checkCategoryTargets().catch(console.error), intervalMs).unref();
    });
  } catch (err) {
    console.error('❌ Failed to start:', err);
    process.exit(1);
  }
}

start();
