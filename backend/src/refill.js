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

━━━ RULE #1 — BANNED QUESTION ENDINGS ━━━

NEVER end a question with vague tags like these:
"— what is it?"  "— who is it?"  "— what is this?"  "— who is this?"
"— what are they?"  "— who is he/she?"  "— name this..."
"— what is this called?"  "— who is the pop star?"  "— who is this athlete?"
"— who is this musician?"  "— what is the name of this..."

Instead, ask DIRECTLY and SPECIFICALLY using "Which", "Who", "What", "How many", "In which city", "Name the":

❌ BAD:  "She won four Grammy Awards and is known for her powerful voice — who is this singer?"
✅ GOOD: "Which singer won four Grammy Awards in a single night in 2010, breaking the record for most wins by a female artist at the time?"

❌ BAD:  "This game lets players build anything from blocks — what is it called?"
✅ GOOD: "Which sandbox building game, created by Markus Persson and released in 2011, became the best-selling video game of all time?"

❌ BAD:  "He surpassed Kareem Abdul-Jabbar's scoring record in 2023 to become the NBA's all-time leader — who is he?"
✅ GOOD: "Which player surpassed Kareem Abdul-Jabbar's long-standing record in February 2023 to become the NBA's all-time leading scorer?"

━━━ WRITE LIKE TRIVIAL PURSUIT ━━━

Study these examples — notice how every question ends with a SPECIFIC, DIRECT question:

EXAMPLE 1 (Geography):
Q: "Once known as Rhodesia and the site of the ancient ruins of Great Zimbabwe, this landlocked southern African nation gained independence from Britain in 1980 — what is it called today?"
A: Zimbabwe

EXAMPLE 2 (TV, Movies & Music):
Q: "Before winning four Emmy Awards for playing a chemistry teacher turned drug kingpin, this actor spent years as the lovable bumbling dad on Malcolm in the Middle — which acclaimed AMC drama gave him that darker role?"
A: Breaking Bad

EXAMPLE 3 (History):
Q: "After the assassination of Archduke Franz Ferdinand in Sarajevo in 1914, this global conflict dragged in most of the world's major powers and claimed over 17 million lives — by what common name do we know it?"
A: World War I

EXAMPLE 4 (Pop Culture):
Q: "With over 100 million YouTube subscribers and famous for giving away cars, houses, and cash to strangers, which creator became the most subscribed individual on YouTube?"
A: MrBeast

━━━ CORE RULES ━━━

ANSWERS MUST BE SHORT:
- Maximum 5 words — ideally 1-3 words
- One clear, unambiguous answer
- BAD answer: "The Battle of Thermopylae, 480 BC, fought by King Leonidas"
- GOOD answer: "Battle of Thermopylae" or "Leonidas"

ANSWER MUST NOT APPEAR IN THE QUESTION:
- Never include the answer word or any close variant in the question text
- BAD: "Which 2021 TikTok trend used The Real Roxanne's 'Roxanne's Dance'?" → Answer: "The Roxanne Trend" (Roxanne appears in both)
- BAD: "The Mongol Empire stretched from Asia to Europe — who founded the Mongol Empire?" → Answer: Genghis Khan (Mongol repeated)
- Ask yourself before submitting: "Does any word in my question appear in the answer?" If yes, rewrite.

NEVER DESCRIBE THE ANSWER THEN ASK WHAT IT IS:
- The context in the question must be a DIFFERENT fact about the subject — not a description of the answer
- BAD: "Although he played a meth-cooking chemistry teacher, Bryan Cranston is best known for which TV series?" (the description IS Breaking Bad)
- GOOD: "Bryan Cranston spent years as the bumbling dad on Malcolm in the Middle before landing which role that won him four Emmy Awards?"

NO "AS OF YEAR" PHRASING:
- NEVER: "as of 2024", "as of this writing", "currently", "at the time"
- Write timeless facts: "Who holds the all-time record..." not "As of 2024, who holds..."
- For recent events, state the year naturally: "In 2023, which country..." not "As of 2023..."

UNIQUENESS — every question in a batch must cover a different subject:
- Never two questions about the same person, show, team, platform, sport, or topic
- Think of each batch as a well-shuffled deck — maximum variety

━━━ CATEGORY RULES ━━━

GEOGRAPHY (50% fun/surprising, 50% knowledge-based):
- Fun/surprising: weird country facts, unexpected borders, bizarre place names, surprising geography records, islands nobody knows exist, countries that changed names, cities with unexpected climates
- Knowledge-based: capitals, rivers, mountain ranges, major bodies of water, continents
- Rotate types: capitals, rivers, mountains, deserts, islands, borders, flags, natural wonders, country nicknames, colonial history, city nicknames — never repeat a type

HISTORY (50% fun/surprising, 50% knowledge-based):
- Fun/surprising: bizarre historical facts, unexpected causes of wars, strange laws that existed, surprising firsts, history's great accidents and coincidences, famous last words, unexpected connections between events
- Knowledge-based: dates, leaders, treaties, battles, movements
- Rotate eras: ancient civilizations, medieval, Age of Exploration, World Wars, Cold War, civil rights, recent political history — never cluster the same era

SCIENCE & NATURE (mix of fun and factual):
- Rotate sub-topics: space/astronomy, human anatomy, chemistry, physics, biology, geology, weather, AI/technology, medicine, animals, plants, ocean life, environmental science, inventions, mathematics

TV, MOVIES & MUSIC — exact split per batch:
- 50% RECENT (2020-2025): streaming hits (The Bear, Succession, Stranger Things, Squid Game, Wednesday, Euphoria, White Lotus, House of the Dragon, The Last of Us, Severance), recent blockbusters, Gen Z artists (Olivia Rodrigo, Sabrina Carpenter, SZA, Bad Bunny, Kendrick Lamar, The Weeknd, Taylor Swift, Chappell Roan, Billie Eilish), K-pop, reality TV
- 17% 1970s: classic rock (Led Zeppelin, Fleetwood Mac, ABBA, Eagles, David Bowie), 70s TV (M*A*S*H, All in the Family, Happy Days), 70s films (Star Wars, Jaws, The Godfather, Grease)
- 17% 1980s: Michael Jackson, Madonna, Prince, 80s TV (Cheers, Miami Vice, Family Ties), 80s blockbusters (ET, Back to the Future, Die Hard, Top Gun, Ghostbusters)
- 16% 1990s/2000s: Friends, The Sopranos, The Office, Breaking Bad, 90s music (Nirvana, Spice Girls, Eminem, Backstreet Boys, Britney), 2000s films (Lord of the Rings, Harry Potter, Spider-Man)
- TV must make up at least 40% of questions — ask about catchphrases, character names, plot twists, spinoffs, actors, specific episodes

SPORTS & GAMES — exact split per batch:
- 35% VIDEO GAMES: specific games, characters, developers, gaming records, esports, console wars (Minecraft, Fortnite, GTA, Zelda, Mario, Call of Duty, Elden Ring, Pokemon, Roblox, Among Us)
- 35% SPORTS: rotate across DIFFERENT sports — soccer, basketball, hockey, baseball, tennis, golf, boxing, Olympics, Formula 1, cricket, rugby, gymnastics, swimming, track & field. Never the same sport twice per batch. Include athletes from different countries and eras
- 30% BOARD/CARD/OTHER GAMES: Monopoly, Scrabble, chess, Risk, Poker, Magic: The Gathering, Dungeons & Dragons, game shows, Wordle, crossword puzzles

POP CULTURE — split per batch:
- 75% RECENT teen-friendly (2020-2025): viral moments, memes, TikTok creators (MrBeast, Charli D'Amelio), YouTube milestones, celebrity drama teens follow, streaming moments that went viral, Gen Z slang, viral products (Stanley cups, Grimace shake), Fortnite collabs, news events teens care about
- 25% BOOMER/GEN X pop culture: Watergate, moon landing as cultural moment, disco era, MTV launch, Walkman, VHS vs Betamax, iconic 80s/90s ads, Saturday Night Fever, Rubik's Cube craze, Pac-Man arcade culture, grunge era, Y2K panic
- MAX 2 social media platform questions per batch — include at least 2 real news events from 2022-2025
- Only ask about trends that were genuinely massive — if it didn't make mainstream news or get tens of millions of views, skip it

90% global topics, maximum 10% Canadian
Mark canadian:true only for specifically Canadian content

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

CRITICAL REMINDERS:
- Every question about a DIFFERENT subject — no repeats of person, show, sport, platform, or topic
- ANSWERS: 1-5 words max, short and unambiguous
- ANSWER MUST NOT appear in the question text — not even partially
- NO "as of [year]" — write timeless facts or state year naturally in context
- BANNED ENDINGS: never end with "— what is it?", "— who is this?", "— who is he/she?", "— name this..." — ask DIRECTLY using Which/Who/What/How many
- Context in question must be a DIFFERENT fact about the subject, never a description of the answer
- Geography/History: 50% fun surprising facts, 50% knowledge-based
- Pop Culture: 75% recent teen-friendly, 25% Boomer/Gen X (Watergate, MTV, disco, Rubik's Cube era)
- TV Movies Music: 50% recent (2020-2025), 50% spread across 70s/80s/90s — TV must be 40% of questions
- Sports & Games: 35% video games, 35% sports (different sport each question), 30% board/card games
- Max 2 "what year" questions per category

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
