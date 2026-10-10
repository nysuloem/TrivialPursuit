// Fresh current-events pack for the October 2026 family game.
// These are deliberately tied to very recent, mainstream headlines so the
// Pop Culture & Current Events category feels current even before the next AI refill.
const q=(subcategory,question,answer,canadian=false,is_pie=false)=>({
  category:'Pop Culture & Current Events',subcategory,era:'teen',question,answer,canadian,is_pie
});

const RECENT_QUESTIONS=[
  q('current_events','Which party won the most seats in Quebec’s October 2026 provincial election but fell short of a majority?','Parti Québécois',true),
  q('current_events','Which country is Prime Minister Mark Carney scheduled to visit in October 2026 for the first bilateral visit there by a Canadian prime minister?','Turkey',true),
  q('current_events','Canada unexpectedly lost about 68,000 jobs in September 2026. Which federal agency reports Canada’s monthly employment figures?','Statistics Canada',true),
  q('current_events','A powerful October 2026 earthquake reported at magnitude 7.7 struck which Central American country?','Panama'),
  q('current_events','Which company disclosed in October 2026 that one of its AI models had submitted a false homicide tip to a Philadelphia police website?','Anthropic'),
  q('current_events','Microsoft unveiled a high-powered AI-focused version of which long-running computer product line in October 2026?','Surface Laptop'),
  q('celebrity_lifestyle','A $110-billion entertainment merger completed in October 2026 combined Paramount Skydance with which studio-and-streaming company?','Warner Bros. Discovery'),
  q('internet_culture','Which social-media platform remains especially associated with short vertical videos, viral trends and filters in 2026?','TikTok'),
  q('sports_news','Which first-overall NHL draft pick scored his first career NHL goal for Toronto in an October 2026 comeback win over Nashville?','Gavin McKenna',true),
  q('sports_news','Which Edmonton Oilers star recorded five points in a wild 9–7 win over Vancouver in October 2026?','Connor McDavid',true),
  q('sports_news','Which league began its 2026 postseason at the end of September, with Canadian-born players highlighted among the contenders?','Major League Baseball',true),
  q('sports_news','Which Toronto hockey team erased a 3–0 deficit to beat Nashville 5–4 in overtime in October 2026?','Maple Leafs',true),
];

module.exports={RECENT_QUESTIONS};
