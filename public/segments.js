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
   likedBy:['greed', 'curiosity'],
   plan(c){ c.want = 0.3 + 0.5 * c.tr.curiosity + 0.4 * c.tr.greed + (c.m.fear > 0.3 ? c.tr.caution : 0) - 0.3 * c.n; if (c.n >= 3) c.gain *= 0.5; }},

  {fn:'Cleaver', core:'CUGCUG', body:'spikes',
   does:'Its two spikes damage what they touch on rival strands, then cut damaged structures off. Everything behind the cut floats free.',
   tag:'Real science', sci:'Hammerhead ribozymes can be built to find a target RNA by base pairing, then cut it.',
   /* one base sits at each spike tip */
   tips(f){ const L = f.end - f.start; return [f.start + Math.round(L / 4), f.start + Math.round(3 * L / 4)]; },
   likedBy:['aggression', 'grudge'],
   plan(c){ c.want = 1.7 * c.tr.aggression + 0.5 * c.tr.opportunism + 0.8 * c.m.anger + (c.info.late && c.info.rank > 1 ? 0.6 : 0); if (c.n >= 2) c.want *= 0.35; }},

  {fn:'Membrane', core:'GCCGGC', body:'chamber',
   does:'Takes the hits meant for the functions on either side of it. Dissolves in magnesium.',
   tag:'Real science', sci:'Bubbles of fatty acid can hold RNA, grow and divide. Magnesium breaks them apart.',
   shield:true, saltBreaks:0.25,
   likedBy:['caution', 'patience', 'grudge'],
   plan(c){ c.want = 1.4 * c.tr.caution + 0.35 * c.rivalSpikes + 0.6 * c.m.fear + 0.08 * c.p.s.functions.length; if (c.n >= 2) c.want *= 0.4; }},

  {fn:'Detector', core:'ACAACAACA', body:'circle',
   does:'Warns you of UV flashes and meteorites early and points to the nearest fragment.',
   tag:'Real science', sci:'Riboswitches change shape when they catch a particular molecule, switching genes on or off.',
   warnEarly:4.5, findsFragments:true,
   /* opportunists want one too: it leads them to fragments for a Joiner */
   likedBy:['caution', 'curiosity', 'patience', 'opportunism'],
   plan(c){ c.want = 0.9 * c.tr.caution + 0.4 * c.tr.curiosity + 0.8 * c.tr.opportunism; if (c.n) c.want *= 0.3; }},

  {fn:'Joiner', core:'GGA', body:'jaws',
   does:'While it is the very end of your strand, back your tail into a fragment to join it. It fuses around what it grabbed: +1.',
   tag:'Real science', sci:'The class I ligase, one of the first ribozymes evolved from random RNA, joins strands together.',
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

  {fn:'Repairer', core:'GACGACGAC', body:'helpers',
   does:'Leaves the strand as two helpers that travel up it once, mending damage and clearing junk.',
   tag:'Game idea', sci:'Cells today repair RNA and DNA with protein enzymes. Whether early RNA could mend itself is an open question.',
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

/* a piece freshly cut off a strand: for CUT_FRESH seconds anyone's tail end can take it back on (after a short CUT_ARM,
   so it does not jump straight back onto the strand it came from). It pulses while it can be taken, then fades for
   CUT_FADE seconds and breaks up into letters. fresh = seconds left to take it, fade = seconds left of fading */
const CUT_FRESH = 3.5, CUT_ARM = 0.6, CUT_FADE = 0.8;
function fragAlpha(fresh, fade, t){
  if (fade != null && fade >= 0) return 0.6 * Math.max(0, fade) / CUT_FADE;
  if (fresh > 0) return 0.3 + 0.55 * (0.5 + 0.5 * Math.sin(t * 9));
  return 0.7;
}

return {LIST, names, get, bodyOf, swimOf, warnEarly, any, strength, strengthNote, CUT_FRESH, CUT_ARM, CUT_FADE, fragAlpha};
})();
