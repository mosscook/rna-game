/* =====================================================================
   Segment types: every function a strand can fold, in one place.
   The game, the bots, the page and the server all read this list. To add a segment type, add an entry.

   Each entry:
     fn       the name players see. Also the key everywhere else.
     core     the recipe's middle letters. A recipe is 2 stem letters + core + the stem's partners in reverse.
              Cores must all differ (the test checks).
     body     the shape it folds into, with the strand mechanics that come with that shape (rna-strand.js):
                blades   two hairpins side by side; with 3D on they spin like a turbine
                spikes   one long hairpin folded into two opposing spikes
                chamber  a swollen chamber; goo spreads to its neighbours
                circle   a circle split by the spine
                jaws     a mouth at the tail end. Armed while it is the last structure; when something joins
                         right behind it, it fuses around that and gives it +1
                ring     leaves the strand as a ring, cuts off the structure ahead of it, both burst into letters
                helpers  leaves the strand as two helpers that travel up it once, mending damage
              A new segment can reuse any of these. A new shape needs code in rna-strand.js.
     does, tag, sci   the recipe card: what it does, how real it is, the science behind it
   Strength: a segment folded with one wrong letter has a strength q (rna-strand.js decides it; 1 when exact) and every
   ability below scales with it. Above 1 (a lucky mistake) it also scores +1.
   What it does in the game (sim.js reads these; leave out the ones that do not apply):
     swim       {speed, turn, turnBot}: added per working copy. speed multiplies swim speed (0.3 = +30%),
                turn adds to the turn rate (humans / bots)
     tips(f)    the strand positions that strike rivals (damage, then cut damaged structures)
     shield     takes hits meant for the working functions on either side of it
     saltBreaks chance each half second that a drying salt pool damages it
     warnEarly  seconds of warning before UV flashes and meteorites (without one: 1.8)
     findsFragments  points the player to the nearest fragment
     hitR       (striking segments) how close a tip must come to a rival to strike, in px, at full strength
     rest, regrow, stub   (Cleaver) seconds it rests after a cut; how long the regrowth at the end of that takes;
                how long its spikes are while resting (a fraction of full length)
     fresh, arm, fade, grab   (Cleaver) a piece it cuts off: seconds anyone can take it back; seconds before it can be
                taken; seconds it fades; how close a tail end must come to take it, in px
     reach, cooldown   (Joiner) how close a fragment must come to the jaws, in px; seconds before it can join again
   Tuning (the dev panel's Segments section):
     tune       [key, label, min, max, step, unit, kind] for each adjustable value. key is a property of the entry
                ('swim.speed' for a nested one) or 'S.<name>' for a strand drawing setting (rna-strand.js). kind is
                'game' (what it does; single player only, since a room runs the server's copy) or 'look' (how it is drawn)
   How bots think about it (bots.js):
     likedBy    personality traits that make a bot fond of it
     plan(c)    sets c.want (and can change c.gain, the score it would add) for a bot weighing what to build;
                return false to rule it out. c has: tr traits, m mood, n working copies, info (what the bot sees),
                p (the bot), kinds (fns it has), has(fn), lastSt (its last structure), rivalSpikes, G (the game)
   ===================================================================== */
window.SoupSegments = (() => {
'use strict';

const LIST = [
  {fn:'Mover', core:'UUAAUU', body:'blades',
   does:'Swim faster and turn tighter. Its two blades spin like a turbine.',
   tag:'Game only', sci:'No RNA can swim. Movement is the biggest thing this game invents.',
   swim:{speed:0.3, turn:0.6, turnBot:0.5},
   tune:[['swim.speed', 'Swim speed bonus', 0, 1.5, 0.05, '×', 'game'], ['swim.turn', 'Turn bonus (you)', 0, 2, 0.05, '', 'game'],
     ['swim.turnBot', 'Turn bonus (bots)', 0, 2, 0.05, '', 'game'],
     ['S.spin', 'Blade spin', 0, 3, 0.05, '', 'look'], ['S.pitch', 'Blade pitch', 0, 90, 1, '°', 'look'], ['S.sweep', 'Blade sweep', 0, 2, 0.05, '', 'look']],
   likedBy:['greed', 'curiosity'],
   plan(c){ c.want = 0.3 + 0.5 * c.tr.curiosity + 0.4 * c.tr.greed + (c.m.fear > 0.3 ? c.tr.caution : 0) - 0.3 * c.n; if (c.n >= 3) c.gain *= 0.5; }},

  {fn:'Cleaver', core:'CUGCUG', body:'spikes',
   does:'Its two spikes damage what they touch on rival strands, then cut damaged structures off. Everything behind the cut floats free. After a cut its spikes shrink to stubs for 10 seconds before they grow back and it can strike again.',
   tag:'Real science', sci:'Hammerhead ribozymes can be built to find a target RNA by base pairing, then cut it.',
   /* one base sits at each spike tip */
   tips(f){ const L = f.end - f.start; return [f.start + Math.round(L / 4), f.start + Math.round(3 * L / 4)]; },
   hitR:13, rest:10, regrow:1, stub:0.12, fresh:3.5, arm:0.6, fade:0.8, grab:32,
   tune:[['hitR', 'Strike reach', 4, 40, 1, 'px', 'game'], ['rest', 'Rest after a cut', 0, 30, 0.5, 's', 'game'],
     ['regrow', 'Regrow time (end of the rest)', 0.1, 10, 0.1, 's', 'game'],
     ['fresh', 'Cut piece: time to take it back', 0, 10, 0.1, 's', 'game'], ['arm', 'Cut piece: delay before it can be taken', 0, 3, 0.1, 's', 'game'],
     ['fade', 'Cut piece: fade time', 0.1, 3, 0.1, 's', 'game'], ['grab', 'Cut piece: tail reach to take it', 8, 80, 1, 'px', 'game'],
     ['S.spikeLen', 'Spike length, active (first spike)', 2, 20, 0.5, '', 'look'], ['S.spikeLenB', 'Spike length, active (second spike)', 2, 20, 0.5, '', 'look'],
     ['stub', 'Spike length, resting', 0, 1, 0.02, '× active', 'look'], ['S.spikeSlope', 'Spike slant', 0, 6, 0.1, '', 'look'],
     ['S.spikeTwist', 'Spike twist', 0, 90, 1, '°', 'look']],
   likedBy:['aggression', 'grudge'],
   plan(c){ c.want = 1.7 * c.tr.aggression + 0.5 * c.tr.opportunism + 0.8 * c.m.anger + (c.info.late && c.info.rank > 1 ? 0.6 : 0); if (c.n >= 2) c.want *= 0.35; }},

  {fn:'Membrane', core:'GCCGGC', body:'chamber',
   does:'Takes the hits meant for the functions on either side of it. Membranes side by side shield each other and add up their strength. Dissolves in magnesium.',
   tag:'Real science', sci:'Bubbles of fatty acid can hold RNA, grow and divide. Magnesium breaks them apart.',
   shield:true, saltBreaks:0.25,
   tune:[['saltBreaks', 'Chance a drying salt pool damages it (each ½ s)', 0, 1, 0.01, '', 'game'],
     ['S.memDiam', 'Chamber width', 4, 20, 0.5, '', 'look'], ['S.memLength', 'Chamber length', 3, 16, 0.5, '', 'look'],
     ['S.memSqueeze', 'Chamber squeeze', 0, 2, 0.05, '', 'look'], ['S.gooOpacity', 'Goo opacity (all goo)', 0, 1, 0.02, '', 'look'],
     ['S.gooSize', 'Goo width (all goo)', 6, 50, 1, '', 'look']],
   likedBy:['caution', 'patience', 'grudge'],
   plan(c){ c.want = 1.4 * c.tr.caution + 0.35 * c.rivalSpikes + 0.6 * c.m.fear + 0.08 * c.p.s.functions.length; if (c.n >= 2) c.want *= 0.4; }},

  {fn:'Detector', core:'ACAACAACA', body:'circle',
   does:'Warns you of UV flashes and meteorites early and points to the nearest fragment.',
   tag:'Real science', sci:'Riboswitches change shape when they catch a particular molecule, switching genes on or off.',
   warnEarly:4.5, findsFragments:true,
   tune:[['warnEarly', 'Warning before UV flashes and meteorites', 1.8, 10, 0.1, 's', 'game'], ['S.detSize', 'Circle size', 1, 10, 0.25, '', 'look']],
   /* opportunists want one too: it leads them to fragments for a Joiner */
   likedBy:['caution', 'curiosity', 'patience', 'opportunism'],
   plan(c){ c.want = 0.9 * c.tr.caution + 0.4 * c.tr.curiosity + 0.8 * c.tr.opportunism; if (c.n) c.want *= 0.3; }},

  {fn:'Joiner', core:'GGA', body:'jaws',
   does:'While it is the very end of your strand, back your tail into a fragment to join it. It fuses around what it grabbed: +1.',
   tag:'Real science', sci:'The class I ligase, one of the first ribozymes evolved from random RNA, joins strands together.',
   reach:30, cooldown:4,
   tune:[['reach', 'Jaw reach', 8, 80, 1, 'px', 'game'], ['cooldown', 'Wait before joining again', 0, 15, 0.5, 's', 'game']],
   likedBy:['opportunism'],
   plan(c){
     const p = c.p, G = c.G;
     /* a useful fragment carries a working segment I lack, or two or more of them */
     const useful = r => { const fl = r.f.s.functions.filter(f => !f.damaged); return fl.length >= 2 || fl.some(f => !c.kinds.has(f.fn)); };
     /* useful fragments in sight that nobody else is already going for */
     const free = c.info.frags.filter(r => r.d < 1600 && useful(r) && !G.players.some(o => o !== p && o.ai && o.ai.mode === 'join' && o.ai.fragPick && o.ai.fragPick.f === r.f)).length;
     /* without one in sight, only a Detector (which points to fragments) makes a Joiner worth building */
     const detector = c.has('Detector');
     if (!free && !detector) return false;
     c.want = 1.1 * c.tr.opportunism + 0.45 * free + (c.info.cleaver ? 0.5 * c.tr.aggression : 0) + (detector ? 0.3 : 0);
     if (free) c.gain += 1.2;
     if (c.n){ c.want *= 0.3 + 0.7 * c.tr.opportunism; if (!free) c.gain *= 0.5; }
   }},

  {fn:'Repairer', core:'ACU', body:'helpers',
   does:'Leaves the strand as two helpers that travel up it once, mending damage and clearing junk.',
   tag:'Game idea', sci:'Cells today repair RNA and DNA with protein enzymes. Whether early RNA could mend itself is an open question.',
   tune:[['S.repSpeed', 'Helper speed (how fast it travels and mends)', 2, 60, 0.5, '', 'game']],
   likedBy:[],
   plan(c){
     /* worth what it would mend */
     const dmg = c.info.damaged;
     c.gain = dmg.reduce((s, f) => s + (c.kinds.has(f.fn) ? 1 : 3), 0);
     if (c.gain < 2) return false;
     /* the other way to mend is a trip to the ice: a Repairer is worth more when there is none nearby */
     const M = c.G.MAP, h = c.info.h, cold = M.CELLS.map((x, i) => i).filter(i => M.CELLS[i].mends);
     const ice = M.nearestOf(cold, h.x, h.y, 2500);
     c.want = 0.5 + 0.35 * dmg.length + 0.5 * c.tr.caution + 0.3 * c.tr.greed + (ice ? 0 : 0.6);
   }},

  {fn:'Self-cutter', core:'UAG', body:'ring',
   does:'One use. Leaves as a ring, cuts off the structure ahead of it, and both burst into letters you can collect again.',
   tag:'Real science', sci:'Most natural ribozymes, like the hammerhead, cut their own backbone at one exact spot.',
   likedBy:[],
   plan(c){
     /* it cuts the last structure before it. Worth it when that is broken (damaged, or a junk fold), to recycle
        it into letters and lose its dead weight, and there is no Repairer to mend it instead */
     if (c.has('Repairer')) return false;
     const s = c.p.s, folded = s.length - s.tail.length;
     const last = s.segments.filter(g => g.end < folded).pop(); if (!last) return false;
     const len = last.end - last.start + 1, st = last.fn ? s.functions.find(f => f.start === last.start) : null;
     const junk = !last.fn && len >= 5, broken = !!(st && st.damaged);
     if (!junk && !broken) return false;
     c.gain = 0.6 + 0.05 * len; c.want = 0.3 + 0.5 * c.tr.opportunism + 0.3 * c.tr.greed;
   }}
];

const BY = Object.fromEntries(LIST.map(s => [s.fn, s]));
const get = fn => (fn && BY[fn]) || null;
const names = LIST.map(s => s.fn);
const bodyOf = fn => { const s = get(fn); return s ? s.body : null; };

/* strength of a folded segment: 1 when spelled exactly; less, or more, with one wrong letter (rna-strand.js) */
const strength = f => (f && f.q != null ? f.q : 1);
/* swim bonus from a strand's working functions, each counted at its strength */
function swimOf(fns){
  const out = {speed:0, turn:0, turnBot:0};
  for (const s of LIST){
    if (!s.swim) continue;
    let n = 0; for (const f of fns) if (f.fn === s.fn) n += strength(f);
    out.speed += s.swim.speed * n; out.turn += s.swim.turn * n; out.turnBot += s.swim.turnBot * n;
  }
  return out;
}
/* seconds of warning before hazards, from a strand's working functions */
function warnEarly(fns){ let e = 1.8; for (const f of fns){ const s = get(f.fn); if (!s || !s.warnEarly) continue; const q = strength(f), w = q === 1 ? s.warnEarly : 1.8 + (s.warnEarly - 1.8) * q; if (w > e) e = w; } return e; }
const any = (fns, key) => fns.some(f => { const s = get(f.fn); return !!(s && s[key]); });

/* a short description of a segment's strength, for messages and the strand panel */
function strengthNote(f){
  const q = strength(f), m = f && f.miss;
  if (q === 1) return '';
  const pct = Math.round(q * 100) + '%';
  if (q > 1) return `a lucky mistake: ${pct} strength, +1`;
  if (m && m.kind === 'wobble') return `a G·U wobble pair in its stem: ${pct} strength`;
  if (m && m.kind === 'stem') return `a mismatched pair in its stem: ${pct} strength`;
  return q >= 0.8 ? `a mild mistake: ${pct} strength` : `a harmful mistake: ${pct} strength`;
}

/* a piece freshly cut off a strand: for the Cleaver's 'fresh' seconds anyone's tail end can take it back on (after a
   short 'arm', so it does not jump straight back onto the strand it came from). It pulses while it can be taken, then
   fades for 'fade' seconds and breaks up into letters. A Cleaver that has just cut rests for 'rest' seconds: a stub
   until its last 'regrow' seconds, then it grows back. These are read through CUT_FRESH, CUT_ARM, CUT_FADE and
   CLEAVE_REST below, so tuning the Cleaver changes them everywhere */
const CL = BY.Cleaver;
/* how shrunk a resting Cleaver is, from the seconds left: 1 (a stub) until the regrowth, then back to 0 */
const restOf = left => { const g = Math.max(0.01, CL.regrow); if (left >= g) return 1; if (left <= 0) return 0; const u = left / g; return u * u * (3 - 2 * u); };
function fragAlpha(fresh, fade, t){
  if (fade != null && fade >= 0) return 0.6 * Math.max(0, fade) / Math.max(0.01, CL.fade);
  if (fresh > 0) return 0.3 + 0.55 * (0.5 + 0.5 * Math.sin(t * 9));
  return 0.7;
}

/* ---------- tuning: the dev panel's Segments section adjusts the values each entry's 'tune' list names ---------- */
const RSG = () => window.RNAStrand;
const pathGet = (o, k) => k.split('.').reduce((a, p) => a == null ? a : a[p], o);
const pathSet = (o, k, v) => { const ps = k.split('.'), last = ps.pop(); const t = ps.reduce((a, p) => a[p], o); t[last] = v; };
function tuneGet(fn, k){ if (k.startsWith('S.')) return RSG() ? RSG().S[k.slice(2)] : undefined; return pathGet(get(fn), k); }
/* the values as shipped, captured the first time anything is tuned (the strand settings exist only once rna-strand.js loads) */
let DEF = null;
function captureDefaults(){ if (DEF) return; DEF = {}; for (const s of LIST) if (s.tune){ DEF[s.fn] = {}; for (const [k] of s.tune) DEF[s.fn][k] = tuneGet(s.fn, k); } }
function tuneSet(fn, k, v){
  captureDefaults(); v = +v;
  if (k.startsWith('S.')){ if (RSG()){ RSG().S[k.slice(2)] = v; RSG().restyle(k.slice(2)); } return; }
  pathSet(get(fn), k, v);
}
const tuneDefault = (fn, k) => { captureDefaults(); return DEF[fn] && DEF[fn][k]; };
/* the values that differ from the shipped ones: {fn:{key:value}} */
function tuneChanged(){
  captureDefaults(); const out = {};
  for (const s of LIST) if (s.tune) for (const [k] of s.tune){ const v = tuneGet(s.fn, k); if (v !== DEF[s.fn][k]) (out[s.fn] = out[s.fn] || {})[k] = v; }
  return out;
}
function tuneApply(o){ for (const fn in o || {}) for (const k in o[fn]){ const s = get(fn); if (s && s.tune && s.tune.some(t => t[0] === k)) tuneSet(fn, k, o[fn][k]); } }
function tuneReset(fn){ captureDefaults(); for (const s of LIST) if (s.tune && (!fn || s.fn === fn)) for (const [k] of s.tune) tuneSet(s.fn, k, DEF[s.fn][k]); }

return {LIST, names, get, bodyOf, swimOf, warnEarly, any, strength, strengthNote, restOf, fragAlpha,
  get CUT_FRESH(){ return CL.fresh; }, get CUT_ARM(){ return CL.arm; }, get CUT_FADE(){ return CL.fade; }, get CLEAVE_REST(){ return CL.rest; },
  tuneGet, tuneSet, tuneDefault, tuneChanged, tuneApply, tuneReset};
})();
