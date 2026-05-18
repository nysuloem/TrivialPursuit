const OpenAI = require('openai');
const { insertQuestions, logRefill, getUnusedCount, getLowCategories, CATEGORIES } = require('./db');

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const REFILL_AMOUNT    = parseInt(process.env.REFILL_AMOUNT || '250');
const THRESHOLD        = parseInt(process.env.LOW_QUESTION_THRESHOLD || '250');
const MIN_PER_CATEGORY = 50;

let isRefilling = false;

// Keeping your preferred weight distribution, totaling 54 regular + 6 pie questions per standard batch
const DISTRIBUTION = {
  'Geography':          { regular: 8,  pie: 1 },
  'TV, Movies & Music': { regular: 10, pie: 1 },
  'History':            { regular: 8,  pie: 1 },
  'Science & Nature':   { regular: 8,  pie: 1 },
  'Sports & Games':     { regular: 10, pie: 1 },
  'Pop Culture':        { regular: 10, pie: 1 },
};

const SYSTEM_PROMPT = [
  'You are an expert trivia writer crafting questions for a Canadian family board game styled after Trivial Pursuit.',
  'The players span multiple generations: Teenagers (13-18), Parents/Gen X (40-50), and Boomers (60+).',
  '',
  '=== CRITICAL: MULTI-GENERATIONAL BALANCE ===',
  '- TEEN APPEAL: Teenagers must feel heavily represented in "Pop Culture" and "TV, Movies & Music". Do not use obscure, hyper-niche TikTok inside jokes. Focus on mainstream Gen Z/Alpha juggernauts.',
  '- PARENT/BOOMER APPEAL: Ensure Geography, History, and Science & Nature don\'t leave teens completely out, but lean heavily into established cultural literacy.',
  '- THE BRIDGE PRINCIPLE: A great question provides enough context for an older person to guess a teen answer, and vice versa. (e.g., Mentioning a parent\'s legendary career when asking about their Gen Z influencer kid).',
  '',
  '=== CRITICAL: RADICAL DIVERSITY (NO CLUSTERING) ===',
  '- NEVER feature the same person, franchise, team, band, or historic event more than ONCE in a single batch.',
  '- If you write a question about Taylor Swift, do not mention Travis Kelce or the Eras Tour in another question.',
  '- If you write a question about Minecraft, do not use it again for any other gaming question.',
  '- Rotate wildly across sub-genres. For sports: don\'t give 3 basketball questions; split them across Formula 1, tennis, hockey, and soccer.',
  '',
  '=== THE TRIVIAL PURSUIT "VOICE" ===',
  'Trivial Pursuit questions start with compelling, authoritative trivia hooks and finish with a crisp, direct question. They never use vague, trailing pronouns.',
  '',
  '=== RULE: BANNED QUESTION ENDINGS ===',
  'NEVER end a question with: "what is it?", "who is this?", "who is he/she?", "what are they?", "name this...", "what is this called?"',
  'Instead, ask DIRECTLY using: "Which [noun]...", "Who...", "What [noun]...", "In which city...", "Name the [noun]..."',
  '',
  'BAD: "She won four Grammy Awards recently — who is this singer?"',
  'GOOD: "Which pop star made history at the Grammys by becoming the first performer to win Album of the Year four times?"',
  '',
  '=== CORE WRITING RULES ===',
  '1. SHORT ANSWERS: Maximum 5 words, ideally 1-3. No conversational padding.',
  '2. NO ANSWER LEAKAGE: Never use the answer word (or close variants) anywhere in the question text.',
  '3. NO "AS OF" PHRASING: Never write "As of 2026" or "Currently". State the timeframe naturally: "In 2024, which singer..." or phrase it as a timeless milestone.',
  '4. CANADIAN CONTENT: Maximize engagement by ensuring exactly 10% of questions subtly highlight Canadian achievement, geography, or history. Mark these "canadian": true.',
  '',
  '=== CATEGORY BLUEPRINTS ===',
  '',
  'GEOGRAPHY:',
  '- 50% Standard (Capitals, major rivers, borders, mountain ranges).',
  '- 50% Quirky (Odd territorial anomalies, extreme weather capitals, places that changed names).',
  '',
  'HISTORY:',
  '- Rotate evenly: Ancient, Medieval, Age of Discovery, World Wars, Cold War, and Modern (2000s).',
  '- Mix grand political movements with strange historical oddities (e.g., Pepsi briefly owning a Soviet military fleet).',
  '',
  'SCIENCE & NATURE:',
  '- Rotate heavily: Astronomy, human anatomy, AI/tech milestones, animal adaptations, chemistry, physics.',
  '',
  'TV, MOVIES & MUSIC (Modern First, Retro Sprinkled):',
  '- 50% must be 2020-2026 content targeting teen cultural awareness (The Bear, Wednesday, Olivia Rodrigo, Zendaya, Billie Eilish, Dune).',
  '- 50% split across 80s, 90s, and 2000s classics (Star Wars, Friends, Eminem, Spielberg) so parents can shine.',
  '',
  'SPORTS & GAMES (Strict Counts per Batch of 10):',
  '- Exactly 4 VIDEO GAME questions: Focus on massive modern titles (Fortnite, Roblox, Zelda, Elden Ring, Valorant) and retro mainstays (Mario, Pac-Man).',
  '- Exactly 4 REAL SPORTS questions: Rotate across NFL, NBA, NHL, MLB, F1, Olympics, and Tennis. Never repeat a sport in the same batch.',
  '- Exactly 2 TRADITIONAL GAMES questions: Board games, card games, chess, poker, Wordle, D&D.',
  '',
  'POP CULTURE (Heavy Teen Focus):',
  '- 7-8 out of 10 questions must be massive internet-era pop culture (2015-2026) that a 15-year-old would know instantly: Viral trends (Stanley cups, Grimace shake), massive YouTubers (MrBeast), celebrity crossovers, meme history.',
  '- 2-3 out of 10 questions can feature Retro cultural milestones (Y2K panic, Live Aid, MTV launch, Rubik\'s cube craze).',
  '- NEVER lead a batch with a retro question.',
  '',
  '=== OUTPUT FORMAT ===',
  'Respond ONLY with valid JSON matching this schema, no markdown, no code blocks, no trailing explanations:',
  '{ "questions": [ { "category": "...", "question": "...", "answer": "...", "is_pie": false, "canadian": false } ] }'
].join('\n');

function buildPrompt(batchNum, focusCategories) {
  let catInstructions;
  if (focusCategories && focusCategories.length > 0) {
    const perCat = Math.ceil(30 / focusCategories.length);
    catInstructions = focusCategories
      .map(cat => `- "${cat}": ${perCat} regular questions + 1 pie question`)
      .join('\n');
  } else {
    catInstructions = Object.entries(DISTRIBUTION)
      .map(([cat, counts]) => `- "${cat}": ${counts.regular} regular questions + ${counts.pie} pie question`)
      .join('\n');
  }

  return [
    `BATCH ${batchNum} — Generate trivia questions with this exact category distribution:`,
    catInstructions,
    '',
    'CRITICAL BATCH ENFORCEMENT:',
    '- RADICAL TOPIC DIVERSITY: Do not reuse a subject, person, franchise, or event across questions. (e.g., If one question is about Travis Kelce, no other question can be about Taylor Swift or the NFL).',
    '- TEEN COMPREHENSION: Ensure the modern Pop Culture and TV/Movies/Music targets mainstream hits teenagers care about, but use descriptive hooks so older family members can reasonably attempt a guess.',
    '- FORMATTING: Answers MUST be 1-5 words max. Do not leak the answer into the question text. Absolutely no banned ending phrases like "who is he?"',
    '',
    'Respond ONLY with the JSON object: { "questions": [...] }'
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

  const validated = parsed
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
    .filter(Boolean)
    .filter(q => {
      if (answerInQuestion(q.question, q.answer)) {
        console.log('   Rejected (answer in question): "' + q.answer + '"');
        return false;
      }
      return true;
    });

  return validated;
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