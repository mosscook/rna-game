/* Plays many bot-only rounds with no page and reports what wins: personalities, segment types, places, deaths.
   Use it to check a balance change (new numbers, a new segment or biome) before anyone plays it.

     npm run balance                          12 rounds of 5 minutes, 10 bots each
     npm run balance -- --rounds 40 --seconds 120 --seed 7 --threads 2 --json out.json

   --seed makes the run repeatable (the same seed plays the same rounds). Rounds run in parallel: one per CPU core,
   leaving one free, unless --threads says otherwise. */
import {Worker, isMainThread, parentPort, workerData} from 'node:worker_threads';
import {availableParallelism} from 'node:os';
import {writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

/* segments that leave the strand as they work (ring and helpers bodies): counted by use, not by holding */
const ONE_USE = ['Repairer', 'Self-cutter'];
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const mulberry = s => () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

/* ---------- one round, in a worker ---------- */
async function playRound(seed, seconds){
  const {makeGame} = await import('../src/game.js');
  Math.random = mulberry(seed);
  let ended = null;
  const {sim, MAP, BOTS, stage} = makeGame({minStrands:10, round:seconds, hooks:{end:rows => { ended = rows; }}});
  /* one-use segments leave the strand when they work, so count them from the strand's own events */
  const evs = new Map(), addStrand = stage.addStrand;
  stage.addStrand = o => { let s = null; s = addStrand.call(stage, Object.assign({}, o, {onEvent:(t, d) => {
    if (s){ const c = evs.get(s) || {}; c[t] = (c[t] || 0) + 1; evs.set(s, c); } if (o.onEvent) o.onEvent(t, d); }})); return s; };
  sim.reset(seed);
  const rec = new Map();
  const R = p => { let r = rec.get(p.id); if (!r){ r = {name:p.name, lead:p.mind.lead, skill:p.mind.skill, home:p.mind.home, deaths:{}, hitsDealt:0, cutsDealt:0, hitsTaken:0, cutsTaken:0, zones:{}, held:{}, samples:0,
    first:null, firstT:null, kinds:new Set(), folded:0, nf:0, joins:0, jc:false, scoreAt:[], goals:{}}; rec.set(p.id, r); } return r; };
  /* listen in on the bots' own event calls */
  const onHit = BOTS.onHit, onDeath = BOTS.onDeath;
  BOTS.onHit = (victim, by, cut) => { if (by && by.mind){ R(by)[cut ? 'cutsDealt' : 'hitsDealt']++; } if (victim.mind) R(victim)[cut ? 'cutsTaken' : 'hitsTaken']++; return onHit(victim, by, cut); };
  BOTS.onDeath = p => { if (p.mind){ const why = /smoker/.test(p.deathBy || '') ? 'black smoker' : /meteorite/.test(p.deathBy || '') ? 'meteorite' : 'other'; const d = R(p).deaths; d[why] = (d[why] || 0) + 1; } return onDeath(p); };
  sim.start();
  const dt = 1 / 30;
  for (let k = 0; !ended && k < seconds * 30 + 30; k++){
    sim.step(dt);
    /* a Joiner just took in a fragment (its cooldown restarts at 4 s) */
    for (const p of sim.players){ if (!p.mind) continue; const r = R(p); if (p.jcd > 3.9 && !r.jc){ r.joins++; r.jc = true; } else if (p.jcd <= 3.9) r.jc = false; }
    if (k % 30 === 0) for (const p of sim.players){
      if (!p.mind) continue;
      const r = R(p); r.samples++;
      const t = k / 30, fl = p.s.functions;
      if (fl.length > r.nf) r.folded += fl.length - r.nf;
      r.nf = fl.length;
      for (const f of sim.working(p)) if (!r.kinds.has(f.fn)){ r.kinds.add(f.fn); if (f.fn !== 'Mover' && !r.first){ r.first = f.fn; r.firstT = t; } }
      if (t % 60 === 0 && t > 0) r.scoreAt[t / 60 - 1] = sim.complexity(p);
      if (p.ai && p.ai.goal) r.goals[p.ai.goal] = (r.goals[p.ai.goal] || 0) + 1;
      if (p.alive){ const z = MAP.zoneAt(p.s.head.x, p.s.head.y); r.zones[z] = (r.zones[z] || 0) + 1; }
      for (const f of sim.working(p)) r.held[f.fn] = (r.held[f.fn] || 0) + 1 / Math.max(1, sim.countFn(p, f.fn));
    }
  }
  const rows = (ended || sim.standings()).map((row, i) => {
    const r = R(row.p);
    const e = evs.get(row.p.s) || {};
    delete r.kinds; delete r.jc; delete r.nf;
    return {...r, damage:e.damaged || 0, rank:i + 1, score:row.score, letters:row.p.s.length, used:{Repairer:e.repairerLaunched || 0, 'Self-cutter':e.cutterLaunched || 0}, mended:e.mended || 0,
      final:sim.working(row.p).map(f => f.fn), damaged:row.p.s.functions.filter(f => f.damaged).length};
  });
  const fragsLeft = sim.frags.length;
  stage.dispose();
  return {seed, rows, fragsLeft};
}
if (!isMainThread){
  parentPort.on('message', async ({seed, seconds}) => parentPort.postMessage(await playRound(seed, seconds)));
}

/* ---------- the run: hand rounds to workers, then report ---------- */
if (isMainThread){
  const rounds = +arg('rounds', 12), seconds = +arg('seconds', 300), seed0 = +arg('seed', Date.now() % 1e6), out = arg('json', null);
  const threads = Math.max(1, Math.min(rounds, +arg('threads', 0) || availableParallelism() - 1 || 1));
  console.log(`Playing ${rounds} rounds of ${seconds} s with 10 bots each (seed ${seed0}, ${threads} at a time)…`);
  const t0 = Date.now(), results = [];
  let next = 0;
  await Promise.all(Array.from({length:threads}, () => new Promise(done => {
    const w = new Worker(fileURLToPath(import.meta.url));
    const give = () => { if (next >= rounds){ w.terminate(); return done(); } w.postMessage({seed:seed0 + next++, seconds}); };
    w.on('message', r => { results.push(r); process.stdout.write(`\r  ${results.length}/${rounds} rounds`); give(); });
    w.on('error', e => { console.error('\n', e); process.exit(1); });
    give();
  })));
  console.log(`  (${((Date.now() - t0) / 1000).toFixed(0)} s)\n`);
  report(results, {rounds, seconds, seed:seed0});
  if (out){ writeFileSync(out, JSON.stringify({rounds, seconds, seed:seed0, results}, null, 1)); console.log(`\nWrote every round to ${out}`); }
}

function report(results, run){
  const rows = results.flatMap(r => r.rows), N = rows.length, R = results.length;
  const avg = (list, f) => list.length ? list.reduce((a, x) => a + f(x), 0) / list.length : 0;
  const pct = v => (v * 100).toFixed(0) + '%', f1 = v => v.toFixed(1);
  const table = (head, body) => {
    const w = head.map((h, i) => Math.max(h.length, ...body.map(b => String(b[i]).length)));
    const line = r => r.map((c, i) => i ? String(c).padStart(w[i]) : String(c).padEnd(w[i])).join('  ');
    console.log(line(head)); console.log(w.map(n => '-'.repeat(n)).join('  ')); for (const b of body) console.log(line(b)); console.log('');
  };
  const notes = [];
  const winners = rows.filter(r => r.rank === 1), med = r => { const s = r.rows.map(x => x.score).sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  console.log(`SCORES  winner ${f1(avg(winners, r => r.score))} on average, median strand ${f1(avg(results, med))}, last place ${f1(avg(results, r => r.rows[r.rows.length - 1].score))}`);
  console.log(`        ${pct(avg(results, r => r.rows.filter(x => x.score === r.rows[0].score).length > 1 ? 1 : 0))} of rounds ended in a tie for first\n`);

  console.log('PERSONALITY (each bot\'s standout trait)');
  const traits = [...new Set(rows.map(r => r.lead))].sort();
  const tb = traits.map(t => {
    const g = rows.filter(r => r.lead === t), wins = g.filter(r => r.rank === 1).length, fair = g.length / 10;
    const dead = avg(g, r => Object.values(r.deaths).reduce((a, b) => a + b, 0));
    if (g.length >= 8 && wins > fair * 2.2) notes.push(`${t} bots win ${(wins / fair).toFixed(1)}x their fair share`);
    if (g.length >= 8 && wins === 0 && R >= 10) notes.push(`${t} bots never won`);
    return [t, g.length, pct(wins / Math.max(1, g.length)), f1(avg(g, r => r.rank)), f1(avg(g, r => r.score)), f1(avg(g, r => r.cutsDealt)), f1(avg(g, r => r.cutsTaken)), f1(dead)];
  });
  table(['trait', 'bots', 'won', 'avg rank', 'avg score', 'cuts made', 'cuts taken', 'deaths'], tb);

  console.log('SKILL');
  const bySkill = rows.slice().sort((a, b) => a.skill - b.skill), third = Math.floor(N / 3);
  table(['skill third', 'avg score', 'won'], [['lowest', bySkill.slice(0, third)], ['middle', bySkill.slice(third, N - third)], ['highest', bySkill.slice(N - third)]]
    .map(([k, g]) => [k, f1(avg(g, r => r.score)), pct(g.filter(r => r.rank === 1).length / g.length)]));

  console.log('SEGMENT TYPES (working at the end of the round; winners hold more of everything, since each new kind scores 3)');
  const fns = [...new Set(rows.flatMap(r => r.final.concat(Object.keys(r.held))))];
  const st = fns.map(fn => {
    const has = rows.filter(r => r.final.includes(fn)), winHas = winners.filter(r => r.final.includes(fn));
    const share = has.length / N;
    if (share < 0.05 && !ONE_USE.includes(fn)) notes.push(`${fn}: almost nobody has one at the end (${pct(share)})`);
    return [fn, pct(share), f1(avg(has, r => r.final.filter(x => x === fn).length)), pct(winHas.length / winners.length), pct(avg(rows, r => (r.held[fn] || 0) / Math.max(1, r.samples)))];
  }).sort((a, b) => parseFloat(b[1]) - parseFloat(a[1]));
  table(['segment', 'strands with one', 'copies', 'winners with one', 'time held'], st.filter(r => !ONE_USE.includes(r[0])));
  /* one-use segments leave the strand as they work: count how often they were used instead */
  for (const fn of ONE_USE){
    const n = avg(rows, r => r.used[fn] || 0), users = rows.filter(r => r.used[fn]).length / N;
    console.log(`${fn} (one use): used ${f1(n * 10)} times per round, by ${pct(users)} of bots` + (fn === 'Repairer' ? `, mending ${f1(avg(rows, r => r.mended) * 10)} structures per round` : ''));
    if (users < 0.03) notes.push(`${fn}: bots almost never use one (${pct(users)} of bots)`);
  }
  console.log(`Damaged structures left at the end: ${f1(avg(rows, r => r.damaged))} per strand. Letters per strand: ${f1(avg(rows, r => r.letters))}.\n`);

  console.log('HOW STRANDS GROW');
  const mins = Math.max(...rows.map(r => r.scoreAt.length));
  const curve = g => Array.from({length:mins}, (_, i) => f1(avg(g, r => r.scoreAt[i] ?? r.score))).concat(f1(avg(g, r => r.score))).join(' → ');
  console.log(`average score after each minute, then at the end: ${curve(rows)}  (winners: ${curve(winners)})`);
  console.log(`structures folded per bot: ${f1(avg(rows, r => r.folded))} · fragments joined per round: ${f1(avg(rows, r => r.joins) * 10)} · damage taken per bot: ${f1(avg(rows, r => r.damage))}`);
  const firsts = {}; for (const r of rows) if (r.first) firsts[r.first] = (firsts[r.first] || 0) + 1;
  const nf = rows.filter(r => r.first);
  console.log(`first segment after the starting Mover: ${Object.entries(firsts).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${pct(n / N)}`).join(', ')}${nf.length < N ? `, none ${pct(1 - nf.length / N)}` : ''} · at ${f1(avg(nf, r => r.firstT))} s on average`);
  const gl = {}; let gt = 0; for (const r of rows) for (const [g, n] of Object.entries(r.goals)){ gl[g] = (gl[g] || 0) + n; gt += n; }
  console.log(`what bots are working toward, share of time: ${Object.entries(gl).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${pct(n / gt)}`).join(', ')}\n`);
  if (firsts.Joiner && firsts.Joiner / N > 0.4) notes.push(`${pct(firsts.Joiner / N)} of bots build a Joiner first`);

  console.log('DEATHS (per bot per round)');
  const causes = [...new Set(rows.flatMap(r => Object.keys(r.deaths)))];
  console.log(causes.length ? causes.map(c => `${c} ${avg(rows, r => r.deaths[c] || 0).toFixed(2)}`).join(', ') + '\n' : 'none\n');

  console.log('WHERE BOTS SPEND THEIR TIME');
  const zt = {}; let all = 0;
  for (const r of rows) for (const [z, n] of Object.entries(r.zones)){ zt[z] = (zt[z] || 0) + n; all += n; }
  const zl = Object.entries(zt).sort((a, b) => b[1] - a[1]);
  console.log(zl.map(([z, n]) => `${z} ${pct(n / all)}`).join(', ') + '\n');
  const homes = {}; for (const r of rows) (homes[r.home] = homes[r.home] || []).push(r);
  table(['home region', 'bots', 'avg score', 'won'], Object.entries(homes).map(([h, g]) => [h, g.length, f1(avg(g, r => r.score)), pct(g.filter(r => r.rank === 1).length / g.length)]));

  console.log('WORTH A LOOK');
  if (R < 10) notes.push(`only ${R} rounds: differences under about 15 points are noise. Try --rounds 40.`);
  console.log(notes.length ? notes.map(n => '  - ' + n).join('\n') : '  nothing stands out');
}
