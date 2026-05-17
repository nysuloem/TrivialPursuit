const OpenAI = require('openai');
const { insertQuestions, logRefill, getUnusedCount, CATEGORIES } = require('./db');

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const REFILL_AMOUNT = parseInt(process.env.REFILL_AMOUNT || '250');
const THRESHOLD     = parseInt(process.env.LOW_QUESTION_THRESHOLD || '250');

let isRefilling = false;

// How many of each category + type to generate
const DISTRIBUTION = {
  // [category]: { regular, pie }
  'Geography':              { regular: 7, pie: 1 },
  'Entertainment & Music':  { regular: 9, pie: 1 },
  'History':                { regular: 7, pie: 1 },
  'Science & Nature':       { regular: 7, pie: 1 },
  'Sports & Video Games':   { regular: 9, pie: 1 },
  'Current Events & Trends':{ regular: 9, pie: 1 },
};
// Total per batch: ~48 regular + 6 pie ≈ 54 per Claude call
// We run ~5 calls to get to 250+

const SYSTEM_PROMPT = `You are generating trivia questions for a Trivial Pursuit-style game played by Canadian teenagers (ages 13–18) and their parents (Boomers and Gen X, ages 40–60).

RULES:
- Questions must be written in TRUE Trivial Pursuit style — they are longer, richer, and more interesting than simple one-liners
- A good Trivial Pursuit question gives CONTEXT before asking — it teaches you something even if you get it wrong
- Example of BAD question: "What year did the Berlin Wall fall?" 
- Example of GOOD question: "After nearly three decades of dividing East and West Germany and becoming the defining symbol of the Cold War, in what year did the Berlin Wall finally come down?"
- Questions should be 2-3 sentences long — set the scene, then ask
- 90% of questions should be about GLOBAL topics — not Canadian
- Only 10% should be specifically Canadian
- Pie questions are HARDER — require a very precise answer (exact year, exact number, exact name) that only someone who really knows their stuff would get
- Answers must be concise and unambiguous — one clear correct answer
- No duplicate questions

GENERATIONAL MIX — this is a family game, so spread questions across generations:
- ~50% teen-friendly (2015–2025): TikTok, streaming, Gen Z pop culture, recent gaming, current music artists, social media, recent sports
- ~30% Millennial/Gen X (1980–2010): classic video games, 90s/2000s TV and music, early internet, iconic movies, classic sports moments
- ~20% Boomer-friendly (1960–1985): classic rock, vintage TV shows, historical pop culture, 70s/80s sports legends

ENTERTAINMENT & MUSIC CATEGORY must include a good mix of:
- Music (all eras — Taylor Swift AND The Beatles AND 90s hip hop AND classic rock)
- TV shows (Netflix, HBO, classic sitcoms, reality TV, animated shows, streaming originals)
- Movies (blockbusters, classics, recent releases)
- Celebrities and pop culture moments

OUTPUT FORMAT: Respond ONLY with a valid JSON array. No markdown, no explanation, no backticks.
Each object: { "category": "...", "question": "...", "answer": "...", "is_pie": false, "canadian": false }`;

function buildPrompt(batchNum) {
  const catInstructions = Object.entries(DISTRIBUTION)
    .map(([cat, counts]) =>
      `- "${cat}": ${counts.regular} regular questions + ${counts.pie} pie question (harder)`
    ).join('\n');

  return `Generate trivia questions for batch ${batchNum}. Make sure these are DIFFERENT from previous batches.

Generate exactly this distribution:
${catInstructions}

Remember:
- Pie questions: harder but single-answer — one precise fact (exact year, record, name). NOT multi-part.
- Regular questions: Trivial Pursuit difficulty — specific but answerable by a smart teen OR their parent
- 90% global, 10% Canadian
- Generational mix: ~50% recent (2015–2025), ~30% Gen X/Millennial (1980–2010), ~20% Boomer (1960–1985)
- Entertainment & Music must cover: TV shows (classic AND streaming), movies, music across all eras, celebrities
- Sports & Video Games must cover: classic sports legends AND recent stars AND video games (retro AND modern)
- Mark canadian:true only if the question is specifically about Canada

Respond with ONLY the JSON array.`;
}

async function generateBatch(batchNum) {
  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 8000,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user',   content: buildPrompt(batchNum) },
    ],
    response_format: { type: 'json_object' },
  });

  const text = response.choices[0]?.message?.content || '';

  // GPT with json_object mode always wraps in an object — unwrap
  const obj = JSON.parse(text);
  let parsed;
  if (Array.isArray(obj)) {
    parsed = obj;
  } else {
    // Find the first array value in the object regardless of key name
    const arrays = Object.values(obj).filter(v => Array.isArray(v));
    parsed = arrays.length > 0 ? arrays[0] : [];
  }

  // Loose validation — just need category, question, answer
  return parsed
    .filter(q => q && q.category && q.question && q.answer && CATEGORIES.includes(q.category))
    .map(q => ({
      category: q.category,
      question: q.question,
      answer: q.answer,
      is_pie: q.is_pie === true,
      canadian: q.canadian === true,
    }));
}

async function refillBank() {
  if (isRefilling) {
    console.log('⏳ Refill already in progress, skipping');
    return;
  }

  isRefilling = true;
  const before = await getUnusedCount();
  console.log(`🔄 Starting refill — bank has ${before} questions, target: ${REFILL_AMOUNT} new`);

  let totalAdded = 0;
  const batchesNeeded = Math.ceil(REFILL_AMOUNT / 50); // ~50 per Claude call

  try {
    for (let i = 1; i <= batchesNeeded; i++) {
      console.log(`  Generating batch ${i}/${batchesNeeded}...`);
      const questions = await generateBatch(i);
      await insertQuestions(questions);
      totalAdded += questions.length;
      console.log(`  ✅ Batch ${i}: added ${questions.length} questions (total so far: ${totalAdded})`);

      // Small delay between batches to be kind to the API
      if (i < batchesNeeded) await new Promise(r => setTimeout(r, 1000));
    }

    await logRefill(before, totalAdded, 'success');
    const after = await getUnusedCount();
    console.log(`✅ Refill complete — bank now has ${after} questions (+${totalAdded})`);
  } catch (err) {
    console.error('❌ Refill failed:', err.message);
    await logRefill(before, totalAdded, 'error: ' + err.message);
  } finally {
    isRefilling = false;
  }
}

// Called after every question is served — checks threshold
async function checkAndRefillIfNeeded() {
  if (isRefilling) return;
  const count = await getUnusedCount();
  if (count < THRESHOLD) {
    console.log(`⚠️  Bank below threshold (${count} < ${THRESHOLD}) — triggering background refill`);
    refillBank(); // fire and forget
  }
}

module.exports = { refillBank, checkAndRefillIfNeeded, isRefilling: () => isRefilling };
