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

// Category-specific guidance for search query generation
const CATEGORY_SEARCH_GUIDANCE = {
  'Geography': 'surprising geography facts, unusual borders, places that changed names, extreme geography records, bizarre territorial anomalies, unexpected climate facts, islands nobody knows about',
  'TV, Movies & Music': 'recent streaming shows 2024, new music releases 2024, viral TV moments, surprising music records, behind the scenes film facts, unexpected casting decisions, recent award show moments',
  'History': 'bizarre historical facts that sound made up, unexpected causes of famous events, strange historical coincidences, surprising firsts in history, weird historical laws, obscure events that changed the world',
  'Science & Nature': 'surprising scientific discoveries 2024, weird animal behaviors, unexpected physics facts, strange chemistry facts, recent space discoveries, bizarre medical facts, record-breaking natural phenomena',
  'Sports & Games': 'surprising sports records 2024, obscure Olympic facts, unexpected video game records, strange board game history, unusual sports moments, recent esports milestones, weird sports rules',
  'Pop Culture': 'viral moments teenagers 2024, surprising celebrity facts, unexpected internet trends 2024, behind the scenes streaming show facts, surprising music industry facts, Gen Z cultural moments 2024',
};

const QUESTION_SYSTEM_PROMPT = [
  'You are an expert trivia writer crafting questions for a Canadian family Trivial Pursuit-style board game.',
  'Players span three generations: Teenagers (13-18), Gen X Parents (40-55), and Boomers (60+).',
  '',
  '=== THE BRIDGE PRINCIPLE ===',
  'The best questions give enough context that an older player can guess a teen answer, and vice versa.',
  '',
  '=== BANNED QUESTION ENDINGS ===',
  'NEVER end with: "what is it?" "who is it?" "what is this?" "who is this?" "who is he/she?" "name this..."',
  'Instead ask DIRECTLY: Which, Who, What, How many, In which city, Name the',
  '',
  'BAD:  "She won four Grammys — who is this singer?"',
  'GOOD: "Which pop star made history at the 2010 Grammys by becoming the first female artist to win Album of the Year twice?"',
  '',
  '=== CORE RULES ===',
  'SHORT ANSWERS: Maximum 5 words, ideally 1-3. One clear unambiguous answer.',
  '',
  'NO ANSWER LEAKAGE: The answer word must NEVER appear in the question.',
  '- BAD: "Which TikTok trend used The Real Roxannes dance?" Answer: "Roxanne Trend" (Roxanne in both)',
  '- BAD: "Rosa Parks sparked the Montgomery Bus Boycott — what was the boycott called?" (answer in question)',
  '',
  'NEVER DESCRIBE THE ANSWER THEN ASK WHAT IT IS:',
  '- BAD: "Although he played a meth-cooking teacher, Bryan Cranston is best known for which TV series?" (that IS Breaking Bad)',
  '- GOOD: "Bryan Cranston spent years as the bumbling dad on Malcolm in the Middle — which later AMC role won him four Emmy Awards?"',
  '',
  'NO AS-OF PHRASING: Never write "as of 2024", "currently", "at the time". State years naturally in context.',
  '',
  '=== OUTPUT ===',
  'Respond ONLY with valid JSON, no markdown, no code blocks:',
  '{ "questions": [ { "category": "...", "question": "...", "answer": "...", "is_pie": false, "canadian": false } ] }',
].join('\n');

// Step 1: Ask GPT to generate creative search queries for a category
async function generateSearchQueries(category, usedTopics) {
  const avoidList = usedTopics.length > 0
    ? 'Avoid searches that would find content about: ' + usedTopics.slice(-40).join(', ') + '.'
    : '';

  const prompt = [
    'Generate 4 specific, creative web search queries to find interesting trivia material for the "' + category + '" category of a family trivia game.',
    '',
    'The queries should find:',
    '- Surprising, counterintuitive, or little-known facts',
    '- A mix of recent (2023-2024) and timeless content',
    '- Content spanning different cultures, countries, and time periods',
    '- Things that would genuinely surprise both teenagers and their parents',
    '- AVOID obvious well-known topics — go for the unexpected angle',
    '',
    'Category guidance: ' + CATEGORY_SEARCH_GUIDANCE[category],
    avoidList,
    '',
    'Make each query specific enough to find a unique angle — not generic like "interesting facts about history".',
    'Think like a curious researcher looking for the most surprising and engaging content possible.',
    '',
    'Respond ONLY with valid JSON: { "queries": ["query1", "query2", "query3", "query4"] }',
  ].join('\n');

  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
  });

  const result = JSON.parse(response.choices[0].message.content || '{}');
  return result.queries || [];
}

// Step 2: Search the web for fresh content
async function searchWeb(query) {
  // Try with web search tool first
  const searchTools = [
    [{ type: 'web_search_preview' }],
    [{ type: 'web_search_preview_2025_03_11' }],
  ];

  for (const tools of searchTools) {
    try {
      const response = await client.chat.completions.create({
        model: 'gpt-4o',
        max_tokens: 800,
        tools,
        messages: [{
          role: 'user',
          content: 'Search for: ' + query + '\n\nSummarise the most interesting, surprising, and specific facts you find. Focus on concrete facts with clear answers — names, numbers, dates, places. Return 3-5 bullet points of the most trivia-worthy facts.',
        }],
      });
      const content = response.choices[0].message.content || '';
      if (content.length > 50) return content;
    } catch (e) {
      // Try next tool format
    }
  }

  // Fallback: ask GPT to use its own knowledge on this specific query
  try {
    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: 'Using your knowledge, find surprising and specific trivia facts about: ' + query + '\n\nFocus on lesser-known, counterintuitive, or surprising facts — not the obvious well-known ones. Return 3-5 bullet points of concrete trivia-worthy facts with specific names, numbers, or dates.',
      }],
    });
    return response.choices[0].message.content || '';
  } catch (e) {
    console.log('   Search fallback also failed: ' + e.message);
    return '';
  }
}

// Step 3: Generate questions from the web search results
async function generateQuestionsFromContent(category, content, count, isPieCategory, usedTopics) {
  const avoidList = usedTopics.length > 0
    ? 'TOPICS ALREADY USED — do not write questions about: ' + usedTopics.slice(-60).join(', ')
    : '';

  const pieInstruction = isPieCategory
    ? 'Include exactly 1 pie question (is_pie: true) — harder, requires very specific knowledge.'
    : 'All questions should have is_pie: false.';

  const prompt = [
    'Using ONLY the factual content below, write ' + count + ' trivia questions for the "' + category + '" category.',
    '',
    '=== SOURCE MATERIAL ===',
    content,
    '=== END SOURCE MATERIAL ===',
    '',
    avoidList,
    '',
    pieInstruction,
    '',
    'Rules:',
    '- Base questions ONLY on facts from the source material above — do not invent or add facts',
    '- Apply the Bridge Principle: give enough context that both teens and parents have a chance',
    '- SHORT ANSWERS: 1-5 words, ideally 1-3 words',
    '- NO ANSWER LEAKAGE: answer word must not appear in the question',
    '- NO BANNED ENDINGS: never end with "who is this?", "what is it?", "who is he/she?"',
    '- Ask DIRECTLY: Which, Who, What, How many, In which city',
    '- NO "as of [year]" phrasing',
    '- Mark canadian:true only if specifically about Canada',
    '',
    'Respond ONLY with valid JSON: { "questions": [...] }',
  ].join('\n');

  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 1500,
    messages: [
      { role: 'system', content: QUESTION_SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
    response_format: { type: 'json_object' },
  });

  const text = response.choices[0].message.content || '';
  const obj = JSON.parse(text);
  const arrays = Object.values(obj).filter(v => Array.isArray(v));
  return arrays.length > 0 ? arrays[0] : [];
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
      'This trivia question has a problem: the answer word appears in the question text.',
      'Category: ' + q.category,
      'Original question: ' + q.question,
      'Answer: ' + q.answer,
      '',
      'Rewrite the question so the answer "' + q.answer + '" does NOT appear in the question.',
      'Use a DIFFERENT interesting fact as the hook. End with a direct specific question.',
      '',
      'Respond ONLY with valid JSON: { "question": "rewritten question here" }',
    ].join('\n');

    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    });

    const result = JSON.parse(response.choices[0].message.content || '{}');
    if (result.question && !answerInQuestion(result.question, q.answer)) {
      return { ...q, question: result.question.trim() };
    }
    return null;
  } catch (e) {
    return null;
  }
}

// Main batch generation — 3-step pipeline per category
async function generateBatch(batchNum, focusCategories, usedTopics) {
  const allQuestions = [];
  const categoriesToProcess = focusCategories || CATEGORIES;
  const pieCategory = CATEGORIES[batchNum % CATEGORIES.length];

  for (const category of categoriesToProcess) {
    try {
      const questionsPerCat = focusCategories ? 3 : (DISTRIBUTION[category]?.regular || 8);
      const isPie = category === pieCategory && !focusCategories;

      console.log('     [' + category + '] Generating search queries...');

      // Step 1: Generate search queries
      const queries = await generateSearchQueries(category, usedTopics);
      console.log('     [' + category + '] Queries: ' + queries.slice(0, 2).join(' | ') + '...');

      // Step 2: Search web with 2 of the queries (balance speed vs diversity)
      const searchResults = [];
      for (const query of queries.slice(0, 2)) {
        const result = await searchWeb(query);
        if (result) searchResults.push(result);
        await new Promise(r => setTimeout(r, 500));
      }

      if (searchResults.length === 0) {
        console.log('     [' + category + '] No search results, skipping');
        continue;
      }

      const combinedContent = searchResults.join('\n\n---\n\n');

      // Step 3: Generate questions from content
      console.log('     [' + category + '] Writing questions from search results...');
      const raw = await generateQuestionsFromContent(
        category, combinedContent, questionsPerCat, isPie, usedTopics
      );

      // Validate and clean
      const clean = [];
      const needsRewrite = [];

      for (const q of raw) {
        const cat = normalizeCategory(q.category || category);
        if (!cat || !q.question || !q.answer) continue;
        const mapped = {
          category: cat,
          question: String(q.question).trim(),
          answer: String(q.answer).trim(),
          is_pie: q.is_pie === true,
          canadian: q.canadian === true,
        };
        if (answerInQuestion(mapped.question, mapped.answer)) {
          needsRewrite.push(mapped);
        } else {
          clean.push(mapped);
        }
      }

      // Attempt rewrites
      if (needsRewrite.length > 0) {
        const rewritten = await Promise.all(needsRewrite.map(q => rewriteQuestion(q)));
        rewritten.forEach(q => { if (q) clean.push(q); });
      }

      console.log('     [' + category + '] ' + clean.length + ' questions ready');
      allQuestions.push(...clean);

    } catch (err) {
      console.error('     [' + category + '] Error: ' + err.message);
    }

    // Small delay between categories
    await new Promise(r => setTimeout(r, 600));
  }

  return allQuestions;
}

async function refillBank(focusCategories) {
  if (isRefilling) { console.log('Refill already in progress'); return; }
  isRefilling = true;
  const before = await getUnusedCount();
  const target = focusCategories ? 60 : REFILL_AMOUNT;
  // Each batch covers all 6 categories = ~54 questions
  // So batches needed = target / 54
  const batchesNeeded = Math.max(1, Math.ceil(target / 54));
  console.log('Starting web-search refill — bank: ' + before + ', target: +' + target + ' (' + batchesNeeded + ' batches)');

  let totalAdded = 0;
  const usedTopics = [];

  try {
    for (let i = 1; i <= batchesNeeded; i++) {
      console.log('   === Batch ' + i + '/' + batchesNeeded + ' (topic memory: ' + usedTopics.length + ' items) ===');
      const questions = await generateBatch(i, focusCategories, usedTopics);
      const inserted = await insertQuestions(questions);
      const count = parseInt(inserted) || 0;
      totalAdded += count;

      // Add answers to topic memory to prevent future repetition
      questions.forEach(q => { if (q.answer) usedTopics.push(q.answer); });

      console.log('   Batch ' + i + ' complete: ' + count + ' inserted, ' + totalAdded + ' total so far');
      if (i < batchesNeeded) await new Promise(r => setTimeout(r, 1500));
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
