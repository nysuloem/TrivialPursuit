const OpenAI = require('openai');
const { insertQuestions, logRefill, getUnusedCount, getLowCategories, CATEGORIES } = require('./db');

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const REFILL_AMOUNT    = parseInt(process.env.REFILL_AMOUNT || '250');
const THRESHOLD        = parseInt(process.env.LOW_QUESTION_THRESHOLD || '250');
const MIN_PER_CATEGORY = 50;

let isRefilling = false;

const DISTRIBUTION = {
  'Geography':          { regular: 8,  pie: 1 },
  'TV, Movies & Music': { regular: 10, pie: 1 },
  'History':            { regular: 8,  pie: 1 },
  'Science & Nature':   { regular: 8,  pie: 1 },
  'Sports & Games':     { regular: 10, pie: 1 },
  'Pop Culture':        { regular: 10, pie: 1 },
};

const SYSTEM_PROMPT = [
  'You are an expert trivia writer crafting questions for a Canadian family Trivial Pursuit-style board game.',
  'Players span three generations: Teenagers (13-18), Gen X Parents (40-55), and Boomers (60+).',
  '',
  '=== THE BRIDGE PRINCIPLE ===',
  'The best questions give enough context that an older player can guess a teen answer, and vice versa.',
  'A question about MrBeast should hint at what he does so a Boomer has a fighting chance.',
  'A question about The Beatles should be framed so a teenager finds it interesting, not just a date quiz.',
  '',
  '=== RULE #1 — BANNED QUESTION ENDINGS ===',
  'NEVER end a question with vague trailing phrases like:',
  '"what is it?" "who is it?" "what is this?" "who is this?" "who is he/she?"',
  '"what are they?" "name this..." "what is this called?" "who is the pop star?" "who is this athlete?"',
  '',
  'Instead, ask DIRECTLY and SPECIFICALLY using: Which, Who, What, How many, In which city, Name the',
  '',
  'BAD:  "She won four Grammy Awards and is known for her powerful voice — who is this singer?"',
  'GOOD: "Which pop star made history at the 2010 Grammys by becoming the first female artist to win Album of the Year twice?"',
  '',
  'BAD:  "This game lets players build anything from blocks — what is it called?"',
  'GOOD: "Which sandbox building game, created by Markus Persson in 2011, became the best-selling video game of all time?"',
  '',
  'BAD:  "He surpassed Kareems record in 2023 to lead the NBA all time in scoring — who is he?"',
  'GOOD: "Which Lakers star surpassed Kareem Abdul-Jabbars long-standing record in February 2023 to become the NBAs all-time leading scorer?"',
  '',
  '=== WRITE LIKE TRIVIAL PURSUIT ===',
  'Questions open with a compelling hook or surprising fact, then close with a crisp direct question.',
  'They teach you something even when you get them wrong.',
  '',
  'EXAMPLE 1 (Geography):',
  'Q: "Once known as Rhodesia, this landlocked southern African nation peacefully gained independence from Britain in 1980 — what is it called today?"',
  'A: Zimbabwe',
  '',
  'EXAMPLE 2 (TV, Movies & Music):',
  'Q: "Before winning four Emmy Awards for playing a chemistry teacher turned drug kingpin, this actor spent years as the lovable bumbling dad on Malcolm in the Middle — which acclaimed AMC drama gave him that iconic darker role?"',
  'A: Breaking Bad',
  '',
  'EXAMPLE 3 (History):',
  'Q: "Triggered by the assassination of Archduke Franz Ferdinand in Sarajevo in 1914, this global conflict dragged in most of the worlds major powers and claimed over 17 million lives — by what common name do we know it?"',
  'A: World War I',
  '',
  'EXAMPLE 4 (Pop Culture):',
  'Q: "Known for jaw-dropping stunts like burying himself alive and giving away private islands, which YouTube creator became the most subscribed individual channel on the platform?"',
  'A: MrBeast',
  '',
  '=== CORE RULES ===',
  '',
  'SHORT ANSWERS: Maximum 5 words, ideally 1-3 words. One clear unambiguous answer.',
  'BAD answer: "The Battle of Thermopylae, 480 BC, fought by King Leonidas of Sparta"',
  'GOOD answer: "Battle of Thermopylae" or "Leonidas"',
  '',
  'NO ANSWER LEAKAGE — the answer must NEVER appear in the question:',
  '- BAD: "Which TikTok trend used The Real Roxannes dance song?" Answer: "The Roxanne Trend" (Roxanne in both)',
  '- BAD: "The Mongol Empire stretched from the Pacific to Eastern Europe — who founded the Mongol Empire?" (Mongol repeated)',
  '- BAD: "Rosa Parks refused to give up her seat, sparking the Montgomery Bus Boycott — what was the boycott called?" (answer in question)',
  '- Before submitting each question, ask: does any word in my question appear in the answer? If yes, rewrite.',
  '',
  'NEVER DESCRIBE THE ANSWER THEN ASK WHAT IT IS:',
  '- The context hook must reveal a DIFFERENT fact about the subject, not describe the answer itself.',
  '- BAD: "Although he played a meth-cooking chemistry teacher, Bryan Cranston is best known for which TV series?" (that IS Breaking Bad)',
  '- GOOD: "Bryan Cranston spent years playing the lovable bumbling dad Hal on Malcolm in the Middle — which later AMC role won him four Emmy Awards?"',
  '',
  'NO AS-OF-YEAR PHRASING:',
  '- NEVER write: "as of 2024", "as of this writing", "currently", "at the time of publication"',
  '- Write timeless facts: "Who holds the all-time record..." not "As of 2024, who holds..."',
  '- For dated events state the year naturally in context: "In 2023, which country..." not "As of 2023..."',
  '',
  'RADICAL DIVERSITY — every question in a batch must cover a different subject:',
  '- NEVER feature the same person, franchise, team, band, show, sport, or platform twice in one batch',
  '- If one question mentions Taylor Swift, no other question can reference Travis Kelce, the Eras Tour, or the NFL',
  '- Rotate wildly across sub-genres within each category',
  '',
  '=== CATEGORY BLUEPRINTS ===',
  '',
  'GEOGRAPHY (50% fun/surprising, 50% knowledge-based):',
  '- Fun/surprising: weird country facts, unexpected borders, bizarre place names, geography records, islands nobody knows, countries that changed names, cities with unexpected climates, territorial oddities',
  '- Knowledge-based: capitals, major rivers, mountain ranges, bodies of water, continents',
  '- Rotate types every question: capitals, rivers, mountains, deserts, islands, borders, flags, natural wonders, nicknames — never repeat a type',
  '',
  'HISTORY (50% fun/surprising, 50% knowledge-based):',
  '- Fun/surprising: bizarre historical facts, strange laws that existed, surprising firsts, great historical accidents, unexpected causes of famous events, famous last words, odd connections between events (e.g. Pepsi briefly owning Soviet warships)',
  '- Knowledge-based: leaders, battles, treaties, movements, key dates',
  '- Rotate eras every question: ancient, medieval, Age of Exploration, World Wars, Cold War, civil rights, modern (2000s)',
  '',
  'SCIENCE & NATURE:',
  '- Rotate heavily every question: space/astronomy, human anatomy, chemistry, physics, biology, geology, weather, AI/technology, medicine, animal adaptations, plants, ocean life, environmental science, inventions, mathematics',
  '',
  'TV, MOVIES & MUSIC — teen-friendly FIRST, older content sprinkled in:',
  '- REQUIRED: Generate 2020-2025 questions FIRST. At least 5 out of 10 must be from 2020-2025.',
  '- 2020-2025 (5+ questions): The Bear, Succession, Wednesday, Euphoria, House of the Dragon, The Last of Us, Severance, Stranger Things, Squid Game, White Lotus, Abbott Elementary, Olivia Rodrigo, Sabrina Carpenter, SZA, Bad Bunny, Kendrick Lamar, The Weeknd, Taylor Swift Eras Tour, Chappell Roan, Billie Eilish, BTS, Barbie movie, Oppenheimer, Top Gun Maverick, Everything Everywhere All At Once',
  '- 80s sprinkle (2 questions): Michael Jackson, Madonna, Prince, Back to the Future, ET, Die Hard, Cheers, Miami Vice',
  '- 90s/2000s sprinkle (2 questions): Friends, The Sopranos, Eminem, Britney Spears, Lord of the Rings, The Office, Breaking Bad, Nirvana',
  '- 70s sprinkle (1 question only): Star Wars, Fleetwood Mac, ABBA, Jaws, Saturday Night Fever, Grease',
  '- TV must make up at least 40% of questions — ask about specific catchphrases, characters, plot twists, casting choices, spinoffs',
  '- Apply the Bridge Principle: frame older questions with hooks that give teens a fighting chance, frame newer questions with context hooks so parents can attempt them',
  '',
  'SPORTS & GAMES (strict counts per batch of 10):',
  '- Exactly 4 VIDEO GAME questions: massive modern titles AND retro mainstays. Rotate: Fortnite, Roblox, Minecraft, GTA, Zelda, Mario, Call of Duty, Elden Ring, Pokemon, Among Us, Valorant, Pac-Man, Tetris, Sonic, Donkey Kong',
  '- Exactly 4 SPORTS questions: rotate across COMPLETELY DIFFERENT sports. Cover NFL, NBA, NHL, MLB, F1, Olympics, Tennis, Soccer, Boxing, Cricket, Golf, Rugby. Never the same sport twice in one batch.',
  '- Exactly 2 TRADITIONAL GAME questions: Monopoly, Scrabble, chess, Risk, Poker, Magic: The Gathering, Dungeons and Dragons, game shows, Wordle, crossword puzzles',
  '',
  'POP CULTURE — teen-first, older content is a small sprinkle only:',
  '- REQUIRED: Generate teen content FIRST. 7-8 out of 10 must be things a 15-year-old immediately recognizes.',
  '- Teen content 2020-2025 (7-8 questions): celebrity drama (Taylor/Travis, Selena/Hailey, Will Smith slap, Kanye controversies, Zendaya), viral moments (Grimace shake, Stanley cups, Wednesday dance, Barbie cultural moment), Gen Z news (climate strikes, AI going mainstream, COVID culture, Ukraine war reactions), TikTok creators (MrBeast, Charli D Amelio), gaming crossovers (Fortnite Travis Scott concert, Among Us politicians), award show moments, Caitlin Clark rise, Simone Biles comeback, LeBron scoring record',
  '- Older sprinkle (2-3 questions MAX): Watergate, moon landing as cultural event, disco era, MTV launch 1981, Rubiks Cube craze, Pac-Man fever, VHS vs Betamax, Y2K panic, Live Aid',
  '- NEVER start a Pop Culture batch with a retro question — always lead with teen content',
  '- MAX 2 social media platform questions per batch',
  '- Only ask about things that were genuinely massive — if it did not make mainstream news or get tens of millions of views, skip it',
  '',
  'CANADIAN CONTENT: Exactly 10% of questions should highlight Canadian achievement, geography, or history. Mark these canadian:true.',
  '',
  '=== OUTPUT ===',
  'Respond ONLY with valid JSON, no markdown, no code blocks, no explanation:',
  '{ "questions": [ { "category": "...", "question": "...", "answer": "...", "is_pie": false, "canadian": false } ] }',
].join('\n');

function buildPrompt(batchNum, focusCategories) {
  let catInstructions;
  if (focusCategories && focusCategories.length > 0) {
    const perCat = Math.ceil(30 / focusCategories.length);
    catInstructions = focusCategories
      .map(cat => '- "' + cat + '": ' + perCat + ' regular questions + 1 pie question')
      .join('\n');
  } else {
    catInstructions = Object.entries(DISTRIBUTION)
      .map(([cat, counts]) => '- "' + cat + '": ' + counts.regular + ' regular questions + ' + counts.pie + ' pie question')
      .join('\n');
  }

  return [
    'BATCH ' + batchNum + ' — Generate trivia questions with this exact distribution:',
    catInstructions,
    '',
    'CRITICAL BATCH REMINDERS:',
    '- RADICAL DIVERSITY: Every question must cover a completely different subject — no repeat of person, show, sport, platform, or topic',
    '- SHORT ANSWERS: 1-5 words max, ideally 1-3 words, one clear answer',
    '- NO ANSWER LEAKAGE: The answer word must not appear anywhere in the question text',
    '- NO BANNED ENDINGS: Never end with "who is this?", "what is it?", "who is he/she?" — ask DIRECTLY using Which/Who/What/How many',
    '- NO AS-OF PHRASING: Write timeless facts or state the year naturally in context',
    '- BRIDGE PRINCIPLE: Frame modern questions so older players can attempt them; frame retro questions so teens find them interesting',
    '- Geography/History: 50% fun surprising facts, 50% knowledge-based; rotate eras and sub-types every question',
    '- Pop Culture: Generate teen 2020-2025 content FIRST — 7-8 out of 10 questions; max 2-3 retro; never lead with retro',
    '- TV Movies Music: Generate 2020-2025 content FIRST — 5+ out of 10; TV must be 40% of questions',
    '- Sports & Games: Exactly 4 video games, 4 sports (different sport each), 2 traditional games',
    '- Max 2 "what year" questions per category',
    '',
    'Respond ONLY with: { "questions": [...] }',
  ].join('\n');
}

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

function answerInQuestion(question, answer) {
  if (!question || !answer) return false;
  const q = question.toLowerCase();
  const stopWords = new Set(['the','a','an','of','in','on','at','to','for','is','was','are','were','and','or','but','it','its','this','that','these','those','by','with','from','as','be','been','has','had','have','which','who','what','where','when','how','not','no','do','did','does']);
  const answerWords = answer.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopWords.has(w));
  return answerWords.some(word => q.includes(word));
}

async function rewriteQuestion(q) {
  try {
    const prompt = [
      'This trivia question has a problem: the answer word appears in the question text, which gives it away.',
      '',
      'Category: ' + q.category,
      'Original question: ' + q.question,
      'Answer: ' + q.answer,
      '',
      'Rewrite the question so that:',
      '1. The answer word "' + q.answer + '" does NOT appear anywhere in the question',
      '2. The question is still about the same topic/subject',
      '3. It uses a DIFFERENT interesting fact as the hook — not a description of the answer itself',
      '4. It ends with a direct specific question (not "what is it?" or "who is this?")',
      '5. It still sounds like a Trivial Pursuit question',
      '',
      'Respond ONLY with valid JSON: { "question": "rewritten question here" }',
    ].join('\n');

    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    });

    const result = JSON.parse(response.choices[0].message.content || '{}');
    if (result.question && !answerInQuestion(result.question, q.answer)) {
      return { ...q, question: result.question.trim() };
    }
    return null; // rewrite still failed
  } catch (e) {
    return null;
  }
}

async function generateBatch(batchNum, focusCategories) {
  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 8000,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user',   content: buildPrompt(batchNum, focusCategories) },
    ],
    response_format: { type: 'json_object' },
  });

  const text = response.choices[0].message.content || '';
  const obj  = JSON.parse(text);
  let parsed;
  if (Array.isArray(obj)) {
    parsed = obj;
  } else {
    const arrays = Object.values(obj).filter(v => Array.isArray(v));
    parsed = arrays.length > 0 ? arrays[0] : [];
  }

  const mapped = parsed
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
    });

  // Separate clean questions from ones that need rewriting
  const clean = [];
  const needsRewrite = [];

  for (const q of mapped) {
    if (!q) continue;
    if (answerInQuestion(q.question, q.answer)) {
      console.log('   Rewriting (answer in question): "' + q.answer + '"');
      needsRewrite.push(q);
    } else {
      clean.push(q);
    }
  }

  // Attempt rewrites in parallel
  if (needsRewrite.length > 0) {
    const rewritten = await Promise.all(needsRewrite.map(q => rewriteQuestion(q)));
    rewritten.forEach((q, i) => {
      if (q) {
        console.log('   Rewrite succeeded: "' + q.answer + '"');
        clean.push(q);
      } else {
        console.log('   Rewrite failed, discarding: "' + needsRewrite[i].answer + '"');
      }
    });
  }

  return clean;
}

async function refillBank(focusCategories) {
  if (isRefilling) { console.log('Refill already in progress'); return; }
  isRefilling = true;
  const before = await getUnusedCount();
  const target = focusCategories ? 150 : REFILL_AMOUNT;
  const batchesNeeded = Math.ceil(target / 50);
  console.log('Starting refill — bank: ' + before + ', target: +' + target);

  let totalAdded = 0;
  try {
    for (let i = 1; i <= batchesNeeded; i++) {
      console.log('   Generating batch ' + i + '/' + batchesNeeded + '...');
      const questions = await generateBatch(i, focusCategories);
      const inserted  = await insertQuestions(questions);
      const count = parseInt(inserted) || 0;
      totalAdded += count;
      console.log('   Batch ' + i + ': ' + count + ' inserted (' + (questions.length - count) + ' duplicates skipped)');
      if (i < batchesNeeded) await new Promise(r => setTimeout(r, 1000));
    }
    await logRefill(before, totalAdded, 'success');
    const after = await getUnusedCount();
    console.log('Refill complete — bank now has ' + after + ' (+' + totalAdded + ')');
  } catch (err) {
    console.error('Refill failed:', err.message);
    await logRefill(before, totalAdded, 'error: ' + err.message);
  } finally {
    isRefilling = false;
  }
}

async function checkAndRefillIfNeeded() {
  if (isRefilling) return;
  const total = await getUnusedCount();
  if (total < THRESHOLD) {
    console.log('Total bank low (' + total + ') — triggering full refill');
    refillBank();
    return;
  }
  const lowCats = await getLowCategories();
  if (lowCats.length > 0) {
    const names = lowCats.map(r => r.category);
    console.log('Low categories: ' + names.join(', ') + ' — triggering targeted refill');
    refillBank(names);
  }
}

module.exports = { refillBank, checkAndRefillIfNeeded, isRefilling: () => isRefilling, generateBatch };
