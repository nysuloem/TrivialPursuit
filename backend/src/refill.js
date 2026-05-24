const OpenAI = require('openai');
const {
  insertQuestions,
  logRefill,
  getUnusedCount,
  getLowCategories,
  CATEGORIES,
} = require('./db');

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
const NEWS_SEARCH_MODEL = process.env.OPENAI_NEWS_SEARCH_MODEL || 'gpt-4o';

const REFILL_AMOUNT = parseInt(process.env.REFILL_AMOUNT || '250', 10);
const THRESHOLD = parseInt(process.env.LOW_QUESTION_THRESHOLD || '250', 10);
const SEARCH_DELAY_MS = parseInt(process.env.SEARCH_DELAY_MS || '450', 10);
const BATCH_DELAY_MS = parseInt(process.env.BATCH_DELAY_MS || '1200', 10);
const NEWS_SEARCH_TIMEOUT_MS = parseInt(process.env.NEWS_SEARCH_TIMEOUT_MS || '30000', 10);

// Set this to true only if your database insert supports angle/difficulty/precise_era/topic_key.
const DB_SUPPORTS_EXTENDED_FIELDS = process.env.DB_SUPPORTS_EXTENDED_FIELDS === 'true';

let isRefilling = false;

const DISTRIBUTION = {
  Geography: { regular: 8, pie: 1 },
  'TV, Movies & Music': { regular: 10, pie: 1 },
  History: { regular: 8, pie: 1 },
  'Science & Nature': { regular: 10, pie: 1 },
  'Sports & Games': { regular: 10, pie: 1 },
  'Pop Culture & Current Events': { regular: 10, pie: 1 },
};

const DIFFICULTY_CYCLE = ['medium', 'medium', 'easy', 'medium', 'pie', 'medium'];

const ERA_POOLS = {
  'TV, Movies & Music': [
    '1980s',
    '1990s',
    '2000s',
    '2010s',
    '2020s',
    '1990s',
    '2000s',
    '1980s',
    '2020s',
    'timeless',
  ],
  'Sports & Games': [
    '1980s',
    '1990s',
    '2000s',
    '2010s',
    '2020s',
    'timeless',
    '1990s',
    '2000s',
    '2010s',
    '2020s',
  ],
  'Pop Culture & Current Events': [
    '2020s',
    '2020s',
    '2020s',
    '2020s',
    '2020s',
    '2020s',
    '2010s',
    '2020s',
  ],
  'Science & Nature': [
    'timeless',
    'timeless',
    '2020s',
    '2010s',
    '2000s',
    '1990s',
    'timeless',
    '2020s',
    'timeless',
    '2010s',
  ],
  Geography: ['timeless', 'timeless', '2020s', '2000s', '1990s'],
  History: ['timeless', '1980s', '1990s', '2000s', '2020s', 'classic'],
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
    { subcategory: 'plants', count: 1 },
    { subcategory: 'human_body', count: 1 },
    { subcategory: 'space', count: 1 },
    { subcategory: 'technology', count: 1 },
    { subcategory: 'chemistry', count: 1 },
    { subcategory: 'physics', count: 1 },
    { subcategory: 'earth_science', count: 1 },
    { subcategory: 'ecology', count: 1 },
  ],

  // Balanced but not so news-heavy that focused Pop Culture top-ups get stuck.
  'Pop Culture & Current Events': [
    { subcategory: 'current_events', count: 3 },
    { subcategory: 'sports_news', count: 1 },
    { subcategory: 'internet_culture', count: 2 },
    { subcategory: 'teen_culture', count: 1 },
    { subcategory: 'celebrity_lifestyle', count: 1 },
    { subcategory: 'viral', count: 2 },
  ],

  Geography: [
    { subcategory: 'cities', count: 2 },
    { subcategory: 'countries', count: 2 },
    { subcategory: 'borders', count: 1 },
    { subcategory: 'rivers', count: 1 },
    { subcategory: 'mountains', count: 1 },
    { subcategory: 'records', count: 1 },
  ],

  History: [
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
    tv_show: [
      'sitcoms',
      'dramas',
      'streaming_hits',
      'classic_tv',
      'reality_tv',
      'animated_tv',
      'tv_catchphrases',
      'series_finales',
      'spinoffs',
      'award_winners',
    ],
    movie: [
      'blockbusters',
      'franchises',
      'directors',
      'actors',
      'animated_movies',
      'movie_music',
      'box_office',
      'behind_the_scenes',
      'awards',
      'cult_classics',
    ],
    music: [
      'pop_stars',
      'rock_bands',
      'hip_hop',
      'country',
      'music_videos',
      'albums',
      'chart_records',
      'awards',
      'concerts_and_tours',
      'canadian_music',
    ],
  },

  'Science & Nature': {
    animals: [
      'animal_behavior',
      'animal_physiology',
      'animal_senses',
      'animal_migration',
      'animal_communication',
      'animal_defenses',
      'evolutionary_adaptations',
      'marine_animals',
      'birds',
      'insects',
      'mammals',
    ],
    plants: [
      'plant_defenses',
      'plant_communication',
      'carnivorous_plants',
      'plant_reproduction',
      'seeds_and_germination',
      'trees_and_forests',
      'crop_science',
      'photosynthesis_applications',
    ],
    human_body: [
      'brain_and_memory',
      'blood_and_immunity',
      'digestion_and_metabolism',
      'senses_and_perception',
      'bones_and_muscles',
      'sleep_and_circadian_rhythms',
      'hormones',
      'heart_and_circulation',
    ],
    space: [
      'space_missions',
      'planetary_features',
      'exoplanets',
      'space_telescopes',
      'moon_and_mars',
      'asteroids_and_comets',
      'black_holes',
      'solar_system_comparisons',
    ],
    technology: [
      'everyday_technology',
      'medical_technology',
      'internet_and_computing',
      'ai_and_robotics',
      'transportation_technology',
      'energy_technology',
      'communication_technology',
      'invention_origins',
    ],
    chemistry: [
      'everyday_chemistry',
      'food_chemistry',
      'materials_science',
      'elements_and_periodic_table',
      'chemical_reactions',
      'household_chemistry',
      'medicine_and_drugs',
    ],
    physics: [
      'light_and_color',
      'sound_and_hearing',
      'electricity_and_magnetism',
      'motion_and_forces',
      'heat_and_temperature',
      'waves',
      'space_physics',
      'everyday_physics',
    ],
    earth_science: [
      'volcanoes',
      'earthquakes',
      'rocks_and_minerals',
      'weather_extremes',
      'oceans_and_currents',
      'climate_patterns',
      'fossils',
      'plate_tectonics',
    ],
    ecology: [
      'food_webs',
      'invasive_species',
      'conservation_successes',
      'ecosystem_engineers',
      'pollination',
      'symbiosis',
      'urban_ecology',
      'climate_impacts',
    ],
  },

  'Pop Culture & Current Events': {
    current_events: [
      'major_news',
      'world_events',
      'north_american_news',
      'environment_news',
      'technology_news',
      'surprising_news',
      'canadian_news',
      'global_headlines',
      'politics_and_government',
      'major_court_cases',
      'international_conflict',
      'major_elections',
    ],
    sports_news: [
      'headline_sports_moments',
      'major_trades',
      'championship_headlines',
      'olympic_news',
      'major_sports_records',
      'canadian_sports_news',
    ],
    internet_culture: [
      'memes',
      'internet_phrases',
      'social_media_apps',
      'youtube_culture',
      'streamers',
      'online_platforms',
      'viral_videos',
      'internet_challenges',
    ],
    teen_culture: [
      'tiktok',
      'gen_z_slang',
      'viral_products',
      'gaming_crossovers',
      'schoolyard_trends',
      'youth_fashion',
      'apps_and_filters',
      'toy_and_collectible_trends',
    ],
    celebrity_lifestyle: [
      'celebrity_businesses',
      'celebrity_brands',
      'fashion_and_red_carpets',
      'famous_interviews',
      'celebrity_couples',
      'movie_premieres',
      'social_media_celebrities',
      'reality_tv_celebrities',
    ],
    viral: [
      'memes',
      'internet_challenges',
      'viral_videos',
      'social_media_moments',
      'internet_phrases',
      'widely_known_online_moments',
    ],
  },

  Geography: {
    cities: [
      'landmarks',
      'city_nicknames',
      'population',
      'host_cities',
      'urban_features',
    ],
    countries: [
      'flags',
      'capitals',
      'borders',
      'name_changes',
      'islands',
      'country_records',
    ],
    borders: [
      'unusual_borders',
      'landlocked_countries',
      'enclaves',
      'border_changes',
    ],
    rivers: ['famous_rivers', 'river_records', 'river_cities', 'waterfalls'],
    mountains: [
      'famous_mountains',
      'mountain_records',
      'volcanoes',
      'mountain_ranges',
    ],
    records: [
      'largest_smallest',
      'hottest_coldest',
      'northernmost_southernmost',
      'geographic_extremes',
    ],
  },

  History: {
    modern: [
      'famous_firsts',
      'inventions',
      'scandals',
      'turning_points',
      'leaders',
    ],
    world_wars: [
      'home_front',
      'major_battles',
      'wartime_inventions',
      'leaders',
      'canadian_war_history',
    ],
    cold_war: [
      'space_race',
      'spies',
      'walls_and_borders',
      'nuclear_age',
      'pop_culture_links',
    ],
    civil_rights: [
      'famous_figures',
      'landmark_events',
      'court_cases',
      'protest_movements',
    ],
    exploration: [
      'famous_explorers',
      'ships',
      'maps',
      'polar_exploration',
      'space_exploration_history',
    ],
    ancient: ['egypt', 'rome', 'greece', 'ancient_inventions', 'ancient_wonders'],
    medieval: ['castles', 'plague', 'vikings', 'knights', 'trade_routes'],
  },
};

const ANGLE_SEARCH_GUIDANCE = {
  // Sports & games
  players_and_legends:
    'famous athletes, nicknames, iconic career moments, recognizable stars only; avoid obscure stat-only trivia',
  teams_and_rivalries:
    'famous teams, rivalries, dynasties, playoff matchups, expansion teams, relocation stories',
  stadiums_and_arenas:
    'famous stadiums and arenas, unusual features, naming history, home teams, iconic venues',
  broadcasters_and_media:
    'famous sports broadcasters, theme songs, TV coverage, commentary catchphrases, sports media moments',
  rules_and_penalties:
    'sports rules, penalties, scoring systems, rule changes, unusual rules casual fans can understand',
  trophies_and_championships:
    'major trophies and championship traditions, Stanley Cup, Super Bowl, World Series, NBA Finals, Grey Cup',
  logos_uniforms_and_mascots:
    'team logos, mascots, jersey changes, colours, uniform traditions, famous sports branding',
  coaches_and_managers:
    'famous coaches and managers, championship coaches, recognizable leadership stories',
  olympic_moments:
    'Olympic host cities, mascots, ceremonies, records, famous medal moments, Canadian Olympic stories',
  sports_business_and_expansion:
    'team relocations, expansion teams, league mergers, drafts, trades, salary caps, franchise stories',
  famous_games_and_moments:
    'iconic games, buzzer beaters, miracle comebacks, famous goals, recognizable moments',
  canadian_sports_culture:
    'Hockey Night in Canada, Grey Cup, Canadian athletes, Canadian teams, curling, Olympics, sports traditions',

  console_history:
    'Nintendo, Sega, PlayStation, Xbox, console launches, hardware features, console wars, sales milestones',
  iconic_characters:
    'Mario, Link, Sonic, Pikachu, Master Chief, Lara Croft, recognizable game characters and origins',
  gameplay_mechanics:
    'power-ups, open worlds, save files, motion controls, battle royale, platforming, game mechanics',
  franchises:
    'Zelda, Mario Kart, Pokémon, Call of Duty, GTA, Minecraft, Fortnite, Final Fantasy, Halo',
  developers_and_studios:
    'Nintendo, Sega, Sony, Microsoft, Rockstar, Blizzard, Valve, EA, Ubisoft, studio histories',
  arcade_history:
    'Pac-Man, Donkey Kong, Space Invaders, Street Fighter, Mortal Kombat, arcade cabinets and high scores',
  handheld_gaming:
    'Game Boy, Nintendo DS, PSP, Switch, handheld console history and famous portable games',
  pc_gaming:
    'Steam, The Sims, Doom, World of Warcraft, Minecraft, mods, PC gaming milestones',
  esports:
    'League of Legends, Dota 2, Counter-Strike, Fortnite, esports tournaments, prize pools, famous events',
  mobile_games:
    'Angry Birds, Candy Crush, Pokémon Go, mobile gaming records, app-store gaming trends',
  gaming_music_and_sound:
    'famous video game music, sound effects, composers, theme songs, iconic gaming audio',
  gaming_cultural_impact:
    'video games in movies, TV, culture, controversies, ratings, moral panics, classroom or family relevance',

  classic_board_games:
    'Monopoly, Scrabble, Clue, Risk, Battleship, Trivial Pursuit, chess, checkers, recognizable classics',
  modern_board_games:
    'Catan, Ticket to Ride, Codenames, Pandemic, Carcassonne, modern tabletop games families may know',
  rules_and_mechanics:
    'dice, cards, tiles, boards, trading, bluffing, cooperative games, simple rule facts',
  game_inventors:
    'inventors and origin stories of famous games, but only games most families know',
  party_games: 'Pictionary, Taboo, Charades, Twister, party game history and rules',
  strategy_games:
    'chess, Risk, Catan, Stratego, Go, strategy game concepts and famous facts',
  word_games:
    'Scrabble, Boggle, crosswords, Wordle, word-game rules, tiles, scoring, origin stories',
  trivia_games: 'Trivial Pursuit, Jeopardy, quiz shows, trivia formats, famous trivia games',
  family_games:
    'Uno, Sorry!, Trouble, Life, Guess Who?, Connect Four, family game rules and origins',
  game_components:
    'dice, meeples, tokens, spinners, boards, cards, timers, game pieces and their origins',

  // Science
  animal_behavior:
    'animal behavior facts involving familiar animals; focus on surprising behavior with a clear explanation, not simple records',
  animal_physiology:
    'accessible animal physiology facts: how animals breathe, circulate blood, regulate temperature, survive extremes, or sense the world; avoid simple largest/fastest facts',
  animal_senses:
    'animal senses and perception: echolocation, magnetoreception, infrared sensing, smell, vision, hearing; recognizable animals only',
  animal_migration:
    'animal migration facts involving monarch butterflies, salmon, whales, birds, turtles, and other recognizable animals',
  animal_communication:
    'animal communication: whale songs, bee dances, bird calls, prairie dog alarms, elephant rumbles; accessible but not too simple',
  animal_defenses:
    'animal defenses: camouflage, mimicry, venom, toxins, armor, startle displays, immune defenses; recognizable examples',
  evolutionary_adaptations:
    'evolutionary adaptations in familiar animals and plants; focus on why the trait is useful, not obscure taxonomy',
  marine_animals:
    'marine animal adaptations and behavior involving whales, sharks, octopuses, coral, sea turtles, seals, or deep-sea animals',
  birds:
    'bird adaptations, migration, songs, feathers, flight, nests, senses, and recognizable bird examples',
  insects:
    'insect behavior and adaptations: bees, ants, monarchs, mosquitoes, butterflies, beetles, cicadas; avoid obscure taxonomy',
  mammals:
    'mammal adaptations and physiology: whales, bats, bears, elephants, dogs, cats, primates; accessible mechanisms',

  plant_defenses:
    'plant defenses: thorns, toxins, smells, chemical defenses, mimicry, plant-insect interactions; accessible examples',
  plant_communication:
    'plant signaling and communication: chemical signals, mycorrhizal networks, warning signals, touch responses; avoid overclaiming',
  carnivorous_plants:
    'carnivorous plants: Venus flytrap, pitcher plants, sundews, nutrient-poor soils, trapping mechanisms',
  plant_reproduction:
    'plant reproduction: pollination, seeds, fruit, flowers, spores, dispersal by animals, wind, water',
  seeds_and_germination:
    'seeds and germination: dormancy, seed banks, fire-triggered germination, seed dispersal, crop seeds',
  trees_and_forests:
    'trees and forests: rings, old trees, forest communication, fire ecology, rainforest facts, carbon storage',
  crop_science:
    'crop science: wheat, corn, rice, potatoes, seedless fruit, plant breeding, food crops, agricultural discoveries',
  photosynthesis_applications:
    'photosynthesis and plant energy facts connected to food, oxygen, crops, forests, and climate',

  brain_and_memory:
    'brain and memory facts: hippocampus, sleep and memory, senses, decision-making, famous brain discoveries; accessible',
  blood_and_immunity:
    'blood and immune system facts: blood types, vaccines, antibodies, white blood cells, inflammation; accessible',
  digestion_and_metabolism:
    'digestion and metabolism facts: enzymes, gut microbes, insulin, energy use, stomach acid, liver, pancreas',
  senses_and_perception:
    'human senses and perception: taste, smell, color vision, hearing, balance, optical illusions',
  bones_and_muscles:
    'bones and muscles: joints, tendons, skeletal muscle, exercise, calcium, bone healing; accessible mechanisms',
  sleep_and_circadian_rhythms:
    'sleep and circadian rhythms: melatonin, jet lag, REM sleep, body clocks, sleep deprivation',
  hormones:
    'hormones and physiology: insulin, adrenaline, cortisol, melatonin, thyroid hormone; accessible cause-effect facts',
  heart_and_circulation:
    'heart and circulation facts: blood pressure, heart valves, pacemakers, exercise, oxygen delivery',

  space_missions:
    'space missions: Apollo, Mars rovers, Voyager, James Webb, Artemis, ISS, recognizable mission facts',
  planetary_features:
    'planetary features beyond basic planet ID: storms, atmospheres, moons, volcanoes, rings, rotation, extreme temperatures',
  exoplanets:
    'exoplanets and planet discovery: planets around other stars, habitable zones, transit method, famous discoveries',
  space_telescopes:
    'space telescopes: Hubble, James Webb, cosmic images, infrared light, galaxies, early universe',
  moon_and_mars:
    'Moon and Mars facts: rovers, water ice, craters, volcanoes, human exploration, recognizable missions',
  asteroids_and_comets:
    'asteroids and comets: impacts, tails, meteor showers, asteroid belt, dinosaur impact, space missions',
  black_holes:
    'black holes: event horizons, first image, gravity, stars collapsing, accessible facts without equations',
  solar_system_comparisons:
    'solar system comparisons: why planets differ, moons, atmospheres, rotation, magnetic fields, not simple naming questions',

  everyday_technology:
    'everyday technology science: microwaves, GPS, touchscreens, Wi-Fi, barcodes, QR codes, LEDs, batteries',
  medical_technology:
    'medical technology: MRI, X-rays, vaccines, pacemakers, insulin pumps, ultrasound, prosthetics',
  internet_and_computing:
    'internet and computing: search engines, cloud computing, encryption, computer chips, coding, data storage',
  ai_and_robotics:
    'AI and robotics: chatbots, image recognition, self-driving sensors, robots in factories and medicine; accessible',
  transportation_technology:
    'transportation technology: airplanes, trains, electric cars, seatbelts, airbags, GPS, hybrid engines',
  energy_technology:
    'energy technology: solar panels, wind turbines, batteries, electric cars, hydroelectricity, nuclear power',
  communication_technology:
    'communication technology: radio, satellites, fiber optics, smartphones, Bluetooth, Wi-Fi',
  invention_origins:
    'origin stories of familiar inventions and discoveries; focus on recognizable inventions, not obscure inventors',

  everyday_chemistry:
    'everyday chemistry: soap, rust, baking soda, vinegar, pH, acids and bases, cleaning, cooking reactions',
  food_chemistry:
    'food chemistry: why bread rises, why onions make you cry, chili heat, fermentation, browning reactions, caffeine',
  materials_science:
    'materials science: plastics, glass, concrete, carbon fiber, graphene, Kevlar, rubber, semiconductors',
  elements_and_periodic_table:
    'periodic table facts with recognizable elements: oxygen, carbon, gold, helium, lithium, uranium, sodium; avoid rote atomic numbers',
  chemical_reactions:
    'chemical reactions in daily life: combustion, rusting, baking, fermentation, photosynthesis, batteries',
  household_chemistry:
    'household chemistry: bleach, soap, detergents, vinegar, baking soda, hard water, stains',
  medicine_and_drugs:
    'medicine chemistry: aspirin, antibiotics, insulin, vaccines, anesthesia, caffeine, drug delivery; accessible and not medical advice',

  light_and_color:
    'light and color: rainbows, prisms, blue sky, sunsets, lasers, pigments, screens, color vision',
  sound_and_hearing:
    'sound and hearing: echoes, ultrasound, decibels, Doppler effect, animal hearing, music physics without music trivia',
  electricity_and_magnetism:
    'electricity and magnetism: batteries, magnets, motors, generators, lightning, power grids',
  motion_and_forces:
    'motion and forces: gravity, friction, seatbelts, roller coasters, sports physics, rockets',
  heat_and_temperature:
    'heat and temperature: insulation, sweating, freezing, boiling, thermometers, heat transfer',
  waves:
    'waves: water waves, sound waves, light waves, microwaves, radio waves, earthquakes',
  space_physics:
    'space physics: gravity, orbits, tides, rockets, escape velocity, satellites; accessible without equations',
  everyday_physics:
    'everyday physics: why ice floats, why skies are blue, why mirrors reflect, how microwaves heat food, why seatbelts work',

  volcanoes:
    'volcano facts: eruptions, lava, ash, famous volcanoes, volcanic islands, monitoring',
  earthquakes:
    'earthquake facts: faults, seismic waves, tsunamis, magnitude, famous earthquakes',
  rocks_and_minerals:
    'rocks and minerals: diamonds, quartz, granite, limestone, fossils, minerals in daily life',
  weather_extremes:
    'weather extremes: tornadoes, hurricanes, lightning, hail, blizzards, heat waves',
  oceans_and_currents:
    'oceans and currents: Gulf Stream, tides, deep ocean, ocean conveyor belt, El Niño',
  climate_patterns:
    'climate patterns: El Niño, La Niña, monsoons, seasons, greenhouse effect; accessible and not political unless needed',
  fossils:
    'fossils: dinosaurs, amber, fossil footprints, ancient animals, fossil formation, famous discoveries',
  plate_tectonics:
    'plate tectonics: continents moving, mountain formation, earthquakes, volcanoes, ring of fire',

  food_webs:
    'food webs and ecology: predators, prey, keystone species, trophic cascades, recognizable examples',
  invasive_species:
    'invasive species: zebra mussels, cane toads, Asian carp, rabbits in Australia, kudzu; accessible',
  conservation_successes:
    'conservation success stories: bald eagles, whales, pandas, ozone layer, protected areas; recognizable',
  ecosystem_engineers:
    'ecosystem engineers: beavers, corals, elephants, termites, kelp forests; how organisms shape habitats',
  pollination:
    'pollination: bees, butterflies, bats, hummingbirds, flowers, crops, coevolution',
  symbiosis:
    'symbiosis: clownfish and anemones, gut microbes, lichens, coral algae, cleaner fish',
  urban_ecology:
    'urban ecology: raccoons, pigeons, coyotes, city trees, heat islands, wildlife in cities',
  climate_impacts:
    'climate impacts on animals, plants, migration, coral bleaching, forests, crops; accessible and evidence-based',

  // News/current events
  major_news:
    'major news stories from Canada, the United States, and the world from the last 6 months',
  world_events:
    'major international events from the last 6 months that North American families likely heard about',
  north_american_news:
    'major Canada and United States news stories from the last 6 months',
  environment_news:
    'major environmental news, climate events, wildfires, storms, conservation stories from the last 6 months',
  technology_news:
    'major technology news from the last 6 months, AI, phones, space, major tech companies',
  surprising_news:
    'surprising but mainstream news stories from the last 6 months that families may have heard about',
  canadian_news:
    'major Canadian news stories from the last 6 months reported by CBC, CTV, Global, or major outlets',
  global_headlines:
    'major global headlines from the last 6 months reported by AP, Reuters, BBC, CNN, CBC, or CTV',
  politics_and_government:
    'major political and government news from the last 6 months in Canada, the US, and globally relevant countries',
  major_court_cases:
    'major court cases, Supreme Court decisions, legal rulings, and major trials from the last 6 months',
  international_conflict:
    'major international conflict, diplomacy, peace talks, sanctions, or geopolitical stories from the last 6 months',
  major_elections:
    'major elections, leadership races, and election outcomes from the last 6 months',

  headline_sports_moments:
    'major sports headlines from the last 6 months in NHL NBA NFL MLB Olympics tennis soccer',
  major_trades:
    'major sports trades and signings from the last 6 months in North American sports',
  championship_headlines:
    'championship winners and major finals from the last 6 months',
  olympic_news:
    'Olympic news, host cities, medal moments, and major Olympic headlines',
  major_sports_records:
    'major sports records broken recently, only widely reported and recognizable records',
  canadian_sports_news:
    'major Canadian sports headlines from the last 6 months from TSN, Sportsnet, CBC, NHL, NBA, MLB, Olympics',

  // Pop culture but not music
  memes:
    'widely known memes, internet phrases, meme images, mainstream online jokes; not music',
  internet_phrases:
    'internet catchphrases, meme phrases, viral expressions, mainstream online language; not songs or lyrics',
  social_media_apps:
    'TikTok, Instagram, Snapchat, BeReal, Twitter/X, Facebook, social media app features and changes',
  youtube_culture:
    'YouTube milestones, famous creators, MrBeast, viral channels, subscriber records, mainstream YouTube culture; not music videos',
  streamers:
    'Twitch streamers, gaming streamers, livestream records, widely known streaming personalities',
  online_platforms:
    'TikTok, YouTube, Twitch, Reddit, Instagram, Snapchat, Discord, Twitter/X, platform features and culture',
  viral_videos:
    'viral videos that reached mainstream family awareness, YouTube and TikTok viral clips; avoid music videos',
  internet_challenges:
    'widely known internet challenges and viral social media challenges; avoid dance challenges based mainly on songs',
  tiktok:
    'widely known TikTok trends, formats, creators, filters, and TikTok culture that reached mainstream awareness; avoid song-based questions',
  gen_z_slang:
    'mainstream Gen Z slang words and phrases understood or discussed by families',
  viral_products:
    'viral products, Stanley cups, Prime drink, Squishmallows, fidget spinners, mainstream trend products',
  gaming_crossovers:
    'Fortnite events, Minecraft, Roblox, gaming crossovers with movies, sports, brands, and internet culture; avoid music-concert questions',
  schoolyard_trends:
    'mainstream school trends, toys, apps, games, and teen pop culture from the 2010s and 2020s',
  youth_fashion:
    'teen fashion trends, footwear, accessories, backpacks, hairstyles, viral clothing trends; not music',
  apps_and_filters:
    'Snapchat filters, TikTok filters, Instagram filters, social media effects, app features',
  toy_and_collectible_trends:
    'Squishmallows, fidget spinners, Pokémon cards as collectibles, Funko Pop, viral toys, schoolyard collectibles',
  celebrity_businesses:
    'celebrity brands, beauty lines, fashion lines, restaurants, non-music business ventures, mainstream celebrity companies',
  celebrity_brands:
    'celebrity beauty brands, fashion brands, sports-team ownership, restaurants, consumer products; not songs or albums',
  fashion_and_red_carpets:
    'famous red carpet looks, celebrity fashion, Met Gala moments, award-show outfits; not music awards as music achievements',
  famous_interviews:
    'famous celebrity interviews, talk show moments, Oprah, late-night TV, widely recognized media moments; not album promotion trivia',
  celebrity_couples:
    'widely known celebrity couples and breakups from mainstream pop culture; not music collaborations',
  movie_premieres:
    'major movie premieres, press tours, red carpets, Barbie and Oppenheimer-style public moments; not soundtrack or song questions',
  social_media_celebrities:
    'influencers, YouTubers, TikTok creators, internet celebrities, social-media fame; not musicians as musicians',
  reality_tv_celebrities:
    'Kardashians, reality TV stars, hosts, contestants, reality-TV fame and brands; not music competition winners unless not about singing',
  social_media_moments:
    'major social media moments, viral posts, platform changes, mainstream online events; not music releases',
  widely_known_online_moments:
    'widely known online moments from TikTok, YouTube, Instagram, Reddit, Twitch, and Twitter/X; not songs or music videos',

  default:
    'recognizable North American family trivia topic with an interesting clue, not obscure specialist material',
};

const VALID_SUBCATEGORIES = {
  'Sports & Games': [
    'nhl',
    'nba',
    'nfl',
    'mlb',
    'golf',
    'olympics',
    'tennis',
    'soccer',
    'sports',
    'video_games',
    'board_games',
    'card_games',
    'esports',
  ],
  'TV, Movies & Music': ['tv_show', 'movie', 'music', 'streaming', 'reality_tv'],
  'Science & Nature': [
    'space',
    'animals',
    'human_body',
    'technology',
    'plants',
    'weather',
    'chemistry',
    'physics',
    'scientists',
    'food_science',
    'ocean',
    'earth_science',
    'ecology',
    'medicine',
  ],
  'Pop Culture & Current Events': [
    'current_events',
    'sports_news',
    'internet_culture',
    'celebrity_lifestyle',
    'teen_culture',
    'viral',
  ],
  Geography: ['capitals', 'countries', 'rivers', 'mountains', 'records', 'cities', 'borders'],
  History: [
    'ancient',
    'medieval',
    'world_wars',
    'cold_war',
    'civil_rights',
    'modern',
    'exploration',
  ],
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
  '=== SPORTS & GAMES DIVERSITY RULES ===',
  'Sports questions must NOT default to player statistics. No more than half of sports questions should be about individual athletes.',
  'Rotate across athletes, teams, stadiums/arenas, broadcasters/media, trophies/championships, rules/penalties, mascots/logos/uniforms, league expansion/relocation/drafts/trades, famous games, and Canadian sports culture.',
  'Video game questions must rotate across consoles, characters, gameplay mechanics, developers/studios, franchises, music/sound, arcade history, handheld systems, PC gaming, esports, mobile games, and cultural impact.',
  'Board/card game questions must rotate across classic games, modern tabletop games, party games, word games, strategy games, card games, trading card games, pieces/components, rules/scoring, inventors, and origin stories.',
  '',
  '=== SCIENCE & NATURE RULES ===',
  'Science & Nature questions should be accessible but not elementary-school obvious.',
  'Avoid overly simple questions such as: which planet has rings, which planet is red, what gas do humans breathe, what organ pumps blood, what do bees make, what is H2O, or how many legs does a spider have.',
  'Prefer questions that connect a familiar answer to an interesting mechanism, adaptation, discovery, comparison, or real-world application.',
  'Rotate across animals, plants, human body, space, chemistry, physics, technology, earth science, ecology, medicine, food science, and environmental science.',
  '',
  '=== POP CULTURE & CURRENT EVENTS RULES ===',
  'This category should include real current events, politics/government, international events, major headlines, and sports headlines.',
  'Current-events questions must come from fresh source material. Never invent current news from memory.',
  'Current-events questions should use recognizable news stories reported by mainstream sources such as CBC, CTV, AP, Reuters, BBC, CNN, TSN, Sportsnet, or ESPN.',
  'For current-events questions, any event date before today is a past event, not a future event.',
  'For current-events questions, events from the last 6 months should be treated as recent.',
  'Pop-culture questions should focus on internet culture, social media, viral products, celebrity lifestyle, and widely discussed public moments.',
  'Do NOT write music-category questions here.',
  'Forbidden in Pop Culture & Current Events: songs, albums, chart records, Grammy wins, music videos, concert tours, bands, singers as musicians, rappers as musicians, lyrics, or music-industry achievements.',
  'Musicians may appear only if the question is clearly about non-music pop culture, such as a movie role, brand, fashion moment, social media event, public relationship, acting role, sports-team ownership, or business venture.',
  '',
  '=== OUTPUT ===',
  'Respond ONLY with valid JSON, no markdown, no code blocks.',
  'Use this shape exactly:',
  '{ "category": "...", "subcategory": "...", "angle": "...", "era": "...", "difficulty": "...", "question": "...", "answer": "...", "is_pie": false, "canadian": false }',
].join('\n');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function withTimeout(promise, ms, label = 'operation') {
  let timer;

  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(label + ' timed out after ' + ms + ' ms'));
    }, ms);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function choiceFromCycle(list, index) {
  if (!Array.isArray(list) || list.length === 0) return null;
  return list[((index % list.length) + list.length) % list.length];
}

function todayLong() {
  return new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function normalizeCategory(cat) {
  if (!cat) return null;
  const c = String(cat).trim();
  if (CATEGORIES.includes(c)) return c;

  const lower = c.toLowerCase();

  if (
    lower.includes('tv') ||
    lower.includes('movie') ||
    lower.includes('music') ||
    lower.includes('entertainment')
  ) {
    return 'TV, Movies & Music';
  }

  if (
    lower.includes('pop culture') ||
    lower.includes('current event') ||
    lower.includes('trend') ||
    lower.includes('celebrity') ||
    lower.includes('viral') ||
    lower.includes('internet') ||
    lower.includes('news')
  ) {
    return 'Pop Culture & Current Events';
  }

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

  if (category === 'Science & Nature') {
    if (
      safe.includes('earth') ||
      safe.includes('geology') ||
      safe.includes('volcano') ||
      safe.includes('earthquake')
    ) {
      return 'earth_science';
    }
    if (
      safe.includes('eco') ||
      safe.includes('conservation') ||
      safe.includes('pollination') ||
      safe.includes('symbiosis')
    ) {
      return 'ecology';
    }
    if (
      safe.includes('medic') ||
      safe.includes('health') ||
      safe.includes('vaccine') ||
      safe.includes('drug')
    ) {
      return 'medicine';
    }
    if (safe.includes('food')) return 'food_science';
    if (safe.includes('animal')) return 'animals';
    if (safe.includes('plant')) return 'plants';
    if (safe.includes('body') || safe.includes('human')) return 'human_body';
    if (safe.includes('space') || safe.includes('planet')) return 'space';
    if (safe.includes('tech')) return 'technology';
    if (safe.includes('chem')) return 'chemistry';
    if (safe.includes('phys')) return 'physics';
  }

  if (category === 'Pop Culture & Current Events') {
    if (
      safe.includes('news') ||
      safe.includes('current') ||
      safe.includes('headline') ||
      safe.includes('world_event') ||
      safe.includes('canadian_news') ||
      safe.includes('politic') ||
      safe.includes('election') ||
      safe.includes('court') ||
      safe.includes('conflict') ||
      safe.includes('government')
    ) {
      return 'current_events';
    }

    if (safe.includes('sport')) return 'sports_news';

    if (
      safe.includes('internet') ||
      safe.includes('online') ||
      safe.includes('meme') ||
      safe.includes('youtube') ||
      safe.includes('streamer') ||
      safe.includes('platform')
    ) {
      return 'internet_culture';
    }

    if (
      safe.includes('celebrity') ||
      safe.includes('red_carpet') ||
      safe.includes('fashion') ||
      safe.includes('lifestyle') ||
      safe.includes('brand')
    ) {
      return 'celebrity_lifestyle';
    }

    if (safe.includes('teen') || safe.includes('gen_z')) return 'teen_culture';
    if (safe.includes('viral')) return 'viral';
  }

  return allowed[0] || safe || 'misc';
}

function legacyEra(era) {
  if (era === 'timeless') return 'timeless';
  if (era === '2020s' || era === '2010s') return 'teen';
  if (era === '2000s' || era === '1990s') return 'millennial';
  if (era === '1980s' || era === '1970s' || era === 'classic') return 'classic';
  return 'timeless';
}

function answerInQuestion(question, answer) {
  if (!question || !answer) return false;

  const q = String(question).toLowerCase();

  const stopWords = new Set([
    'the',
    'a',
    'an',
    'of',
    'in',
    'on',
    'at',
    'to',
    'for',
    'is',
    'was',
    'are',
    'were',
    'and',
    'or',
    'but',
    'it',
    'its',
    'this',
    'that',
    'these',
    'those',
    'by',
    'with',
    'from',
    'as',
    'be',
    'been',
    'has',
    'had',
    'have',
    'which',
    'who',
    'what',
    'where',
    'when',
    'how',
    'not',
    'no',
    'do',
    'did',
    'does',
  ]);

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

  if (/\b(player|athlete|scored|goals|points|home runs|touchdowns|mvp|hart|heisman|batting|yards|assists|rebounds|wins above replacement)\b/.test(q)) {
    return 'player_stat';
  }

  if (/\b(stadium|arena|field|ballpark|centre|center|dome|garden|rink|court|course)\b/.test(q)) {
    return 'venue';
  }

  if (/\b(broadcaster|commentator|announcer|called games|voice of|play-by-play|hockey night|theme song)\b/.test(q)) {
    return 'media';
  }

  if (/\b(rule|penalty|offside|icing|foul|yard line|periods|innings|downs|power play|red card)\b/.test(q)) {
    return 'rules';
  }

  if (/\b(mascot|logo|jersey|uniform|colours|colors|helmet|nickname)\b/.test(q)) {
    return 'branding';
  }

  if (/\b(trophy|cup|championship|finals|super bowl|world series|stanley cup|grey cup|olympic medal)\b/.test(q)) {
    return 'championships';
  }

  if (/\b(console|nintendo|playstation|xbox|sega|game boy|switch)\b/.test(q)) {
    return 'video_console';
  }

  if (/\b(board|dice|tiles|tokens|cards|meeples|scrabble|monopoly|catan|clue|risk)\b/.test(q)) {
    return 'tabletop';
  }

  return 'other';
}

function overlapsWithMusicCategory(q) {
  if (!q || q.category !== 'Pop Culture & Current Events') return false;

  const text = [q.question, q.answer, q.angle, q.subcategory]
    .join(' ')
    .toLowerCase();

  return /\b(song|single|album|chart|billboard|grammy|grammys|concert|tour|music video|singer|rapper|band|lyrics|streaming record|spotify|apple music|hot 100|number one hit|number-one hit|platinum record|record label)\b/.test(text);
}

function scienceQuestionTooSimple(q) {
  if (!q || q.category !== 'Science & Nature') return false;

  const text = [q.question, q.answer].join(' ').toLowerCase();

  const tooSimplePatterns = [
    /\bwhich planet has rings\b/,
    /\bwhich planet is known for its rings\b/,
    /\bwhat planet has rings\b/,
    /\bwhat planet is red\b/,
    /\bwhich planet is red\b/,
    /\bwhich planet is known as the red planet\b/,
    /\bwhich planet is closest to the sun\b/,
    /\bwhich planet is farthest from the sun\b/,
    /\bwhat gas do humans breathe\b/,
    /\bwhat gas do people breathe\b/,
    /\bwhat gas do plants produce\b/,
    /\bwhat do bees make\b/,
    /\bwhat animal is the king of the jungle\b/,
    /\bwhat is the largest animal\b/,
    /\bwhat is the fastest land animal\b/,
    /\bhow many legs does a spider have\b/,
    /\bwhat force pulls things down\b/,
    /\bwhat is h2o\b/,
    /\bwhat organ pumps blood\b/,
    /\bwhat part of the body pumps blood\b/,
    /\bwhat star is at the center of our solar system\b/,
    /\bwhat is the center of our solar system\b/,
    /\bwhat do plants need for photosynthesis\b/,
    /\bwhat do you call animals that eat meat\b/,
    /\bwhat do you call animals that eat plants\b/,
  ];

  return tooSimplePatterns.some(pattern => pattern.test(text));
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

function tooManyPopCulturePlatformQuestions(currentQuestions, newQuestion) {
  if (!newQuestion || newQuestion.category !== 'Pop Culture & Current Events') return false;

  const platformSubcats = new Set(['internet_culture', 'teen_culture', 'viral']);
  if (!platformSubcats.has(newQuestion.subcategory)) return false;

  const count = currentQuestions.filter(
    q => q.category === 'Pop Culture & Current Events' && platformSubcats.has(q.subcategory)
  ).length;

  return count >= 2;
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

function sourceRequired(slot) {
  return (
    slot.category === 'Pop Culture & Current Events' &&
    (slot.subcategory === 'current_events' || slot.subcategory === 'sports_news')
  );
}

function buildSlotsForCategory(category, batchNum, desiredCount, pieCategory) {
  const plan = CATEGORY_SLOT_PLANS[category] || [
    { subcategory: 'general', count: desiredCount },
  ];

  const eraPool = ERA_POOLS[category] || ['timeless'];
  const slots = [];

  let cursor = batchNum * 7;

  for (const block of plan) {
    const subcategory = block.subcategory;
    const angleList =
      (QUESTION_ANGLES[category] && QUESTION_ANGLES[category][subcategory]) || ['default'];

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

  let extensionIndex = 0;

  while (slots.length < desiredCount) {
    const block = choiceFromCycle(plan, cursor + extensionIndex);
    const angleList =
      (QUESTION_ANGLES[category] && QUESTION_ANGLES[category][block.subcategory]) || ['default'];

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

function buildSearchQuery(slot) {
  const guidance = ANGLE_SEARCH_GUIDANCE[slot.angle] || ANGLE_SEARCH_GUIDANCE.default;
  const eraText = slot.era === 'timeless' ? '' : slot.era;

  if (slot.category === 'Science & Nature') {
    return [
      eraText,
      guidance,
      'accessible but not elementary-school science trivia',
      'familiar answer with interesting mechanism adaptation discovery comparison or application',
      'avoid simple planet facts simple animal records and basic definitions',
    ].filter(Boolean).join(' ');
  }

  if (slot.category === 'Pop Culture & Current Events') {
    if (slot.subcategory === 'internet_culture') {
      return [
        'mainstream internet culture memes YouTube TikTok Twitch social media apps viral videos 2010s 2020s',
        guidance,
        'recognizable family trivia not music not songs not albums',
      ].join(' ');
    }

    if (slot.subcategory === 'celebrity_lifestyle') {
      return [
        'mainstream celebrity lifestyle fashion red carpet celebrity brands interviews reality TV social media 2010s 2020s',
        guidance,
        'recognizable family trivia not songs albums concerts Grammy music charts',
      ].join(' ');
    }

    if (slot.subcategory === 'teen_culture') {
      return [
        'mainstream teen culture 2010s 2020s TikTok YouTube Roblox Fortnite social media viral products school trends',
        guidance,
        'recognizable family trivia not music charts not songs not singers',
      ].join(' ');
    }

    if (slot.subcategory === 'viral') {
      return [
        'mainstream viral internet moments memes 2010s 2020s TikTok YouTube widely recognized',
        guidance,
        'accessible family trivia not music not songs not music videos',
      ].join(' ');
    }
  }

  return [
    eraText,
    guidance,
    'accessible family trivia recognizable North America',
  ].filter(Boolean).join(' ');
}

function buildNewsSearchPrompt(slot) {
  const guidance = ANGLE_SEARCH_GUIDANCE[slot.angle] || ANGLE_SEARCH_GUIDANCE.default;

  if (slot.subcategory === 'sports_news') {
    return [
      'Find recent major sports headlines suitable for Canadian family trivia.',
      'Today is ' + todayLong() + '.',
      'Any event date before today is a past event, not a future event.',
      'Focus on the last 6 months, with preference for the last 30-90 days.',
      'Use mainstream sports/news sources such as TSN, Sportsnet, ESPN, CBC, AP, Reuters, BBC, or CNN.',
      'Cover recognizable stories from NHL, NBA, NFL, MLB, Olympics, tennis, soccer, golf, or major Canadian sports.',
      'Avoid obscure transactions, minor injuries, local-only stories, and niche statistics.',
      '',
      'Specific focus:',
      guidance,
      '',
      'Return 6-10 concise source facts. For each fact include:',
      '- the event/story',
      '- date or month/year',
      '- key people, teams, or places',
      '- why a Canadian/North American family would recognize it',
      '- source/outlet name if visible',
      '',
      'Do not write trivia questions yet.',
    ].join('\n');
  }

  return [
    'Find recent major current events suitable for Canadian family trivia.',
    'Today is ' + todayLong() + '.',
    'Any event date before today is a past event, not a future event.',
    'Do not treat an event as future unless its date is clearly after today.',
    'Focus on the last 6 months, with a strong preference for the last 30-90 days.',
    'Use mainstream news sources such as CBC, CTV, AP, Reuters, BBC, CNN, Global News, NPR, or major Canadian/US outlets.',
    'Cover a mix of Canada, United States, international events, politics/government, court cases, major disasters, environment, technology, science/space, and major global headlines.',
    'Avoid celebrity gossip, niche social-media stories, minor local stories, and music-industry stories.',
    '',
    'Specific focus:',
    guidance,
    '',
    'Return 8-12 concise source facts. For each fact include:',
    '- the event/story',
    '- date or month/year',
    '- key people, places, countries, organizations, or laws involved',
    '- why a Canadian/North American family would recognize it',
    '- source/outlet name if visible',
    '',
    'Do not write trivia questions yet.',
  ].join('\n');
}

function stablePopCultureFallback(slot) {
  const topicHints = {
    celebrity_lifestyle: [
      'Use celebrity topics only when they are not music-category questions.',
      'Good: celebrity brands, fashion, red carpets, movie roles, reality TV, interviews, public relationships, social media moments, acting roles, sports-team ownership, business ventures.',
      'Avoid: songs, albums, chart records, Grammy wins, concert tours, music videos, bands, singers as musicians, rappers as musicians, and music-industry achievements.',
      'Possible non-music examples: Ryan Reynolds and Mint Mobile/Wrexham, The Rock and movies/businesses, Zendaya fashion/acting, Kardashians reality TV/brands, Barbie press tour, celebrity-owned brands.',
    ].join('\n'),

    internet_culture: [
      'Use mainstream internet culture that reached broad awareness.',
      'Good: memes, YouTube milestones, TikTok formats, Twitch/streaming, social media apps, viral videos, internet phrases, online platforms.',
      'Avoid: songs, albums, chart records, Grammy wins, concert tours, music videos, bands, singers as musicians, and music-industry questions.',
      'Possible examples: MrBeast, Wordle, TikTok, BeReal, Instagram, Snapchat, Twitter/X, Twitch, Reddit, Discord, viral memes, platform changes.',
    ].join('\n'),

    teen_culture: [
      'Use teen/youth culture beyond music.',
      'Good: apps, games, toys, collectibles, slang, school trends, fashion items, viral products, gaming crossovers.',
      'Avoid: songs, albums, chart records, Grammy wins, concert tours, music videos, bands, singers as musicians, and music-industry questions.',
      'Possible examples: Roblox, Fortnite, Minecraft, Nintendo Switch, Stanley cups, Squishmallows, Prime drink, Snapchat, TikTok, filters, slang.',
    ].join('\n'),

    viral: [
      'Use widely known viral internet moments, memes, phrases, apps, or challenges.',
      'Avoid music-based viral songs, chart achievements, albums, Grammy wins, concert tours, and music videos.',
      'Choose only trends that reached mainstream awareness, not tiny niche memes.',
    ].join('\n'),
  };

  return [
    'Use only stable, widely recognized pop-culture knowledge.',
    'Do not claim anything is the latest, newest, current, or recent.',
    'This category must NOT duplicate TV, Movies & Music.',
    'Do not write questions where the answer depends on a song, album, chart record, Grammy win, concert tour, band, singer-as-musician, rapper-as-musician, lyric, music video, or music-industry achievement.',
    'The answer should be recognizable to at least one generation, and the clue should help the others guess.',
    '',
    'Topic area:',
    topicHints[slot.subcategory] ||
      'mainstream internet culture, celebrity lifestyle, viral products, and social media.',
  ].join('\n');
}

async function searchCurrentNewsWithOpenAI(slot) {
  const input = [
    'Today is ' + todayLong() + '.',
    'Any event date before today is a past event, not a future event.',
    'Events from the last 6 months should be treated as recent if they occurred before today.',
    '',
    buildNewsSearchPrompt(slot),
  ].join('\n');

  try {
    console.log('   Searching current news with OpenAI Responses web_search...');

    const response = await withTimeout(
      client.responses.create({
        model: NEWS_SEARCH_MODEL,
        tools: [
          {
            type: 'web_search',
            search_context_size: 'low',
            user_location: {
              type: 'approximate',
              country: 'CA',
              region: 'Ontario',
              city: 'Toronto',
            },
          },
        ],
        input,
      }),
      NEWS_SEARCH_TIMEOUT_MS,
      'Responses web_search'
    );

    const text = response.output_text || '';
    console.log('   Current news search finished. Content length: ' + text.length);

    if (text.trim().length > 100) return text;

    console.log('   Responses web_search returned too little text.');
    return '';
  } catch (err) {
    console.log('   Responses web_search failed/timed out: ' + err.message);
    return '';
  }
}

async function searchWeb(query, requireFresh = false) {
  const today = todayLong();

  const searchTools = [[{ type: 'web_search_preview' }]];

  for (const tools of searchTools) {
    try {
      const response = await client.chat.completions.create({
        model: MODEL,
        max_tokens: 900,
        tools,
        messages: [
          {
            role: 'user',
            content: [
              'Today is ' + today + '.',
              'Any event date before today is a past event, not a future event.',
              'Search for: ' + query,
              '',
              'Find 4-6 trivia-worthy facts with recognizable answers and helpful context.',
              'Prioritize facts that are accessible to a Canadian/North American family.',
              'Avoid obscure specialist facts and minor names.',
              'If this is Science & Nature, avoid elementary-school obvious facts and instead find familiar answers connected to mechanisms, adaptations, discoveries, comparisons, or applications.',
              'If this is Pop Culture & Current Events, avoid music-category facts about songs, albums, chart records, Grammys, tours, bands, singers, rappers, lyrics, and music videos.',
            ].join('\n'),
          },
        ],
      });

      const content = response.choices[0]?.message?.content || '';
      if (content.trim().length > 80) return content;
    } catch (e) {
      // Try fallback below.
    }
  }

  if (requireFresh) {
    console.log('   Fresh search failed; skipping non-search fallback.');
    return '';
  }

  try {
    const response = await client.chat.completions.create({
      model: MODEL,
      max_tokens: 700,
      messages: [
        {
          role: 'user',
          content: [
            'Using your general knowledge, list 4-6 accessible trivia facts about:',
            query,
            '',
            'The answer should be widely recognizable. The clue can be interesting but not obscure.',
            'Avoid exact dates, niche records, specialist facts, and minor names.',
            'Do not claim anything is current, latest, newest, or recent.',
            'If this is Science & Nature, avoid elementary-school obvious facts and instead use mechanisms, adaptations, discoveries, comparisons, or applications.',
            'If this is Pop Culture & Current Events, avoid music-category facts about songs, albums, chart records, Grammys, tours, bands, singers, rappers, lyrics, and music videos.',
          ].join('\n'),
        },
      ],
    });

    return response.choices[0]?.message?.content || '';
  } catch (e) {
    console.log('   Search fallback failed: ' + e.message);
    return '';
  }
}

async function generateQuestionForSlot(slot, content, usedTopics) {
  const today = todayLong();

  const prompt = [
    'Write exactly 1 trivia question for this slot in a Canadian family Trivial Pursuit-style game.',
    '',
    'Today is ' + today + '.',
    'Any event date before today is a past event, not a future event.',
    'For current_events and sports_news, events from the last 6 months should be treated as recent if they occurred before today.',
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
    '- For Science & Nature, avoid elementary-school obvious questions. Ask about mechanisms, adaptations, discoveries, comparisons, or applications.',
    '- For Science & Nature, the answer should be recognizable, but the clue should not be a basic definition.',
    '- For current_events and sports_news, use only the fresh source material provided.',
    '- For current_events and sports_news, include the year or month naturally in the clue if needed.',
    '- For current_events and sports_news, do not write vague questions like "Which country was in the news?" Be specific enough to be fair.',
    '- For current_events and sports_news, do not call a past event a future event if its date is before today.',
    '- For celebrity_lifestyle, internet_culture, teen_culture, and viral questions, do not claim something is latest/current unless source material says so.',
    '- For Pop Culture & Current Events, do not write a music question. Avoid songs, albums, chart records, Grammys, tours, bands, singers as musicians, rappers as musicians, lyrics, music videos, and music-industry achievements.',
    '- Musicians can appear in Pop Culture only for clearly non-music reasons: acting roles, brands, fashion, social media, public relationships, business ventures, sports ownership, or widely discussed public moments.',
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
      'Today is ' + todayLong() + '.',
      'Any event date before today is a past event, not a future event.',
      '',
      JSON.stringify(q, null, 2),
      '',
      'Rewrite only the question. Keep the same answer.',
      'The rewritten question must not contain the answer words.',
      'Use a helpful clue and ask directly.',
      'If this is Pop Culture & Current Events, do not turn it into a music question.',
      'If this is Science & Nature, do not make it elementary-school obvious.',
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
  const today = todayLong();

  const prompt = [
    'Evaluate this trivia question for a Canadian family board game.',
    '',
    'Today is ' + today + '.',
    'Any event date before today is a past event, not a future event.',
    'For current_events and sports_news, events from the last 6 months should be considered recent if they occurred before today.',
    'Do not reject a question as a future event unless the event date is clearly after today.',
    'Do not label an event as future merely because its year is the same as today’s year.',
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
    'For Science & Nature, reject elementary-school obvious questions such as basic planet facts, basic animal records, or simple definitions.',
    'For Pop Culture & Current Events, teen-culture answers may be generation-specific, but the clue must be helpful.',
    'Reject Pop Culture & Current Events questions if they really belong in the Music category: songs, albums, chart records, Grammys, concert tours, music videos, singers-as-musicians, rappers-as-musicians, bands, lyrics, or music-industry achievements.',
    'For current_events and sports_news, reject the question only if it seems stale, unsourced, vague, inaccurate, clearly after today, or not based on a recognizable recent story.',
    'For current_events and sports_news, treat events from the last 6 months as recent, as long as they occurred before today.',
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

    let keep =
      result.keep === true &&
      recognizability >= 3 &&
      clue >= 3 &&
      obscurity <= 3;

    if (!keep && q.category === 'Pop Culture & Current Events') {
      keep =
        result.keep === true &&
        recognizability >= 2 &&
        clue >= 4 &&
        obscurity <= 3;
    }

    if (keep && scienceQuestionTooSimple(q)) keep = false;
    if (keep && overlapsWithMusicCategory(q)) keep = false;

    if (!keep) {
      console.log('   Validator rejected: ' + q.answer + ' — ' + (result.reason || 'no reason'));
    }

    return keep;
  } catch (e) {
    return Boolean(
      q.question &&
        q.answer &&
        !answerInQuestion(q.question, q.answer) &&
        !hasBannedEnding(q.question) &&
        !overlapsWithMusicCategory(q) &&
        !scienceQuestionTooSimple(q)
    );
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

  let content = '';

  if (freshRequired) {
    content = await searchCurrentNewsWithOpenAI(slot);

    if (!content) {
      console.log(
        '   Fresh Responses web_search unavailable; skipping current-event slot: ' +
          slot.subcategory +
          ' / ' +
          slot.angle
      );
      return null;
    }
  } else {
    content = await searchWeb(query, false);
  }

  if (!content && slot.category === 'Pop Culture & Current Events') {
    content = stablePopCultureFallback(slot);
  }

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

    if (overlapsWithMusicCategory(q)) {
      console.log('   Rejected Pop Culture question overlapping with Music: ' + q.answer);
      continue;
    }

    if (scienceQuestionTooSimple(q)) {
      console.log('   Rejected overly simple Science question: ' + q.answer);
      continue;
    }

    if (tooManyPopCulturePlatformQuestions(currentQuestions, q)) {
      console.log('   Rejected extra social-media/platform Pop Culture question: ' + q.answer);
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
      console.log(
        '       Slot: ' +
          slot.subcategory +
          ' / ' +
          slot.angle +
          ' / ' +
          slot.era +
          ' / ' +
          slot.difficulty
      );

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
      const targetCount = focusCategories
        ? 8
        : DISTRIBUTION[category]?.regular || 8;

      const generated = await generateCategoryBatch(
        category,
        batchNum,
        targetCount,
        pieCategory,
        usedTopics
      );

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

  // Focused top-ups are intentionally smaller so Pop Culture/news searches do not feel stuck.
  const target = focusCategories ? 40 : REFILL_AMOUNT;
  const questionsPerBatch = focusCategories ? 8 * focusCategories.length : 58;
  const batchesNeeded = Math.max(2, Math.ceil(target / questionsPerBatch));

  console.log(
    'Starting diversity-slot refill — bank: ' +
      before +
      ', target: +' +
      target +
      ' (' +
      batchesNeeded +
      ' batches)'
  );

  let totalAdded = 0;
  const usedTopics = [];

  try {
    for (let i = 1; i <= batchesNeeded; i++) {
      console.log(
        '   === Batch ' +
          i +
          '/' +
          batchesNeeded +
          ' (topic memory: ' +
          usedTopics.length +
          ' items) ==='
      );

      const questions = await generateBatch(i, focusCategories, usedTopics);
      const inserted = await insertQuestions(questions);
      const count = parseInt(inserted, 10) || 0;

      totalAdded += count;

      questions.forEach(q => {
        if (q.answer) usedTopics.push(q.answer);
        if (q.topic_key) usedTopics.push(q.topic_key);
      });

      console.log(
        '   Batch ' +
          i +
          ' complete: ' +
          count +
          ' inserted, ' +
          totalAdded +
          ' total so far'
      );

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
  overlapsWithMusicCategory,
  scienceQuestionTooSimple,
};