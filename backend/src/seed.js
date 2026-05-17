// Run with: node src/seed.js
// Seeds the initial question bank with ~300 questions
require('dotenv').config();
const { initDB, insertQuestions, getUnusedCount } = require('./db');
const { refillBank } = require('./refill');

async function seed() {
  console.log('🌱 Seeding initial question bank via Claude AI...');
  await initDB();

  const existing = await getUnusedCount();
  if (existing > 0) {
    console.log(`ℹ️  Bank already has ${existing} questions. Skipping seed.`);
    console.log('   If you want to re-seed, clear the questions table first.');
    process.exit(0);
  }

  // Use the same refill mechanism to seed
  await refillBank();

  const final = await getUnusedCount();
  console.log(`✅ Seed complete. Bank has ${final} questions.`);
  process.exit(0);
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
