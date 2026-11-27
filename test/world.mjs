/* A full round on a generated world (worldgen.js), the way a room runs it: the map builds, strands start in the
   lagoon's mounds, nobody ends up inside a wall, and the round finishes. */
import {makeGame} from '../src/game.js';

let ended = null;
const {sim, MAP} = makeGame({minStrands:10, round:90, hooks:{end:rows => { ended = rows; }}});
const t0 = performance.now();
sim.reset(777, {world:{size:0.7}});
const genMs = performance.now() - t0;
const a = sim.addHuman('AUG', 'h1'), b = sim.addHuman('GCU', 'h2');
sim.start();
const fails = [];
if (!MAP.world) fails.push('no world was built');
if (MAP.W !== 6400 || MAP.H !== 4200 || sim.W !== MAP.W) fails.push(`size ${MAP.W}x${MAP.H}, sim ${sim.W}`);
if (!MAP.world.checks.ok) fails.push('map checks failed');
const homes = MAP.world.spawns;
const near = p => homes.some(h => Math.hypot(p.s.head.x - h.x, p.s.head.y - h.y) < 400);
if (!near(a) || !near(b)) fails.push('humans did not start in mounds');
const home = p => { let k = 0; homes.forEach((h, i) => { if (Math.hypot(p.s.head.x - h.x, p.s.head.y - h.y) < Math.hypot(p.s.head.x - homes[k].x, p.s.head.y - homes[k].y)) k = i; }); return k; };
if (home(a) === home(b)) fails.push('two humans share a mound');
const dt = 1 / 30; let steps = 0, inWall = 0, worst = 0, moved = 0;
const start = {x:a.s.head.x, y:a.s.head.y};
while (!ended && steps < 30 * 120){
  a.tx = a.s.head.x + Math.cos(steps / 90) * 300; a.ty = a.s.head.y + Math.sin(steps / 70) * 300;
  const t = performance.now(); sim.step(dt); worst = Math.max(worst, performance.now() - t);
  if (steps % 30 === 0) for (const p of sim.players) if (p.alive && MAP.solidAt(p.s.head.x, p.s.head.y)) inWall++;
  steps++;
}
moved = Math.hypot(a.s.head.x - start.x, a.s.head.y - start.y);
if (!ended) fails.push('the round did not end');
if (inWall > 3) fails.push(`heads found inside walls ${inWall} times`);
const speeds = [MAP.speedAt(homes[0].x, homes[0].y)];
console.log(`world ${MAP.W}x${MAP.H} built in ${genMs.toFixed(0)} ms; ${steps} steps, worst ${worst.toFixed(1)} ms; heads in walls ${inWall}; letters ${sim.nucs.length}; smokers ${MAP.smokers.length}, geysers ${MAP.geysers.length}; speed in a mound ${speeds[0].toFixed(2)}`);
if (fails.length){ console.log('FAIL:', fails.join('; ')); process.exit(1); }
console.log('world round ok');
