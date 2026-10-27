// Coverage is balanced against stored and current-run questions, not reset to biology each batch.
const SCIENCE_DISCIPLINES = {
  "physics": "Physics: motion, forces, energy, quantum, nuclear, particle physics and thermodynamics",
  "chemistry": "Chemistry: organic, inorganic, physical, analytical chemistry and biochemistry",
  "astronomy": "Astronomy and astrophysics: stars, planets, galaxies and cosmology",
  "geology": "Geology and geophysics: rocks, minerals and Earth processes",
  "meteorology": "Meteorology and climate: weather, atmosphere and forecasting",
  "oceanography": "Oceanography and hydrology: oceans, rivers, groundwater and the water cycle",
  "seismology": "Seismology: earthquakes and Earth structure",
  "environmental_science": "Environmental science: pollution, conservation and environmental change",
  "botany": "Botany: plant biology and physiology",
  "zoology": "Zoology: animal biology, physiology and adaptations",
  "microbiology": "Microbiology: bacteria, fungi and microorganisms",
  "cell_biology": "Cell and molecular biology: cells, membranes, proteins and molecular processes",
  "genetics": "Genetics: inheritance, DNA and gene expression",
  "ecology": "Ecology: organisms, populations and ecosystems",
  "evolution": "Evolutionary biology: natural selection, speciation and common ancestry",
  "immunology": "Immunology: immune cells, antibodies and immune responses",
  "virology": "Virology: viruses and viral replication",
  "neuroscience": "Neuroscience: neurons, brain, senses and nervous systems",
  "entomology": "Entomology: insects and their biology",
  "mathematics": "Mathematics: pure and applied mathematics, geometry and calculus",
  "statistics": "Statistics and probability: data analysis, modelling and inference",
  "logic": "Logic: formal and symbolic reasoning",
  "computer_science": "Computer science: algorithms, computation and information theory",
  "systems_decision_theory": "Systems and decision theory: operations research, game theory and decision making",
  "psychology": "Psychology: cognition, learning, behaviour and perception",
  "anthropology": "Anthropology: human origins, evolution and cultures",
  "linguistics": "Linguistics: phonetics, language structure and language history",
  "civil_engineering": "Civil engineering: structures, bridges and infrastructure",
  "mechanical_engineering": "Mechanical engineering: machines, mechanics and energy systems",
  "electrical_engineering": "Electrical engineering: circuits, electronics and power",
  "chemical_engineering": "Chemical engineering: industrial chemical processes and separations",
  "aerospace_engineering": "Aerospace engineering: aircraft, spacecraft and flight",
  "materials_engineering": "Materials engineering: metals, polymers, ceramics and material properties",
  "medicine": "Medicine and health sciences: basic and clinical medicine and nursing",
  "pharmacology": "Pharmacology: medicines, drug actions and drug discovery",
  "public_health": "Public health and epidemiology: disease spread, prevention and population health",
  "agronomy": "Agricultural and crop science: crops, soil, plant breeding and agronomy",
  "veterinary_science": "Veterinary science and animal husbandry: animal health, care and production",
  "software_engineering": "Software engineering: software design, development and testing",
  "cybersecurity": "Cybersecurity and information technology: security, networks and computing systems"
};
const SCIENCE_LEVELS = ['elementary', 'high_school', 'university', 'high_school', 'university',
  'elementary', 'high_school', 'university', 'high_school', 'university'];
const SCIENCE_RULES = 'Science & Nature includes natural, formal, social and applied sciences. Follow the assigned discipline and education_level. Elementary: clear foundational school facts and definitions ARE allowed (20%). High school: secondary-school principles and applications (40%). University: introductory undergraduate concepts, not graduate specialisms or obscure researcher names (40%). Keep questions concise, accurate, unambiguous and playable aloud, with short answers and no lengthy calculations. University answers may be scientific terms taught in introductory courses; do not require household-name answers at this level. Pie difficulty means a harder clue within the assigned education level, not a different curriculum level.';
function buildScienceSlots(batchNum, count, pieCategory, existing = []) {
  const ids = Object.keys(SCIENCE_DISCIPLINES);
  const counts = Object.fromEntries(ids.map(id => [id, 0]));
  for (const q of existing) if (q.category === 'Science & Nature' && q.subcategory in counts) counts[q.subcategory]++;
  const offset = ((batchNum % ids.length) + ids.length) % ids.length;
  const order = ids.slice(offset).concat(ids.slice(0, offset));
  return Array.from({length: count}, (_, i) => {
    const id = order.reduce((best, candidate) => counts[candidate] < counts[best] ? candidate : best, order[0]);
    counts[id]++;
    const level = SCIENCE_LEVELS[i % 10];
    return {category:'Science & Nature', subcategory:id, discipline:SCIENCE_DISCIPLINES[id],
      angle:['principle','application','discovery','comparison','mechanism'][(i + batchNum) % 5],
      era:'timeless', education_level:level, difficulty:level === 'elementary' ? 'easy' : 'medium',
      is_pie:pieCategory === 'Science & Nature' && i === count - 1};
  });
}
module.exports = {SCIENCE_DISCIPLINES, SCIENCE_LEVELS, SCIENCE_RULES, buildScienceSlots};
