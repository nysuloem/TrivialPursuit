const MEME_RULE = 'For Pop Culture & Current Events, never ask for the name, title, nickname or caption of a meme. Ask about real events, people, platforms, discoveries or culture instead.';
function asksForMemeName(q) {
  if (!q || q.category !== 'Pop Culture & Current Events') return false;
  const text = String(q.question || '').toLowerCase();
  return /\b(?:which|what)\s+(?:(?:viral|internet|popular|famous|online|classic)\s+)*meme\b/.test(text)
    || /\bname\s+(?:the|this|that|a)\b[^?]{0,100}\bmeme\b/.test(text)
    || (/\bmemes?\b/.test(text) && /\b(?:name|title|nickname|caption|called|known as)\b/.test(text));
}
module.exports = {MEME_RULE, asksForMemeName};
