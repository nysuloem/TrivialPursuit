require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const { initDB } = require('./db');
const { ensureDefaultAdmin } = require('./auth');
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
    await ensureDefaultAdmin();
    app.listen(PORT, () => {
      console.log(`🚀 Trivia backend running on port ${PORT}`);
      console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (err) {
    console.error('❌ Failed to start:', err);
    process.exit(1);
  }
}

start();
