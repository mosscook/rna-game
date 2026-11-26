/* =====================================================================
   RNA Strand module v1
   One RNA strand engine shared by the RNA Specimen Lab and the game.
   It folds a sequence into function shapes, runs the Self-cutter and
   Repairer events and damage, and draws the strand with SVG.
   The host owns the camera, the water, input and game rules.

   Use:
     const stage = RNAStrand.createStage(svgElement);   // adds <defs> and stage.world
     stage.world  -> <g> to move with your camera (set its transform)
     stage.zoom   -> your camera zoom, keeps labels readable
     const s = stage.addStrand({seq:'GGC…', x:0, y:0, heading:0, onEvent:(type, data) => {}});
     each frame:  s.cruise(dt, {x, y}, {speed, turnCap, hold})  swim toward a point in smooth arcs (what the lab and game use)
              or  s.step(dt, {target:{x, y}, speed})      steer straight at a point
              or  s.step(dt, {turn, speed})               turn the head directly (radians/s)
              then stage.render()
     s.setSeq('…'), s.append('…'), s.clear(), s.damage(), s.move(dx, dy), s.place(x, y, heading), s.remove()
     s.structureAt(i), s.damageAt(i), s.cutAt(i), s.tint(spine, goo), s.setOpacity(o)
     Game recipes (default, S.pairing 'recipes'): letters stay loose until s.foldTail() turns the tail into
     recipes and junk. s.tail, s.segments, s.dropLast(), s.shedFrom(i), s.setLetter(i, b),
     s.setSeq(letters, segments), s.appendFolded(letters, segments). RNAStrand.RECIPES lists the cores.
     Long parts (S.pairing 'parts'): arms fold and combine on their own as letters arrive.
     options: {tint:{spine:'#hex', goo:'#hex'}}; step control also takes turnRate (radians/s)
     read: s.seq, s.head, s.heading, s.nodes, s.fold, s.functions, s.helpers
   Events: 'seq', 'burst' (letters thrown loose, with positions), 'cutterLaunched', 'cut',
           'repairerLaunched', 'mended', 'cleared', 'helpersDone', 'damaged'.
           Each carries data.text, a plain-language line for the HUD.
   Settings: RNAStrand.S is shared by every strand. Change S[key], then RNAStrand.restyle(key).
   Builders: RNAStrand.buildFn(seq, 'Mover') returns letters to append that fold into it.
   ===================================================================== */
window.RNAStrand = (() => {
'use strict';
const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
const TAU = Math.PI * 2, clamp = (v, a, b) => Math.max(a, Math.min(b, v)), rnd = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];
const wrapA = a => ((a + Math.PI * 3) % TAU) - Math.PI;
const f1 = v => v.toFixed(1);
const MAXLEN = 240;
/* segment types and their body plans live in segments.js */
const SEG = window.SoupSegments, BODY = fn => SEG.bodyOf(fn);

/* ---------- chemistry ---------- */
const BASES = ['A','U','G','C'], COMP = {A:'U', U:'A', G:'C', C:'G'}, HB = {A:2, U:2, G:3, C:3};
const PURINE = {A:true, G:true, U:false, C:false};
/* Watson–Crick edge, major-groove side to minor-groove side: D donor (N–H), A acceptor (lone pair), '' nothing */
const SLOTS = {A:['D','A',''], U:['A','D','A'], G:['A','D','D'], C:['D','A','A']};
const COLOR = {A:'var(--base-a)', U:'var(--base-u)', G:'var(--base-g)', C:'var(--base-c)'};
const MOTIFS = {UUU:'Mover', CUG:'Cleaver', GGA:'Joiner', CCC:'Membrane', UAG:'Self-cutter', GAC:'Repairer', ACA:'Detector'};

/* ---------- settings: shared by every strand on the page; change S[k] then call RNAStrand.restyle(k) ---------- */
const DEFAULTS = {glyph:'dot', color:'base', backbone:'wire', lineW:0.5, helixBand:false, rungs:false, glyphSize:3, glow:0, decor:false, labels:false,
  goo:'memFill', gooCover:'all', gooSize:26, gooSoft:10.5, gooOpacity:0.2, gooBases:false, ripple:0,
  autoSwim:true, autoTurn:0.9, weave:0.5, motion:'trail', turnRate:6, speed:200, undulate:3, drag:0.6,
  pairing:'recipes', looseGap:1.5, minStem:2, foldSpeed:6, shape:1, side:'alternate', sticky:false,
  illus:true, behave:true, repSpeed:18.5, detSize:4, memStyle:'chamber', memDiam:10, memSlope:0.8, memTurns:2.5, memLength:8.5, memTwist:1, memSqueeze:0.95,
  cleaverSpikes:true, spikeLen:12, spikeSlope:2, spikeTwist:0,
  twist:true, rollStep:120, spacing:0.7, depthShade:1, turbine:true, spin:0.7, pitch:80, sweep:0.7,
  particles:true, follow:false, zoom:1,
  cSpine:'#ffffff', cGoo:'#ffffff', cFn:'#7cf0ff', cA:'#3ddc97', cU:'#ff5a6e', cG:'#ffc93c', cC:'#4da3ff', cBg:'#04050a', v:3};
const S = Object.assign({}, DEFAULTS);
const COLOR_KEYS = [['cSpine','Spine','--spine'],['cGoo','Goo','--goo'],['cFn','Function shapes','--fn'],['cBg','Water','--void'],
  ['cA','A','--base-a'],['cU','U','--base-u'],['cG','G','--base-g'],['cC','C','--base-c']];

/* ---------- base glyphs, in units of r, pairing edge facing +x, backbone at the origin ---------- */
const C30 = Math.cos(Math.PI / 6), PENT_R = 0.8507, PENT_RI = 0.6882;
let GEO = {}, R = 6, LB = 14, D = 42, W = 21, LW = 1;
function hexPts(cx, r){ return [30, 90, 150, 210, 270, 330].map(a => [cx + r * Math.cos(a * Math.PI / 180), r * Math.sin(a * Math.PI / 180)]); }
function poly(pts){ return 'M' + pts.map(p => p[0].toFixed(2) + ' ' + p[1].toFixed(2)).join('L') + 'Z'; }
function buildGeom(r){
  const stub = 0.4 * r, slotY = [-0.85 * r, 0, 0.85 * r], out = {};
  for (const b of BASES){
    let rings = '', attach, cx;
    if (PURINE[b]){
      const pcx = stub + PENT_R * r, x0 = pcx + PENT_RI * r; cx = x0 + C30 * r;
      const pent = [36, 108, 180, 252, 324].map(a => [pcx + PENT_R * r * Math.cos(a * Math.PI / 180), PENT_R * r * Math.sin(a * Math.PI / 180)]);
      rings = poly(pent) + poly(hexPts(cx, r)); attach = stub;
    } else { cx = stub + C30 * r; rings = poly(hexPts(cx, r)); attach = cx - C30 * r; }
    const ex = cx + C30 * r + 0.2 * r, rimX = cx + C30 * r;
    let stalks = `M0 0L${attach.toFixed(2)} 0`, pegs = '', cups = '', donors = '';
    SLOTS[b].forEach((t, k) => {
      if (!t) return;
      const y = slotY[k], fromY = k === 1 ? 0 : (k === 0 ? -0.5 * r : 0.5 * r);
      stalks += `M${rimX.toFixed(2)} ${fromY.toFixed(2)}L${ex.toFixed(2)} ${y.toFixed(2)}`;
      if (t === 'D'){
        pegs += `M${ex.toFixed(2)} ${(y - 0.26 * r).toFixed(2)}L${(ex + 0.6 * r).toFixed(2)} ${y.toFixed(2)}L${ex.toFixed(2)} ${(y + 0.26 * r).toFixed(2)}Z`;
        donors += `M${rimX.toFixed(2)} ${fromY.toFixed(2)}L${ex.toFixed(2)} ${y.toFixed(2)}L${(ex + 0.75 * r).toFixed(2)} ${y.toFixed(2)}`;
      } else { const c = ex + 0.36 * r, rr = 0.3 * r; cups += `M${c.toFixed(2)} ${(y - rr).toFixed(2)}A${rr.toFixed(2)} ${rr.toFixed(2)} 0 0 0 ${c.toFixed(2)} ${(y + rr).toFixed(2)}`; }
    });
    out[b] = {rings, stalks, pegs, cups, donors, attach, edge:ex, rc:cx, slotY};
  }
  out.pairD = out.A.edge + out.U.edge + 0.8 * r;
  return out;
}
function rebuildGlyphs(){
  R = S.glyphSize; LW = S.lineW / 2; GEO = buildGeom(R); LB = 2.3 * R; D = GEO.pairD; W = D / 2;
  for (const st of stages) buildGlyphDefs(st.glyphDefs);
}
function buildGlyphDefs(defs){
  defs.innerHTML = '';
  for (const b of BASES){
    const G = GEO[b];
    const s = el('g', {id:'rs-gs-' + b}, defs);
    el('path', {d:`M0 0L${G.attach.toFixed(2)} 0`, fill:'none', stroke:'currentColor', 'stroke-width':1.3 * LW, 'stroke-linecap':'round'}, s);
    el('path', {d:G.rings, fill:'none', stroke:'currentColor', 'stroke-width':1.6 * LW, 'stroke-linejoin':'round'}, s);
    const so = el('g', {id:'rs-gso-' + b}, defs);
    el('path', {d:`M0 0L${G.attach.toFixed(2)} 0`, fill:'none', stroke:'currentColor', 'stroke-width':1.6 * LW, 'stroke-linecap':'round'}, so);
    el('path', {d:G.rings, fill:'currentColor', stroke:'currentColor', 'stroke-width':1.2 * LW, 'stroke-linejoin':'round'}, so);
    const l = el('g', {id:'rs-gl-' + b}, defs);
    el('path', {d:`M0 0L${(G.rc - R).toFixed(2)} 0`, stroke:'currentColor', 'stroke-width':1.3 * LW}, l);
    el('circle', {cx:G.rc, cy:0, r:R * 1.05, fill:'var(--void)', stroke:'currentColor', 'stroke-width':1.5 * LW}, l);
    const d = el('g', {id:'rs-gd-' + b}, defs);
    el('path', {d:`M0 0L${(G.rc).toFixed(2)} 0`, stroke:'currentColor', 'stroke-width':1.3 * LW}, d);
    el('circle', {cx:G.rc, cy:0, r:R * (PURINE[b] ? 1.05 : 0.7), fill:'currentColor'}, d);
    const dh = el('g', {id:'rs-gdh-' + b}, defs);
    el('path', {d:`M0 0L${(G.rc - R * 0.7).toFixed(2)} 0`, stroke:'currentColor', 'stroke-width':1.3 * LW, 'stroke-dasharray':'1.5 2'}, dh);
    el('circle', {cx:G.rc, cy:0, r:R * (PURINE[b] ? 1.05 : 0.7), fill:'none', stroke:'currentColor', 'stroke-width':Math.max(0.8, 1.2 * LW)}, dh);
  }
}
const glyphHref = () => ({dot:'rs-gd-', solid:'rs-gso-', letter:'rs-gl-'}[S.glyph] || 'rs-gs-');

/* ---------- folding: pure functions of the sequence ---------- */
function foldOf(s, minStem){
  const n = s.length, cands = [];
  for (let a = 0; a < n; a++) for (let l = 3; l <= 9; l++){
    const b = a + l + 1; if (b >= n) break;
    let k = 0, hb = 0;
    while (a - k >= 0 && b + k < n && COMP[s[a - k]] === s[b + k]){ hb += HB[s[a - k]]; k++; }
    if (k >= minStem) cands.push({a, b, stem:k, loop:l, hb});
  }
  cands.sort((x, y) => y.hb - x.hb || y.stem - x.stem || x.a - y.a || x.loop - y.loop);
  const used = new Array(n).fill(false), hps = [];
  for (const c of cands){
    let ok = true; for (let i = c.a; i <= c.b; i++) if (used[i]){ ok = false; break; }
    if (!ok) continue;
    let k = 0; while (k < c.stem && !used[c.a - k] && !used[c.b + k]) k++;
    if (k < minStem) continue;
    let hb = 0, gc = 0; for (let q = 0; q < k; q++){ hb += HB[s[c.a - q]]; if (s[c.a - q] === 'G' || s[c.a - q] === 'C') gc++; }
    const h = {a:c.a, b:c.b, stem:k, loop:c.loop, hb, gc, start:c.a - k + 1, end:c.b + k - 1, recipe:false};
    h.fn = c.loop === 3 && k === 2 ? MOTIFS[s.slice(c.a + 1, c.a + 4)] || '' : '';
    for (let i = h.start; i <= h.end; i++) used[i] = true;
    hps.push(h);
  }
  return hps.sort((x, y) => x.a - y.a);
}
/* the game's own rule: 7-letter windows read from the newest end */
function recipeAt(s, k){
  if (k < 0 || k + 7 > s.length) return null;
  if (COMP[s[k + 1]] !== s[k + 5] || COMP[s[k]] !== s[k + 6]) return null;
  const fn = MOTIFS[s.slice(k + 2, k + 5)]; if (!fn) return null;
  const gc = (s[k] === 'G' || s[k] === 'C') + (s[k + 1] === 'G' || s[k + 1] === 'C');
  return {start:k, end:k + 6, a:k + 1, b:k + 5, stem:2, loop:3, fn, recipe:true, hb:HB[s[k]] + HB[s[k + 1]], gc};
}
const UNIT_TEXT = {
  Cleaver:'one long arm that folds into two opposing spikes', Mover:'two arms side by side', Membrane:'three or more arms side by side',
  Joiner:'a cheap 7-letter hairpin with a GGA loop. At the tail it is a mouth that grabs fragments; once one attaches right behind it, it fuses around that segment and adds +1',
  Detector:'pricey like the Repairer: one long run that folds back on itself twice, with ACA at each turn. Its middle pairs with both sides, so the strand arcs out, runs back along the spine and arcs out the other way, closing into a circle',
  'Self-cutter':'a cheap 7-letter hairpin with a UAG loop. It leaves the strand as a ring, slides up to the structure ahead, squeezes it off, and both burst into loose letters', Repairer:'the priciest: two hairpins with GAC loops side by side, one long and one short. It leaves the strand and its two hairpins become odd-shaped helpers that travel up the strand once, mending damaged structures and clearing away junk and loose letters, then dissolve at the 5′ end'
};
/* Repairer: two GAC-loop hairpins side by side with different stem lengths (3 to 6 pairs) */
function repairersOf(s){
  const hp = [], out = [];
  for (let p = 1; p + 3 < s.length; p++){
    if (s[p] !== 'G' || s[p + 1] !== 'A' || s[p + 2] !== 'C') continue;
    let q = 0, hb = 0, gc = 0;
    while (q < 6 && p - 1 - q >= 0 && p + 3 + q < s.length && COMP[s[p - 1 - q]] === s[p + 3 + q]){ hb += HB[s[p - 1 - q]]; gc += s[p - 1 - q] === 'G' || s[p - 1 - q] === 'C'; q++; }
    if (q >= 3) hp.push({a:p - 1, b:p + 3, stem:q, loop:3, hb, gc, start:p - q, end:p + 2 + q});
  }
  let last = -1;
  for (let i = 0; i < hp.length; i++){
    const h1 = hp[i]; if (h1.start <= last) continue;
    const h2 = hp.find(h => h.start > h1.end && h.start - h1.end - 1 <= 2 && h.stem !== h1.stem);
    if (!h2) continue;
    out.push([h1, h2]); last = h2.end;
  }
  return out;
}
/* Detector: X + ACA + (X paired back) + ACA + X again, so the middle run pairs with both sides (stem 5 to 8) */
function detectorsOf(s){
  const out = [];
  for (let p = 1; p + 3 < s.length; p++){
    if (s[p] !== 'A' || s[p + 1] !== 'C' || s[p + 2] !== 'A') continue;
    let qm = 0; while (qm < 8 && p - 1 - qm >= 0 && p + 3 + qm < s.length && COMP[s[p - 1 - qm]] === s[p + 3 + qm]) qm++;
    for (let q = qm; q >= 5; q--){
      const t2 = p + 3 + q;
      if (t2 + 2 + q >= s.length || s[t2] !== 'A' || s[t2 + 1] !== 'C' || s[t2 + 2] !== 'A') continue;
      let ok = true; for (let t = 0; t < q && ok; t++) if (COMP[s[t2 - 1 - t]] !== s[t2 + 3 + t]) ok = false;
      if (!ok) continue;
      let hb = 0; for (let t = 0; t < q; t++) hb += HB[s[p - 1 - t]] * 2;
      out.push({kind:'detector', fn:'Detector', start:p - q, end:t2 + 2 + q, q, a:p - 1, b:p + 3, stem:q, loop:3, hb, t1:p, t2, recipe:false});
      p = t2 + 2 + q; break;
    }
  }
  return out;
}
function partsFold(s, minStem){
  const n = s.length, masked = s.split(''), joiners = [], cutters = [], reps = [];
  const dets = detectorsOf(s), detArms = [];
  for (const u of dets){
    for (let i = u.start; i <= u.end; i++) masked[i] = 'N';
    detArms.push({kind:'arm', detector:true, fn:'', a:u.a, b:u.b, stem:u.q, loop:3, start:u.start, end:u.t2 - 1, hb:0, gc:0},
                 {kind:'arm', detector:true, fn:'', a:u.t2 - 1, b:u.t2 + 3, stem:u.q, loop:3, start:u.t1 + 3, end:u.end, hb:0, gc:0});
  }
  for (const [h1, h2] of repairersOf(masked.join(''))){
    for (const h of [h1, h2]) Object.assign(h, {kind:'arm', repairer:true, fn:'', recipe:false});
    reps.push(h1, h2);
    for (let i = h1.start; i <= h2.end; i++) masked[i] = 'N';
  }
  /* Joiners: the 7-letter GGA hairpin, found first so it stays small and recognisable */
  for (let k = 0; k + 7 <= n;){
    const r = masked.slice(k, k + 7).includes('N') ? null : recipeAt(s, k);
    if (r && r.fn === 'Joiner'){ joiners.push(Object.assign(r, {kind:'arm', joiner:true, fn:'', recipe:false})); for (let i = k; i < k + 7; i++) masked[i] = 'N'; k += 7; }
    else if (r && r.fn === 'Self-cutter'){ cutters.push(Object.assign(r, {kind:'arm', cutter:true, fn:'', recipe:false})); for (let i = k; i < k + 7; i++) masked[i] = 'N'; k += 7; }
    else k++;
  }
  const arms = foldOf(masked.join(''), minStem).map(h => Object.assign(h, {fn:'', kind:'arm'})).concat(joiners, cutters, reps, detArms).sort((x, y) => x.start - y.start);
  const clamps = [], special = joiners.concat(cutters, reps, dets);
  const units = [], free = arms.filter(h => !h.joiner && !h.cutter && !h.repairer && !h.detector);
  let run = [];
  const flush = () => {
    if (run.length >= 2) units.push({kind:'tandem', fn:run.length === 2 ? 'Mover' : 'Membrane', arms:run.slice(), start:run[0].start, end:run[run.length - 1].end});
    else if (run.length === 1 && run[0].stem >= 5 && run[0].loop <= 4) units.push({kind:'arm', fn:'Cleaver', arms:run.slice(), start:run[0].start, end:run[0].end});
    run = [];
  };
  free.forEach(h => {
    const prev = run[run.length - 1];
    const blocked = prev && special.some(j => j.start > prev.end && j.start < h.start);
    if (prev && (h.start - prev.end - 1 > 2 || blocked)) flush();
    run.push(h);
  });
  flush();
  const mods = free.concat(special).sort((x, y) => x.start - y.start);
  for (const c of cutters) units.push({kind:'cutter', fn:'Self-cutter', arms:[c], start:c.start, end:c.end});
  for (const u of dets) units.push(u);
  for (let k = 0; k < reps.length; k += 2) units.push({kind:'repairer', fn:'Repairer', arms:[reps[k], reps[k + 1]], start:reps[k].start, end:reps[k + 1].end});
  /* a Joiner works at the tail; once something attaches right behind it, it fuses around that segment and adds +1 */
  for (const j of joiners){
    if (n - 1 - j.end <= 2){ j.jstate = 'armed'; units.push({kind:'joiner', fn:'Joiner', arms:[j], start:j.start, end:j.end, jstate:'armed'}); continue; }
    const next = mods.find(m => m.start > j.end);
    if (next && next.start - j.end - 1 <= 1){
      j.jstate = 'fused';
      const tgt = units.find(u => u.start <= next.start && u.end >= next.start) || null;
      if (tgt) tgt.bonus = (tgt.bonus || 0) + 1;
      j.target = tgt;
      units.push({kind:'joiner', fn:'Joiner', fused:true, arms:[j], start:j.start, end:j.end, jstate:'fused', target:tgt});
    } else j.jstate = 'spent';
  }
  units.sort((x, y) => x.start - y.start);
  let g = 0;
  mods.forEach((m, k) => {
    if (m.kind === 'clamp'){ m.grp = g++; return; }
    const prev = mods[k - 1], u = units.find(u => u.kind === 'tandem' && u.arms.includes(m));
    m.grp = u && prev && u.arms.includes(prev) ? prev.grp : g++;
  });
  return {arms, clamps, units, mods};
}
/* Cleaver: the strand runs base of spike A -> tip A -> centre -> tip B -> base, so one base sits at each tip */
const isCleaver = m => !!m && (m.cleaver || (m.recipe && BODY(m.fn) === 'spikes'));
function spikeIdx(m){ const L = m.end - m.start; return {tA:Math.round(L / 4), C:Math.round(L / 2), tB:Math.round(3 * L / 4), L}; }
function spikeShape(m){
  const {tA, C, tB, L} = spikeIdx(m), Lu = S.spikeLen, sl = S.spikeSlope;
  const P = [[0, -1], [Lu, -0.5 + sl], [0, 0], [-Lu, 0.5 + sl], [0, 1]], K = [0, tA, C, tB, L], out = [];
  for (let seg = 0; seg < 4; seg++){
    const a = P[seg], b = P[seg + 1], k0 = K[seg], k1 = K[seg + 1];
    for (let k = k0; k < (seg === 3 ? k1 + 1 : k1); k++){ const f = (k - k0) / ((k1 - k0) || 1); out[k] = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]; }
  }
  return out;
}
/* Detector: a circle split by the spine. Top arc out, a tight turn, back along the middle, another turn, bottom arc out.
   Arc bases point into the circle; the middle run's bases alternate up and down, pairing with both halves */
function detGeom(u){
  /* top arc, a turn, back along the middle, a turn, bottom arc: the letters are shared out between the three passes */
  const n = u.n || (u.q * 3 + 6), Rd = S.detSize * LB, e = 0.35, out = [];
  const rest = Math.max(3, n - 2), mid = Math.floor(rest / 3), top = Math.ceil((rest - mid) / 2), bot = rest - mid - top;
  const arc = (a0, a1, cnt) => { for (let j = 0; j < cnt; j++){ const f = cnt > 1 ? j / (cnt - 1) : 0.5, a = a0 + (a1 - a0) * f; out.push({x:Rd * Math.cos(a), y:Rd * Math.sin(a), ax:0, ay:0}); } };
  arc(Math.PI - e, e, top);
  out.push({x:Rd * 0.98, y:0, ax:0, ay:0});
  const M = 0.74 * Rd;
  for (let j = 0; j < mid; j++){ const x = mid > 1 ? M - 2 * M * j / (mid - 1) : 0; out.push({x, y:0, ax:x, ay:(j % 2 ? -1 : 1) * Rd}); }
  out.push({x:-Rd * 0.98, y:0, ax:0, ay:0});
  arc(Math.PI + e, TAU - e, bot);
  return out.slice(0, n);
}
/* ---------- game recipes: a 2-letter stem, the function's core, then the stem's partners in reverse ----------
   Mover is A–U rich (flexible blades), Membrane G–C rich (the strongest pairs, a sturdy wall). */
const RECIPES = Object.fromEntries(SEG.LIST.map(s => [s.fn, s.core]));
const RECIPE_LIST = Object.entries(RECIPES).sort((a, b) => b[1].length - a[1].length);
const recipeLen = fn => RECIPES[fn].length + 4;
function recipeMatch(s, k, fn){
  const core = RECIPES[fn], L = core.length + 4;
  if (k < 0 || k + L > s.length) return false;
  for (let j = 0; j < core.length; j++) if (s[k + 2 + j] !== core[j]) return false;
  return COMP[s[k + 1]] === s[k + L - 2] && COMP[s[k]] === s[k + L - 1];
}
/* read a run of letters from its newest end: recipes where they match, junk in between */
function parseRecipes(s){
  const hits = []; let i = s.length;
  while (i > 0){
    let hit = null;
    for (const [fn] of RECIPE_LIST){ const L = recipeLen(fn); if (i - L >= 0 && recipeMatch(s, i - L, fn)){ hit = {fn, start:i - L, end:i - 1}; break; } }
    if (hit){ hits.unshift(hit); i = hit.start; } else i--;
  }
  const out = []; let pos = 0;
  for (const h of hits){ if (h.start > pos) out.push({fn:null, start:pos, end:h.start - 1}); out.push(h); pos = h.end + 1; }
  if (pos < s.length) out.push({fn:null, start:pos, end:s.length - 1});
  return out;
}
/* the letter a recipe needs at position i, given the letters t collected for it so far (null = any letter) */
function recipeNeed(t, fn, i){
  const core = RECIPES[fn], L = core.length + 4;
  if (i < 2 || i >= L) return null;
  if (i < 2 + core.length) return core[i - 2];
  const src = t[L - 1 - i]; return src ? COMP[src] : null;
}
/* how much of a recipe the end of a tail already spells: {k letters, t those letters} */
function recipeProgress(tail, fn){
  const L = recipeLen(fn);
  for (let k = Math.min(L, tail.length); k >= 1; k--){
    const t = tail.slice(tail.length - k); let ok = true;
    for (let i = 0; i < k && ok; i++){ const need = recipeNeed(t, fn, i); if (need && t[i] !== need) ok = false; }
    if (ok) return {k, t};
  }
  return {k:0, t:''};
}
function recipeSeq(fn){ const a = pick(Math.random() < 0.7 ? ['G', 'C'] : ['A', 'U']), b = pick(Math.random() < 0.7 ? ['G', 'C'] : ['A', 'U']); return a + b + RECIPES[fn] + COMP[b] + COMP[a]; }
/* a sparse hairpin: k letters spread evenly up one side, round the loop and back, at a fixed size */
function bladeShape(m){
  const k = m.end - m.start + 1, side = 2.4 * LB, rr = W, arc = Math.PI * rr, tot = 2 * side + arc, out = [];
  for (let j = 0; j < k; j++){
    const sd = k > 1 ? j / (k - 1) * tot : tot / 2; let x, y;
    if (sd <= side){ x = sd; y = -rr; }
    else if (sd <= side + arc){ const a = -Math.PI / 2 + (sd - side) / rr; x = side + Math.cos(a) * rr; y = Math.sin(a) * rr; }
    else { x = side - (sd - side - arc); y = rr; }
    out.push([x / LB, y / W]);
  }
  return out;
}
function shapeOf(m){
  if (m.kind === 'detector') return detGeom(m).map(g => [g.y / LB, g.x / W]);
  if (S.cleaverSpikes && isCleaver(m)) return spikeShape(m);
  if (m.sparse) return bladeShape(m);
  if (m.shape) return m.shape;
  const out = new Array(m.end - m.start + 1), L = m.loop, bulge = 1 + L / 7;
  for (let q = 0; q < m.stem; q++){ out[q] = [q, -1]; out[out.length - 1 - q] = [q, 1]; }
  for (let j = 0; j < L; j++){
    const th = -Math.PI / 2 + Math.PI * (j + 1) / (L + 1);
    out[m.stem + j] = [(m.stem - 1) + Math.cos(th) * bulge * W / LB, Math.sin(th) * bulge];
  }
  return out;
}

/* ---------- builders: sequences that fold into a given function next to what is already there ---------- */
const rcs = x => x.split('').reverse().map(b => COMP[b]).join('');
const LOOPS = {3:['GAA','AAA','GCA'], 4:['GAAA','GCAA','GAGA','UUCG'], 7:['GAAAUAA','AAGAAUA','GAUAAAA']};
const rstem = k => { let x = ''; for (let i = 0; i < k; i++) x += pick(Math.random() < 0.7 ? ['G','C'] : ['A','U']); return x; };
const armSeq = (stem, loop) => { const st = rstem(stem); return st + pick(LOOPS[loop]) + rcs(st); };
function unitSeq(fn){
  switch (fn){
    case 'Mover': return armSeq(3, 4) + 'A' + armSeq(3, 4);
    case 'Membrane': return armSeq(3, 4) + 'A' + armSeq(3, 4) + 'A' + armSeq(3, 4);
    case 'Cleaver': return armSeq(5, 3);
    case 'Joiner': { const st = rstem(2); return st + 'GGA' + rcs(st); }
    case 'Self-cutter': { const st = rstem(2); return st + 'UAG' + rcs(st); }
    case 'Detector': { const x = rstem(7); return x + 'ACA' + rcs(x) + 'ACA' + x; }
    case 'Repairer': { const a = rstem(6), b = rstem(4); return a + 'GAC' + rcs(a) + 'A' + b + 'GAC' + rcs(b); }
    default: return '';
  }
}
function buildFn(base, fn){
  const ms = Math.max(2, Math.min(3, S.minStem)), sig = u => u.fn + '@' + u.start + '-' + u.end;
  const keep = u => u.fn !== 'Joiner';
  const before = partsFold(base, ms).units.filter(keep).map(sig);
  for (let t = 0; t < 400; t++) for (const sp of base.length ? ['AAA', 'AA', 'AAAA', 'UUU'] : ['']){
    const add = sp + unitSeq(fn), s2 = base + add;
    if (s2.length > MAXLEN) return null;
    const all = partsFold(s2, ms).units, after = all.filter(u => keep(u) || u.start === base.length + sp.length).map(sig);
    if (after.length === before.length + 1 && before.every(x => after.includes(x)) && after.some(x => x.startsWith(fn + '@' + (base.length + sp.length) + '-'))) return add;
  }
  return null;
}
function buildPartsSeven(){
  let best = '';
  for (let tries = 0; tries < 6; tries++){
    let sq = '', got = 0;
    for (const fn of ['Mover', 'Cleaver', 'Membrane', 'Detector', 'Repairer', 'Joiner']){ const add = buildFn(sq, fn); if (add){ sq += add; got++; } }
    if (got === 6) return sq;
    if (sq.length > best.length) best = sq;
  }
  return best;
}
/* simulate a join: a fragment attaches right behind an armed Joiner */
function joinFragment(base){
  const f0 = partsFold(base, Math.max(2, Math.min(3, S.minStem)));
  const j = f0.units.find(u => u.jstate === 'armed');
  if (!j) return null;
  for (let t = 0; t < 300; t++) for (const sp of ['', 'A']){
    const fn = pick(['Cleaver', 'Mover']);
    const pad = base.length - 1 - j.end, add = sp + unitSeq(fn), s2 = base + add;
    if (pad + sp.length > 1 || s2.length > MAXLEN) continue;
    const f = partsFold(s2, Math.max(2, Math.min(3, S.minStem)));
    if (f.units.some(u => u.fused && u.start === j.start && u.target && u.target.fn === fn)) return add;
  }
  return null;
}

/* ---------- stages: one per <svg>, sharing the settings above ---------- */
const stages = [];
function createStage(svg){
  const defs = el('defs', {}, svg);
  const glyphDefs = el('g', {}, defs);
  const world = el('g', {class:'rs-world'}, svg);
  /* goo is drawn as wide strokes, not filters: a soft body and an outline cut with a mask */
  const L = {gooFL:el('g', {}, world), gooL:el('g', {}, world), main:el('g', {}, world), helperGoo:el('g', {}, world), helpers:el('g', {}, world)};
  const stage = {svg, world, defs, layers:L, glyphDefs, strands:[], zoom:1, nextId:0,
    addStrand:opts => makeStrand(stage, opts || {}),
    render(){ for (const s of stage.strands) s.render(); },
    /* done with this stage (a server room going to sleep, a finished test round): let it be freed */
    dispose(){ for (const s of stage.strands.slice()) s.remove(); const i = stages.indexOf(stage); if (i >= 0) stages.splice(i, 1); }};
  stages.push(stage);
  if (!GEO.A) rebuildGlyphs(); else buildGlyphDefs(glyphDefs);
  applyColors(stage);
  return stage;
}
function applyColors(st){ for (const s of st ? [st] : stages) for (const [k, , v] of COLOR_KEYS) s.svg.style.setProperty(v, S[k]); }
/* call after changing RNAStrand.S[key] */
function restyle(k){
  if (k == null || k === 'glyphSize' || k === 'lineW' || k === 'glyph') rebuildGlyphs();
  if (k == null || COLOR_KEYS.some(x => x[0] === k)) applyColors();
  for (const st of stages) for (const s of st.strands) s._restyle(k);
}

/* ---------- one strand ---------- */
function makeStrand(stage, opts){
  const onEvent = opts.onEvent || (() => {});
  const emit = (type, data) => { try { onEvent(type, data || {}); } catch(e){ console.error(e); } };
  const hint = (type, text, data) => emit(type, Object.assign({text}, data || {}));
  /* this strand's own layers inside the stage's shared ones */
  const E = {};
  E.gooFL = el('g', {}, stage.layers.gooFL); E.gooL = el('g', {}, stage.layers.gooL);
  E.main = el('g', {}, stage.layers.main);
  E.hull = el('path', {fill:'var(--fn)', 'fill-opacity':'.06', stroke:'var(--fn)', 'stroke-opacity':'.7', 'stroke-dasharray':'5 6', 'stroke-linejoin':'round'}, E.main);
  E.decoFill = el('path', {fill:'var(--fn)', stroke:'none'}, E.main);
  E.bands = el('path', {fill:'var(--spine)', opacity:'.1'}, E.main);
  E.bbRibbon = el('path', {fill:'none', stroke:'var(--spine)', 'stroke-linecap':'round', 'stroke-linejoin':'round', opacity:'.3'}, E.main);
  E.bb = el('path', {fill:'none', stroke:'var(--spine)', 'stroke-linecap':'round', 'stroke-linejoin':'round'}, E.main);
  E.bbNick = el('path', {fill:'none', stroke:'var(--void)', 'stroke-linecap':'butt', 'stroke-linejoin':'round'}, E.main);
  E.decoLine = el('path', {fill:'none', stroke:'var(--fn)', 'stroke-linecap':'round', 'stroke-linejoin':'round'}, E.main);
  E.rungs = el('path', {fill:'none', stroke:'var(--spine)', 'stroke-dasharray':'2 2.5', opacity:'.85'}, E.main);
  E.glyphs = el('g', {}, E.main);
  E.core = el('circle', {fill:'var(--spine)'}, E.main);
  E.letters = el('g', {'font-family':'ui-monospace, monospace', 'font-weight':700, 'text-anchor':'middle', 'dominant-baseline':'central'}, E.main);
  E.labels = el('g', {'font-family':'system-ui, sans-serif', 'font-weight':700, 'font-size':12, 'text-anchor':'middle', fill:'var(--fn)'}, E.main);
  E.cutRing = el('g', {}, E.main); E.cutPath = el('path', {fill:'none', stroke:'var(--spine)', 'stroke-linejoin':'round'}, E.cutRing);
  E.scatterL = el('g', {}, E.main);
  E.helperGoo = el('g', {}, stage.layers.helperGoo); E.helpers = el('g', {}, stage.layers.helpers);
  const mid = 'rs-m' + (stage.nextId++);
  E.gooBody = el('path', {fill:'none', stroke:'var(--goo)', 'stroke-linecap':'round', 'stroke-linejoin':'round'}, E.gooFL);
  E.mask = el('mask', {id:mid, maskUnits:'userSpaceOnUse', x:-1e5, y:-1e5, width:2e5, height:2e5}, stage.defs);
  el('rect', {x:-1e5, y:-1e5, width:2e5, height:2e5, fill:'#fff'}, E.mask);
  E.gooIn = el('path', {fill:'none', stroke:'#000', 'stroke-linecap':'round', 'stroke-linejoin':'round'}, E.mask);
  E.gooOut = el('path', {fill:'none', stroke:'var(--goo)', 'stroke-linecap':'round', 'stroke-linejoin':'round', mask:`url(#${mid})`}, E.gooL);
  const $ = id => E[id];
  const groups = () => [E.gooFL, E.gooL, E.main, E.helperGoo, E.helpers];
  let visible = true;
  function tint(spine, goo){ for (const g of groups()){ if (spine) g.style.setProperty('--spine', spine); if (goo) g.style.setProperty('--goo', goo); } }
  if (opts.tint) tint(opts.tint.spine, opts.tint.goo);

  let seq = null, N = [], fold = {mods:[], partner:[], loopOf:[], role:[]}, pairs = new Map(), sticky = new Map();
  let head = {x:0, y:0}, target = {x:60, y:0}, heading = 0, moving = 0, trail = [];
  function computeFold(){ computePartsFold(); }
  /* game recipes: folding happens only when the host calls fold(); segs records what folded where */
  let segs = [];
  const recipeMode = () => (opts.mode || S.pairing) !== 'parts';
  function recipeStructures(){
    const arms = [], units = [], mods = [], junk = [], n = seq.length;
    const arm = (lo, hi, extra) => { const len = hi - lo + 1, stem = Math.max(1, Math.floor((len - 3) / 2)), loop = len - 2 * stem;
      const h = Object.assign({kind:'arm', fn:'', start:lo, end:hi, a:lo + stem - 1, b:hi - stem + 1, stem, loop, hb:0, gc:0, sparse:true, recipe:false}, extra || {}); arms.push(h); return h; };
    for (const sg of segs){
      const {fn, start, end} = sg, len = end - start + 1;
      if (end >= n) continue;
      if (!fn){ if (len >= 5) mods.push(arm(start, end)); else junk.push({kind:'junk', fn:'', start, end, stem:0}); continue; }
      /* the shape comes from the segment's body plan (segments.js) */
      const body = BODY(fn);
      if (body === 'blades' || body === 'helpers'){
        const rep = body === 'helpers';
        const cut = rep ? start + Math.ceil(len / 2) : start + Math.floor(len / 2) - 1;
        const x = rep ? {repairer:true} : {};
        const h1 = arm(start, cut, x), h2 = arm(cut + 1, end, x); mods.push(h1, h2);
        units.push({kind:rep ? 'repairer' : 'tandem', fn, arms:[h1, h2], start, end});
      } else if (body === 'chamber') units.push({kind:'tandem', fn, arms:[], start, end});
      else if (body === 'spikes'){ const h = arm(start, end, {cleaver:true}); mods.push(h); units.push({kind:'arm', fn, arms:[h], start, end}); }
      else if (body === 'jaws'){ const h = arm(start, end, {joiner:true}); delete h.sparse; mods.push(h); units.push({kind:'joiner', fn, arms:[h], start, end}); }
      else if (body === 'ring'){ const h = arm(start, end, {cutter:true}); mods.push(h); units.push({kind:'cutter', fn, arms:[h], start, end}); }
      else if (body === 'circle'){ const h = arm(start, end, {detector:true}); const u = {kind:'detector', fn, start, end, n:len, a:h.a, b:h.b, stem:h.stem, loop:h.loop, hb:0, recipe:false}; units.push(u); mods.push(u); }
      else { const h = arm(start, end); mods.push(h); units.push({kind:'arm', fn, arms:[h], start, end}); }   /* no known body: a plain hairpin */
    }
    /* a Joiner is armed while nothing follows it; once a structure is joined right behind it, it fuses around it for +1 */
    for (const u of units.filter(v => BODY(v.fn) === 'jaws')){
      const h = u.arms[0];
      if (u.end === n - 1){ h.jstate = u.jstate = 'armed'; continue; }
      const nx = units.find(v => v.start === u.end + 1);
      if (nx){ h.jstate = u.jstate = 'fused'; u.fused = true; u.target = nx; nx.bonus = (nx.bonus || 0) + 1; h.target = nx; }
      else { h.jstate = 'spent'; units.splice(units.indexOf(u), 1); }
    }
    units.sort((x, y) => x.start - y.start); mods.sort((x, y) => x.start - y.start);
    let g = 0;
    mods.forEach((m, k) => { const prev = mods[k - 1], u = units.find(u => u.kind === 'tandem' && u.arms.includes(m)); m.grp = u && prev && u.arms.includes(prev) ? prev.grp : g++; });
    return {arms, clamps:[], units, mods, junk};
  }
  function computePartsFold(){
    const n = seq.length, pf = recipeMode() ? recipeStructures() : partsFold(seq.join(''), S.minStem);
    const partner = new Array(n).fill(-1), loopOf = new Array(n).fill(null), role = new Array(n).fill('free'), next = new Map();
    const addStem = (a, b, stem) => { for (let q = 0; q < stem; q++){ const i = a - q, j = b + q; partner[i] = j; partner[j] = i; role[i] = role[j] = 'stem';
      const key = i + '-' + j; next.set(key, pairs.get(key) || {i, j, s:0, delay:q * 0.22 / S.foldSpeed}); } };
    pf.arms.forEach(h => { addStem(h.a, h.b, h.stem); for (let i = h.a + 1; i < h.b; i++){ loopOf[i] = h; role[i] = 'loop'; } });
    pf.units.forEach(u => { if (BODY(u.fn) === 'spikes' && u.arms) u.arms[0].cleaver = true; });
    pairs = next; sticky.clear();
    fold = {mods:pf.mods, partner, loopOf, role, units:pf.units, tags:pf.units, arms:pf.arms, junk:pf.junk || []};
  }
  let dmg = [];
  const rangeDamaged = m => { for (let i = m.start; i <= m.end; i++) if (dmg[i]) return true; return false; };
  const modProg = m => { let t = 0; for (let q = 0; q < m.stem; q++){ const p = pairs.get((m.a - q) + '-' + (m.b + q)); t += p ? p.s : 0; } t /= m.stem; return rangeDamaged(m) ? Math.min(t, 0.45) : t; };
  function sideOf(mi){ const m = fold.mods[mi], g = m && m.grp != null ? m.grp : mi; return S.side === 'left' ? 1 : S.side === 'right' ? -1 : g % 2 ? -1 : 1; }
  function syncNodes(){
    if (!N.length && seq.length) N.push({x:head.x, y:head.y, px:head.x, py:head.y, ang:0});
    while (N.length < seq.length){
      const a = N[N.length - 1], b = N[N.length - 2];
      let dx = -Math.cos(heading), dy = -Math.sin(heading);
      if (b){ dx = a.x - b.x; dy = a.y - b.y; const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d; }
      const x = a.x + dx * LB, y = a.y + dy * LB;
      N.push({x, y, px:x, py:y, ang:Math.atan2(dy, dx) + Math.PI / 2});
    }
    N.length = seq.length;
  }
  function setSeq(arr){
    seq = arr.slice(0, MAXLEN);
    segs = segs.filter(g => g.end < seq.length);
    if (dmg.length > seq.length) dmg.length = seq.length; while (dmg.length < seq.length) dmg.push(false);
    syncNodes(); computeFold(); buildPools();
    emit('seq', {seq:seq.join('')});
  }
  /* ---------- head steering, shared by both bodies ---------- */
  function steer(dt, maxSpeed, turnRate){
    const dx = target.x - head.x, dy = target.y - head.y, d = Math.hypot(dx, dy);
    if (d > 3){
      const want = Math.atan2(dy, dx), turn = wrapA(want - heading);
      const tr = turnRate != null ? turnRate : S.turnRate;
      heading += clamp(turn, -tr * dt, tr * dt);
      const facing = Math.max(0, Math.cos(wrapA(want - heading)));
      const sp = Math.min(maxSpeed != null ? maxSpeed : S.speed, d * 5) * (0.3 + 0.7 * facing);
      head.x += Math.cos(heading) * sp * dt; head.y += Math.sin(heading) * sp * dt;
    }
    moving += (clamp(d / 60, 0, 1) - moving) * Math.min(1, dt * 5);
    recordTrail();
  }
  function recordTrail(){
    const t0 = trail[0];
    if (!t0 || Math.hypot(head.x - t0.x, head.y - t0.y) >= 2) trail.unshift({x:head.x, y:head.y}); else { t0.x = head.x; t0.y = head.y; }
    let need = R * 2 + (seq.length + 4) * LB * 1.2 + 200, acc = 0;
    for (let i = 1; i < trail.length; i++){ acc += Math.hypot(trail[i].x - trail[i - 1].x, trail[i].y - trail[i - 1].y); if (acc > need){ trail.length = i + 1; break; } }
  }
  /* limp: in thick ground the body stops tracing the head's path and is dragged like a rope instead.
     The trail becomes a chain of evenly spaced points; each is pulled only when the one ahead drags it taut,
     so slack hangs, corners get cut, and the body drifts a little on its own */
  const ROPE = 6;
  let limp = 0, limpOn = false;
  function resampleTrail(){
    const need = R * 2 + (seq.length + 4) * LB * 1.2 + 200, out = [{x:head.x, y:head.y}];
    let i = 0, acc = 0, want = ROPE;
    while (want < need && i < trail.length - 1){
      const a = trail[i], b = trail[i + 1], len = Math.hypot(b.x - a.x, b.y - a.y);
      if (acc + len >= want){ const f = (want - acc) / (len || 1); out.push({x:a.x + (b.x - a.x) * f, y:a.y + (b.y - a.y) * f}); want += ROPE; }
      else { acc += len; i++; }
    }
    while (want < need){ const e = pastEnd(want - acc); out.push({x:e.x, y:e.y}); want += ROPE; }
    trail = out;
  }
  function ropeTrail(dt){
    const need = R * 2 + (seq.length + 4) * LB * 1.2 + 200, n = Math.ceil(need / ROPE) + 1;
    while (trail.length < n){ const e = pastEnd(ROPE); trail.push({x:e.x, y:e.y}); }
    if (trail.length > n) trail.length = n;
    trail[0].x = head.x; trail[0].y = head.y;
    for (let i = 1; i < trail.length; i++){
      const a = trail[i - 1], b = trail[i];
      /* a slow wander sideways: the slack drifts in the thick water */
      const dx0 = b.x - a.x, dy0 = b.y - a.y, l0 = Math.hypot(dx0, dy0) || 1;
      const w = Math.sin(clock * 0.8 + i * 0.23) * 5 * dt * limp;
      b.x += -dy0 / l0 * w; b.y += dx0 / l0 * w;
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
      if (d > ROPE){ b.x = a.x + dx / d * ROPE; b.y = a.y + dy / d * ROPE; }
    }
  }
  /* a point beyond the end of the recorded path, continuing straight along its last direction */
  function pastEnd(over){
    const e = trail[trail.length - 1] || head, p = trail[trail.length - 2];
    let tx = p ? e.x - p.x : -Math.cos(heading), ty = p ? e.y - p.y : -Math.sin(heading); let l = Math.hypot(tx, ty);
    if (l < 1e-3){ tx = -Math.cos(heading); ty = -Math.sin(heading); l = 1; }
    tx /= l; ty /= l; over = Math.max(0, over);
    return {x:e.x + tx * over, y:e.y + ty * over, tx, ty};
  }
  function seedTrailFromNodes(){
    trail = [{x:head.x, y:head.y}];
    for (const p of N) trail.push({x:p.x, y:p.y});
    const last = N[N.length - 1] || head, prev = N[N.length - 2] || head;
    let dx = last.x - prev.x, dy = last.y - prev.y; let dl = Math.hypot(dx, dy);
    if (dl < 1e-3){ dx = -Math.cos(heading); dy = -Math.sin(heading); dl = 1; }
    for (let k = 1; k < 80; k++) trail.push({x:last.x + dx / dl * k * 12, y:last.y + dy / dl * k * 12});
  }
  function detectors(){ const m = new Map(); for (const u of fold.units || []) if (BODY(u.fn) === 'circle') m.set(u.start, u); return m; }
  function layDetector(u, place, d, put){
    const G = detGeom(u), cnt = G.length, pr = modProg(u), Rd = S.detSize * LB;
    const L = (cnt - 1) * LB * (1 - pr) + 2 * Rd * pr;
    const flat = []; for (let k = 0; k < cnt; k++) flat.push(place(d + L * k / (cnt - 1)));
    const p0 = flat[0], p1 = flat[cnt - 1], mA = flat[Math.floor((cnt - 1) / 2)], mB = flat[Math.ceil((cnt - 1) / 2)];
    const cx = (mA.x + mB.x) / 2, cy = (mA.y + mB.y) / 2;
    let tx = p1.x - p0.x, ty = p1.y - p0.y; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
    const nx = -ty, ny = tx, t = S.behave ? clock : 0, tilt = 0.5 * Math.sin(t * 0.9), ct = Math.cos(tilt), st = Math.sin(tilt);
    for (let k = 0; k < cnt; k++){
      const g = G[k], f = flat[k];
      const X = cx + tx * g.x + nx * g.y * ct, Y = cy + ty * g.x + ny * g.y * ct, Z = g.y * st;
      const ax = cx + tx * g.ax + nx * g.ay * ct, ay = cy + ty * g.ax + ny * g.ay * ct;
      put(u.start + k, f.x + (X - f.x) * pr, f.y + (Y - f.y) * pr, Z * pr, ax, ay);
    }
    return d + L + LB;
  }
  function chambers(){
    const m = new Map(); if (S.memStyle !== 'chamber') return m;
    const src = fold.units && fold.units.length ? fold.units : (fold.mods || []);
    for (const u of src) if (BODY(u.fn) === 'chamber') m.set(u.start, u);
    return m;
  }
  /* Joiner: armed at the tail it is a back-facing snout whose loop splays into biting jaws; fused it becomes a ring around the next segment */
  function layJoiner(m, place, d, put, putIn){
    const p0 = place(d), p1 = place(d + LB);
    let tx = p1.x - p0.x, ty = p1.y - p0.y; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
    const nx = -ty, ny = tx, t = S.behave ? clock : 0, span = m.end - m.start;
    if (m.jstate === 'armed'){
      const tele = 1 + 0.3 * Math.sin(t * 1.3);
      const pts = new Array(span + 1), vS = W * 0.55;
      for (let q = 0; q < m.stem; q++){ pts[q] = [q * LB * tele + LB * 0.4, -vS]; pts[span - q] = [q * LB * tele + LB * 0.4, vS]; }
      const ue = (m.stem - 1) * LB * tele + LB * 0.4, L = m.loop;
      /* the two side tips trace mirrored circles: out and forward, then sweeping inward and back, like scooping toward the mouth */
      const th = -t * 4.4, cu = ue + LB * 1.0, cv = W * 1.15, rc = W * 0.75;
      for (let j = 0; j < L; j++){
        const f = L > 1 ? j / (L - 1) : 0.5, side = f * 2 - 1;
        pts[m.stem + j] = Math.abs(side) > 0.5
          ? [cu + Math.cos(th) * rc * 1.1, side * (cv + Math.sin(th) * rc)]
          : [ue + LB * (0.45 + 0.2 * (0.5 - 0.5 * Math.cos(th))), side * W];
      }
      for (let k = 0; k <= span; k++){ const [u, v] = pts[k]; put(m.start + k, p0.x + tx * u + nx * v, p0.y + ty * u + ny * v, 0); }
      return d + ue + LB * 2.2;
    }
    const cnt = span + 1, rr = W * 1.7;
    for (let k = 0; k < cnt; k++){
      const ph = TAU * k / cnt + t * 0.8, ox = Math.cos(ph) * rr, oz = Math.sin(ph) * rr, ot = Math.sin(ph) * rr * 0.3;
      putIn(m.start + k, p0.x + nx * ox + tx * ot, p0.y + ny * ox + ty * ot, oz, p0.x, p0.y);
    }
    return d + LB * 0.4;
  }
  function placeChamber(u, p0, p1, L, put){
    const cnt = u.end - u.start + 1, t = S.behave ? clock : 0, R0 = S.memDiam * LB / 2;
    let tx = p1.x - p0.x, ty = p1.y - p0.y; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
    const nx = -ty, ny = tx, cx = (p0.x + p1.x) / 2, cy = (p0.y + p1.y) / 2;
    for (let k = 0; k < cnt; k++){
      const s = cnt > 1 ? k / (cnt - 1) : 0.5;
      const sw = Math.pow(Math.sin(Math.PI * s), S.memSlope);
      const sq = 1 - S.memSqueeze * 0.4 * (0.5 + 0.5 * Math.sin(TAU * (s * 1.2 - t * 0.5)));
      const r = R0 * sw * sq, ph = TAU * S.memTurns * s + t * S.memTwist * 2;
      const v = (s - 0.5) * L, ax = cx + tx * v, ay = cy + ty * v;
      put(u.start + k, ax + nx * Math.cos(ph) * r, ay + ny * Math.cos(ph) * r, Math.sin(ph) * r, ax, ay);
    }
  }
  let clock = 0;
  function layoutTrail(dt){ if (S.twist) layoutTrail3D(dt); else layoutTrail2D(dt); }
  function layoutTrail2D(dt){
    const n = N.length; if (!n) return;
    let ti = 0, acc = 0;
    const amp = S.undulate * 0.7 * R * (0.25 + 0.75 * moving) * (1 - 0.85 * limp);
    const place = d => {
      while (ti < trail.length - 1){
        const a = trail[ti], b = trail[ti + 1], len = Math.hypot(b.x - a.x, b.y - a.y);
        if (acc + len >= d){
          const f = (d - acc) / (len || 1), nx = -(b.y - a.y) / (len || 1), ny = (b.x - a.x) / (len || 1);
          const w = amp * Math.sin(clock * 5 - d * 0.045) * clamp(d / 80, 0, 1);
          return {x:a.x + (b.x - a.x) * f + nx * w, y:a.y + (b.y - a.y) * f + ny * w};
        }
        acc += len; ti++;
      }
      return pastEnd(d - acc);
    };
    let ri = 0;
    const set = (i, p) => { const q = N[i]; q.x = q.px = p.x; q.y = q.py = p.y; q.z = 0; q.inward = false; };
    const chAt = chambers();
    const dtAt = detectors();
    const putC = (i, x, y, z, ax, ay) => { const q = N[i]; q.x = q.px = x; q.y = q.py = y; q.z = z; q.inward = true; q.ax = ax; q.ay = ay; };
    const modAt = new Map(); fold.mods.forEach((m, mi) => modAt.set(m.start, mi));
    let d = R * 1.6, i = 0;
    while (i < n){
      const ch = chAt.get(i);
      if (ch){ const L = S.memLength * LB, p0 = place(d), p1 = place(d + L); placeChamber(ch, p0, p1, L, putC); i = ch.end + 1; d += L + LB; ri++; continue; }
      { const dz = dtAt.get(i); if (dz){ d = layDetector(dz, place, d, putC); i = dz.end + 1; ri++; continue; } }
      { const jm = modAt.get(i); if (jm != null && fold.mods[jm].joiner && (fold.mods[jm].jstate === 'armed' || fold.mods[jm].jstate === 'fused')){ const m = fold.mods[jm]; d = layJoiner(m, place, d, (ii, x, y) => set(ii, {x, y}), putC); i = m.end + 1; ri++; continue; } }
      const mi = modAt.get(i);
      if (mi == null){ set(i, place(d)); i++; d += LB * (recipeMode() ? S.looseGap : 1); continue; }
      const m = fold.mods[mi], span = m.end - m.start, pr = modProg(m);
      const shp0 = shapeOf(m); let reach = 0; for (const q of shp0) reach = Math.max(reach, Math.abs(q[1]) * W);
      const gap = Math.max(0, reach - W) * pr;
      d += gap;
      const width = span * LB * (1 - pr) + D * pr;
      const flat = []; for (let k = 0; k <= span; k++) flat.push(place(d + k * width / span));
      const p0 = flat[0], p1 = flat[span];
      let vx = p1.x - p0.x, vy = p1.y - p0.y; const vl = Math.hypot(vx, vy) || 1; vx /= vl; vy /= vl;
      let sd = sideOf(mi);
      if (S.side === 'free'){ const lm = N[Math.round((m.a + m.b) / 2)]; sd = ((lm.x - (p0.x + p1.x) / 2) * -vy + (lm.y - (p0.y + p1.y) / 2) * vx) >= 0 ? 1 : -1; }
      const ux = -vy * sd, uy = vx * sd, ox = (p0.x + p1.x) / 2, oy = (p0.y + p1.y) / 2;
      const shp = shapeOf(m), wob = Math.sin(clock * 3 + mi) * 0.04;
      for (let k = 0; k <= span; k++){
        const [u, v] = shp[k];
        const tx = ox + ux * u * LB * (1 + wob) + vx * v * W, ty = oy + uy * u * LB * (1 + wob) + vy * v * W;
        set(m.start + k, k === 0 || k === span ? flat[k] : {x:flat[k].x + (tx - flat[k].x) * pr, y:flat[k].y + (ty - flat[k].y) * pr});
      }
      i = m.end + 1; d += width + LB + gap;
    }
  }

  /* ---------- 3D: structures roll around the spine; a Mover's arms share one hub as turbine blades ---------- */
  const spinState = new Map();
  function layoutTrail3D(dt){
    const n = N.length; if (!n) return;
    let ti = 0, acc = 0;
    const amp = S.undulate * 0.7 * R * (0.25 + 0.75 * moving) * (1 - 0.85 * limp);
    const place = d => {
      while (ti < trail.length - 1){
        const a = trail[ti], b = trail[ti + 1], len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        if (acc + len >= d){
          const f = (d - acc) / len, tx = (b.x - a.x) / len, ty = (b.y - a.y) / len;
          const w = amp * Math.sin(clock * 5 - d * 0.045) * clamp(d / 80, 0, 1);
          return {x:a.x + (b.x - a.x) * f - ty * w, y:a.y + (b.y - a.y) * f + tx * w, tx, ty};
        }
        acc += len; ti++;
      }
      return pastEnd(d - acc);
    };
    const set = (i, x, y, z) => { const q = N[i]; q.x = q.px = x; q.y = q.py = y; q.z = z; q.inward = false; };
    const chAt = chambers();
    const dtAt = detectors();
    const putC = (i, x, y, z, ax, ay) => { const q = N[i]; q.x = q.px = x; q.y = q.py = y; q.z = z; q.inward = true; q.ax = ax; q.ay = ay; };
    const modAt = new Map(); fold.mods.forEach((m, mi) => modAt.set(m.start, mi));
    const hubOf = new Map();
    if (S.turbine) for (const u of fold.units || []) if (BODY(u.fn) === 'blades' && u.arms){
      const sp = (spinState.get(u.start) || 0) + dt * S.spin * (0.25 + moving) * 4;
      spinState.set(u.start, sp);
      u.arms.forEach((h, k) => hubOf.set(h.start, {u, k, n:u.arms.length, spin:sp}));
    }
    if (S.memStyle === 'sleeve') for (const u of fold.units || []) if (BODY(u.fn) === 'chamber' && u.arms){
      const br = S.behave ? Math.sin(clock * 1.5) : 0;
      u.arms.forEach((h, k) => hubOf.set(h.start, {u, k, n:u.arms.length, sleeve:true, rake:0.8 + 0.15 * br}));
    }
    const roll = S.rollStep * Math.PI / 180;
    let d = R * 1.6, i = 0, ri = 0, hub = null;
    while (i < n){
      const ch = chAt.get(i);
      if (ch){ const L = S.memLength * LB, p0 = place(d), p1 = place(d + L); placeChamber(ch, p0, p1, L, putC); i = ch.end + 1; d += L + LB; ri++; continue; }
      { const dz = dtAt.get(i); if (dz){ d = layDetector(dz, place, d, putC); i = dz.end + 1; ri++; continue; } }
      { const jm = modAt.get(i); if (jm != null && fold.mods[jm].joiner && (fold.mods[jm].jstate === 'armed' || fold.mods[jm].jstate === 'fused')){ const m = fold.mods[jm]; d = layJoiner(m, place, d, set, putC); i = m.end + 1; ri++; continue; } }
      const mi = modAt.get(i);
      if (mi == null){
        if (hub && i < hub.u.end){ set(i, hub.A.x, hub.A.y, 0); i++; continue; }
        const p = place(d); set(i, p.x, p.y, 0); i++; d += LB * (recipeMode() ? S.looseGap : 1); continue;
      }
      const m = fold.mods[mi], span = m.end - m.start, pr = modProg(m), hb = hubOf.get(m.start);
      const shp = shapeOf(m);
      let reach = 0; for (const q of shp) reach = Math.max(reach, Math.abs(q[1]) * W);
      const gap = Math.max(0, reach - W) * pr * S.spacing;
      const width = span * LB * (1 - pr) + D * pr;
      let A, theta, pitch = 0, rk;
      if (hb && hb.k > 0 && hub && hub.u === hb.u){ A = hub.A; }
      else { d += gap; A = place(d + width / 2); }
      if (hb){
        if (hb.k === 0) hub = {u:hb.u, A, width};
        if (hb.sleeve){ theta = ri * roll + hb.k * TAU / hb.n; pitch = 0; rk = hb.rake * pr; }
        else { theta = hb.spin + hb.k * TAU / hb.n; pitch = S.pitch * Math.PI / 180 * pr; rk = S.sweep * moving * 0.9; }
      } else { theta = ri * roll; rk = S.sweep * moving * 0.3; ri++; if (S.cleaverSpikes && isCleaver(m)){ pitch = S.spikeTwist * Math.PI / 180 * pr; rk = 0; } }
      const tx = A.tx, ty = A.ty, nx = -ty, ny = tx, ct = Math.cos(theta), st = Math.sin(theta);
      let ux = ct * nx, uy = ct * ny, uz = st;
      const cr = Math.cos(rk), sr = Math.sin(rk);
      ux = ux * cr + tx * sr; uy = uy * cr + ty * sr; uz = uz * cr;
      const cx = -uz * ty, cy = uz * tx, cz = ux * ty - uy * tx, cp = Math.cos(pitch), sp = Math.sin(pitch);
      const vx = tx * cp + cx * sp, vy = ty * cp + cy * sp, vz = cz * sp;
      const wob = 1 + Math.sin(clock * 3 + mi) * 0.04;
      for (let k = 0; k <= span; k++){
        const [u, v] = shp[k], f = (k / span - 0.5) * width;
        const fx = A.x + tx * f, fy = A.y + ty * f;
        const X = A.x + ux * u * LB * wob + vx * v * W, Y = A.y + uy * u * LB * wob + vy * v * W, Z = uz * u * LB * wob + vz * v * W;
        set(m.start + k, fx + (X - fx) * pr, fy + (Y - fy) * pr, Z * pr);
      }
      i = m.end + 1;
      if (hb){ if (hb.k === hb.n - 1){ hub = null; d += width + LB * S.spacing + gap; ri++; } }
      else d += (width + gap) * S.spacing + LB * Math.max(0.6, S.spacing);
    }
  }
  function link(i, j, L, w, minOnly){
    const a = N[i], b = N[j]; let dx = b.x - a.x, dy = b.y - a.y; const d = Math.hypot(dx, dy) || 0.001;
    if (minOnly && d >= L) return;
    const k = (d - L) / d * w;
    if (i === 0){ b.x -= dx * k; b.y -= dy * k; }
    else if (j === 0){ a.x += dx * k; a.y += dy * k; }
    else { a.x += dx * k * 0.5; a.y += dy * k * 0.5; b.x -= dx * k * 0.5; b.y -= dy * k * 0.5; }
  }
  function pullShapes(w){
    if (S.pairing === 'free' || w <= 0) return;
    fold.mods.forEach((m, mi) => {
      const pr = modProg(m); if (pr < 0.3) return;
      const p0 = N[m.start], p1 = N[m.end];
      let vx = p1.x - p0.x, vy = p1.y - p0.y; const vl = Math.hypot(vx, vy) || 1; vx /= vl; vy /= vl;
      const ox = (p0.x + p1.x) / 2, oy = (p0.y + p1.y) / 2;
      let sd = sideOf(mi);
      if (S.side === 'free'){ const lm = N[Math.round((m.a + m.b) / 2)]; sd = ((lm.x - ox) * -vy + (lm.y - oy) * vx) >= 0 ? 1 : -1; }
      const ux = -vy * sd, uy = vx * sd, shp = shapeOf(m);
      for (let k = 1; k < shp.length - 1; k++){
        const i = m.start + k; if (i === 0) continue;
        const [u, v] = shp[k], q = N[i];
        q.x += (ox + ux * u * LB + vx * v * W - q.x) * w * pr; q.y += (oy + uy * u * LB + vy * v * W - q.y) * w * pr;
      }
    });
  }
  let stickyT = 0;
  function stepPhysics(dt){
    const n = N.length; if (!n) return;
    const h = N[0]; h.x = h.px = head.x + Math.cos(heading + Math.PI) * R * 1.6; h.y = h.py = head.y + Math.sin(heading + Math.PI) * R * 1.6;
    const damp = 1 - S.drag;
    for (let i = 1; i < n; i++){
      const p = N[i], vx = (p.x - p.px) * damp, vy = (p.y - p.py) * damp;
      p.px = p.x; p.py = p.y; p.x += vx; p.y += vy;
      if (S.undulate > 0){
        const a = N[i - 1], b = N[Math.min(n - 1, i + 1)];
        const tx = b.x - a.x, ty = b.y - a.y, tl = Math.hypot(tx, ty) || 1;
        const f = S.undulate * Math.sin(clock * 7 - i * 0.55) * (0.25 + 0.75 * moving) * 0.55;
        p.x += -ty / tl * f; p.y += tx / tl * f;
      }
    }
    const diag = Math.hypot(LB, D), rep = LB * 2.15;
    for (let it = 0; it < 10; it++){
      for (let i = 0; i < n - 1; i++) link(i, i + 1, LB, 1);
      for (let i = 0; i < n - 2; i++) link(i, i + 2, LB * 1.8, 0.22, true);
      for (const p of pairs.values()){
        if (p.s <= 0) continue;
        link(p.i, p.j, D, 0.5 * p.s);
        const q = pairs.get((p.i + 1) + '-' + (p.j - 1));
        if (q && q.s > 0){ const w = 0.35 * Math.min(p.s, q.s); link(p.i, p.j - 1, diag, w); link(p.i + 1, p.j, diag, w); }
      }
      for (const p of sticky.values()) link(p.i, p.j, D, 0.3);
      pullShapes(S.shape * 0.25);
      if (it % 2 === 0) for (let i = 0; i < n; i++) for (let j = i + 3; j < n; j++){
        if (fold.partner[i] === j) continue;
        const a = N[i], b = N[j], ddx = b.x - a.x; if (ddx > rep || ddx < -rep) continue;
        const ddy = b.y - a.y; if (ddy > rep || ddy < -rep) continue;
        link(i, j, rep, 0.35, true);
      }
    }
    if (S.sticky){
      stickyT += dt;
      if (stickyT > 0.2){
        stickyT = 0;
        const busy = new Set(); for (const p of sticky.values()){ busy.add(p.i); busy.add(p.j); }
        for (let i = 0; i < n; i++){
          if (fold.partner[i] >= 0 || busy.has(i)) continue;
          for (let j = i + 5; j < n; j++){
            if (fold.partner[j] >= 0 || busy.has(j) || COMP[seq[i]] !== seq[j]) continue;
            if (Math.hypot(N[i].x - N[j].x, N[i].y - N[j].y) < D * 1.25){ sticky.set(i + '-' + j, {i, j}); busy.add(i); busy.add(j); break; }
          }
        }
      }
      for (const [k, p] of sticky){
        const dd = Math.hypot(N[p.i].x - N[p.j].x, N[p.i].y - N[p.j].y);
        if (dd > D * 2.2 || Math.random() < (seq[p.i] === 'G' || seq[p.i] === 'C' ? 0.0006 : 0.002) * dt * 60) sticky.delete(k);
      }
    } else if (sticky.size) sticky.clear();
  }
  /* Self-cutter: forms, pops out as a ring, slides upstrand to the structure ahead, tightens, and both burst into loose bases */
  let cut = null, scatter = [];
  function findCutter(){ return (fold.units || []).find(u => BODY(u.fn) === 'ring' && !rangeDamaged(u)) || null; }
  function targetBefore(idx){
    let best = null;
    for (const u of (fold.units || []).concat(fold.mods || [])) if (u.end < idx && (!best || u.end > best.end || (u.end === best.end && u.start < best.start))) best = u;
    return best;
  }
  function removeRange(a, b){
    const len = b - a + 1, next = new Map();
    for (const p of pairs.values()){
      if ((p.i >= a && p.i <= b) || (p.j >= a && p.j <= b)) continue;
      const i = p.i > b ? p.i - len : p.i, j = p.j > b ? p.j - len : p.j;
      next.set(i + '-' + j, Object.assign({}, p, {i, j}));
    }
    pairs = next; N.splice(a, len); seq.splice(a, len); dmg.splice(a, len);
    segs = segs.filter(g => g.end < a || g.start > b).map(g => g.start > b ? {fn:g.fn, start:g.start - len, end:g.end - len} : g);
    for (const h of helpers){ if (h.pos > b) h.pos -= len; else if (h.pos >= a) h.pos = Math.max(0, a - 0.01); }
    if (repEv){ if (repEv.start > b) repEv.start -= len; else if (repEv.end >= a) repEv = null; }
    setSeq(seq.slice());
  }
  function burst(pts, cx, cy){
    for (const p of pts){
      let dx = p.x - cx, dy = p.y - cy; const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
      const a = Math.atan2(dy, dx) + rnd(-0.7, 0.7), sp = rnd(50, 170);
      scatter.push({x:p.x, y:p.y, vx:Math.cos(a) * sp, vy:Math.sin(a) * sp, b:p.b, life:1});
    }
    if (pts.length) emit('burst', {letters:pts.map(p => ({b:p.b, x:p.x, y:p.y}))});
  }
  function ringAt(pos){
    const n = N.length; if (!n) return null;
    const k = clamp(Math.floor(pos), 0, n - 1), k2 = Math.min(n - 1, k + 1), f = clamp(pos - k, 0, 1);
    const x = N[k].x + (N[k2].x - N[k].x) * f, y = N[k].y + (N[k2].y - N[k].y) * f;
    const a = N[Math.max(0, k - 1)], b = N[Math.min(n - 1, k + 2)];
    let tx = b.x - a.x, ty = b.y - a.y; const tl = Math.hypot(tx, ty) || 1;
    return {x, y, tx:tx / tl, ty:ty / tl};
  }
  function updateCutter(dt){
    for (const p of scatter){ p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 1 - 1.6 * dt; p.vy *= 1 - 1.6 * dt; p.life -= dt / 2.6; }
    scatter = scatter.filter(p => p.life > 0);
    if (!cut){
      const r = findCutter(); if (!r) return;
      cut = {phase:'form', t:0, start:r.start, end:r.end, letters:seq.slice(r.start, r.end + 1).join('')};
      return;
    }
    cut.t += dt;
    if (cut.phase === 'form'){
      if (cut.t < 0.9) return;
      if (seq.slice(cut.start, cut.end + 1).join('') !== cut.letters){ cut = null; return; }
      const tg = targetBefore(cut.start);
      if (tg){
        /* the cut takes the structure, the loose letters between it and the cutter, and the loose run just before it */
        const prev = targetBefore(tg.start), lo = prev ? prev.end + 1 : 0, hi = cut.start - 1;
        cut.target = {start:lo, end:hi, mid:(tg.start + tg.end) / 2, letters:seq.slice(lo, hi + 1).join(''), core:seq.slice(tg.start, tg.end + 1).join(''), coreAt:tg.start - lo, fn:tg.fn || 'arm', loose:(hi - lo + 1) - (tg.end - tg.start + 1)};
      } else cut.target = null;
      cut.bases = cut.letters.split('');
      removeRange(cut.start, cut.end);
      cut.pos = Math.max(0, cut.start - 0.5); cut.r = W * 2.8; cut.phase = 'travel'; cut.t = 0;
      hint('cutterLaunched', cut.target ? `The Self-cutter left the strand as a ring and is heading for the ${cut.target.fn} ahead of it.` : 'The Self-cutter left the strand as a ring, but there is nothing ahead of it to cut.');
      return;
    }
    if (cut.phase === 'travel'){
      const goal = cut.target ? cut.target.mid : 0;
      cut.pos = Math.max(goal, Math.min(cut.pos, N.length - 1) - dt * 9);
      if (cut.pos <= goal + 0.01){ cut.phase = cut.target ? 'squeeze' : 'burst'; cut.t = 0; }
      return;
    }
    if (cut.phase === 'squeeze'){ cut.r = W * 2.8 * Math.max(0.08, 1 - cut.t / 0.7); if (cut.t >= 0.7){ cut.phase = 'burst'; cut.t = 0; } return; }
    const c = ringAt(cut.pos) || {x:head.x, y:head.y};
    burst(ringPts(c).map((p, j) => ({x:p.x, y:p.y, b:cut.bases[j]})), c.x, c.y);
    const T = cut.target;
    if (T){
      let a = T.start, b = T.end;
      if (seq.slice(a, b + 1).join('') !== T.letters){
        const s = seq.join(''), k = s.indexOf(T.core);
        if (k >= 0){ a = k; b = k + T.core.length - 1; } else a = -1;
      }
      if (a >= 0){
        const pts = [];
        for (let i = a; i <= b; i++) pts.push({x:N[i].x, y:N[i].y, b:seq[i]});
        burst(pts, c.x, c.y); removeRange(a, b);
        hint('cut', `The Self-cutter cut out the ${T.fn}` + (T.loose > 0 ? ` and ${T.loose} loose letter${T.loose === 1 ? '' : 's'} around it` : '') + '. Everything it cut burst into loose letters.', {fn:T.fn, loose:T.loose});
      }
    }
    cut = null;
  }
  function ringPts(c){
    const out = [], r = cut ? cut.r : W, nx = -c.ty, ny = c.tx;
    const k = cut && cut.bases ? cut.bases.length : 7;
    for (let j = 0; j < k; j++){
      const ph = TAU * j / k + clock * 2.2, o = Math.cos(ph) * r, ot = Math.sin(ph) * r * 0.32;
      out.push({x:c.x + nx * o + c.tx * ot, y:c.y + ny * o + c.ty * ot, z:Math.sin(ph) * r});
    }
    return out;
  }
  /* Repairer: two lopsided helpers spiral up the strand, mending damage and clearing junk and surplus loose letters */
  let helpers = [], repFlash = [];
  function structAt(i){
    const u = (fold.units || []).find(u => i >= u.start && i <= u.end);
    if (u) return u;
    return (fold.mods || []).find(m => i >= m.start && i <= m.end) || (fold.junk || []).find(m => i >= m.start && i <= m.end) || null;
  }
  const isFn = st => !!st && !!st.fn && (fold.units || []).includes(st);
  function removableLoose(i){
    /* in game recipes the loose tail is the player's collection in progress: never clear it */
    if (recipeMode()){ const last = segs.length ? segs[segs.length - 1].end : -1; return i < last; }
    const prev = targetBefore(i), next = (fold.units || []).concat(fold.mods || []).filter(u => u.start > i).sort((a, b) => a.start - b.start)[0];
    if (!prev || !next) return true;
    return next.start - prev.end - 1 > 3;
  }
  function removeWithShift(a, b){
    const pts = []; for (let i = a; i <= b; i++) pts.push({x:N[i].x, y:N[i].y, b:seq[i]});
    let cx = 0, cy = 0; pts.forEach(p => { cx += p.x; cy += p.y; }); cx /= pts.length; cy /= pts.length;
    burst(pts, cx, cy); removeRange(a, b);
  }
  /* only remove if every function on the strand stays the same afterwards */
  function safeRemove(a, b){
    const fns = u => u.filter(x => x.fn).map(x => x.fn + (x.jstate || '')).join(',');
    const s2 = seq.slice(0, a).concat(seq.slice(b + 1)).join('');
    if (!recipeMode() && fns(fold.units || []) !== fns(partsFold(s2, S.minStem).units)) return false;
    removeWithShift(a, b); return true;
  }
  function helperAct(i){
    if (i < 0 || i >= seq.length) return false;
    const st = structAt(i);
    if (st && rangeDamaged(st)){
      for (let k = st.start; k <= st.end; k++) dmg[k] = false;
      styleDirty = true; repFlash.push({i:Math.round((st.start + st.end) / 2), t:0});
      hint('mended', `A Repairer helper mended the ${st.fn || 'arm'}.`, {fn:st.fn || 'arm'});
      return true;
    }
    if (st && !isFn(st)){ if (!safeRemove(st.start, st.end)) return false; hint('cleared', 'A Repairer helper cleared away a junk segment.'); return true; }
    if (!st && removableLoose(i)) return safeRemove(i, i);
    return false;
  }
  /* the Repairer folds, then leaves the strand; its two hairpins become helpers that travel up the strand once, then dissolve */
  let repEv = null;
  function updateRepair(dt){
    for (const f of repFlash) f.t += dt; repFlash = repFlash.filter(f => f.t < 0.8);
    if (!repEv){
      const u = (fold.units || []).find(u => BODY(u.fn) === 'helpers' && !rangeDamaged(u));
      if (u) repEv = {t:0, start:u.start, end:u.end, letters:seq.slice(u.start, u.end + 1).join(''),
        h:u.arms.map(h => [h.start - u.start, h.end - u.start])};
    } else if ((repEv.t += dt) >= 1.2){
      const ok = seq.slice(repEv.start, repEv.end + 1).join('') === repEv.letters && (fold.units || []).some(u => BODY(u.fn) === 'helpers' && u.start === repEv.start);
      if (ok){
        const L = repEv.letters, st = repEv.start, en = repEv.end, pos = Math.max(0, st - 0.5), H = repEv.h;
        repEv = null; removeRange(st, en);
        helpers.push({kind:0, pos, dir:-1, phi:0, wait:0, life:Infinity, cool:0, letters:L.slice(H[0][0], H[0][1] + 1)},
                     {kind:1, pos, dir:-1, phi:Math.PI, wait:1.2, life:Infinity, cool:0, letters:L.slice(H[1][0], H[1][1] + 1)});
        while (helpers.length > 6) helpers.shift();
        hint('repairerLaunched', `The Repairer left the strand. Its two hairpins are now helpers working their way up the strand once before they dissolve.`);
      } else repEv = null;
    }
    const n = N.length;
    for (const h of helpers){
      if (h.wait > 0){ h.wait -= dt; continue; }
      h.life -= dt;
      if (h.life <= 0){
        const x = h.x != null ? h.x : head.x, y = h.y != null ? h.y : head.y, k = h.letters.length;
        burst(h.letters.split('').map((b, j) => ({x:x + Math.cos(TAU * j / k) * R * 2, y:y + Math.sin(TAU * j / k) * R * 2, b})), x, y);
        continue;
      }
      if (!n) continue;
      h.phi += dt; h.cool -= dt;
      if (!h.end) h.pos += h.dir * dt * S.repSpeed * (h.kind ? 0.7 : 1);
      if (h.end){ placeHelper(h, dt); continue; }
      if (h.cool <= 0 && helperAct(Math.round(h.pos))) h.cool = 0.3;
      /* one trip up the strand: at the 5' end the helper dissolves */
      if (h.pos <= 0){ h.pos = 0; h.end = true; h.life = 0.8; }
      placeHelper(h, dt);
    }
    if (helpers.some(h => h.life <= 0)){
      helpers = helpers.filter(h => h.life > 0);
      if (!helpers.length) hint('helpersDone', 'The Repairer helpers reached the 5′ end and dissolved into loose letters.');
    }
  }
  /* two lopsided shapes: a long hooked hairpin and a short forked one, each showing its G-A-C loop */
  const HELPER_SHAPES = [
    {line:[[7, 0], [3, -3], [-1, -4], [-5, -2], [-7, 1]], dots:[0, 2, 4], scale:1},
    {line:[[4, 0], [0, 0], [-4, -3], [0, 0], [-2.5, 3.5]], dots:[0, 2, 4], scale:0.8}
  ];
  /* helpers glide beside the strand: anchored to a smoothed centre line, kept just outside the local width on their own side,
     breathing in and out on a slow sine, and eased so folds, spins and cuts never make them jump */
  function strandFrame(pos){
    const n = N.length, cen = (p, w) => {
      let x = 0, y = 0, t = 0;
      for (let k = Math.max(0, Math.floor(p - w)); k <= Math.min(n - 1, Math.ceil(p + w)); k++){ const wt = 1 - Math.abs(k - p) / (w + 1); if (wt <= 0) continue; x += N[k].x * wt; y += N[k].y * wt; t += wt; }
      return t ? {x:x / t, y:y / t} : {x:N[0].x, y:N[0].y};
    };
    const c = cen(pos, 6), a = cen(Math.max(0, pos - 8), 6), b = cen(Math.min(n - 1, pos + 8), 6);
    const tx = b.x - a.x, ty = b.y - a.y, tl = Math.hypot(tx, ty);
    return {x:c.x, y:c.y, tx:tl > 1e-3 ? tx / tl : 0, ty:tl > 1e-3 ? ty / tl : 0, ok:tl > 1e-3};
  }
  function placeHelper(h, dt){
    const n = N.length; if (!n) return;
    /* ease the index, not the screen position, so the helper rides along with a swimming strand without lag */
    h.dpos = h.dpos == null ? h.pos : h.dpos + (h.pos - h.dpos) * Math.min(1, dt * 3);
    const f = strandFrame(h.dpos), side = h.kind ? -1 : 1;
    if (h.tx == null){ h.tx = f.ok ? f.tx : 1; h.ty = f.ok ? f.ty : 0; }
    else if (f.ok){ const e = Math.min(1, dt * 2.5); h.tx += (f.tx - h.tx) * e; h.ty += (f.ty - h.ty) * e; const l = Math.hypot(h.tx, h.ty) || 1; h.tx /= l; h.ty /= l; }
    const nx = -h.ty * side, ny = h.tx * side;
    /* how far the strand reaches out on this side, near the helper */
    let hw = 0;
    for (let k = Math.max(0, Math.floor(h.dpos - 10)); k <= Math.min(n - 1, Math.ceil(h.dpos + 10)); k++) hw = Math.max(hw, (N[k].x - f.x) * nx + (N[k].y - f.y) * ny);
    h.hw = h.hw == null ? hw : h.hw + (hw - h.hw) * Math.min(1, dt * 1.5);
    const out = h.hw + Math.max(S.gooSize * 0.6, W) + R * 3.5 + D * 0.5 * (1 + Math.sin(h.phi * 1.4 + h.kind * Math.PI));
    /* ease relative to the head so the helper keeps up with swimming but glides over sudden re-layouts after a cut */
    const rx = f.x + nx * out - head.x, ry = f.y + ny * out - head.y;
    if (h.rx == null){ h.rx = rx; h.ry = ry; } else { const e = Math.min(1, dt * 4); h.rx += (rx - h.rx) * e; h.ry += (ry - h.ry) * e; }
    h.x = head.x + h.rx; h.y = head.y + h.ry;
  }
  let helperEls = [];
  function renderHelpers(){
    const g = $('helpers'), hg = $('helperGoo');
    while (helperEls.length < helpers.length) helperEls.push({
      goo:el('path', {fill:'none', stroke:'var(--goo)', 'stroke-linecap':'round', 'stroke-linejoin':'round'}, hg),
      path:el('path', {fill:'none', stroke:'var(--spine)', 'stroke-linecap':'round', 'stroke-linejoin':'round'}, g),
      dots:[0, 1, 2].map(() => el('circle', {}, g))});
    helperEls.forEach((E, k) => {
      const h = helpers[k];
      if (!h || h.wait > 0 || h.x == null){ E.path.setAttribute('d', ''); E.dots.forEach(d => d.setAttribute('r', 0)); E.goo.setAttribute('d', ''); return; }
      const sh = HELPER_SHAPES[h.kind], z = Math.sin(h.phi * 1.4 + h.kind * Math.PI);
      const x = h.x, y = h.y, ang = Math.atan2(h.ty * h.dir, h.tx * h.dir) + Math.sin(h.phi * 0.9) * 0.15, sc = R * 0.8 * sh.scale * (1 + 0.06 * z);
      const fade = h.end ? Math.max(0, h.life / 0.8) : 1, flick = h.end ? 0.5 + 0.5 * Math.abs(Math.sin(clock * 14)) : 1;
      const op = (0.9 * fade * flick).toFixed(2);
      const P = sh.line.map(([u, v]) => [x + (Math.cos(ang) * u - Math.sin(ang) * v) * sc, y + (Math.sin(ang) * u + Math.cos(ang) * v) * sc]);
      E.goo.setAttribute('d', 'M' + P.map(p => f1(p[0]) + ' ' + f1(p[1])).join('L')); E.goo.setAttribute('stroke-width', f1(R * 6)); E.goo.setAttribute('opacity', (0.28 * fade * flick).toFixed(2));
      E.path.setAttribute('d', 'M' + P.map(p => f1(p[0]) + ' ' + f1(p[1])).join('L'));
      E.path.setAttribute('stroke-width', S.lineW); E.path.setAttribute('opacity', op);
      sh.dots.forEach((pi, j) => { const d = E.dots[j], b = 'GAC'[j];
        d.setAttribute('cx', f1(P[pi][0])); d.setAttribute('cy', f1(P[pi][1])); d.setAttribute('r', f1(R * (PURINE[b] ? 1.05 : 0.7)));
        d.setAttribute('fill', COLOR[b]); d.setAttribute('opacity', op); });
    });
  }
  /* damage a random structure: functions first, then junk */
  function damageRandom(exclude){
    const pool = (fold.units || []).filter(u => !rangeDamaged(u) && u.fn !== exclude).concat((fold.mods || []).filter(m => !structAt(m.start) || !isFn(structAt(m.start))).filter(m => !rangeDamaged(m)));
    if (!pool.length){ hint('damaged', 'Nothing left to damage.', {fn:null}); return null; }
    const st = pick(pool);
    for (let k = st.start; k <= st.end; k++) dmg[k] = true;
    styleDirty = true;
    hint('damaged', `Damaged the ${st.fn || 'arm'}: its backbone is nicked, its bases are drained and it sags half-unfolded. It stops working until a Repairer mends it.`, {fn:st.fn || 'arm'});
    return st.fn || 'arm';
  }
  function step(dt, ctrl){
    ctrl = ctrl || {};
    updateCutter(dt);
    updateRepair(dt);
    clock += dt;
    if (ctrl.pos){
      /* follow: the head is placed where a server says it is (multiplayer mirrors); the body follows as usual */
      head.x = ctrl.pos.x; head.y = ctrl.pos.y; if (ctrl.pos.h != null) heading = ctrl.pos.h;
      target = {x:head.x + Math.cos(heading) * 120, y:head.y + Math.sin(heading) * 120};
      moving += ((ctrl.moving != null ? ctrl.moving : 1) - moving) * Math.min(1, dt * 3);
      limp += ((ctrl.limp || 0) - limp) * Math.min(1, dt * 4);
      if (limp > 0.5 && !limpOn){ limpOn = true; resampleTrail(); }
      else if (limp < 0.45 && limpOn) limpOn = false;
      if (limpOn) ropeTrail(dt); else recordTrail();
    } else if (ctrl.turn != null){
      /* cruise: the host turns the head directly (smooth arcs), the body follows */
      heading = wrapA(heading + ctrl.turn * dt);
      const sp = ctrl.speed != null ? ctrl.speed : S.speed;
      head.x += Math.cos(heading) * sp * dt; head.y += Math.sin(heading) * sp * dt;
      target = {x:head.x + Math.cos(heading) * 120, y:head.y + Math.sin(heading) * 120};
      /* how hard the strand is swimming drives its wave, spin and sweep, even when thick water holds it back */
      const eff = ctrl.effort != null ? ctrl.effort : sp;
      moving += (clamp(eff / 120, 0, 1) - moving) * Math.min(1, dt * 3);
      limp += ((ctrl.limp || 0) - limp) * Math.min(1, dt * 4);
      if (limp > 0.5 && !limpOn){ limpOn = true; resampleTrail(); }
      else if (limp < 0.45 && limpOn) limpOn = false;
      if (limpOn) ropeTrail(dt); else recordTrail();
    } else {
      if (ctrl.target) target = {x:ctrl.target.x, y:ctrl.target.y};
      steer(dt, ctrl.speed, ctrl.turnRate);
    }
    for (const p of pairs.values()){ if (p.delay > 0) p.delay -= dt; else p.s = Math.min(1, p.s + dt * 1.4 * S.foldSpeed); }
    if (S.motion === 'trail') layoutTrail(dt); else stepPhysics(dt);
  }
  let gooFillEls = [];
  let useEls = [], letterEls = [], gooEls = [], labelEls = [], styleDirty = true;
  function buildPools(){
    const n = seq.length, gl = $('glyphs'), lt = $('letters'), go = $('gooL'), lb = $('labels');
    while (useEls.length < n){ const u = el('use', {}, gl); u.dataset.i = useEls.length; useEls.push(u); letterEls.push(el('text', {}, lt)); }
    while (useEls.length > n){ useEls.pop().remove(); letterEls.pop().remove(); }
    while (labelEls.length < fold.tags.length) labelEls.push(el('text', {}, lb));
    while (labelEls.length > fold.tags.length) labelEls.pop().remove();
    styleDirty = true;
  }
  function colorOf(i){
    if (S.color === 'mono') return 'var(--spine)';
    if (S.color === 'role') return fold.role[i] === 'stem' ? 'var(--spine)' : fold.role[i] === 'loop' ? 'var(--fn)' : 'var(--muted, #7d8597)';
    return COLOR[seq[i]];
  }
  /* goo only where a Membrane reaches: the Membrane itself plus the structure on each side of it */
  let gooCov = [], gooAny = false, memCov = [], memAny = false;
  function gooCoverage(){
    const n = seq.length, cov = new Array(n).fill(false);
    {
      const units = fold.units || [], mods = fold.mods || [];
      const blockOf = m => units.find(u => m.start >= u.start && m.end <= u.end) || m;
      for (const u of (units.length ? units : mods).filter(x => BODY(x.fn) === 'chamber')){
        let lo = u.start, hi = u.end;
        const before = mods.filter(m => m.end < u.start).pop(), after = mods.find(m => m.start > u.end);
        if (before) lo = blockOf(before).start;
        if (after) hi = blockOf(after).end;
        for (let i = lo; i <= hi; i++) cov[i] = true;
      }
    }
    memCov = cov; memAny = S.goo === 'memFill' && cov.some(Boolean);
    gooCov = S.gooCover === 'all' ? new Array(n).fill(true) : cov;
    gooAny = S.goo !== 'off' && gooCov.some(Boolean);
  }
  function applyStyle(){
    styleDirty = false;
    gooCoverage();
    const href = glyphHref();
    useEls.forEach((u, i) => { u.setAttribute('href', '#' + (dmg[i] ? 'rs-gdh-' : href) + seq[i]); u.style.color = colorOf(i); u.dataset.d = dmg[i] ? 1 : ''; });
    const showLetters = S.glyph === 'letter' || S.glyph === 'structLetter';
    letterEls.forEach((t, i) => { t.textContent = seq[i]; t.style.display = showLetters ? '' : 'none';
      t.setAttribute('fill', S.glyph === 'letter' ? colorOf(i) : 'var(--ink, #e8ecf4)'); t.setAttribute('font-size', f1(R * (S.glyph === 'letter' ? 1.35 : 1.05))); });
    $('bb').setAttribute('stroke-width', S.backbone === 'ribbon' ? S.lineW * 0.6 : S.lineW);
    $('bb').style.display = S.backbone === 'none' ? 'none' : '';
    $('bbRibbon').style.display = S.backbone === 'ribbon' ? '' : 'none';
    $('bbRibbon').setAttribute('stroke-width', S.lineW * 4);
    $('rungs').setAttribute('stroke-width', S.lineW * 0.7); $('rungs').style.display = S.rungs ? '' : 'none';
    $('decoLine').setAttribute('stroke-width', S.lineW); $('decoLine').style.display = $('decoFill').style.display = S.decor ? '' : 'none';
    $('decoFill').setAttribute('opacity', .55);
    $('bands').style.display = S.helixBand ? '' : 'none';
    $('labels').style.display = S.labels ? '' : 'none';
    $('core').setAttribute('r', f1(R * 0.75));
    /* goo: a wide round stroke along the strand is the body; the same stroke, a little wider, with the body masked out, is the outline */
    const gw = S.gooSize * 1.2, edge = Math.max(1, S.lineW * 1.6);
    const fillOn = S.goo === 'fill' || S.goo === 'both' || (S.goo === 'memFill' && memAny), outOn = S.goo === 'outline' || S.goo === 'both' || S.goo === 'memFill';
    $('gooBody').setAttribute('stroke-width', f1(gw)); $('gooBody').setAttribute('opacity', S.gooOpacity);
    $('gooIn').setAttribute('stroke-width', f1(gw)); $('gooOut').setAttribute('stroke-width', f1(gw + edge * 2));
    $('gooFL').style.display = fillOn && gooAny ? '' : 'none';
    $('gooL').style.display = outOn && gooAny ? '' : 'none';
    labelEls.forEach((t, k) => { const m = fold.tags[k]; t.textContent = !m || !m.fn ? '' : m.fused ? 'Joiner fused +1' : m.bonus ? m.fn + ' +' + m.bonus : m.fn; });
    $('labels').style.display = S.labels || (S.pairing === 'parts' && S.decor) ? '' : 'none';
    $('hull').style.display = S.pairing === 'parts' && S.decor ? '' : 'none';
    $('hull').setAttribute('stroke-width', S.lineW);
  }
  function spikeAngle(i, m){
    const {tA, C, tB, L} = spikeIdx(m), k = i - m.start, P = q => N[m.start + q];
    if (k === C){ const a = P(tA), b = P(tB); return Math.atan2(b.y - a.y, b.x - a.x) + Math.PI / 2; }
    const tri = k < C ? [0, tA, C] : [C, tB, L];
    const cx = (P(tri[0]).x + P(tri[1]).x + P(tri[2]).x) / 3, cy = (P(tri[0]).y + P(tri[1]).y + P(tri[2]).y) / 3;
    return Math.atan2(N[i].y - cy, N[i].x - cx);
  }
  function glyphAngle(i, spk){
    const q = N[i];
    if (q.inward && S.motion === 'trail'){ const dx = q.ax - q.x, dy = q.ay - q.y; return {a:Math.hypot(dx, dy) > 0.3 ? Math.atan2(dy, dx) : q.ang, flip:false, pj:-1}; }
    if (spk && spk[i]) return {a:spikeAngle(i, spk[i]), flip:false, pj:-1};
    const n = N.length, p = N[i], j = fold.partner[i];
    const pr = j >= 0 ? pairs.get(Math.min(i, j) + '-' + Math.max(i, j)) : null;
    if (pr && pr.s > 0.25) return {a:Math.atan2(N[j].y - p.y, N[j].x - p.x), flip:i > j, pj:j};
    for (const sp of sticky.values()) if (sp.i === i || sp.j === i){ const o = sp.i === i ? sp.j : sp.i; return {a:Math.atan2(N[o].y - p.y, N[o].x - p.x), flip:i > o, pj:o}; }
    const m = fold.loopOf[i];
    if (m){
      let cx = 0, cy = 0, c = 0;
      for (let k = m.start; k <= m.end; k++){ cx += N[k].x; cy += N[k].y; c++; }
      return {a:Math.atan2(p.y - cy / c, p.x - cx / c), flip:false, pj:-1};
    }
    const a = N[Math.max(0, i - 1)], b = N[Math.min(n - 1, i + 1)];
    return {a:Math.atan2(b.y - a.y, b.x - a.x) - Math.PI / 2, flip:false, pj:-1};
  }
  function smoothPath(pts){
    if (pts.length < 2) return '';
    let d = `M${f1(pts[0].x)} ${f1(pts[0].y)}`;
    for (let i = 1; i < pts.length - 1; i++) d += `Q${f1(pts[i].x)} ${f1(pts[i].y)} ${f1((pts[i].x + pts[i + 1].x) / 2)} ${f1((pts[i].y + pts[i + 1].y) / 2)}`;
    const l = pts[pts.length - 1]; return d + `L${f1(l.x)} ${f1(l.y)}`;
  }
  function hullPath(pts, cx, cy){
    const P = pts.map(p => [p.x, p.y]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (P.length < 3) return '';
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const p of P){ while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (let i = P.length - 1; i >= 0; i--){ const p = P[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
    const h = lo.slice(0, -1).concat(up.slice(0, -1)), pad = R * 2.2;
    return 'M' + h.map(p => { const dx = p[0] - cx, dy = p[1] - cy, d = Math.hypot(dx, dy) || 1; return f1(p[0] + dx / d * pad) + ' ' + f1(p[1] + dy / d * pad); }).join('L') + 'Z';
  }
  function slotPos(i, k, flip){
    const p = N[i], G = GEO[seq[i]], lx = G.edge + 0.3 * R, ly = G.slotY[k] * (flip ? -1 : 1), ca = Math.cos(p.ang), sa = Math.sin(p.ang);
    return [p.x + ca * lx - sa * ly, p.y + sa * lx + ca * ly];
  }
  let ringDots = [], scatDots = [];
  function renderCut(){
    const g = $('cutRing'), sg = $('scatterL');
    const live = cut && (cut.phase === 'travel' || cut.phase === 'squeeze');
    if (!live){ $('cutPath').setAttribute('d', ''); ringDots.forEach(d => d.setAttribute('r', 0)); }
    else {
      const c = ringAt(cut.pos); if (c){
        const pts = ringPts(c);
        while (ringDots.length < pts.length) ringDots.push(el('circle', {}, g));
        $('cutPath').setAttribute('d', 'M' + pts.map(p => f1(p.x) + ' ' + f1(p.y)).join('L') + 'Z');
        $('cutPath').setAttribute('stroke-width', S.lineW);
        pts.forEach((p, j) => { const d = ringDots[j], zn = clamp(p.z / (2 * W), -1, 1);
          d.setAttribute('cx', f1(p.x)); d.setAttribute('cy', f1(p.y)); d.setAttribute('r', f1(R * (PURINE[cut.bases[j]] ? 1.05 : 0.7) * (1 + 0.25 * zn)));
          d.setAttribute('fill', COLOR[cut.bases[j]]); d.setAttribute('opacity', (0.55 + 0.45 * (zn + 1) / 2).toFixed(2)); });
      }
    }
    while (scatDots.length < scatter.length) scatDots.push(el('circle', {}, sg));
    scatDots.forEach((d, k) => {
      const p = scatter[k];
      if (!p){ if (d.getAttribute('r') !== '0') d.setAttribute('r', 0); return; }
      d.setAttribute('cx', f1(p.x)); d.setAttribute('cy', f1(p.y)); d.setAttribute('r', f1(R * (PURINE[p.b] ? 1.05 : 0.7)));
      d.setAttribute('fill', COLOR[p.b]); d.setAttribute('opacity', Math.max(0, p.life).toFixed(2));
    });
  }
  function renderStrand(){
    renderCut();
    if (styleDirty) applyStyle();
    const n = N.length;
    const fs = f1(Math.max(12, 12 / (stage.zoom || 1)));
    if ($('labels').getAttribute('font-size') !== fs) $('labels').setAttribute('font-size', fs);
    const core = $('core'); core.setAttribute('cx', f1(head.x)); core.setAttribute('cy', f1(head.y));
    if (!n){ ['bb','bbRibbon','rungs','bands','decoFill','decoLine','hull','bbNick'].forEach(id => $(id).setAttribute('d', ''));
      const hd = `M${f1(head.x)} ${f1(head.y)}h0.1`; $('gooOut').setAttribute('d', hd); $('gooIn').setAttribute('d', hd); $('gooBody').setAttribute('d', ''); renderHelpers(); return; }
    let rung = '';
    const info = new Array(n), spk = new Array(n).fill(null);
    if (S.cleaverSpikes) for (const m of fold.mods) if (isCleaver(m)) for (let i = m.start; i <= m.end; i++) spk[i] = m;
    for (let i = 0; i < n; i++){
      const p = N[i], g = glyphAngle(i, spk);
      if (dmg[i]) g.a += Math.sin(clock * 11 + i * 1.7) * 0.35;
      p.ang += wrapA(g.a - p.ang) * 0.35;
      info[i] = g;
      const ca = Math.cos(p.ang), sa = Math.sin(p.ang), G = GEO[seq[i]];
      const zn = S.twist && S.motion === 'trail' ? clamp((p.z || 0) / (3 * LB), -1, 1) * S.depthShade : 0, sc = 1 + 0.25 * zn;
      useEls[i].setAttribute('transform', `translate(${f1(p.x)} ${f1(p.y)}) rotate(${f1(p.ang * 180 / Math.PI)}) scale(${sc.toFixed(3)} ${(g.flip ? -sc : sc).toFixed(3)})`);
      const op = (1 - 0.6 * (1 - zn) / 2 * S.depthShade).toFixed(2);
      if (useEls[i].getAttribute('opacity') !== op){ useEls[i].setAttribute('opacity', op); letterEls[i].setAttribute('opacity', op); }
      letterEls[i].setAttribute('x', f1(p.x + ca * G.rc)); letterEls[i].setAttribute('y', f1(p.y + sa * G.rc));
    }
    if (S.rungs) for (let i = 0; i < n; i++){
      const j = info[i].pj; if (j < i) continue;
      const pr = pairs.get(i + '-' + j); if (pr && pr.s < 0.7) continue;
      const si = SLOTS[seq[i]], sj = SLOTS[seq[j]];
      for (let k = 0; k < 3; k++){
        if (!((si[k] === 'D' && sj[k] === 'A') || (si[k] === 'A' && sj[k] === 'D'))) continue;
        const a = slotPos(i, k, info[i].flip), b = slotPos(j, k, info[j].flip);
        rung += `M${f1(a[0])} ${f1(a[1])}L${f1(b[0])} ${f1(b[1])}`;
      }
    }
    $('rungs').setAttribute('d', rung);
    const path = smoothPath([head].concat(N));
    if (gooAny){
      /* runs of covered letters, each drawn as one smooth stroke (the whole strand from the head when it all has goo) */
      const runs = cov => { let d = ''; for (let i = 0; i < n; i++){ if (!cov[i]) continue; let j = i; while (j + 1 < n && cov[j + 1]) j++; d += smoothPath((i === 0 ? [head] : []).concat(N.slice(i, j + 1))) || `M${f1(N[i].x)} ${f1(N[i].y)}h0.1`; i = j; } return d; };
      const outD = S.gooCover === 'all' ? path || `M${f1(head.x)} ${f1(head.y)}h0.1` : runs(gooCov);
      $('gooOut').setAttribute('d', outD); $('gooIn').setAttribute('d', outD);
      $('gooBody').setAttribute('d', S.goo === 'memFill' ? runs(memCov) : outD);
    }
    $('bb').setAttribute('d', path); $('bbRibbon').setAttribute('d', S.backbone === 'ribbon' ? path : '');
    let nick = '';
    for (let i = 0; i < n; i++){
      if (!dmg[i]) continue;
      let j = i; while (j + 1 < n && dmg[j + 1]) j++;
      nick += smoothPath(N.slice(Math.max(0, i - 1), Math.min(n, j + 2)));
      i = j;
    }
    $('bbNick').setAttribute('d', nick);
    $('bbNick').setAttribute('stroke-width', f1(Math.max(S.lineW, S.backbone === 'ribbon' ? S.lineW * 4 : S.lineW) + 1.6));
    $('bbNick').setAttribute('stroke-dasharray', `${f1(LB * 0.35)} ${f1(LB * 0.9)}`);
    renderHelpers();
    let bands = '';
    if (S.helixBand) for (const m of fold.mods){
      if (modProg(m) < 0.6) continue;
      const pts = []; for (let i = m.start; i <= m.a; i++) pts.push(N[i]); for (let i = m.b; i <= m.end; i++) pts.push(N[i]);
      bands += 'M' + pts.map(p => f1(p.x) + ' ' + f1(p.y)).join('L') + 'Z';
    }
    $('bands').setAttribute('d', bands);
    $('decoFill').setAttribute('d', ''); $('decoLine').setAttribute('d', '');
    let hull = '';
    fold.tags.forEach((m, k) => {
      const t = labelEls[k]; if (!t || !m.fn) return;
      const pts = []; for (let i = m.start; i <= m.end; i++) pts.push(N[i]);
      let cx = 0, cy = 0; for (const p of pts){ cx += p.x; cy += p.y; } cx /= pts.length; cy /= pts.length;
      const sx = (N[m.start].x + N[m.end].x) / 2, sy = (N[m.start].y + N[m.end].y) / 2;
      let vx = cx - sx, vy = cy - sy; const vl = Math.hypot(vx, vy) || 1; vx /= vl; vy /= vl;
      let reach = 0; for (const p of pts) reach = Math.max(reach, (p.x - cx) * vx + (p.y - cy) * vy);
      t.setAttribute('x', f1(cx + vx * (reach + R * 2.6))); t.setAttribute('y', f1(cy + vy * (reach + R * 2.6) + 4));
      if (S.pairing === 'parts' && S.decor) hull += hullPath(pts, cx, cy);
    });
    $('hull').setAttribute('d', hull);
  }


  /* swim toward a point the way a strand swims on its own: never pivoting on the spot, but arcing with an eased,
     capped turn and a slow weave, slowing near the point without stopping, so the body always flows behind the head */
  const cr = {turn:0, sp:0, t:0};
  function cruise(dt, tg, o){
    o = o || {}; cr.t += dt;
    const d = Math.hypot(tg.x - head.x, tg.y - head.y);
    if (d < (o.hold || 0)){ cr.turn = 0; cr.sp += (0 - cr.sp) * Math.min(1, dt * 6); step(dt, {turn:0, speed:cr.sp}); return; }
    const cap = o.turnCap != null ? o.turnCap : 3, gain = o.gain != null ? o.gain : 3;
    const goal = clamp(wrapA(Math.atan2(tg.y - head.y, tg.x - head.x) - heading) * gain, -cap, cap);
    cr.turn += (goal - cr.turn) * Math.min(1, dt * (o.ease != null ? o.ease : 6));
    const top = o.speed != null ? o.speed : S.speed, lo = o.minSpeed != null ? o.minSpeed : 0.35;
    /* drag (thick water: clay, brine, drained flats) slows how far each stroke gets you, not the stroke itself.
       In ground slower than 0.8 the body goes limp and is dragged like a rope (see ropeTrail) */
    const drag = o.drag != null ? clamp(o.drag, 0.05, 1) : 1;
    /* the head keeps swimming and turning at full strength; behind it, thick ground leaves the body limp */
    const lim = o.limp != null ? o.limp : clamp((0.8 - drag) / 0.2, 0, 1);
    /* close to the point and facing away from it, ease off further so the arc tightens enough to reach it instead of circling it */
    const near = o.slowWithin || 160, off = Math.abs(wrapA(Math.atan2(tg.y - head.y, tg.x - head.x) - heading));
    const align = clamp(1 - off / Math.PI * 1.3, 0.15, 1), far = clamp(d / (near * 1.5), 0, 1);
    const wantSp = top * (lo + (1 - lo) * clamp(d / near, 0, 1)) * (align + (1 - align) * far);
    cr.sp += (wantSp - cr.sp) * Math.min(1, dt * 3);
    const wv = (o.weave != null ? o.weave : S.weave * 0.6) * Math.sin(cr.t * 1.35 + (o.phase || 0));
    step(dt, {turn:cr.turn + wv, speed:cr.sp * drag, effort:cr.sp, limp:lim});
  }
  const clean = s => (Array.isArray(s) ? s.join('') : String(s || '')).toUpperCase().replace(/T/g, 'U').replace(/[^AUGC]/g, '');
  /* ---------- start ---------- */
  head = {x:opts.x || 0, y:opts.y || 0}; heading = opts.heading || 0;
  target = {x:head.x + Math.cos(heading) * 60, y:head.y + Math.sin(heading) * 60};
  if (Array.isArray(opts.segments)) segs = opts.segments.map(g => ({fn:g.fn || null, start:g.start, end:g.end}));
  setSeq(clean(opts.seq).split(''));
  seedTrailFromNodes();

  const api = {
    step, cruise,
    /* drive the strand from outside: put the head at (x, y) facing h; moving and limp are 0..1 */
    follow:(dt, x, y, h, o) => step(dt, {pos:{x, y, h}, moving:o && o.moving, limp:o && o.limp}),
    render:() => { if (visible) renderStrand(); },
    /* replace the letters; pass folded segments [{fn, start, end}] to keep structures, otherwise everything is loose */
    setSeq:(s, sg) => { segs = Array.isArray(sg) ? sg.map(g => ({fn:g.fn || null, start:g.start, end:g.end})) : []; setSeq(clean(s).split('')); },
    /* add letters and their folded segments (indexes from 0 within the added letters) */
    appendFolded(s, sg){ const at = seq.length, add = clean(s); segs = segs.concat((sg || []).map(g => ({fn:g.fn || null, start:g.start + at, end:g.end + at}))); setSeq(seq.concat(add.split(''))); },
    /* fold the loose tail: recipes where they match, junk for the rest. Returns what folded */
    foldTail(){
      const from = segs.length ? segs[segs.length - 1].end + 1 : 0;
      if (from >= seq.length) return [];
      const made = parseRecipes(seq.slice(from).join('')).map(g => ({fn:g.fn, start:g.start + from, end:g.end + from}));
      segs = segs.concat(made); setSeq(seq.slice());
      emit('folded', {made:made.map(g => ({fn:g.fn, letters:seq.slice(g.start, g.end + 1).join('')}))});
      return made;
    },
    get segments(){ return segs.map(g => ({fn:g.fn, start:g.start, end:g.end})); },
    get tail(){ const from = segs.length ? segs[segs.length - 1].end + 1 : 0; return seq.slice(from).join(''); },
    /* take the last letter off if it is loose; returns it */
    dropLast(){ const from = segs.length ? segs[segs.length - 1].end + 1 : 0; if (seq.length <= from) return null; const b = seq[seq.length - 1]; removeRange(seq.length - 1, seq.length - 1); return b; },
    /* everything from a letter to the tail bursts into loose letters */
    shedFrom(i){ if (i < 0 || i >= seq.length) return; const pts = []; for (let k = i; k < seq.length; k++) pts.push({x:N[k].x, y:N[k].y, b:seq[k]}); burst(pts, N[i].x, N[i].y); removeRange(i, seq.length - 1); },
    /* change a loose letter (radiation) */
    setLetter(i, b){ if (i < 0 || i >= seq.length || segs.some(g => i >= g.start && i <= g.end)) return false; seq[i] = b; setSeq(seq.slice()); return true; },
    append:s => setSeq(seq.concat(String(s).toUpperCase().replace(/T/g, 'U').replace(/[^AUGC]/g, '').split(''))),
    clear(){ N = []; pairs = new Map(); sticky.clear(); dmg = []; helpers = []; repEv = null; cut = null; setSeq([]); },
    damage:exclude => damageRandom(exclude),
    /* the structure at a letter index: {fn (null for junk arms), start, end, damaged}, or null for a loose letter */
    structureAt(i){ const st = structAt(i); return st ? {fn:isFn(st) ? st.fn : null, start:st.start, end:st.end, damaged:rangeDamaged(st)} : null; },
    /* damage the structure at a letter index; returns its name, or null if there is nothing there to damage */
    damageAt(i){
      const st = structAt(i); if (!st || rangeDamaged(st)) return null;
      for (let k = st.start; k <= st.end; k++) dmg[k] = true;
      styleDirty = true;
      hint('damaged', `The ${st.fn || 'arm'} was damaged. It stops working until a Repairer mends it.`, {fn:st.fn || 'arm', start:st.start});
      return st.fn || 'arm';
    },
    /* cut the strand at a letter index: the structure there bursts into loose letters and everything behind it comes off.
       Returns {fn, tail:'letters behind the cut', tailNodes:[{x, y}]} */
    cutAt(i){
      if (i < 0 || i >= seq.length) return null;
      const st = structAt(i), a = st ? st.start : i, b = st ? st.end : i;
      const pts = []; for (let k = a; k <= b; k++) pts.push({x:N[k].x, y:N[k].y, b:seq[k]});
      let cx = 0, cy = 0; pts.forEach(p => { cx += p.x; cy += p.y; }); cx /= pts.length; cy /= pts.length;
      const tail = seq.slice(b + 1).join(''), tailNodes = N.slice(b + 1).map(p => ({x:p.x, y:p.y}));
      const tailSegs = segs.filter(g => g.start > b).map(g => ({fn:g.fn, start:g.start - b - 1, end:g.end - b - 1}));
      burst(pts, cx, cy);
      removeRange(a, seq.length - 1);
      return {fn:st ? st.fn || 'arm' : null, tail, tailNodes, tailSegs};
    },
    tint,
    setOpacity(o){ for (const g of groups()) g.setAttribute('opacity', o); },
    move(dx, dy){ head.x += dx; head.y += dy; },
    /* put the head somewhere without dragging the body (walls push it back); the body follows its path as usual */
    setHead(x, y, h){ head.x = x; head.y = y; if (h != null) heading = h; const t0 = trail[0]; if (t0){ t0.x = x; t0.y = y; } },
    /* mend the structure at a letter index; returns its name, or null if nothing there was damaged */
    mendAt(i){ const st = structAt(i); if (!st || !rangeDamaged(st)) return null; for (let k = st.start; k <= st.end; k++) dmg[k] = false; styleDirty = true; repFlash.push({i:Math.round((st.start + st.end) / 2), t:0}); return st.fn || 'arm'; },
    /* off-screen strands keep swimming but skip drawing */
    setVisible(v){ if (v === visible) return; visible = v; for (const g of groups()) g.style.display = v ? '' : 'none'; },
    get visible(){ return visible; },
    place(x, y, h){ const dx = x - head.x, dy = y - head.y; head.x = x; head.y = y; if (h != null) heading = h;
      for (const p of trail){ p.x += dx; p.y += dy; } for (const p of N){ p.x += dx; p.y += dy; p.px += dx; p.py += dy; } },
    remove(){ for (const k of ['gooFL', 'gooL', 'main', 'helperGoo', 'helpers', 'mask']) E[k].remove(); const i = stage.strands.indexOf(api); if (i >= 0) stage.strands.splice(i, 1); },
    _restyle(k){
      if (k == null || k === 'minStem' || k === 'glyphSize' || k === 'lineW' || k === 'pairing'){ computeFold(); buildPools(); }
      if (k === 'motion' && S.motion === 'trail') seedTrailFromNodes();
      if (k === 'motion' && S.motion === 'physics') N.forEach(p => { p.px = p.x; p.py = p.y; p.z = 0; p.inward = false; });
      styleDirty = true;
    },
    get seq(){ return seq.join(''); },
    get length(){ return seq.length; },
    get head(){ return head; }, get heading(){ return heading; }, get moving(){ return moving; }, get limp(){ return limp; },
    get nodes(){ return N; }, get fold(){ return fold; }, get pairs(){ return pairs; },
    get functions(){ return (fold.units || []).map(u => ({fn:u.fn, start:u.start, end:u.end, damaged:rangeDamaged(u), bonus:u.bonus || 0, jstate:u.jstate || null})); },
    get helpers(){ return helpers; }, get repEv(){ return repEv; }, get cutter(){ return cut; },
    get damaged(){ return dmg; }
  };
  stage.strands.push(api);
  return api;
}

return {S, DEFAULTS, COLOR_KEYS, BASES, COMP, HB, PURINE, COLOR, SLOTS, MAXLEN, UNIT_TEXT,
  RECIPES, recipeLen, recipeMatch, parseRecipes, recipeNeed, recipeProgress, recipeSeq,
  createStage, restyle, applyColors, partsFold, buildFn, buildPartsSeven, joinFragment, unitSeq, glyphHref,
  get geo(){ return {GEO, R, LB, D, W}; }};
})();
