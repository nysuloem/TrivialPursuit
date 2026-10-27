const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {SCIENCE_DISCIPLINES, buildScienceSlots} = require('../src/science-strategy');
const {asksForMemeName} = require('../src/question-policy');

test('each full science batch targets 20/40/40 and distinct disciplines', () => {
  for (let batch = 0; batch < 12; batch++) {
    const slots = buildScienceSlots(batch, 10, 'Science & Nature');
    const count = level => slots.filter(s => s.education_level === level).length;
    assert.deepEqual([count('elementary'), count('high_school'), count('university')], [2,4,4]);
    assert.equal(new Set(slots.map(s => s.subcategory)).size, 10);
    assert.equal(slots.filter(s => s.is_pie).length, 1);
  }
});

test('successive batches cover all 40 areas and prefer underrepresented stored subjects', () => {
  const existing = [];
  for (let batch=0; batch<4; batch++) existing.push(...buildScienceSlots(batch, 10, null, existing));
  assert.equal(new Set(existing.map(q => q.subcategory)).size, Object.keys(SCIENCE_DISCIPLINES).length);
  const oversampled = Array.from({length:20}, () => ({category:'Science & Nature',subcategory:'physics'}));
  assert.ok(buildScienceSlots(0,10,null,oversampled).every(s => s.subcategory !== 'physics'));
});

test('meme identification blocked while ordinary current events remain allowed', () => {
  for (const question of ['Which viral meme features a distracted man?', 'What is the name of this meme?', 'Name the internet meme showing a dog.', 'What meme became popular in 2025?']) {
    assert.equal(asksForMemeName({category:'Pop Culture & Current Events',question}), true);
  }
  assert.equal(asksForMemeName({category:'Pop Culture & Current Events',question:'Which country hosted the climate summit?'}),false);
  assert.equal(asksForMemeName({category:'Science & Nature',question:'Who coined the word meme?'}),false);
});

test('legacy meme-name question skipped without writes; exclusions survive fallback queries', async () => {
  const queries=[];
  const candidates=[{id:1,category:'Pop Culture & Current Events',question:'Which meme features a dog?'},
                    {id:2,category:'Pop Culture & Current Events',question:'Which country hosted the summit?'}];
  class Pool {
    async query(sql,params) {
      queries.push({sql,params:structuredClone(params)});
      const ids=params[params.length-1];
      assert.ok(Array.isArray(ids));
      // Force both subcategory and era fallbacks.
      if(sql.includes('subcategory !=') || sql.includes("era = 'teen'")) return {rows:[]};
      return {rows:candidates.filter(q => !ids.includes(q.id)).slice(0,1)};
    }
  }
  const sandbox={module:{exports:{}},exports:{},process:{env:{}},console,
    require:name => name==='pg' ? {Pool} : require('../src/question-policy')};
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/db'),'utf8'),sandbox);
  const result=await sandbox.module.exports.getQuestion('Pop Culture & Current Events',false,'teen',['viral']);
  assert.equal(result.id,2);
  assert.ok(queries.every(q => q.sql.includes('id != ALL(')));
  assert.ok(queries.every(q => !/UPDATE|DELETE|INSERT/.test(q.sql)));
});
