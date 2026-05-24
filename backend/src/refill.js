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
  'Pop Culture & Current Events':        { regular: 10, pie: 1 },
};

// Category-specific guidance for search query generation
const CATEGORY_SEARCH_GUIDANCE = {
  'Geography': 'surprising geography facts, unusual borders, places that changed names, extreme geography records, bizarre territorial anomalies, unexpected climate facts, islands nobody knows about',
  'TV, Movies & Music': [
    'TV SHOWS: recent streaming hits Netflix HBO Disney Plus, classic TV shows 1980s 1990s 2000s, actors characters catchphrases plot twists spinoffs',
    'MOVIES: blockbuster films 1980s to present, actors directors franchises, surprising film facts box office records, recent releases',
    'MUSIC: pop rock hip hop country artists 1980s to present, albums records chart moments, surprising music industry facts, recent artists',
  ].join(' | '),
  'History': 'bizarre historical facts that sound made up, unexpected causes of famous events, strange historical coincidences, surprising firsts in history, weird historical laws, obscure events that changed the world',
  'Science & Nature': [
    'SCIENCE: famous scientists discoveries breakthroughs inventions, science news recent, space exploration NASA discoveries, human body medicine health facts, physics chemistry biology surprising facts',
    'NATURE: interesting animals facts behaviors records, plants trees fungi surprising facts, ocean sea life facts, weather climate natural phenomena, ecosystems environments surprising nature facts',
  ].join(' | '),
  'Sports & Games': 'ROTATE between these three types equally: (1) SPORTS: NHL NBA NFL MLB PGA golf records championships stars moments 1980s to present, (2) VIDEO GAMES: Nintendo PlayStation Xbox Steam gaming history console wars popular franchises Minecraft Fortnite Mario Pokemon GTA Zelda esports, (3) BOARD GAMES: Monopoly chess poker Magic The Gathering Dungeons Dragons Scrabble card games trivia',
  'Pop Culture & Current Events': [
    'CURRENT EVENTS: search CBC News, CTV News, ABC News, BBC News, CNN for major North American and world news stories from the last 12 months — politics, world events, disasters, elections, major trials, surprising news',
    'POP CULTURE: viral moments celebrities trends social media Gen Z culture recent — search Entertainment Tonight, People, TMZ, BuzzFeed for recent celebrity news and viral moments',
    'TEEN CULTURE: TikTok trends YouTube milestones gaming crossovers Gen Z slang viral products recent',
  ].join(' | '),
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
  'NO AS-OF PHRASING: Never write "as of 2024", "currently", "at the time". State years naturally in context when relevant.',
  '',
  '=== GEOGRAPHIC & CULTURAL RELEVANCE ===',
  '- 70% of questions should cover North American culture, history, sports, and entertainment (US and Canada)',
  '- 30% can be global — but only topics a North American family would actually know: World Cup, Beatles, Olympics, world geography taught in school, globally famous figures',
  '- AVOID: obscure foreign politicians, local sports leagues outside North America, cultural references only meaningful to people from one specific country',
  '- Canadian content: aim for about 15% — woven naturally into categories. Mark canadian:true.',
  '',
  '=== OUTPUT ===',
  'Respond ONLY with valid JSON, no markdown, no code blocks:',
  '{ "questions": [ { "category": "...", "question": "...", "answer": "...", "is_pie": false, "canadian": false, "subcategory": "...", "era": "..." } ] }',
  '',
  'SUBCATEGORY must be one specific word describing the topic type. Examples:',
  '- Sports & Games: "nhl", "nba", "nfl", "mlb", "golf", "olympics", "tennis", "soccer", "video_games", "board_games", "card_games", "esports"',
  '- TV, Movies & Music: "tv_show", "movie", "music", "streaming", "reality_tv"',
  '- Science & Nature: "space", "animals", "human_body", "technology", "plants", "weather", "chemistry", "physics", "scientists", "food_science", "ocean"',
  '- Pop Culture & Current Events: "current_events", "celebrity", "teen_culture", "viral", "politics", "sports_news"',
  '- Geography: "capitals", "countries", "rivers", "mountains", "records", "cities", "borders"',
  '- History: "ancient", "medieval", "world_wars", "cold_war", "civil_rights", "modern", "exploration"',
  '',
  'ERA must be one of:',
  '- "teen" — content from 2015 to present that teenagers would know',
  '- "millennial" — content from 1990-2014',
  '- "classic" — content from before 1990',
  '- "timeless" — facts that have no specific era (animal facts, geography, science principles)',
].join('\n');

// Step 1: Ask GPT to generate creative search queries for a category
async function generateSearchQueries(category, usedTopics) {
  const safeTopics = Array.isArray(usedTopics) ? usedTopics : [];
  const avoidList = safeTopics.length > 0
    ? 'Avoid searches that would find content about: ' + safeTopics.slice(-40).join(', ') + '.'
    : '';

  const prompt = [
    'Today\'s date is ' + new Date().toLocaleDateString('en-US', {year:'numeric', month:'long', day:'numeric'}) + '.',
    'Generate 4 specific, creative web search queries to find interesting trivia material for the "' + category + '" category of a family trivia game.',
    'The queries should find surprising, counterintuitive, or little-known facts that a North American family would find interesting.',
    'Prioritize RECENT content — search for things that happened in the last 1-2 years where relevant.',
    'Bias toward US and Canadian content (70%) but include some globally relevant topics (30%) that North Americans would know.',
    'Category guidance: ' + CATEGORY_SEARCH_GUIDANCE[category],
    avoidList,
    'Make each query specific — not generic like "interesting facts about history".',
    'Do NOT include specific years like 2023 or 2024 in your queries — use words like "recent", "latest", "this year" instead so the search finds the most current results.',
    'Respond ONLY with valid JSON: { "queries": ["query1", "query2", "query3", "query4"] }',
  ].join('\n');

  try {
    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    });

    const text = response.choices[0]?.message?.content || '{}';
    const result = JSON.parse(text);

    // Handle various response formats
    if (Array.isArray(result.queries) && result.queries.length > 0) return result.queries;
    if (Array.isArray(result.questions)) return result.questions;
    // Find any array in the response
    const anyArray = Object.values(result).find(v => Array.isArray(v) && v.length > 0);
    if (anyArray) return anyArray;

    // Fallback — generate default queries for this category
    console.log('     Query generation returned unexpected format, using defaults');
    return [
      'surprising little-known facts ' + category + ' recent',
      'unusual ' + category.toLowerCase() + ' records and firsts',
    ];
  } catch (e) {
    console.log('     Query generation failed: ' + e.message + ' — using defaults');
    return [
      'surprising little-known facts ' + category + ' recent',
      'unusual ' + category.toLowerCase() + ' records and firsts',
    ];
  }
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
          content: 'Today is ' + new Date().toLocaleDateString('en-US', {year:'numeric', month:'long', day:'numeric'}) + '. Search for: ' + query + '\n\nFind surprising but ACCESSIBLE facts — prioritize recent content where relevant. Focus on facts with clear specific answers (names, numbers, dates, places). Return 4-6 bullet points of the most trivia-worthy accessible facts, noting the year for recent events.',
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
        content: 'Using your knowledge, find surprising but ACCESSIBLE trivia facts about: ' + query + '\n\nFocus on facts that would make someone say "wow I didn\'t know that!" — surprising but not so obscure that only a specialist would know. A curious teen or engaged parent should have a fighting chance. Return 4-6 bullet points of concrete trivia-worthy facts with specific names, numbers, or dates.',
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
  const safeTopics2 = Array.isArray(usedTopics) ? usedTopics : [];
  const avoidList = safeTopics2.length > 0
    ? 'TOPICS ALREADY USED — do not write questions about: ' + safeTopics2.slice(-60).join(', ')
    : '';

  const pieInstruction = isPieCategory
    ? 'Include exactly 1 pie question (is_pie: true) — harder, requires very specific knowledge but still answerable by a dedicated fan or engaged parent.'
    : 'All questions should have is_pie: false.';

  const prompt = [
    'Using the factual content below as your SOURCE MATERIAL for topics and facts, write ' + count + ' trivia questions for the "' + category + '" category.',
    '',
    '=== SOURCE MATERIAL (use these facts as inspiration) ===',
    content,
    '=== END SOURCE MATERIAL ===',
    '',
    avoidList,
    '',
    pieInstruction,
    '',
    '=== GETTABILITY RULE — CRITICAL ===',
    'Every question must be answerable by at least ONE person in a typical Canadian family (teen, parent, or grandparent).',
    'Before writing each question ask: "Would a reasonably curious person know this, or could they figure it out from the context clues in the question?"',
    'If the answer is "only a narrow specialist would know this" — rewrite it with more helpful context, or pick a different fact from the source material.',
    'The best questions are ones where people ALMOST know the answer — they feel achievable but satisfying to get right.',
    '',
    '=== WRITING RULES ===',
    'BANNED ENDINGS: Never end with "what is it?", "who is this?", "who is he/she?", "what are they?", "name this..."',
    'Ask DIRECTLY: Which, Who, What, How many, In which city, Name the',
    '',
    'BAD:  "This singer broke a Grammy record recently — who is she?"',
    'GOOD: "Which Canadian singer swept the 2024 Grammys by winning four awards in a single night, including Album of the Year?"',
    '',
    'SHORT ANSWERS: 1-5 words, ideally 1-3. One clear unambiguous answer.',
    'NO ANSWER LEAKAGE: The answer word must not appear anywhere in the question text.',
    'NO AS-OF PHRASING: Never write "as of 2024", "currently". State years naturally.',
    'BRIDGE PRINCIPLE: Give enough context that both teens AND parents have a fighting chance.',
    '',
    '=== GENERATIONAL MIX for ' + category + ' ===',
    category === 'TV, Movies & Music'
      ? [
          'Split questions roughly: 40% TV shows, 30% movies, 30% music. ALL content from 1980s to present only.',
          'TV: streaming platforms (Netflix, HBO, Disney+, Apple TV+), classic network TV, actors, characters, catchphrases, plot twists, spinoffs, awards. Recent hits: The Bear, Succession, Wednesday, Euphoria, Stranger Things, White Lotus, House of the Dragon, The Last of Us, Severance, Abbott Elementary. Classic: Friends, Seinfeld, The Office, Breaking Bad, Sopranos, Game of Thrones, Lost, Grey\'s Anatomy.',
          'MOVIES: blockbusters, franchises (Marvel, Star Wars, Fast & Furious, Harry Potter, Lord of the Rings), directors, actors, box office records, behind the scenes facts, recent releases (Barbie, Oppenheimer, Top Gun Maverick, Everything Everywhere).',
          'MUSIC: pop, rock, hip hop, country, R&B from 1980s to present. Artists, albums, chart records, award moments, collaborations. Recent: Taylor Swift, Olivia Rodrigo, Billie Eilish, Kendrick Lamar, Bad Bunny, The Weeknd. Classic: Michael Jackson, Madonna, Prince, Nirvana, Eminem, Beyonce.',
          'YEAR DIVERSITY IS CRITICAL: Do NOT cluster questions around the same 1-2 years. Spread across the full range 1980s to present. If you write a question about something from 2023, the next question should be from a different era — maybe the 90s, or 2015, or 2008. Aim for no more than 2 questions from the same decade per batch.',
          'AT LEAST 75% of questions must be from 2000 to present — lean toward recent content teens would know.',
          'Vary question types: actor trivia, show facts, music records, platform firsts, character names, film budgets, chart positions.',
        ].join(' ')
      : category === 'Science & Nature'
      ? [
          'Split roughly 50% science, 50% nature.',
          'SCIENCE sub-topics to rotate across — never cluster the same type twice in a row:',
          '- Famous scientists and discoveries: Einstein, Darwin, Curie, Newton, Hawking, Tesla, Pasteur — their breakthroughs, rivalries, surprising personal facts',
          '- Space exploration: NASA milestones, planets, stars, black holes, Mars missions, moon landing facts, James Webb telescope discoveries',
          '- Human body: bones, organs, senses, blood types, brain facts, sleep, DNA, surprising body facts ("the human eye can distinguish 10 million colours")',
          '- Technology and inventions: who invented what, when was it invented, how everyday technology works (GPS, WiFi, microwave, internet, vaccines)',
          '- Food science: why bread rises, what makes chili hot, why onions make you cry, fermentation, surprising food chemistry',
          '- "Did you know" science facts: octopuses have 3 hearts, honey never spoils, bananas are radioactive, lightning is hotter than the sun — accessible and surprising',
          'NATURE sub-topics to rotate across:',
          '- Animal records and behaviors: fastest, largest, strangest, most venomous, unique adaptations — focus on well-known animals with surprising angles',
          '- Ocean and marine life: sharks, whales, deep sea creatures, coral reefs, ocean records',
          '- Plants and trees: world\'s oldest tree, carnivorous plants, how plants communicate, rainforest facts',
          '- Weather and natural phenomena: tornadoes, lightning, Aurora Borealis, record temperatures, natural disasters',
          '- Environmental science: endangered species, conservation wins, climate facts teens care about',
          'GETTABILITY IS KEY: Every question must be answerable by someone with general knowledge. No obscure taxonomy, no specialist jargon. The surprising angle should be accessible.',
          'Vary question types: records, comparisons, "what is the only...", inventor questions, body facts, space milestones, "did you know" style hooks.',
        ].join(' ')
      : category === 'Sports & Games'
      ? [
          'SPORTS: Focus on major North American leagues from 1980s to present — NHL, NBA, NFL, MLB, PGA golf. Ask about BOTH iconic players AND the sports themselves. Player questions: records, career moments, nicknames, championships. Sport questions: rules, team histories, iconic games, stadium facts, draft moments, trades, dynasties, coaching legends. Spread across many different players and teams — do not ask two questions about the same player or team. Examples of player variety: one NHL question about Gretzky, one NBA about Shaq, one NFL about Montana, one MLB about Jeter. Examples of sport variety: how many periods in hockey, what is a grand slam, what does MVP stand for, which city has won the most Super Bowls.',
          'VIDEO GAMES: Cover a wide range — console history (NES, SNES, PlayStation, Xbox, Nintendo Switch), popular franchises (Mario, Zelda, Call of Duty, FIFA, Minecraft, Fortnite, GTA, Pokemon), Steam/PC gaming, esports, gaming milestones, iconic characters, game developers. NOT just world records — ask about gameplay, lore, platforms, release facts, cultural impact.',
          'BOARD/CARD GAMES: Cover a wide variety — classic board games (chess, Scrabble, Risk, Clue, Battleship, Trivial Pursuit, Boggle), modern tabletop games (Catan, Ticket to Ride, Codenames, Pandemic), card games (poker, blackjack, Magic: The Gathering, Uno), role-playing games (Dungeons & Dragons), party games, game shows (Jeopardy, Wheel of Fortune, Price is Right), digital word games (Wordle). Ask about game history, weird rules, origin stories, record games, famous players. Every question should be about a DIFFERENT game.',
          'Keep teenage gamers engaged — at least 3-4 video game questions per batch covering both retro and modern titles.',
        ].join(' ')
      : category === 'Pop Culture & Current Events'
      ? 'Mix teen-friendly viral/celebrity content (60%) with genuine current events and news stories (40%) that a North American family would have heard about. Include politics, world events, sports moments that made headlines, and cultural moments from recent years. Make news questions accessible — focus on the surprising or ironic angle rather than dry facts.'
      : 'Mix across different eras, cultures, and sub-topics for broad appeal.',
    '',
    'Mark canadian:true only if specifically about Canada.',
    'AIM FOR 70% North American content, 30% globally relevant topics a North American would know.',
    '',
    'Respond ONLY with valid JSON: { "questions": [...] }',
  ].join('\n');

  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 2000,
    messages: [
      { role: 'system', content: QUESTION_SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
    response_format: { type: 'json_object' },
  });

  const text = response.choices[0]?.message?.content || '{}';
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
  if (lower.includes('pop culture') || lower.includes('current event') || lower.includes('trend')) return 'Pop Culture & Current Events';
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
      return { ...q, question: result.question.trim() }; // preserves subcategory and era
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
      const questionsPerCat = focusCategories ? 8 : (DISTRIBUTION[category]?.regular || 8);
      const isPie = category === pieCategory && !focusCategories;

    // For Sports & Games and TV Movies Music, force separate searches for each sub-type
    let searchResults = [];
    if (category === 'Sports & Games') {
      console.log('     [' + category + '] Running 3 sub-type searches (sports / video games / board games)...');
      const subTypeQueries = [
        await generateSearchQueries('Sports & Games - SPORTS ONLY: NHL NBA NFL MLB PGA golf records stars moments', usedTopics),
        await generateSearchQueries('Sports & Games - VIDEO GAMES ONLY: Nintendo PlayStation Xbox Steam Minecraft Fortnite Mario Pokemon GTA console history', usedTopics),
        await generateSearchQueries('BOARD AND CARD GAMES ONLY: classic board game history facts weird rules, modern board games tabletop gaming, card game facts poker blackjack, chess history facts, role playing games history, party games trivia games history, game show facts Jeopardy Wheel of Fortune Price is Right, trading card games collectible games', usedTopics),
      ];
      for (const queries of subTypeQueries) {
        if (queries.length > 0) {
          const result = await searchWeb(queries[0]);
          if (result) searchResults.push(result);
          await new Promise(r => setTimeout(r, 500));
        }
      }
    } else if (category === 'TV, Movies & Music') {
      console.log('     [' + category + '] Running 3 sub-type searches (TV / movies / music) across eras...');
      // Rotate era focus across batches so we get good year diversity
      const eraFocus = ['recent 2020s', '2000s 2010s', '1980s 1990s'][batchNum % 3];
      const subTypeQueries = [
        await generateSearchQueries('TV SHOWS ' + eraFocus + ': streaming platforms Netflix HBO Disney Plus, network TV, actors characters catchphrases plot twists spinoffs awards', usedTopics),
        await generateSearchQueries('MOVIES ' + eraFocus + ': blockbusters franchises actors directors box office records behind the scenes facts', usedTopics),
        await generateSearchQueries('MUSIC ' + eraFocus + ': pop rock hip hop country R&B artists albums chart records award moments collaborations', usedTopics),
      ];
      for (const queries of subTypeQueries) {
        if (queries.length > 0) {
          const result = await searchWeb(queries[0]);
          if (result) searchResults.push(result);
          await new Promise(r => setTimeout(r, 500));
        }
      }
    } else if (category === 'Pop Culture & Current Events') {
      console.log('     [' + category + '] Running 3 targeted searches (news / celebrity / teen culture)...');
      const today = new Date().toLocaleDateString('en-US', {year:'numeric', month:'long'});
      const popQueries = [
        await generateSearchQueries('CURRENT EVENTS NEWS: search CBC News CTV News ABC News BBC News CNN for major North American world news stories recent months ' + today + ' — politics elections world events surprising news facts', usedTopics),
        await generateSearchQueries('CELEBRITY POP CULTURE: recent celebrity news drama viral moments Entertainment social media trending ' + today, usedTopics),
        await generateSearchQueries('TEEN GEN Z CULTURE: TikTok trends YouTube milestones gaming crossovers Gen Z viral products internet moments recent ' + today, usedTopics),
      ];
      for (const queries of popQueries) {
        if (queries.length > 0) {
          const result = await searchWeb(queries[0]);
          if (result) searchResults.push(result);
          await new Promise(r => setTimeout(r, 500));
        }
      }
    } else if (category === 'Science & Nature') {
      console.log('     [' + category + '] Running 2 sub-type searches (science / nature)...');
      const sciNatQueries = [
        await generateSearchQueries('SCIENCE ONLY: famous scientists discoveries breakthroughs, technology inventions who invented what, human body surprising facts, space exploration NASA discoveries, food science chemistry, surprising did-you-know science facts accessible', usedTopics),
        await generateSearchQueries('NATURE ONLY: interesting animals behaviors records surprising facts, ocean sea life sharks whales, plants trees surprising facts, weather climate natural phenomena, environmental science conservation wins', usedTopics),
      ];
      for (const queries of sciNatQueries) {
        if (queries.length > 0) {
          const result = await searchWeb(queries[0]);
          if (result) searchResults.push(result);
          await new Promise(r => setTimeout(r, 500));
        }
      }
    } else {
      // Standard search for Geography, History, and other categories
      const queries = await generateSearchQueries(category, usedTopics);
      console.log('     [' + category + '] Queries: ' + queries.slice(0, 2).join(' | ') + '...');
      for (const query of queries.slice(0, 2)) {
        const result = await searchWeb(query);
        if (result) searchResults.push(result);
        await new Promise(r => setTimeout(r, 500));
      }
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
          subcategory: String(q.subcategory || 'general').toLowerCase().replace(/[^a-z_]/g, '_').substring(0, 50),
          era: ['teen','millennial','classic','timeless'].includes(q.era) ? q.era : 'millennial',
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
  const target = focusCategories ? 100 : REFILL_AMOUNT;
  // For focused refills: each batch generates ~8 questions per category
  // For full refills: each batch covers all 6 categories = ~54 questions
  const questionsPerBatch = focusCategories ? (8 * focusCategories.length) : 54;
  const batchesNeeded = Math.max(3, Math.ceil(target / questionsPerBatch));
  console.log('Starting web-search refill — bank: ' + before + ', target: +' + target + ' (' + batchesNeeded + ' batches)');

  let totalAdded = 0;
  const usedTopics = [];

  try {
    for (let i = 1; i <= batchesNeeded; i++) {
      console.log('   === Batch ' + i + '/' + batchesNeeded + ' (topic memory: ' + (Array.isArray(usedTopics) ? usedTopics.length : 0) + ' items) ===');
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
