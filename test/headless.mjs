/* Runs a full round of the game with no page, the way a room does on the server. */
import {makeGame} from '../src/game.js';

const says = [];
let ended = null, fxCount = 0;
const {sim} = makeGame({minStrands:10, round:120, hooks:{say:(p, t) => says.push(t), fx:() => fxCount++, end:rows => { ended = rows; }}});
sim.reset(12345);
const me = sim.addHuman('AUG', 'h1');
sim.start();
const dt = 1 / 30;
let steps = 0, worst = 0;
const t0 = performance.now();
while (!ended && steps < 30 * 200){
  me.tx = me.s.head.x + Math.cos(steps / 90) * 300; me.ty = me.s.head.y + Math.sin(steps / 70) * 300;
  if (steps % 300 === 299) sim.fold(me);
  const a = performance.now(); sim.step(dt); worst = Math.max(worst, performance.now() - a);
  steps++;
}
const ms = (performance.now() - t0) / steps;
console.log(`steps ${steps}, ${ms.toFixed(2)} ms/step avg, worst ${worst.toFixed(1)} ms, players ${sim.players.length}, nucs ${sim.nucs.length}, frags ${sim.frags.length}, fx ${fxCount}`);
console.log('ended:', !!ended, ended && ended.slice(0, 5).map(r => `${r.p.name}${r.p.isBot ? '' : '*'}:${r.score}`).join(' '));
console.log('player letters:', me.s.length, 'functions:', sim.working(me).map(f => f.fn).join(','));
console.log('messages to the human:', says.length, says.slice(0, 3));
if (!ended) process.exit(1);
