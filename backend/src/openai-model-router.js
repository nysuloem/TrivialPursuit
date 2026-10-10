// Runtime compatibility layer for the trivia generator.
//
// The legacy generator still uses Chat Completions + web_search_preview for
// its general web lookup step. Current GPT-6 reasoning models support web
// search through the Responses API, not that legacy Chat Completions tool
// shape. To improve question writing without breaking search, keep those
// legacy search calls on OPENAI_MODEL (currently gpt-4o), while routing plain
// generation/validation Chat Completions calls to OPENAI_GENERATION_MODEL.
// Responses web-search calls are routed to OPENAI_NEWS_SEARCH_MODEL.

const originalFetch = global.fetch;

if (typeof originalFetch === 'function') {
  global.fetch = async function routedOpenAIFetch(input, init = {}) {
    try {
      const url = typeof input === 'string' ? input : input?.url;
      const isOpenAI = typeof url === 'string' && url.includes('api.openai.com');
      const bodyText = typeof init?.body === 'string' ? init.body : null;

      if (isOpenAI && bodyText) {
        const body = JSON.parse(bodyText);
        let changed = false;

        if (
          url.includes('/v1/chat/completions') &&
          !body.tools &&
          process.env.OPENAI_GENERATION_MODEL
        ) {
          body.model = process.env.OPENAI_GENERATION_MODEL;
          changed = true;
        }

        if (
          url.includes('/v1/responses') &&
          process.env.OPENAI_NEWS_SEARCH_MODEL
        ) {
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
      (process.env.OPENAI_MODEL || 'gpt-4o')
  );
}
