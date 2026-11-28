/* Builds many worlds and reports what a contact sheet can't: how often the checks fail or a map has to be regrown,
   build times, and which layouts came up.   node tools/mapstats.mjs [--n 100] [--seed 1] [--set '{"layout":"strait"}'] */
import '../src/dom-shim.js';
import '../public/worldgen.js';
const WG = globalThis.WorldGen, arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : process.argv[i + 1]; };
const n = +arg('n', 100), s0 = +arg('seed', 1), set = JSON.parse(arg('set', '{}')), size = +arg('size', 0.7), W = Math.round(9200 * size / 100) * 100, H = Math.round(6000 * size / 100) * 100;
let fail = 0, regrown = 0, ms = [], lay = {}, why = {}, land = 0, spread = 0, carved = 0;
for (let k = 0; k < n; k++){
  const t0 = performance.now(), w = WG.generate(Object.assign({}, set, {seed:s0 + k, W, H, RES:25, scale:size})), c = w.checks; ms.push(performance.now() - t0);
  if (!c.ok){ fail++; const y = [c.unlinked.length && 'unlinked', c.small && c.small.length && 'small', c.missing && c.missing.length && 'missing:' + c.missing, c.lagoonMid < 0.35 && 'lagoon', c.spawnSpread >= 0.8 && 'spread', c.mounds !== w.mounds.length && 'mounds'].filter(Boolean).join('+'); why[y] = (why[y] || 0) + 1; }
  if (c.tries > 1) regrown++; lay[w.layout] = (lay[w.layout] || 0) + 1; spread += c.spawnSpread; carved += c.carved;
  let open = 0; for (let i = 0; i < w.E.length; i++) if (w.E[i] >= 0.14 && w.E[i] < WG.WALL) open++; land += open / w.E.length;
}
ms.sort((a, b) => a - b);
console.log(`${n} worlds: ${fail} failed checks ${JSON.stringify(why)}, ${regrown} regrown; build median ${ms[n >> 1].toFixed(0)} ms, worst ${ms[n - 1].toFixed(0)} ms; swimmable ground (not black, not wall) ${(land / n * 100).toFixed(0)}%; start spacing ${(spread / n).toFixed(2)}; passages carved ${(carved / n).toFixed(2)} a map`);
console.log('layouts', JSON.stringify(lay));
