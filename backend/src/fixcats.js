require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function fixCategories() {
  const client = await pool.connect();
  try {
    // Fix TV, Movies & Music variations
    const r1 = await client.query(`
      UPDATE questions 
      SET category = 'TV, Movies & Music'
      WHERE category != 'TV, Movies & Music'
        AND (
          category ILIKE '%entertainment%'
          OR category ILIKE '%tv%'
          OR category ILIKE '%movie%'
          OR category ILIKE '%music%'
          OR category ILIKE '%film%'
        )
    `);
    console.log('TV, Movies & Music fixed:', r1.rowCount, 'rows');

    // Fix Pop Culture variations
    const r2 = await client.query(`
      UPDATE questions 
      SET category = 'Pop Culture'
      WHERE category != 'Pop Culture'
        AND (
          category ILIKE '%pop culture%'
          OR category ILIKE '%current event%'
          OR category ILIKE '%trend%'
          OR category ILIKE '%pop%'
        )
    `);
    console.log('Pop Culture fixed:', r2.rowCount, 'rows');

    // Fix Sports & Video Games → Sports & Games
    const r3 = await client.query(`
      UPDATE questions 
      SET category = 'Sports & Games'
      WHERE category = 'Sports & Video Games'
    `);
    console.log('Sports & Games fixed:', r3.rowCount, 'rows');
    const r3 = await client.query(`
      SELECT category, COUNT(*) as count 
      FROM questions 
      WHERE used = FALSE
      GROUP BY category 
      ORDER BY category
    `);
    console.log('\nCurrent bank by category:');
    r3.rows.forEach(r => console.log(' ', r.category, ':', r.count));

  } finally {
    client.release();
    await pool.end();
  }
}

fixCategories().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
