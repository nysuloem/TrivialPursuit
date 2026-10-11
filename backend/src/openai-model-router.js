// Runtime compatibility layer for the trivia generator.
//
// Legacy search calls remain on OPENAI_MODEL, while plain generation and
// validation calls are routed to OPENAI_GENERATION_MODEL. Responses web-search
// calls are routed to OPENAI_NEWS_SEARCH_MODEL.

const originalFetch = global.fetch;

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
- Rotate eras, regions, genres, sports, sciences, and forms of entertainment aggressively.
- Canadian material is welcome, but do not let any one country dominate Geography, History, Sports, or Pop Culture.
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

          // Add one consistent editorial brief to every plain question-writing /
          // validation call. This keeps the existing generator structure while
          // fixing the two biggest play problems: brutal difficulty and narrow,
          // repetitive subject matter.
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
      ', family-trivia-quality=v2'
  );
}
