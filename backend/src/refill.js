const OpenAI = require('openai');
const { insertQuestions, logRefill, getUnusedCount, getLowCategories, CATEGORIES } = require('./db');

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const REFILL_AMOUNT      = parseInt(process.env.REFILL_AMOUNT || '250');
const THRESHOLD          = parseInt(process.env.LOW_QUESTION_THRESHOLD || '250');
const MIN_PER_CATEGORY   = 50; // refill a category if it drops below this

let isRefilling = false;

// Per-batch distribution
const DISTRIBUTION = {
  'Geography':           { regular: 8,  pie: 1 },
  'TV, Movies & Music':  { regular: 10, pie: 1 },
  'History':             { regular: 8,  pie: 1 },
  'Science & Nature':    { regular: 8,  pie: 1 },
  'Sports & Video Games':{ regular: 10, pie: 1 },
  'Pop Culture':         { regular: 10, pie: 1 },
};

const SYSTEM_PROMPT = `You are writing questions for a Trivial Pursuit board game played by Canadian families — teenagers (13–18) and their Boomer/Gen X parents (40–60).

━━━ THE MOST IMPORTANT RULE: WRITE LIKE TRIVIAL PURSUIT ━━━

Study these real Trivial Pursuit examples and match this exact style:

EXAMPLE 1 (Geography):
Q: "This landlocked African nation was once known as Rhodesia and changed its name after gaining independence — what is it called today?"
A: Zimbabwe

EXAMPLE 2 (TV, Movies & Music):
Q: "She played a nervous substitute teacher on Seinfeld, provided the voice of Phoebe on Friends, and later won an Emmy for her role in The Crown — who is this British actress?"
A: Helen Mirren (accept: Kristin Davis or verify — use a real example)

EXAMPLE 3 (History):
Q: "Known as the 'War to End All Wars,' this global conflict began after the assassination of Archduke Franz Ferdinand and claimed over 17 million lives — by what simpler name do we know it?"
A: World War I (or The Great War)

EXAMPLE 4 (Pop Culture):
Q: "This Norwegian streamer became one of the most followed people on Twitch, known for his Fortnite skills and collaborations with Drake — what is his name?"
A: Tyler 'Ninja' Blevins

━━━ RULES ━━━

UNIQUENESS — Critical:
- Each question must be about a completely DIFFERENT subject
- Never two questions about the same person, show, film, song, or event in one batch
- Spread across as many different topics as possible

QUESTION STYLE:
- 2-3 sentences: give interesting context or a fun fact, THEN ask
- Begin with something engaging — a nickname, a record, an ironic fact, a "before they were famous" angle
- MAXIMUM 2 "what year" questions per category — vary with: Who, Which, What was the nickname, How many, Name the, What does X stand for, In which city, Who played

DIFFICULTY:
- Specific enough to be challenging
- Fair enough that a knowledgeable teen or engaged parent could get it
- Pie questions: harder — require exact knowledge (a specific number, name, or record)

CONTENT MIX per batch:
- 35% recent (2015–2025): streaming, gaming, TikTok, current sports, recent films/music
- 35% Gen X/Millennial (1980–2010): 80s/90s TV, classic films, grunge/hip-hop/pop, early internet
- 30% Boomer (1960–1980): classic rock, vintage Hollywood, 70s/80s sports legends, historic TV

TV, MOVIES & MUSIC must include ALL eras — classic rock legends, 80s/90s blockbusters, 2000s TV hits, AND recent streaming shows. Never just recent pop stars.

GEOGRAPHY: Go beyond capitals — ask about rivers, records, borders, nicknames, colonial history, natural wonders.

HISTORY: Ask about causes, consequences, nicknames, treaties, firsts — not just dates.

SCIENCE & NATURE: Mix biology, space, tech, inventions, human body, animal kingdom, AI, recent discoveries.

SPORTS & VIDEO GAMES: Cover classic sports legends, recent champions, iconic video game characters, gaming records, esports.

POP CULTURE: Memes, viral moments, TikTok trends, reality TV, celebrity drama, influencers, internet firsts, Gen Z slang, YouTube milestones.

OTHER RULES:
- 90% global, maximum 10% Canadian
- Answers must be short and unambiguous — one clear answer
- No trick questions
- No duplicate topics across questions in the same batch

━━━ OUTPUT ━━━
Respond ONLY with valid JSON — no markdown, no backticks, no explanation:
{ "questions": [ { "category": "...", "question": "...", "answer": "...", "is_pie": false, "canadian": false } ] }`;

function buildPrompt(batchNum, focusCategories = null) {
  let catInstructions;

  if (focusCategories && focusCategories.length > 0) {
    // Targeted refill for low categories
    const perCat = Math.ceil(30 / focusCategories.length);
    catInstructions = focusCategories
      .map(cat => `- "${cat}": ${perCat} regular questions + 1 pie question`)
      .join('\n');
  } else {
    catInstructions = Object.entries(DISTRIBUTION)
      .map(([cat, counts]) =>
        `- "${cat}": ${counts.regular} regular questions + ${counts.pie} pie question`
      ).join('\n');
  }

  return `BATCH ${batchNum} — Generate trivia questions with this exact distribution:

${catInstructions}

REMINDERS FOR THIS BATCH:
- Every question must be about a DIFFERENT subject — no topic repeats within this batch
- Write in Trivial Pursuit style: context first (2-3 sentences), then the question
- Maximum 2 "what year" or "what year did" questions per category
- TV, Movies & Music: spread across Boomer, Gen X/Millennial, AND recent eras
- Pie questions need a very specific, precise answer
- Vary question openers: "Known as...", "Before becoming famous for...", "Despite holding the record for...", "This [actor/musician/athlete]...", "Named after...", etc.

Respond ONLY with: { "questions": [...] }`;
}

async function generateBatch(batchNum, focusCategories = null) {
  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 8000,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user',   content: buildPrompt(batchNum, focusCategories) },
    ],
    response_format: { type: 'json_object' },
  });

  const text = response.choices[0]?.message?.content || '';
  const obj  = JSON.parse(text);

  let parsed;
  if (Array.isArray(obj)) {
    parsed = obj;
  } else {
    const arrays = Object.values(obj).filter(v => Array.isArray(v));
    parsed = arrays.length > 0 ? arrays[0] : [];
  }

  return parsed
    .filter(q => q && q.category && q.question && q.answer && CATEGORIES.includes(q.category))
    .map(q => ({
      category: q.category,
      question: String(q.question).trim(),
      answer:   String(q.answer).trim(),
      is_pie:   q.is_pie === true,
      canadian: q.canadian === true,
    }));
}

async function refillBank(focusCategories = null) {
  if (isRefilling) {
    console.log('⏳ Refill already in progress, skipping');
    return;
  }

  isRefilling = true;
  const before = await getUnusedCount();
  const target = focusCategories ? 150 : REFILL_AMOUNT;
  const batchesNeeded = Math.ceil(target / 50);

  console.log(`🔄 Starting refill — bank: ${before}, target: +${target}${focusCategories ? ` (focused: ${focusCategories.join(', ')})` : ''}`);

  let totalAdded = 0;
  try {
    for (let i = 1; i <= batchesNeeded; i++) {
      console.log(`  Generating batch ${i}/${batchesNeeded}...`);
      const questions = await generateBatch(i, focusCategories);
      const inserted  = await insertQuestions(questions);
      totalAdded += inserted;
      console.log(`  ✅ Batch ${i}: ${inserted} inserted (${questions.length - inserted} duplicates skipped)`);
      if (i < batchesNeeded) await new Promise(r => setTimeout(r, 1000));
    }

    await logRefill(before, totalAdded, 'success');
    const after = await getUnusedCount();
    console.log(`✅ Refill complete — bank now has ${after} (+${totalAdded})`);
  } catch (err) {
    console.error('❌ Refill failed:', err.message);
    await logRefill(before, totalAdded, 'error: ' + err.message);
  } finally {
    isRefilling = false;
  }
}

// Called after every question is served
// Checks both total count AND per-category low counts
async function checkAndRefillIfNeeded() {
  if (isRefilling) return;

  // Check total
  const total = await getUnusedCount();
  if (total < THRESHOLD) {
    console.log(`⚠️ Total bank low (${total}) — triggering full refill`);
    refillBank();
    return;
  }

  // Check per-category
  const lowCats = await getLowCategories();
  if (lowCats.length > 0) {
    const names = lowCats.map(r => r.category);
    console.log(`⚠️ Low categories: ${names.join(', ')} — triggering targeted refill`);
    refillBank(names);
  }
}

module.exports = { refillBank, checkAndRefillIfNeeded, isRefilling: () => isRefilling };
