/* The world generator's promises, over a spread of seeds, every layout style and every pattern:
   - the same seed and settings always give the same map (the server and every browser must agree);
   - the checks pass: sealed water opened, fair starts, every outer place present, big enough and on a channel;
   - every landform the game needs is there: mounds to start in, chimneys for smokers, a shield volcano with lava;
   - patterns only reshape: they never add or remove a wall, never make new black water, and stay off the lanes. */
import '../src/dom-shim.js';
import '../public/worldgen.js';
const WG = globalThis.WorldGen, fails = [], W = 6400, H = 4200;
const make = (seed, o) => WG.generate(Object.assign({seed, W, H, RES:25, scale:0.7}, o));
const hash = w => { let h = 0; for (let n = 0; n < w.E.length; n++) h = (h + Math.round(w.E[n] * 1000) * (n % 997 + 1)) % 2147483647; return h; };
function holds(w, what){
  const c = w.checks, N = w.E.length, bad = m => fails.push(`${what}: ${m}`);
  if (!c.ok) bad(`checks failed (${JSON.stringify({unlinked:c.unlinked, small:c.small, lagoonMid:c.lagoonMid, spawnSpread:c.spawnSpread})})`);
  if (w.spawns.length !== 7 || w.mounds.length !== 7) bad(`${w.spawns.length} starts`);
  for (const s of w.spawns){ if (!(s.x > 0 && s.y > 0 && s.x < W && s.y < H)) bad('a start is off the map'); else if (w.E[Math.floor(s.y / 25) * w.GX + Math.floor(s.x / 25)] >= WG.WALL) bad('a start is inside a wall'); }
  for (const a of w.spawns) for (const b of w.spawns) if (a !== b && Math.hypot(a.x - b.x, a.y - b.y) < 250) bad('two starts are on top of each other');
  const kinds = k => w.vents.filter(v => v.kind === k).length;
  if (!kinds('chimney')) bad('no chimneys'); if (!kinds('shield')) bad('no shield volcano'); if (!w.lavas.length) bad('no lava channel'); if (!w.rivers.length) bad('no streams');
  let walls = 0, black = 0, lanes = 0;
  for (let n = 0; n < N; n++){
    if ((w.E0[n] >= WG.WALL) !== (w.E[n] >= WG.WALL)) walls++;
    if (w.E0[n] >= 0.2 && w.E[n] < 0.2) black++;
    if (w.lane[n] >= 0.999 && w.E[n] !== w.E0[n]) lanes++;
  }
  if (walls) bad(`patterns changed ${walls} wall cells`); if (black) bad(`patterns made ${black} cells of new deep water`); if (lanes) bad(`patterns touched ${lanes} lane cells`);
}
const t0 = performance.now(); let built = 0;
/* a spread of seeds as the game builds them, each twice */
const seen = {};
for (let seed = 1; seed <= 8; seed++){
  const a = make(seed), b = make(seed); built += 2; seen[a.layout] = 1;
  if (hash(a) !== hash(b)) fails.push(`seed ${seed}: two builds differ`);
  holds(a, `seed ${seed} (${a.layout})`);
}
/* every layout style, and the old even layout (asymmetry 0) */
for (const layout of Object.keys(WG.LAYOUTS)) for (const seed of [101, 102]){ const w = make(seed, {layout}); built++; if (w.layout !== layout) fails.push(`asked for ${layout}, got ${w.layout}`); holds(w, `${layout} seed ${seed}`); }
holds(make(103, {asymmetry:0}), 'asymmetry 0'); built++;
/* every pattern, on every place at once, at full strength: laid on one world again and again, as the lab does */
const w = make(104);
for (const type of Object.keys(WG.PATTERNS)){
  const patterns = {}; for (const id of w.PIDS) patterns[id] = {type, strength:0.8, scale:1, follow:1};
  WG.pattern(w, {pattern:2, contrast:1, patterns}); holds(w, `pattern ${type}`);
  const h = hash(w); WG.pattern(w, {pattern:2, contrast:1, patterns}); if (hash(w) !== h) fails.push(`pattern ${type}: laid twice, two results`);
  const sw = WG.patternSwatch(type, 32); for (const v of sw) if (!(v >= 0 && v <= 1)){ fails.push(`pattern ${type}: a value outside 0..1`); break; }
}
/* patterns off gives the bare land back */
WG.pattern(w, {pattern:0}); for (let n = 0; n < w.E.length; n++) if (w.E[n] !== w.E0[n]){ fails.push('pattern 0 does not give the land back'); break; }
console.log(`worldgen: ${built} worlds and ${Object.keys(WG.PATTERNS).length} patterns in ${((performance.now() - t0) / 1000).toFixed(1)} s; layouts seen from seeds 1-8: ${Object.keys(seen).join(', ')}`);
if (fails.length){ console.log('FAIL:\n  ' + fails.join('\n  ')); process.exit(1); }
console.log('worldgen ok');
