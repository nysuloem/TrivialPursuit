const OpenAI = require('openai');
const { insertQuestions, logRefill, getUnusedCount, getLowCategories, CATEGORIES } = require('./db');

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
const REFILL_AMOUNT = parseInt(process.env.REFILL_AMOUNT || '250', 10);
const THRESHOLD = parseInt(process.env.LOW_QUESTION_THRESHOLD || '250', 10);
const MIN_PER_CATEGORY = parseInt(process.env.MIN_PER_CATEGORY || '50', 10);
const SEARCH_DELAY_MS = parseInt(process.env.SEARCH_DELAY_MS || '450', 10);
const BATCH_DELAY_MS = parseInt(process.env.BATCH_DELAY_MS || '1200', 10);

// Set to true only if your questions table/db insert supports these columns.
// The generator uses these internally either way, but by default strips them before insert.
const DB_SUPPORTS_EXTENDED_FIELDS = process.env.DB_SUPPORTS_EXTENDED_FIELDS === 'true';

let isRefilling = false;

const DISTRIBUTION = {
  'Geography': { regular: 8, pie: 1 },
  'TV, Movies & Music': { regular: 10, pie: 1 },
  'History': { regular: 8, pie: 1 },
  'Science & Nature': { regular: 8, pie: 1 },
  'Sports & Games': { regular: 10, pie: 1 },
  'Pop Culture & Current Events': { regular: 10, pie: 1 },
};

const DIFFICULTY_CYCLE = ['easy', 'medium', 'medium', 'easy', 'medium', 'pie'];

const ERA_POOLS = {
  'TV, Movies & Music': ['1980s', '1990s', '2000s', '2010s', '2020s', '1990s', '2000s', '1980s', '2020s', 'timeless'],
  'Sports & Games': ['1980s', '1990s', '2000s', '2010s', '2020s', 'timeless', '1990s', '2000s', '2010s', '2020s'],
  'Pop Culture & Current Events': ['2020s', '2020s', '2020s', '2020s', '2010s', '2000s'],
  'Science & Nature': ['timeless', 'timeless', '2020s', '2010s', '2000s', '1990s'],
  'Geography': ['timeless', 'timeless', '2020s', '2000s', '1990s'],
  'History': ['timeless', '1980s', '1990s', '2000s', '2020s', 'classic'],
};

const CATEGORY_SLOT_PLANS = {
  'Sports & Games': [
    { subcategory: 'sports', count: 4 },
    { subcategory: 'video_games', count: 3 },
    { subcategory: 'board_games', count: 2 },
    { subcategory: 'card_games', count: 1 },
  ],
  'TV, Movies & Music': [
    { subcategory: 'tv_show', count: 4 },
    { subcategory: 'movie', count: 3 },
    { subcategory: 'music', count: 3 },
  ],
  'Science & Nature': [
    { subcategory: 'animals', count: 2 },
    { subcategory: 'space', count: 1 },
    { subcategory: 'human_body', count: 1 },
    { subcategory: 'technology', count: 1 },
    { subcategory: 'plants', count: 1 },
    { subcategory: 'weather', count: 1 },
    { subcategory: 'ocean', count: 1 },
  ],
  'Pop Culture & Current Events': [
    { subcategory: 'current_events', count: 3 },
    { subcategory: 'celebrity', count: 2 },
    { subcategory: 'teen_culture', count: 2 },
    { subcategory: 'viral', count: 1 },
    { subcategory: 'politics', count: 1 },
    { subcategory: 'sports_news', count: 1 },
  ],
  'Geography': [
    { subcategory: 'cities', count: 2 },
    { subcategory: 'countries', count: 2 },
    { subcategory: 'borders', count: 1 },
    { subcategory: 'rivers', count: 1 },
    { subcategory: 'mountains', count: 1 },
    { subcategory: 'records', count: 1 },
  ],
  'History': [
    { subcategory: 'modern', count: 2 },
    { subcategory: 'world_wars', count: 1 },
    { subcategory: 'cold_war', count: 1 },
    { subcategory: 'civil_rights', count: 1 },
    { subcategory: 'exploration', count: 1 },
    { subcategory: 'ancient', count: 1 },
    { subcategory: 'medieval', count: 1 },
  ],
};

const QUESTION_ANGLES = {
  'Sports & Games': {
    sports: [
      'players_and_legends',
      'teams_and_rivalries',
      'stadiums_and_arenas',
      'broadcasters_and_media',
      'rules_and_penalties',
      'trophies_and_championships',
      'logos_uniforms_and_mascots',
      'coaches_and_managers',
      'olympic_moments',
      'sports_business_and_expansion',
      'famous_games_and_moments',
      'canadian_sports_culture',
    ],
    video_games: [
      'console_history',
      'iconic_characters',
      'gameplay_mechanics',
      'franchises',
      'developers_and_studios',
      'arcade_history',
      'handheld_gaming',
      'pc_gaming',
      'esports',
      'mobile_games',
      'gaming_music_and_sound',
      'gaming_cultural_impact',
    ],
    board_games: [
      'classic_board_games',
      'modern_board_games',
      'rules_and_mechanics',
      'game_inventors',
      'party_games',
      'strategy_games',
      'word_games',
      'trivia_games',
      'family_games',
      'game_components',
    ],
    card_games: [
      'poker',
      'blackjack',
      'uno',
      'magic_the_gathering',
      'pokemon_cards',
      'playing_card_history',
      'trick_taking_games',
      'collectible_card_games',
    ],
  },
  'TV, Movies & Music': {
    tv_show: ['sitcoms', 'dramas', 'streaming_hits', 'classic_tv', 'reality_tv', 'animated_tv', 'tv_catchphrases', 'series_finales', 'spinoffs', 'award_winners'],
    movie: ['blockbusters', 'franchises', 'directors', 'actors', 'animated_movies', 'movie_music', 'box_office', 'behind_the_scenes', 'awards', 'cult_classics'],
    music: ['pop_stars', 'rock_bands', 'hip_hop', 'country', 'music_videos', 'albums', 'chart_records', 'awards', 'concerts_and_tours', 'canadian_music'],
  },
  'Science & Nature': {
    animals: ['animal_records', 'animal_behavior', 'pets', 'marine_animals', 'birds', 'insects', 'mammals', 'weird_adaptations'],
    space: ['planets', 'moon_and_mars', 'space_telescopes', 'astronauts', 'space_missions', 'solar_system'],
    human_body: ['organs', 'senses', 'brain', 'blood', 'bones', 'sleep', 'digestion'],
    technology: ['inventions', 'everyday_tech', 'internet', 'phones', 'transportation', 'medical_tech'],
    plants: ['trees', 'flowers', 'crops', 'plant_defenses', 'plant_records', 'carnivorous_plants'],
    weather: ['storms', 'lightning', 'temperature_records', 'snow_and_ice', 'climate_phenomena'],
    ocean: ['deep_sea', 'coral_reefs', 'sharks', 'whales', 'ocean_records'],
  },
  'Pop Culture & Current Events': {
    current_events: ['major_news', 'world_events', 'north_american_news', 'environment_news', 'technology_news'],
    celebrity: ['award_shows', 'celebrity_couples', 'famous_interviews', 'public_feuds', 'career_comebacks'],
    teen_culture: ['tiktok', 'youtube', 'streamers', 'gen_z_slang', 'viral_products'],
    viral: ['memes', 'internet_challenges', 'viral_videos', 'social_media_moments'],
    politics: ['elections', 'leaders', 'court_cases', 'political_firsts'],
    sports_news: ['headline_sports_moments', 'major_trades', 'championship_headlines', 'olympic_news'],
  },
  'Geography': {
    cities: ['landmarks', 'city_nicknames', 'population', 'host_cities', 'urban_features'],
    countries: ['flags', 'capitals', 'borders', 'name_changes', 'islands', 'country_records'],
    borders: ['unusual_borders', 'landlocked_countries', 'enclaves', 'border_changes'],
    rivers: ['famous_rivers', 'river_records', 'river_cities', 'waterfalls'],
    mountains: ['famous_mountains', 'mountain_records', 'volcanoes', 'mountain_ranges'],
    records: ['largest_smallest', 'hottest_coldest', 'northernmost_southernmost', 'geographic_extremes'],
  },
  'History': {
    modern: ['famous_firsts', 'inventions', 'scandals', 'turning_points', 'leaders'],
    world_wars: ['home_front', 'major_battles', 'wartime_inventions', 'leaders', 'canadian_war_history'],
    cold_war: ['space_race', 'spies', 'walls_and_borders', 'nuclear_age', 'pop_culture_links'],
    civil_rights: ['famous_figures', 'landmark_events', 'court_cases', 'protest_movements'],
    exploration: ['famous_explorers', 'ships', 'maps', 'polar_exploration', 'space_exploration_history'],
    ancient: ['egypt', 'rome', 'greece', 'ancient_inventions', 'ancient_wonders'],
    medieval: ['castles', 'plague', 'vikings', 'knights', 'trade_routes'],
  },
};

const ANGLE_SEARCH_GUIDANCE = {
  players_and_legends: 'famous athletes, nicknames, iconic career moments, recognizable stars only; avoid obscure stat-only trivia',
  teams_and_rivalries: 'famous teams, rivalries, dynasties, playoff matchups, expansion teams, relocation stories',
  stadiums_and_arenas: 'famous stadiums and arenas, unusual features, naming history, home teams, iconic venues',
  broadcasters_and_media: 'famous sports broadcasters, theme songs, TV coverage, commentary catchphrases, sports media moments',
  rules_and_penalties: 'sports rules, penalties, scoring systems, rule changes, unusual rules casual fans can understand',
  trophies_and_championships: 'major trophies and championship traditions, Stanley Cup, Super Bowl, World Series, NBA Finals, Grey Cup',
  logos_uniforms_and_mascots: 'team logos, mascots, jersey changes, colours, uniform traditions, famous sports branding',
  coaches_and_managers: 'famous coaches and managers, championship coaches, recognizable leadership stories',
  olympic_moments: 'Olympic host cities, mascots, ceremonies, records, famous medal moments, Canadian Olympic stories',
  sports_business_and_expansion: 'team relocations, expansion teams, league mergers, drafts, trades, salary caps, franchise stories',
  famous_games_and_moments: 'iconic games, buzzer beaters, miracle comebacks, famous goals, recognizable moments',
  canadian_sports_culture: 'Hockey Night in Canada, Grey Cup, Canadian athletes, Canadian teams, curling, Olympics, sports traditions',

  console_history: 'Nintendo, Sega, PlayStation, Xbox, console launches, hardware features, console wars, sales milestones',
  iconic_characters: 'Mario, Link, Sonic, Pikachu, Master Chief, Lara Croft, recognizable game characters and origins',
  gameplay_mechanics: 'power-ups, open worlds, save files, motion controls, battle royale, platforming, game mechanics',
  franchises: 'Zelda, Mario Kart, Pokémon, Call of Duty, GTA, Minecraft, Fortnite, Final Fantasy, Halo',
  developers_and_studios: 'Nintendo, Sega, Sony, Microsoft, Rockstar, Blizzard, Valve, EA, Ubisoft, studio histories',
  arcade_history: 'Pac-Man, Donkey Kong, Space Invaders, Street Fighter, Mortal Kombat, arcade cabinets and high scores',
  handheld_gaming: 'Game Boy, Nintendo DS, PSP, Switch, handheld console history and famous portable games',
  pc_gaming: 'Steam, The Sims, Doom, World of Warcraft, Minecraft, mods, PC gaming milestones',
  esports: 'League of Legends, Dota 2, Counter-Strike, Fortnite, esports tournaments, prize pools, famous events',
  mobile_games: 'Angry Birds, Candy Crush, Pokémon Go, mobile gaming records, app-store gaming trends',
  gaming_music_and_sound: 'famous video game music, sound effects, composers, theme songs, iconic gaming audio',
  gaming_cultural_impact: 'video games in movies, TV, culture, controversies, ratings, moral panics, classroom or family relevance',

  classic_board_games: 'Monopoly, Scrabble, Clue, Risk, Battleship, Trivial Pursuit, chess, checkers, recognizable classics',
  modern_board_games: 'Catan, Ticket to Ride, Codenames, Pandemic, Carcassonne, modern tabletop games families may know',
  rules_and_mechanics: 'dice, cards, tiles, boards, trading, bluffing, cooperative games, simple rule facts',
  game_inventors: 'inventors and origin stories of famous games, but only games most families know',
  party_games: 'Pictionary, Taboo, Charades, Twister, party game history and rules',
  strategy_games: 'chess, Risk, Catan, Stratego, Go, strategy game concepts and famous facts',
  word_games: 'Scrabble, Boggle, crosswords, Wordle, word-game rules, tiles, scoring, origin stories',
  trivia_games: 'Trivial Pursuit, Jeopardy, quiz shows, trivia formats, famous trivia games',
  family_games: 'Uno, Sorry!, Trouble, Life, Guess Who?, Connect Four, family game rules and origins',
  game_components: 'dice, meeples, tokens, spinners, boards, cards, timers, game pieces and their origins',

  default: 'recognizable North American family trivia topic with an interesting clue, not obscure specialist material',
};

const VALID_SUBCATEGORIES = {
  'Sports & Games': ['nhl', 'nba', 'nfl', 'mlb', 'golf', 'olympics', 'tennis', 'soccer', 'sports', 'video_games', 'board_games', 'card_games', 'esports'],
  'TV, Movies & Music': ['tv_show', 'movie', 'music', 'streaming', 'reality_tv'],
  'Science & Nature': ['space', 'animals', 'human_body', 'technology', 'plants', 'weather', 'chemistry', 'physics', 'scientists', 'food_science', 'ocean'],
  'Pop Culture & Current Events': ['current_events', 'celebrity', 'teen_culture', 'viral', 'politics', 'sports_news'],
  'Geography': ['capitals', 'countries', 'rivers', 'mountains', 'records', 'cities', 'borders'],
  'History': ['ancient', 'medieval', 'world_wars', 'cold_war', 'civil_rights', 'modern', 'exploration'],
};

const QUESTION_SYSTEM_PROMPT = [
  'You are an expert trivia writer crafting questions for a Canadian family Trivial Pursuit-style board game.',
  'Players span three generations: teenagers (13-18), Gen X parents (40-55), and boomers (60+).',
  '',
  '=== PLAYABILITY TARGET ===',
  'This is a family board game, not a quiz bowl tournament.',
  'The answer should usually be a recognizable household-name topic.',
  'The clue should be interesting, but not obscure.',
  'A good question makes players say: "I should know this."',
  'A bad question makes players say: "How would anyone know that?"',
  '',
  'Prefer famous people, places, teams, movies, shows, songs, games, inventions, animals, events, landmarks, and discoveries.',
  'Avoid minor details, obscure names, exact dates unless iconic, niche records, and one-off viral moments that disappeared quickly.',
  '',
  '=== BRIDGE PRINCIPLE ===',
  'Give enough context that an older player can guess a teen answer, and a teen can guess an older answer.',
  '',
  '=== DIFFICULTY ===',
  'easy = the answer is broadly familiar and the clue gives strong context.',
  'medium = the answer is familiar, but the clue requires some knowledge or reasoning.',
  'pie = harder because the clue is less obvious, NOT because the answer is obscure.',
  '',
  '=== BANNED QUESTION ENDINGS ===',
  'NEVER end with: "what is it?" "who is it?" "what is this?" "who is this?" "who is he/she?" "name this..."',
  'Ask directly: Which, Who, What, How many, In which city, Name the.',
  '',
  '=== CORE RULES ===',
  'SHORT ANSWERS: Maximum 5 words, ideally 1-3. One clear unambiguous answer.',
  'NO ANSWER LEAKAGE: The answer word must NEVER appear in the question.',
  'NO AS-OF PHRASING: Never write "as of 2024", "currently", or "at the time". State years naturally when relevant.',
  '',
  '=== GEOGRAPHIC & CULTURAL RELEVANCE ===',
  '70% of questions should cover North American culture, history, sports, and entertainment.',
  '30% can be global, but only topics a North American family would plausibly know.',
  'Canadian content: aim for about 15% across the whole bank. Mark canadian:true only when specifically about Canada.',
  '',
  '=== SPORTS & GAMES DIVERSITY RULES ===',
  'Sports questions must NOT default to player statistics. No more than half of sports questions should be about individual athletes.',
  'Rotate across athletes, teams, stadiums/arenas, broadcasters/media, trophies/championships, rules/penalties, mascots/logos/uniforms, league expansion/relocation/drafts/trades, famous games, and Canadian sports culture.',
  'Video game questions must rotate across consoles, characters, gameplay mechanics, developers/studios, franchises, music/sound, arcade history, handheld systems, PC gaming, esports, mobile games, and cultural impact.',
  'Board/card game questions must rotate across classic games, modern tabletop games, party games, word games, strategy games, card games, trading card games, pieces/components, rules/scoring, inventors, and origin stories.',
  '',
  '=== OUTPUT ===',
  'Respond ONLY with valid JSON, no markdown, no code blocks.',
  'Use this shape exactly:',
  '{ "category": "...", "subcategory": "...", "angle": "...", "era": "...", "difficulty": "...", "question": "...", "answer": "...", "is_pie": false, "canadian": false }',
].join('\n');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function choiceFromCycle(list, index) {
  if (!Array.isArray(list) || list.length === 0) return null;
  return list[((index % list.length) + list.length) % list.length];
}

function normalizeCategory(cat) {
  if (!cat) return null;
  const c = String(cat).trim();
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

function normalizeSubcategory(category, subcategory) {
  const safe = String(subcategory || '')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');

  if (category === 'Sports & Games') {
    if (safe === 'sports') return 'sports';
    if (safe.includes('video')) return 'video_games';
    if (safe.includes('board')) return 'board_games';
    if (safe.includes('card') || safe.includes('poker') || safe.includes('uno')) return 'card_games';
  }

  const allowed = VALID_SUBCATEGORIES[category] || [];
  if (allowed.includes(safe)) return safe;

  if (category === 'TV, Movies & Music') {
    if (safe.includes('tv')) return 'tv_show';
    if (safe.includes('film')) return 'movie';
  }

  return allowed[0] || safe || 'misc';
}

function legacyEra(era) {
  // Preserves compatibility with the original schema, where era must be teen/millennial/classic/timeless.
  if (era === 'timeless') return 'timeless';
  if (era === '2020s' || era === '2010s') return 'teen';
  if (era === '2000s' || era === '1990s') return 'millennial';
  if (era === '1980s' || era === '1970s' || era === 'classic') return 'classic';
  return 'timeless';
}

function answerInQuestion(question, answer) {
  if (!question || !answer) return false;
  const q = String(question).toLowerCase();
  const stopWords = new Set(['the', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'for', 'is', 'was', 'are', 'were', 'and', 'or', 'but', 'it', 'its', 'this', 'that', 'these', 'those', 'by', 'with', 'from', 'as', 'be', 'been', 'has', 'had', 'have', 'which', 'who', 'what', 'where', 'when', 'how', 'not', 'no', 'do', 'did', 'does']);
  const answerWords = String(answer)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopWords.has(w));
  return answerWords.some(word => q.includes(word));
}

function hasBannedEnding(question) {
  const q = String(question || '').trim().toLowerCase();
  return /(?:what is it\?|who is it\?|what is this\?|who is this\?|who is he\?|who is she\?|what are they\?|name this)/.test(q);
}

function classifyQuestionType(question) {
  const q = String(question || '').toLowerCase();

  if (/\b(player|athlete|scored|goals|points|home runs|touchdowns|mvp|hart|heisman|batting|yards|assists|rebounds|wins above replacement)\b/.test(q)) return 'player_stat';
  if (/\b(stadium|arena|field|ballpark|centre|center|dome|garden|rink|court|course)\b/.test(q)) return 'venue';
  if (/\b(broadcaster|commentator|announcer|called games|voice of|play-by-play|hockey night|theme song)\b/.test(q)) return 'media';
  if (/\b(rule|penalty|offside|icing|foul|yard line|periods|innings|downs|power play|red card)\b/.test(q)) return 'rules';
  if (/\b(mascot|logo|jersey|uniform|colours|colors|helmet|nickname)\b/.test(q)) return 'branding';
  if (/\b(trophy|cup|championship|finals|super bowl|world series|stanley cup|grey cup|olympic medal)\b/.test(q)) return 'championships';
  if (/\b(console|nintendo|playstation|xbox|sega|game boy|switch)\b/.test(q)) return 'video_console';
  if (/\b(board|dice|tiles|tokens|cards|meeples|scrabble|monopoly|catan|clue|risk)\b/.test(q)) return 'tabletop';
  return 'other';
}

function tooManySimilarQuestions(currentQuestions, newQuestion) {
  const type = classifyQuestionType(newQuestion.question);
  const angle = newQuestion.angle;
  const subcategory = newQuestion.subcategory;

  const recent = currentQuestions.slice(-12);
  const sameType = recent.filter(q => classifyQuestionType(q.question) === type).length;
  const sameAngle = recent.filter(q => q.angle === angle).length;
  const sameSubcategory = recent.filter(q => q.subcategory === subcategory).length;

  if (type === 'player_stat' && sameType >= 1) return true;
  if (sameType >= 3) return true;
  if (sameAngle >= 1) return true;
  if (subcategory === 'sports' && sameSubcategory >= 4) return true;
  return false;
}

function makeTopicKey(q) {
  return [
    q.category,
    q.subcategory,
    q.angle,
    String(q.answer || '').toLowerCase().replace(/[^a-z0-9]/g, ''),
  ].join(':');
}

function looksLikeRepeat(q, usedTopics) {
  if (!q || !q.answer) return false;
  const answer = String(q.answer).toLowerCase().trim();
  const key = makeTopicKey(q);
  return usedTopics.some(t => {
    const s = String(t).toLowerCase();
    return s === answer || s === key || (answer.length > 4 && s.includes(answer));
  });
}

function buildSlotsForCategory(category, batchNum, desiredCount, pieCategory) {
  const plan = CATEGORY_SLOT_PLANS[category] || [{ subcategory: 'general', count: desiredCount }];
  const eraPool = ERA_POOLS[category] || ['timeless'];
  const slots = [];

  let cursor = batchNum * 7;

  for (const block of plan) {
    const subcategory = block.subcategory;
    const angleList = (QUESTION_ANGLES[category] && QUESTION_ANGLES[category][subcategory]) || ['default'];

    for (let i = 0; i < block.count; i++) {
      const angle = choiceFromCycle(angleList, cursor + i);
      const era = choiceFromCycle(eraPool, cursor + i);
      const difficulty = choiceFromCycle(DIFFICULTY_CYCLE, cursor + i);

      slots.push({
        category,
        subcategory,
        angle,
        era,
        difficulty,
        is_pie: category === pieCategory && slots.length === 0 ? true : difficulty === 'pie',
      });
    }

    cursor += block.count + 3;
  }

  // If the plan creates fewer slots than requested, continue cycling through the same structure.
  let extensionIndex = 0;
  while (slots.length < desiredCount) {
    const block = choiceFromCycle(plan, cursor + extensionIndex);
    const angleList = (QUESTION_ANGLES[category] && QUESTION_ANGLES[category][block.subcategory]) || ['default'];
    slots.push({
      category,
      subcategory: block.subcategory,
      angle: choiceFromCycle(angleList, cursor + extensionIndex),
      era: choiceFromCycle(eraPool, cursor + extensionIndex),
      difficulty: choiceFromCycle(DIFFICULTY_CYCLE, cursor + extensionIndex),
      is_pie: category === pieCategory && slots.length === 0,
    });
    extensionIndex++;
  }

  return slots.slice(0, desiredCount);
}

function sourceRequired(slot) {
  return (
    slot.category === 'Pop Culture & Current Events' ||
    slot.era === '2020s' ||
    slot.subcategory === 'current_events' ||
    slot.angle === 'technology_news' ||
    slot.angle === 'major_news'
  );
}

function buildSearchQuery(slot) {
  const guidance = ANGLE_SEARCH_GUIDANCE[slot.angle] || ANGLE_SEARCH_GUIDANCE.default;
  const eraText = slot.era === 'timeless' ? '' : slot.era;
  const currentText = sourceRequired(slot) ? 'latest recent 2025 2026' : '';
  return [
    eraText,
    currentText,
    guidance,
    'accessible family trivia recognizable North America',
  ].filter(Boolean).join(' ');
}

async function searchWeb(query, requireFresh = false) {
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const searchTools = [
    [{ type: 'web_search_preview' }],
    [{ type: 'web_search_preview_2025_03_11' }],
  ];

  for (const tools of searchTools) {
    try {
      const response = await client.chat.completions.create({
        model: MODEL,
        max_tokens: 900,
        tools,
        messages: [{
          role: 'user',
          content: [
            'Today is ' + today + '.',
            'Search for: ' + query,
            '',
            'Find 4-6 trivia-worthy facts with recognizable answers and helpful context.',
            'Prioritize facts that are accessible to a Canadian/North American family.',
            'Avoid obscure specialist facts and minor names.',
            'For recent events, include the year and avoid stale information.',
          ].join('\n'),
        }],
      });
      const content = response.choices[0]?.message?.content || '';
      if (content.trim().length > 80) return content;
    } catch (e) {
      // Try next tool format.
    }
  }

  if (requireFresh) {
    console.log('   Fresh search failed; skipping non-search fallback for current/recent slot.');
    return '';
  }

  try {
    const response = await client.chat.completions.create({
      model: MODEL,
      max_tokens: 700,
      messages: [{
        role: 'user',
        content: [
          'Using your general knowledge, list 4-6 accessible trivia facts about:',
          query,
          '',
          'The answer should be widely recognizable. The clue can be interesting but not obscure.',
          'Avoid exact dates, niche records, specialist facts, and minor names.',
        ].join('\n'),
      }],
    });
    return response.choices[0]?.message?.content || '';
  } catch (e) {
    console.log('   Search fallback failed: ' + e.message);
    return '';
  }
}

async function generateQuestionForSlot(slot, content, usedTopics) {
  const prompt = [
    'Write exactly 1 trivia question for this slot in a Canadian family Trivial Pursuit-style game.',
    '',
    'Slot:',
    JSON.stringify(slot, null, 2),
    '',
    'Source material / inspiration:',
    content || 'No source material available. Use only broadly known, stable general knowledge.',
    '',
    'Recently used topics to avoid:',
    usedTopics.slice(-100).join(', ') || 'none',
    '',
    'Critical rules:',
    '- The answer must be recognizable to at least one generation at a family game table.',
    '- The clue can teach something new, but the answer itself should not be obscure.',
    '- Do not ask for an isolated statistic unless the statistic is iconic.',
    '- Do not default to player records.',
    '- Respect the exact subcategory, angle, era, and difficulty from the slot.',
    '- For 1980s, 1990s, and 2000s slots, choose content genuinely associated with that decade.',
    '- For timeless slots, choose broadly familiar facts not tied to one news cycle.',
    '- Maximum answer length: 5 words.',
    '- The answer words must not appear in the question text.',
    '- No banned endings such as "who is this?" or "what is it?".',
    '',
    'Return ONLY valid JSON with this exact shape:',
    '{ "category": "...", "subcategory": "...", "angle": "...", "era": "...", "difficulty": "...", "question": "...", "answer": "...", "is_pie": false, "canadian": false }',
  ].join('\n');

  const response = await client.chat.completions.create({
    model: MODEL,
    max_tokens: 650,
    messages: [
      { role: 'system', content: QUESTION_SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
    response_format: { type: 'json_object' },
  });

  const obj = JSON.parse(response.choices[0]?.message?.content || '{}');
  const category = normalizeCategory(obj.category || slot.category) || slot.category;
  const subcategory = normalizeSubcategory(category, obj.subcategory || slot.subcategory);

  return {
    category,
    question: String(obj.question || '').trim(),
    answer: String(obj.answer || '').trim(),
    is_pie: slot.is_pie === true || obj.is_pie === true || slot.difficulty === 'pie',
    canadian: obj.canadian === true,
    subcategory,
    // Internal/optional metadata:
    angle: String(obj.angle || slot.angle).trim(),
    precise_era: String(obj.era || slot.era).trim(),
    era: legacyEra(String(obj.era || slot.era).trim()),
    difficulty: String(obj.difficulty || slot.difficulty).trim(),
    topic_key: '',
  };
}

async function rewriteQuestion(q) {
  try {
    const prompt = [
      'This trivia question has a problem: the answer appears in the question, the ending is banned, or the wording is not direct enough.',
      '',
      JSON.stringify(q, null, 2),
      '',
      'Rewrite only the question. Keep the same answer.',
      'The rewritten question must not contain the answer words.',
      'Use a helpful clue and ask directly.',
      '',
      'Return ONLY valid JSON: { "question": "rewritten question here" }',
    ].join('\n');

    const response = await client.chat.completions.create({
      model: MODEL,
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    });

    const result = JSON.parse(response.choices[0]?.message?.content || '{}');
    const rewritten = String(result.question || '').trim();
    if (rewritten && !answerInQuestion(rewritten, q.answer) && !hasBannedEnding(rewritten)) {
      return { ...q, question: rewritten };
    }
    return null;
  } catch (e) {
    return null;
  }
}

async function validateQuestion(q) {
  const prompt = [
    'Evaluate this trivia question for a Canadian family board game.',
    '',
    JSON.stringify(q, null, 2),
    '',
    'Score from 1 to 5:',
    '- recognizability: Is the answer familiar to many people?',
    '- clue_helpfulness: Does the question give enough context?',
    '- obscurity_risk: Is this too niche or specialist?',
    '- diversity_value: Does this add variety compared with common trivia questions?',
    '',
    'Reject questions that are too obscure, too stat-heavy, too specialist, misleading, ambiguous, or only answerable by a superfan.',
    'For pie questions, allow slightly harder clues, but still require a recognizable answer.',
    '',
    'Return ONLY valid JSON:',
    '{ "keep": true, "recognizability": 4, "clue_helpfulness": 4, "obscurity_risk": 2, "diversity_value": 4, "reason": "..." }',
  ].join('\n');

  try {
    const response = await client.chat.completions.create({
      model: MODEL,
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    });

    const result = JSON.parse(response.choices[0]?.message?.content || '{}');
    const recognizability = Number(result.recognizability || 0);
    const clue = Number(result.clue_helpfulness || 0);
    const obscurity = Number(result.obscurity_risk || 5);
    const keep = result.keep === true && recognizability >= 3 && clue >= 3 && obscurity <= 3;

    if (!keep) {
      console.log('   Validator rejected: ' + q.answer + ' — ' + (result.reason || 'no reason'));
    }
    return keep;
  } catch (e) {
    // If validator fails, keep only structurally safe questions rather than dropping the whole batch.
    return Boolean(q.question && q.answer && !answerInQuestion(q.question, q.answer) && !hasBannedEnding(q.question));
  }
}

function sanitizeForInsert(q) {
  q.topic_key = makeTopicKey(q);

  const base = {
    category: q.category,
    question: q.question,
    answer: q.answer,
    is_pie: q.is_pie === true,
    canadian: q.canadian === true,
    subcategory: q.subcategory,
    era: q.era,
  };

  if (!DB_SUPPORTS_EXTENDED_FIELDS) return base;

  return {
    ...base,
    angle: q.angle,
    difficulty: q.difficulty,
    precise_era: q.precise_era,
    topic_key: q.topic_key,
  };
}

async function generateQuestionWithRetries(slot, usedTopics, currentQuestions) {
  const query = buildSearchQuery(slot);
  const freshRequired = sourceRequired(slot);
  const content = await searchWeb(query, freshRequired);

  if (!content && freshRequired) return null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    let q = await generateQuestionForSlot(slot, content, usedTopics);

    if (!q || !q.question || !q.answer) continue;

    if (answerInQuestion(q.question, q.answer) || hasBannedEnding(q.question)) {
      const rewritten = await rewriteQuestion(q);
      if (!rewritten) continue;
      q = rewritten;
    }

    if (looksLikeRepeat(q, usedTopics)) {
      console.log('   Rejected repeat topic: ' + q.answer);
      continue;
    }

    if (tooManySimilarQuestions(currentQuestions, q)) {
      console.log('   Rejected repetitive question type/angle: ' + q.answer);
      continue;
    }

    const keep = await validateQuestion(q);
    if (!keep) continue;

    q.topic_key = makeTopicKey(q);
    return q;
  }

  return null;
}

async function generateCategoryBatch(category, batchNum, count, pieCategory, usedTopics) {
  const slots = buildSlotsForCategory(category, batchNum, count, pieCategory);
  const questions = [];

  console.log('     [' + category + '] Generating from ' + slots.length + ' diversity slots...');

  for (const slot of slots) {
    try {
      console.log('       Slot: ' + slot.subcategory + ' / ' + slot.angle + ' / ' + slot.era + ' / ' + slot.difficulty);
      const q = await generateQuestionWithRetries(slot, usedTopics, questions);
      if (!q) {
        console.log('       No usable question for slot.');
        continue;
      }

      questions.push(q);
      usedTopics.push(q.answer);
      usedTopics.push(q.topic_key);
      await sleep(SEARCH_DELAY_MS);
    } catch (err) {
      console.error('       Slot failed: ' + err.message);
    }
  }

  console.log('     [' + category + '] ' + questions.length + ' questions ready');
  return questions;
}

async function generateBatch(batchNum, focusCategories, usedTopics) {
  const allQuestions = [];
  const categoriesToProcess = focusCategories || CATEGORIES;
  const pieCategory = CATEGORIES[batchNum % CATEGORIES.length];

  for (const category of categoriesToProcess) {
    try {
      const targetCount = focusCategories ? 8 : (DISTRIBUTION[category]?.regular || 8);
      const generated = await generateCategoryBatch(category, batchNum, targetCount, pieCategory, usedTopics);
      allQuestions.push(...generated);
    } catch (err) {
      console.error('     [' + category + '] Error: ' + err.message);
    }

    await sleep(SEARCH_DELAY_MS);
  }

  return allQuestions.map(sanitizeForInsert);
}

async function refillBank(focusCategories) {
  if (isRefilling) {
    console.log('Refill already in progress');
    return;
  }

  isRefilling = true;
  const before = await getUnusedCount();
  const target = focusCategories ? 100 : REFILL_AMOUNT;
  const questionsPerBatch = focusCategories ? (8 * focusCategories.length) : 54;
  const batchesNeeded = Math.max(3, Math.ceil(target / questionsPerBatch));

  console.log('Starting diversity-slot refill — bank: ' + before + ', target: +' + target + ' (' + batchesNeeded + ' batches)');

  let totalAdded = 0;
  const usedTopics = [];

  try {
    for (let i = 1; i <= batchesNeeded; i++) {
      console.log('   === Batch ' + i + '/' + batchesNeeded + ' (topic memory: ' + usedTopics.length + ' items) ===');

      const questions = await generateBatch(i, focusCategories, usedTopics);
      const inserted = await insertQuestions(questions);
      const count = parseInt(inserted, 10) || 0;
      totalAdded += count;

      // Keep a local memory even if insertQuestions drops duplicates.
      questions.forEach(q => {
        if (q.answer) usedTopics.push(q.answer);
        if (q.topic_key) usedTopics.push(q.topic_key);
      });

      console.log('   Batch ' + i + ' complete: ' + count + ' inserted, ' + totalAdded + ' total so far');
      if (i < batchesNeeded) await sleep(BATCH_DELAY_MS);
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

module.exports = {
  refillBank,
  checkAndRefillIfNeeded,
  isRefilling: () => isRefilling,
  generateBatch,
  // Exported for quick local tests/debugging.
  buildSlotsForCategory,
  classifyQuestionType,
  answerInQuestion,
};