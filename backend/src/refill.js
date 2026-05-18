const OpenAI = require('openai');
const { insertQuestions, logRefill, getUnusedCount, getLowCategories, CATEGORIES } = require('./db');

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const REFILL_AMOUNT      = parseInt(process.env.REFILL_AMOUNT || '250');
const THRESHOLD          = parseInt(process.env.LOW_QUESTION_THRESHOLD || '250');
const MIN_PER_CATEGORY   = 50; // refill a category if it drops below this

let isRefilling = false;

// Per-batch distribution
const DISTRIBUTION = {
  'Geography':        { regular: 8,  pie: 1 },
  'TV, Movies & Music':{ regular: 10, pie: 1 },
  'History':          { regular: 8,  pie: 1 },
  'Science & Nature': { regular: 8,  pie: 1 },
  'Sports & Games':   { regular: 10, pie: 1 },
  'Pop Culture':      { regular: 10, pie: 1 },
};

const SYSTEM_PROMPT = `You are writing questions for a Trivial Pursuit board game played by Canadian families — teenagers (13–18) and their Boomer/Gen X parents (40–60).

━━━ THE MOST IMPORTANT RULE: WRITE LIKE TRIVIAL PURSUIT ━━━

Study these real Trivial Pursuit examples and match this exact style:

EXAMPLE 1 (Geography):
Q: "This landlocked African nation was once known as Rhodesia and changed its name after gaining independence — what is it called today?"
A: Zimbabwe

EXAMPLE 2 (TV, Movies & Music):
Q: "She played a nervous substitute teacher on Seinfeld, provided the voice of Phoebe on Friends, and later won an Emmy for her role in The Crown — who is this British actress?"
A: Helen Mirren

EXAMPLE 3 (History):
Q: "Known as the 'War to End All Wars,' this global conflict began after the assassination of Archduke Franz Ferdinand and claimed over 17 million lives — by what simpler name do we know it?"
A: World War I (or The Great War)

EXAMPLE 4 (Pop Culture):
Q: "This Norwegian streamer became one of the most followed people on Twitch, known for his Fortnite skills and collaborations with Drake — what is his name?"
A: Tyler 'Ninja' Blevins

━━━ RULES ━━━

CRITICAL — ANSWER MUST NOT APPEAR IN THE QUESTION:
- Never include the answer word or a close variant of it in the question text
- BAD: "The Mongol Empire was the largest contiguous land empire — who founded the Mongol Empire?" (answer: Genghis Khan — 'Mongol' appears twice)
- GOOD: "At its peak it stretched from the Pacific Ocean to Eastern Europe, making it the largest contiguous land empire in history — who founded it?"
- BAD: "LeBron James holds the NBA scoring record — how many points has LeBron scored?" (answer: LeBron — name appears twice)
- GOOD: "He surpassed Kareem Abdul-Jabbar's long-standing record in February 2023 to become the NBA's all-time leading scorer — who is he?"
- Read every question before submitting: if the answer word appears in the question, rewrite it

UNIQUENESS & DIVERSITY — Critical for ALL categories:
- Each question must be about a completely DIFFERENT subject
- Never write two questions in the same batch that involve the same person, place, show, team, platform, or topic
- NEVER cluster sub-topics — if you wrote about TikTok, the next Pop Culture question cannot be about any other social media platform
- Think of each batch like a well-shuffled deck — maximum variety, minimum repetition

CATEGORY-SPECIFIC DIVERSITY REQUIREMENTS:

GEOGRAPHY — rotate across ALL of these, never repeat a type:
Capitals, rivers, mountains, deserts, islands, borders, colonial history, flags, currencies, languages, natural wonders, country nicknames, oceans, treaties, city nicknames

HISTORY — rotate across ALL of these:
Ancient civilizations, medieval era, Age of Exploration, World Wars, Cold War, civil rights, revolutions, assassinations, empires, recent political history (post-2000), space race, pandemics, treaties, famous speeches

TV, MOVIES & MUSIC — rotate across ALL of these, never two of the same type:
Rock bands, solo pop artists, hip hop, country, classical, film directors, animated films, action films, romantic comedies, TV dramas, TV sitcoms, reality TV, documentaries, musicals, streaming originals, award shows — AND span all decades

SCIENCE & NATURE — rotate across ALL of these:
Space/astronomy, human anatomy, chemistry, physics, biology, geology, weather, AI/technology, medicine, animals, plants, ocean life, environmental science, inventions, mathematics

SPORTS & GAMES — rotate across ALL of these, never two from same sport:
Soccer, basketball, hockey, baseball, tennis, golf, boxing, Olympics, Formula 1, cricket, rugby, gymnastics, swimming, track & field, esports, AND board games (Monopoly, Scrabble, Risk, chess), card games (poker, Magic: The Gathering), game shows, puzzles, trivia history

POP CULTURE — rotate across ALL of these, NEVER two social media questions in a row:
Current news events teens care about, celebrity relationships and drama, viral internet moments, memes, fashion trends, food trends, YouTube, TikTok, gaming crossovers, award show moments, movie/TV moments that broke the internet, sports moments that went viral, political moments teens noticed, environmental news, technology launches, brand moments (Stanley cups, etc.)
- NO MORE THAN 2 social media platform questions per batch total
- Include at least 3 questions about things that happened in the actual news in 2023-2025

TIMING RULES — Important:
- NEVER use phrases like "as of 2024", "as of this writing", "at the time of writing", "currently", "as of [year]"
- Write questions as timeless facts: instead of "As of 2024, who holds the record..." write "Who holds the all-time record..."
- For recent events, state the year in the question naturally: "In October 2023, Hamas launched..." not "As of 2023..."
- Questions should feel like they were written by a knowledgeable human, not a hedging AI

QUESTION STYLE:
- 2-3 sentences: give interesting context or a fun fact, THEN ask
- Begin with something engaging — a nickname, a record, an ironic fact, a "before they were famous" angle
- MAXIMUM 2 "what year" questions per category — vary with: Who, Which, What was the nickname, How many, Name the, What does X stand for, In which city, Who played
- NEVER end a question with "— what is it?", "— who is this?", "— what are they?" 
- BAD: "This animal is genetically closest to the grey wolf — what is it?"
- GOOD: "Genetically closer to the grey wolf than any other domestic animal, what is the name of the species humans first domesticated for herding and hunting?"

DIFFICULTY:
- Specific enough to be challenging
- Fair enough that a knowledgeable teen or engaged parent could get it
- Pie questions: harder — require exact knowledge (a specific number, name, or record)

CONTENT MIX per batch:
- 35% recent (2015–2025): streaming, gaming, TikTok, current sports, recent films/music
- 35% Gen X/Millennial (1980–2010): 80s/90s TV, classic films, grunge/hip-hop/pop, early internet
- 30% Boomer (1960–1980): classic rock, vintage Hollywood, 70s/80s sports legends, historic TV

TV, MOVIES & MUSIC must include ALL eras with these ratios:
- 40% RECENT (2020-2025): current streaming hits, recent blockbusters, Gen Z artists (Olivia Rodrigo, Sabrina Carpenter, SZA, Bad Bunny, Kendrick, The Weeknd, Taylor Swift, Chappell Roan), K-pop, reality TV
- 30% MILLENNIAL/GEN X (1990-2010): Friends, Seinfeld, The Office, Breaking Bad, Sopranos, 90s hip hop, Britney, NSYNC, Backstreet Boys, Eminem, 2000s blockbusters, grunge
- 30% BOOMER (1960-1990): Beatles, Rolling Stones, Led Zeppelin, ABBA, Fleetwood Mac, classic Hollywood, M*A*S*H, Cheers, All in the Family, 80s pop

SPORTS & GAMES must include:
- At least 4 different sports per batch (NOT the same sport twice)
- At least 2 non-sport games per batch: board games (Monopoly, Scrabble, chess, Risk), card games (poker, blackjack, Magic: The Gathering), game shows, puzzles
- Rotate across athletes from different countries and eras — not just American or Canadian superstars
- Include: soccer/football, tennis, golf, Olympics, F1, boxing, cricket, rugby, baseball, basketball, hockey, gymnastics, swimming, track & field

POP CULTURE — at least 60% of questions must be things a 15-year-old would know:
- TikTok creators, sounds, trends, dances (MrBeast, Charli D'Amelio, specific viral sounds)
- Viral memes and internet moments (2019-2025) that teenagers reference
- YouTube milestones (first video to 1 billion views, etc.)
- Celebrity drama teens follow (Taylor vs Scooter, Kanye drama, etc.)
- Streaming moments that went viral on social media
- Gen Z slang, phrases, and internet culture
- Viral products and food trends (Stanley cups, Grimace shake, etc.)
- Fortnite/gaming culture crossovers and collaborations

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

CRITICAL REMINDERS FOR THIS BATCH:
- Every question must be about a DIFFERENT subject — no topic, person, platform, or sport repeats
- ANSWER MUST NOT APPEAR IN THE QUESTION — rewrite if the answer word appears in the text
- NEVER say "as of [year]", "as of this writing", "currently" — write timeless facts or state year naturally
- Pop Culture: MAX 2 social media questions total — include news events, celebrity drama, fashion, food trends
- Sports & Games: at least 4 different sports AND at least 2 non-sport games (board games, card games, etc.)
- Each category must span wildly different sub-types per the system prompt rotation list
- Write in Trivial Pursuit style: interesting context first, then the question
- Maximum 2 "what year" questions per category
- NEVER end with "— what is it?", "— who is this?" — ask a specific fact instead

Respond ONLY with: { "questions": [...] }`;
}

// Normalize category names in case GPT returns slight variations
function normalizeCategory(cat) {
  if (!cat) return null;
  const c = cat.trim();
  if (CATEGORIES.includes(c)) return c;
  const lower = c.toLowerCase();
  if (lower.includes('tv') || lower.includes('movie') || lower.includes('music') || lower.includes('entertainment')) return 'TV, Movies & Music';
  if (lower.includes('pop culture') || lower.includes('current event') || lower.includes('trend')) return 'Pop Culture';
  if (lower.includes('geograph')) return 'Geography';
  if (lower.includes('histor')) return 'History';
  if (lower.includes('science') || lower.includes('nature')) return 'Science & Nature';
  if (lower.includes('sport') || lower.includes('game') || lower.includes('video')) return 'Sports & Games';
  return null;
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
    .map(q => {
      const cat = normalizeCategory(q.category);
      if (!cat || !q.question || !q.answer) return null;
      return {
        category: cat,
        question: String(q.question).trim(),
        answer:   String(q.answer).trim(),
        is_pie:   q.is_pie === true,
        canadian: q.canadian === true,
      };
    })
    .filter(Boolean);
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
      const count = parseInt(inserted) || 0;
      totalAdded += count;
      console.log(`  ✅ Batch ${i}: ${count} inserted (${questions.length - count} duplicates skipped)`);
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

module.exports = { refillBank, checkAndRefillIfNeeded, isRefilling: () => isRefilling, generateBatch };
