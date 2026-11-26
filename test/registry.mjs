/* Checks the segment and biome registries (public/segments.js, public/biomes.js) for mistakes a new entry can make.
   Runs before every deploy as part of npm test. */
import {makeGame, RS} from '../src/game.js';

const SEG = globalThis.SoupSegments, BIO = globalThis.SoupBiomes, BOTS = globalThis.SoupBots.create();
const BODIES = ['blades', 'spikes', 'chamber', 'circle', 'jaws', 'ring', 'helpers'];
const TRAITS = BOTS.TRAITS;
const problems = [];
const bad = msg => problems.push(msg);
const dup = (list, what) => { const seen = new Set(); for (const x of list){ if (seen.has(x)) bad(`two ${what} named ${x}`); seen.add(x); } };

/* ---------- segments ---------- */
dup(SEG.LIST.map(s => s.fn), 'segment types');
dup(SEG.LIST.map(s => s.core), 'segment cores (two recipes would spell the same letters)');
for (const s of SEG.LIST){
  const at = `segment ${s.fn}`;
  if (!s.fn || typeof s.fn !== 'string') bad(`${at}: needs a name (fn)`);
  if (!/^[AUGC]{3,}$/.test(s.core || '')) bad(`${at}: core must be 3 or more of A, U, G, C`);
  if (!BODIES.includes(s.body)) bad(`${at}: body "${s.body}" is not one of ${BODIES.join(', ')}`);
  for (const k of ['does', 'tag', 'sci']) if (!s[k]) bad(`${at}: needs ${k} for its recipe card`);
  for (const t of s.likedBy || []) if (!TRAITS.includes(t)) bad(`${at}: likedBy "${t}" is not a trait (${TRAITS.join(', ')})`);
  if (s.plan && typeof s.plan !== 'function') bad(`${at}: plan must be a function`);
  if (s.tips && typeof s.tips !== 'function') bad(`${at}: tips must be a function`);
  if (s.swim && !['speed', 'turn', 'turnBot'].every(k => typeof s.swim[k] === 'number')) bad(`${at}: swim needs speed, turn and turnBot numbers`);
  if (s.saltBreaks != null && !(s.saltBreaks > 0 && s.saltBreaks <= 1)) bad(`${at}: saltBreaks is a chance between 0 and 1`);
  /* every recipe must fold into its own segment, wherever it sits on a strand */
  const seq = RS.recipeSeq(s.fn), parsed = RS.parseRecipes('A' + seq);
  if (!parsed.some(g => g.fn === s.fn && g.end === seq.length)) bad(`${at}: its recipe ${seq} does not read back as ${s.fn}`);
}

/* ---------- biomes ---------- */
const keys = BIO.CELLS.map(c => c.key);
dup(keys, 'ground types');
for (const c of BIO.CELLS){
  const at = `ground ${c.key}`;
  if (!BIO.MIX[c.mix]) bad(`${at}: mix "${c.mix}" is not in MIX`);
  if (c.zone && !BIO.ZONES[c.zone]) bad(`${at}: zone "${c.zone}" is not in ZONES`);
  if (c.solid && !(c.edge && c.layer)) bad(`${at}: walls need an edge colour and a layer`);
  if (!c.solid && c.key !== 'DEEP' && c.key !== 'OCEAN' && !c.layer) bad(`${at}: needs a layer, or it is never drawn`);
  if (!/^#[0-9a-f]{6}$/i.test(c.color || '')) bad(`${at}: color must be #rrggbb (the minimap reads it)`);
  if (c.mini && !keys.includes(c.mini)) bad(`${at}: mini "${c.mini}" is not a ground type`);
  if (!c.solid && !(c.speed > 0)) bad(`${at}: open water needs a speed above 0`);
}
for (const m in BIO.MIX){ const sum = Object.values(BIO.MIX[m]).reduce((a, b) => a + b, 0); if (Math.abs(sum - 1) > 1e-9) bad(`mix ${m} adds up to ${sum}, not 1`); }
for (const [z, v] of Object.entries(BIO.ZONES)) if (!v.label) bad(`zone ${z}: needs a label`);
for (const [b, list] of Object.entries(BIO.LETTER_HOMES)) for (const k of list) if (!keys.includes(k)) bad(`LETTER_HOMES ${b}: "${k}" is not a ground type`);
dup(BIO.REGIONS.map(r => r.id), 'regions');
for (const r of BIO.REGIONS){
  if (typeof r.build !== 'function') bad(`region ${r.id}: needs build(B)`);
  for (const k of r.cells || []) if (!keys.includes(k)) bad(`region ${r.id}: cell "${k}" is not a ground type`);
  if (r.botHome && !(r.cells && r.cells.length)) bad(`region ${r.id}: a bot home needs cells`);
}
/* every region leaves some of its ground on the map, and the map has every zone it names */
const {MAP} = makeGame();
for (const seed of [1, 2, 3]){
  MAP.generate(seed);
  for (const r of BIO.REGIONS) for (const k of r.cells || []) if (!MAP.typeCount(MAP.K[k])) bad(`seed ${seed}: region ${r.id} left no ${k} on the map`);
}

if (problems.length){ console.error(problems.map(p => '  ' + p).join('\n')); console.error(`${problems.length} problem(s) in segments.js / biomes.js`); process.exit(1); }
console.log(`registries ok: ${SEG.LIST.length} segment types, ${BIO.CELLS.length} ground types, ${Object.keys(BIO.ZONES).length} places, ${BIO.REGIONS.length} regions`);
