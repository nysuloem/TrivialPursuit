const OpenAI = require('openai');
const { insertQuestions, logRefill, getUnusedCount, CATEGORIES } = require('./db');

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const REFILL_AMOUNT = parseInt(process.env.REFILL_AMOUNT || '250');
const THRESHOLD     = parseInt(process.env.LOW_QUESTION_THRESHOLD || '250');

let isRefilling = false;

// How many of each category + type to generate
const DISTRIBUTION = {
  'Geography':           { regular: 7, pie: 1 },
  'TV, Movies & Music':  { regular: 9, pie: 1 },
  'History':             { regular: 7, pie: 1 },
  'Science & Nature':    { regular: 7, pie: 1 },
  'Sports & Video Games':{ regular: 9, pie: 1 },
  'Pop Culture':         { regular: 9, pie: 1 },
};
// Total per batch: ~48 regular + 6 pie ≈ 54 per Claude call
// We run ~5 calls to get to 250+

const SYSTEM_PROMPT = `You are generating trivia questions for a Trivial Pursuit-style board game played by Canadian families — teenagers (13–18) and their parents (Boomers and Gen X, 40–60).

═══ MOST IMPORTANT RULES ═══

1. EVERY QUESTION MUST BE UNIQUE IN TOPIC
   - Never ask two questions about the same person, show, movie, song, event, or subject
   - Spread across as many different topics as possible
   - If you already wrote about Taylor Swift, don't write another Taylor Swift question
   - Variety is the #1 priority — 50 questions should cover 50 different subjects

2. QUESTIONS MUST BE TRIVIAL PURSUIT STYLE — longer, richer, with context
   - BAD: "What year did Titanic come out?"
   - GOOD: "James Cameron's epic romance about the doomed ocean liner became the highest-grossing film of all time when it was released — what year did it hit theatres?"
   - Questions should give context, colour, or a fun fact BEFORE asking
   - Most questions should be 2-3 sentences

3. STRICT LIMIT: NO MORE THAN 10% OF QUESTIONS CAN BE "WHAT YEAR" QUESTIONS
   - Vary question types: Who, What, Where, Which, How many, Name the, True identity of, What was the nickname, What does X stand for, etc.
   - Ask about names, places, characters, records, firsts, nicknames, facts — not just years

4. DIFFICULTY: Trivial Pursuit level — specific enough to challenge but fair
   - Not too easy ("What colour is the sky?") 
   - Not too obscure (things only experts would know)
   - A smart teenager or an engaged adult should have a fighting chance

═══ CONTENT RULES ═══

- 90% global topics, 10% Canadian maximum
- Pie questions: same style but require a very precise answer — a specific name, number, or record that takes real knowledge

═══ TV, MOVIES & MUSIC — MUST COVER ALL ERAS ═══
This category MUST have strong representation from ALL of these eras:
- Boomer classics: 60s/70s rock, classic Hollywood films, vintage TV (M*A*S*H, All in the Family, Cheers, etc.)
- Gen X/Millennial: 80s/90s music, blockbusters (Die Hard, Home Alone, Jurassic Park), 90s/2000s TV (Friends, Seinfeld, The Office, Breaking Bad)
- Recent: 2020–2025 streaming hits, current music artists, recent blockbusters
- Music must span rock, pop, hip hop, country, R&B across decades — NOT just recent pop stars

═══ GENERATIONAL MIX (apply to ALL categories) ═══
- 40% recent (2015–2025) — streaming, gaming, social media, current events
- 35% Gen X/Millennial (1980–2010) — 80s/90s/2000s culture, classic games, iconic films
- 25% Boomer (1960–1980) — classic rock, vintage TV, historical pop culture, 70s/80s sports

═══ POP CULTURE CATEGORY ═══
Include: viral moments, memes, social media, influencers, TikTok trends, celebrity drama, reality TV, internet culture, viral products, fashion trends, Gen Z slang, YouTube culture

═══ OUTPUT FORMAT ═══
Respond ONLY with a valid JSON object containing a "questions" array. No markdown, no backticks.
Format: { "questions": [ { "category": "...", "question": "...", "answer": "...", "is_pie": false, "canadian": false } ] }`;

function buildPrompt(batchNum) {
  const catInstructions = Object.entries(DISTRIBUTION)
    .map(([cat, counts]) =>
      `- "${cat}": ${counts.regular} regular questions + ${counts.pie} pie question (harder)`
    ).join('\n');

  return `Generate trivia questions for batch ${batchNum}. These MUST be completely different from any previous batch.

Generate exactly this distribution:
${catInstructions}

CRITICAL FOR THIS BATCH:
- Every single question must be about a DIFFERENT topic/person/show/song/event
- NO "what year" questions except maximum 1-2 per category
- Each question needs context (2-3 sentences) before the actual question
- TV, Movies & Music: MUST include Boomer classics, Gen X/Millennial hits, AND recent content — not just recent
- Vary question types: Who, What, Where, Which, How many, Name the, What was the nickname, What does X stand for
- Pie questions: harder, single precise answer, but still 2-3 sentences with context
- 90% global, 10% Canadian max
- Mark canadian:true only if specifically about Canada

Respond with ONLY a JSON object: { "questions": [...] }`;
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
