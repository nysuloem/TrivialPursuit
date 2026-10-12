// Runtime compatibility layer for the trivia generator.
//
// Legacy search calls remain on OPENAI_MODEL, while plain generation and
// validation calls are routed to OPENAI_GENERATION_MODEL. Responses web-search
// calls are routed to OPENAI_NEWS_SEARCH_MODEL.

const fs = require('node:fs');
const path = require('node:path');
const originalFetch = global.fetch;

// Patch the legacy refill generator before index.js requires it. The previous
// History scaffold was much too narrow (World Wars / Cold War / US civil-rights
// heavy) and the duplicate detector still allowed the same answer/topic to come
// back with reworded clues. Keep the existing DB history, but use it as a true
// "do not revisit this topic" ledger for non-generic answers.
try {
  const refillPath = path.join(__dirname, 'refill.js');
  let source = fs.readFileSync(refillPath, 'utf8');

  const oldHistoryPlan = `  History: [\n    { subcategory: 'world_wars', count: 2 },\n    { subcategory: 'cold_war', count: 1 },\n    { subcategory: 'civil_rights', count: 1 },\n    { subcategory: 'exploration', count: 1 },\n    { subcategory: 'ancient', count: 1 },\n    { subcategory: 'medieval', count: 1 },\n    { subcategory: 'modern', count: 1 },\n  ],`;
  const newHistoryPlan = `  History: [\n    // History should feel global, not like a US/World-Wars category. Modern is\n    // deliberately the largest bucket because its angles now span Canada and\n    // multiple world regions. World Wars are capped at one slot per batch.\n    { subcategory: 'modern', count: 3 },\n    { subcategory: 'ancient', count: 1 },\n    { subcategory: 'medieval', count: 1 },\n    { subcategory: 'exploration', count: 1 },\n    { subcategory: 'cold_war', count: 1 },\n    { subcategory: 'civil_rights', count: 1 },\n    { subcategory: 'world_wars', count: 1 },\n  ],`;

  const oldModernAngles = `    modern: [\n      'famous_firsts',\n      'inventions',\n      'scandals',\n      'turning_points',\n      'leaders',\n      'cold_war_era',\n      'social_movements',\n    ],`;
  const newModernAngles = `    modern: [\n      'canadian_confederation_and_government',\n      'indigenous_canadian_history',\n      'canadian_social_and_cultural_history',\n      'canadian_inventions_and_firsts',\n      'political_history_canada',\n      'political_history_world',\n      'elections_parties_and_parliaments',\n      'constitutions_treaties_and_reforms',\n      'europe_beyond_the_world_wars',\n      'african_history_and_decolonization',\n      'asian_history',\n      'latin_american_history',\n      'middle_eastern_history',\n      'revolutions_and_independence',\n      'women_in_history',\n      'labour_and_social_movements',\n      'science_invention_and_daily_life',\n      'brands_products_and_advertising_history',\n      'retail_and_consumer_history',\n      'obsolete_technology_and_household_products',\n      'political_turning_points',\n    ],`;

  const oldHistorySearch = `  if (slot.category === 'History') {\n    return [\n      eraText,\n      guidance,\n      'history trivia up to year 2000 only — no events after 2000',\n      'focus on events before year 2000: ancient history, medieval, age of exploration, world wars, cold war, civil rights movements, 1980s 1990s history',\n      'accessible family trivia recognizable North America',\n    ].filter(Boolean).join(' ');\n  }`;
  const newHistorySearch = `  if (slot.category === 'History') {\n    return [\n      eraText,\n      guidance,\n      'history trivia up to year 2000 only — no events after 2000',\n      'use a genuinely global range: Canadian history, Indigenous history in Canada, political history, elections and governments, constitutions and reforms, Europe beyond the world wars, Africa, Asia, Latin America, the Middle East, ancient civilizations, medieval societies, exploration, independence movements, revolutions, political and social change, inventions and everyday life',\n      'include consumer and everyday-life history too: famous old brands, discontinued products, department stores, advertising slogans, household technology, toys, cars, food brands, retail chains, packaging and products people remember from earlier decades',\n      'American history may appear, but it must not dominate; World War I and World War II together should be a small minority of History questions',\n      'prefer different countries, centuries, peoples, movements and kinds of history from one question to the next',\n      'accessible family trivia recognizable to Canadian players',\n    ].filter(Boolean).join(' ');\n  }`;

  const oldDuplicateRule = `    if (sameAnswer && !isBroadReusableAnswer(newAnswer) && wordingSimilarity >= 0.45) return true;`;
  const newDuplicateRule = `    // If a distinctive answer has ever appeared in this category, retire that\n    // answer/topic entirely rather than allowing a cosmetically reworded clue.\n    if (sameAnswer && !isBroadReusableAnswer(newAnswer)) return true;`;

  if (source.includes(oldHistoryPlan)) source = source.replace(oldHistoryPlan, newHistoryPlan);
  if (source.includes(oldModernAngles)) source = source.replace(oldModernAngles, newModernAngles);
  if (source.includes(oldHistorySearch)) source = source.replace(oldHistorySearch, newHistorySearch);
  if (source.includes(oldDuplicateRule)) source = source.replace(oldDuplicateRule, newDuplicateRule);

  fs.writeFileSync(refillPath, source, 'utf8');
  console.log('[trivia-diversity] broadened History toward Canada + world politics + consumer history; repeated distinctive answers retired across the full DB history');
} catch (error) {
  console.warn('[trivia-diversity] runtime refill patch skipped:', error.message || error);
}

const FAMILY_TRIVIA_QUALITY = `
You are writing questions for a lively family Trivial Pursuit game, not an academic exam.

QUESTION QUALITY RULES:
- Prioritize FUN, RECOGNIZABLE, broadly knowable trivia for teens and adults playing together.
- Difficulty mix for ordinary questions: about 45% easy, 45% medium, 10% challenging. Only explicitly labelled pie questions may be genuinely hard.
- Avoid obscure names, minor dates, tiny statistical records, niche production credits, specialist terminology, deep-cut episode details, exact vote totals, exact scores, exact release dates, and other "you either memorized it or you don't" minutiae.
- Ask about facts that a reasonably well-read person could know, infer, or enjoy learning.
- Prefer famous people, major events, iconic works, widely known discoveries, landmarks, animals, inventions, teams, games, songs, films, TV shows, and cultural moments.
- Within every generated batch, cover MANY DIFFERENT subjects. Do not write two questions about the same franchise, celebrity, team, country, war, scientific concept, game, film series, TV series, musician, or historical figure.
- Do not reuse the same answer more than once in a category batch.
- Avoid merely rewording a familiar trivia question. If two questions would feel like the same topic at the table, keep only one.
- The examples and famous names in any search guidance are ILLUSTRATIONS, not preferred answers. Deliberately range beyond them instead of repeatedly choosing the most obvious examples.
- Rotate eras, regions, genres, sports, sciences, and forms of entertainment aggressively.
- Canadian material is welcome, but do not let any one country dominate Geography, History, Sports, or Pop Culture.
- For HISTORY specifically: strongly diversify across Canadian history, Indigenous history in Canada, political history, elections, parties, parliaments, constitutions, treaties, reforms, Europe outside the World Wars, Africa, Asia, Latin America, the Middle East, ancient civilizations, medieval societies, independence movements, revolutions, social history, inventions, and everyday life. US history and the World Wars must be a minority, not the default.
- HISTORY should also include consumer memory and material culture: old or discontinued brands and products, department stores and retail chains, famous advertising, household gadgets, toys, cars, food products, packaging, and technologies associated with earlier decades. These should be recognizable and fun, not obscure corporate trivia.
- Political-history questions should focus on significant leaders, elections, parties, governments, laws, institutions, scandals, constitutional changes and turning points that a general audience could plausibly know; avoid microscopic vote counts and procedural minutiae.
- Questions should usually be answerable in a short phrase or name.
- Write cleanly and conversationally. The goal is "Oh, I know this!" and "That's a good question," not frustration.
`;

if (typeof originalFetch === 'function') {
  global.fetch = async function routedOpenAIFetch(input, init = {}) {
    try {
      const url = typeof input === 'string' ? input : input?.url;
      const isOpenAI = typeof url === 'string' && url.includes('api.openai.com');
      const bodyText = typeof init?.body === 'string' ? init.body : null;

      if (isOpenAI && bodyText) {
        const body = JSON.parse(bodyText);
        let changed = false;

        if (url.includes('/v1/chat/completions') && !body.tools) {
          if (process.env.OPENAI_GENERATION_MODEL) body.model = process.env.OPENAI_GENERATION_MODEL;
          if (Array.isArray(body.messages)) {
            body.messages = [
              { role: 'system', content: FAMILY_TRIVIA_QUALITY },
              ...body.messages,
            ];
          }
          changed = true;
        }

        if (url.includes('/v1/responses') && process.env.OPENAI_NEWS_SEARCH_MODEL) {
          body.model = process.env.OPENAI_NEWS_SEARCH_MODEL;
          changed = true;
        }

        if (changed) {
          const headers = { ...(init.headers || {}) };
          delete headers['content-length'];
          delete headers['Content-Length'];
          init = { ...init, headers, body: JSON.stringify(body) };
        }
      }
    } catch {
      // Never let model-routing logic interfere with an otherwise valid call.
    }

    return originalFetch(input, init);
  };

  console.log(
    '[openai-model-router] generation=' +
      (process.env.OPENAI_GENERATION_MODEL || 'unchanged') +
      ', news-search=' +
      (process.env.OPENAI_NEWS_SEARCH_MODEL || 'unchanged') +
      ', legacy-search=' +
      (process.env.OPENAI_MODEL || 'gpt-4o') +
      ', family-trivia-quality=v4'
  );
}
