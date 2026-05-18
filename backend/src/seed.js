// Run with: node src/seed.js
// Seeds the initial question bank with ~1000 questions
require('dotenv').config();
const { initDB, getUnusedCount } = require('./db');
const { refillBank } = require('./refill');

const TARGET = 1000;

async function seed() {
  console.log(`🌱 Seeding question bank — target: ${TARGET} questions`);
  await initDB();

  const existing = await getUnusedCount();
  console.log(`ℹ️  Bank currently has ${existing} questions`);

  const needed = TARGET - existing;
  if (needed <= 0) {
    console.log('✅ Bank already at target. Nothing to do.');
    process.exit(0);
  }

  console.log(`📝 Generating ${needed} more questions in batches of ~50...`);

  // Run refill in batches until we hit the target
  const batches = Math.ceil(needed / 50);
  let added = 0;

  const { insertQuestions } = require('./db');
  const { refillBank: rb } = require('./refill');

  // Use the refill mechanism — it handles batching
  // Override REFILL_AMOUNT temporarily via env
  process.env.REFILL_AMOUNT = String(needed);
  await rb();

  const final = await getUnusedCount();
  console.log(`✅ Seed complete. Bank has ${final} questions.`);
  process.exit(0);
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
