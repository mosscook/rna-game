/* Checks recipes folded with one wrong letter: strength by where the mistake is, the mix of core mutations,
   two mistakes folding to junk, abilities and score following strength, and the Repairer correcting harmful mistakes. */
import {makeGame, RS} from '../src/game.js';
const SEG = globalThis.SoupSegments, COMP = {A:'U', U:'A', G:'C', C:'G'};
let bad = 0;
const check = (ok, what) => { if (!ok){ bad++; console.error('FAIL ' + what); } };
const fold = (seq) => RS.parseRecipes(seq).filter(g => g.fn);

const core = RS.RECIPES.Mover, exact = 'GC' + core + 'GC';
check(fold(exact)[0].q === 1, 'an exact recipe folds at full strength');
check(Math.abs(fold('GC' + core + 'GU')[0].q - 0.9) < 1e-9 && fold('GC' + core + 'GU')[0].miss.kind === 'wobble', 'a G·U pair in the stem is a wobble, 90%');
check(Math.abs(fold('GC' + core + 'GA')[0].q - 0.7) < 1e-9, 'any other stem mismatch is 70%');
check(fold('GC' + 'C' + core.slice(1) + 'GA').length === 0, 'two mistakes fold to junk');
check(RS.parseRecipes('GC' + core + 'GU', true).every(g => !g.fn), 'bots, reading exactly, see junk');
/* every possible core mutation, across all segments */
const tally = {better:0, mild:0, harm:0}; let all = 0;
for (const s of SEG.LIST) for (let i = 0; i < s.core.length; i++) for (const b of 'AUGC'){
  if (b === s.core[i]) continue;
  const q = RS.mutationEffect(s.fn, i, b); all++;
  tally[q > 1 ? 'better' : q >= 0.8 ? 'mild' : 'harm']++;
  const seq = 'GC' + s.core.slice(0, i) + b + s.core.slice(i + 1) + 'GC', g = fold(seq).find(x => x.fn === s.fn && x.end === seq.length - 1);
  if (!g || g.q !== q) check(false, `${s.fn} with ${b} at core position ${i + 1} folds with strength ${q}`);
}
check(tally.better > 0 && tally.better / all < 0.3 && tally.harm / all > 0.3, `core mutations are mostly harmful, some lucky (${JSON.stringify(tally)} of ${all})`);

/* in play: strength reaches abilities and score, and a Repairer corrects harmful mistakes */
const {sim} = makeGame({round:60}); sim.reset(3); const me = sim.addHuman('AUG', 'h1'); sim.start();
const lucky = (() => { for (const s of SEG.LIST) for (let i = 0; i < s.core.length; i++) for (const b of 'AUGC') if (b !== s.core[i] && RS.mutationEffect(s.fn, i, b) > 1 && s.fn === 'Mover') return 'GC' + s.core.slice(0, i) + b + s.core.slice(i + 1) + 'GC'; })();
const before = sim.complexity(me), sw0 = SEG.swimOf(sim.working(me)).speed;
for (const b of lucky) me.s.append(b); sim.fold(me);
check(sim.complexity(me) === before + 1 + 1, `a lucky Mover adds 1 (repeat) + 1 (lucky): ${before} -> ${sim.complexity(me)}`);
check(SEG.swimOf(sim.working(me)).speed > sw0 + 0.3, 'a lucky Mover adds more speed than an exact one');
const cc = RS.RECIPES.Cleaver, weak = (() => { for (let i = 0; i < cc.length; i++) for (const b of 'AUGC') if (b !== cc[i] && RS.mutationEffect('Cleaver', i, b) < 0.8) return 'GC' + cc.slice(0, i) + b + cc.slice(i + 1) + 'GC'; })();
for (const b of weak) me.s.append(b); sim.fold(me);
const cl = sim.working(me).find(f => f.fn === 'Cleaver');
check(cl && cl.q < 1, `a Cleaver with a wrong core letter is weak (${cl && cl.q})`);
const rep = RS.recipeSeq('Repairer'); me.s.appendFolded(rep, [{fn:'Repairer', start:0, end:rep.length - 1}]);
for (let k = 0; k < 30 * 20; k++) sim.step(1 / 30);
const cl2 = me.s.functions.find(f => f.fn === 'Cleaver'), mv = me.s.functions.filter(f => f.fn === 'Mover');
check(cl2 && cl2.q === 1, 'the Repairer corrected the weak Cleaver');
check(mv.some(f => f.q > 1), 'and left the lucky Mover alone');
if (bad){ console.error(`${bad} mutation check(s) failed`); process.exit(1); }
console.log(`mistakes ok: ${tally.better} lucky, ${tally.mild} mild and ${tally.harm} harmful core mutations of ${all}`);
