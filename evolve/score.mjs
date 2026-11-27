/* Balance score for the improvement loop (evolve/PROGRAM.md), read from test/balance.mjs JSON output.

     node evolve/score.mjs run.json                    one run: its balance components and index
     node evolve/score.mjs base.json cand.json         a change against its baseline: the difference, with a
                                                       95% interval from resampling rounds (same seeds pair up)

   "Balance" here: no personality and no home area that does better than the others, every core segment type gets
   built about equally often, and the one-use segments (Repairer, Self-cutter) actually get used. Each part is 0 at
   perfect balance and grows with imbalance; the index is 100 minus a weighted sum, so higher is better. */
import {readFileSync} from 'node:fs';

const CORE = ['Joiner', 'Cleaver', 'Membrane', 'Detector'], ONE_USE = ['Repairer', 'Self-cutter'];
const WEIGHTS = {traits:12, homes:12, segments:40, oneUse:20};

/* the parts, from a list of rounds */
export function parts(rounds){
  const rows = rounds.flatMap(r => r.rows);
  const rankSpread = key => {
    const g = {}; for (const r of rows) (g[r[key]] = g[r[key]] || []).push(r.rank);
    const means = Object.values(g).filter(l => l.length >= 5).map(l => l.reduce((a, b) => a + b, 0) / l.length);
    const mid = (rows.length / rounds.length + 1) / 2;
    return means.length ? Math.sqrt(means.reduce((a, m) => a + (m - mid) ** 2, 0) / means.length) : 0;
  };
  const share = fn => rows.filter(r => r.final.includes(fn)).length / rows.length;
  const shares = CORE.map(share), hi = Math.max(...shares), lo = Math.min(...shares);
  const used = fn => rows.filter(r => (r.used || {})[fn] > 0).length / rows.length;
  const oneUse = ONE_USE.map(used).reduce((a, b) => a + b, 0) / ONE_USE.length;
  return {
    traits:rankSpread('lead'),                    /* average-rank spread between personalities (ranks 1..10) */
    homes:rankSpread('home'),                     /* the same between home areas */
    segments:hi > 0 ? 1 - lo / hi : 1,            /* 0 when every core segment is held equally often */
    oneUse:Math.max(0, 1 - oneUse / 0.15),        /* 0 once 15% of strands use each one-use segment */
    detail:{shares:Object.fromEntries(CORE.map((f, i) => [f, +shares[i].toFixed(3)])), oneUseRate:Object.fromEntries(ONE_USE.map(f => [f, +used(f).toFixed(3)]))}
  };
}
export const index = p => 100 - WEIGHTS.traits * p.traits - WEIGHTS.homes * p.homes - WEIGHTS.segments * p.segments - WEIGHTS.oneUse * p.oneUse;

const load = f => JSON.parse(readFileSync(f, 'utf8'));
const fmt = p => `index ${index(p).toFixed(1)}  (traits ${p.traits.toFixed(2)}, homes ${p.homes.toFixed(2)}, segments ${p.segments.toFixed(2)}, one-use ${p.oneUse.toFixed(2)}; core shares ${JSON.stringify(p.detail.shares)}, one-use rates ${JSON.stringify(p.detail.oneUseRate)})`;

if (import.meta.url === `file://${process.argv[1]}`){
  const [a, b] = process.argv.slice(2);
  if (!a){ console.log('usage: node evolve/score.mjs run.json [candidate.json]'); process.exit(1); }
  const A = load(a);
  console.log(`${a}: ${A.results.length} rounds${A.world ? ` on a world (size ${A.world})` : ' on the classic map'}\n  ${fmt(parts(A.results))}`);
  if (b){
    const B = load(b);
    console.log(`${b}: ${B.results.length} rounds\n  ${fmt(parts(B.results))}`);
    /* pair rounds by seed, then resample pairs */
    const bySeed = new Map(A.results.map(r => [r.seed, r])), pairs = B.results.filter(r => bySeed.has(r.seed)).map(r => [bySeed.get(r.seed), r]);
    let s = 12345; const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    const diffs = [];
    for (let k = 0; k < 2000; k++){
      const pick = Array.from(pairs, () => pairs[Math.floor(rnd() * pairs.length)]);
      diffs.push(index(parts(pick.map(p => p[1]))) - index(parts(pick.map(p => p[0]))));
    }
    diffs.sort((x, y) => x - y);
    const d = index(parts(B.results)) - index(parts(A.results)), lo = diffs[Math.floor(diffs.length * 0.025)], hi = diffs[Math.floor(diffs.length * 0.975)];
    const verdict = lo > 0 ? 'BETTER (the whole interval is above zero)' : hi < 0 ? 'WORSE (the whole interval is below zero)' : 'NO CLEAR CHANGE (the interval spans zero)';
    console.log(`\nchange in balance index: ${d >= 0 ? '+' : ''}${d.toFixed(1)}, 95% interval ${lo.toFixed(1)} to ${hi.toFixed(1)} over ${pairs.length} paired rounds: ${verdict}`);
  }
}
