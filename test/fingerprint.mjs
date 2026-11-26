/* Fingerprints how the game plays, to prove a refactor changed nothing.
   Math.random is replaced with a seeded generator, so the same code always plays the same rounds. The test plays
   three 2-minute rounds (one player carries every segment type, so every mechanic runs), builds five maps, and
   hashes everything: strands, letters, fragments, scores and terrain.

     npm run fingerprint            compare with test/fingerprint.json
     npm run fingerprint -- --save  record new values (after a change that is meant to change gameplay)

   A change that is meant to alter gameplay (new rules, retuned numbers, a new segment) changes the fingerprint:
   check it plays right, then save. A pure cleanup must leave it identical. */
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import {makeGame, RS} from '../src/game.js';

const FILE = new URL('./fingerprint.json', import.meta.url);
const mulberry = s => () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const r3 = v => Math.round(v * 1000) / 1000;
const hash = o => createHash('sha256').update(JSON.stringify(o)).digest('hex').slice(0, 16);

function playRound(seed, everything){
  Math.random = mulberry(seed);
  const said = [];
  let ended = null;
  const {sim, MAP} = makeGame({minStrands:10, round:120, hooks:{say:(p, t) => said.push(t), end:rows => { ended = rows; }}});
  sim.reset(seed);
  const me = sim.addHuman('AUG', 'h1');
  if (everything) for (const fn of ['Mover', 'Cleaver', 'Membrane', 'Detector', 'Joiner', 'Self-cutter', 'Repairer']){ const add = RS.recipeSeq(fn); me.s.appendFolded(add, [{fn, start:0, end:add.length - 1}]); }
  sim.start();
  const snaps = [];
  for (let k = 0; k < 30 * 125 && !ended; k++){
    me.tx = me.s.head.x + Math.cos(k / 90) * 300; me.ty = me.s.head.y + Math.sin(k / 70) * 300;
    if (k % 240 === 239) sim.fold(me);
    if (k % 400 === 399) sim.drop(me);
    sim.step(1 / 30);
    if (k % 150 === 0) snaps.push(hash({
      p:sim.players.map(p => [p.name, p.alive, p.s.seq, p.s.functions.map(f => [f.fn, f.start, f.damaged ? 1 : 0, f.jstate || '', f.bonus || 0]),
        r3(p.s.head.x), r3(p.s.head.y), p.ai && p.ai.mode, p.ai && p.ai.goal]),
      n:sim.nucs.map(q => [q.b, r3(q.x), r3(q.y)]), f:sim.frags.map(f => [f.s.seq, r3(f.s.head.x)]), t:r3(MAP.tide), tl:r3(sim.timeLeft)}));
  }
  return {snaps:hash(snaps), end:ended && ended.map(r => `${r.p.name}:${r.score}`).join(' '), said:hash(said), messages:said.length};
}

function maps(){
  const out = {};
  for (const seed of [1, 2, 3, 99, 4242]){
    Math.random = mulberry(seed);
    const {MAP} = makeGame();
    const sp = MAP.generate(seed), cells = [], zones = [];
    for (let y = 25; y < MAP.H; y += 50) for (let x = 25; x < MAP.W; x += 50) cells.push(MAP.typeAt(x, y));
    for (let y = 100; y < MAP.H; y += 200) for (let x = 100; x < MAP.W; x += 200) zones.push(MAP.zoneAt(x, y));
    out[seed] = hash({cells, zones, sp, springs:MAP.springs, smokers:MAP.smokers, pools:MAP.pools, rafts:MAP.rafts.map(r => [r3(r.x), r3(r.y)])});
  }
  return out;
}

const now = {maps:maps(), rounds:{}};
for (const [seed, all] of [[11, true], [12345, false], [777, true]]) now.rounds[seed] = playRound(seed, all);

if (process.argv.includes('--save') || !existsSync(FILE)){
  writeFileSync(FILE, JSON.stringify(now, null, 2) + '\n');
  console.log('saved test/fingerprint.json');
  console.log(JSON.stringify(now, null, 2));
} else {
  const was = JSON.parse(readFileSync(FILE, 'utf8'));
  let diff = 0;
  const cmp = (a, b, where) => { if (JSON.stringify(a) !== JSON.stringify(b)){ diff++; console.log(`DIFFERENT ${where}\n  was ${JSON.stringify(a)}\n  now ${JSON.stringify(b)}`); } };
  for (const k in was.maps) cmp(was.maps[k], now.maps[k], `map ${k}`);
  for (const k in was.rounds) cmp(was.rounds[k], now.rounds[k], `round ${k}`);
  if (diff){ console.log(`${diff} difference(s): gameplay changed`); process.exit(1); }
  console.log('fingerprint matches: the game plays exactly as before');
}
