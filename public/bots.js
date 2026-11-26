/* RNA Strand Soup: bot minds.
   No fixed archetypes. Each bot is born with a mix of traits, a skill level, its own tastes in recipes
   and a home region. Every fraction of a second it looks around (letters, rivals, fragments, warnings,
   craters, the tide), updates its moods (anger, fear, boredom), plans which recipe to build next, and
   picks the behaviour that scores best right now. Different trait mixes in different situations give
   very different play: hoarding, hunting, raiding tails, piracy with a Joiner, lurking by salt pools,
   hiding in the chimneys, mending in the ice, chasing craters, riding geysers.

   window.SoupBots = {init(api), makeMind(i, taken), tick(dt), think(p, dt), onHit(victim, by, cut),
                      onDeath(p), onRespawn(p), describe(p)} */
/* a factory: the browser uses the default instance; a server room makes its own with SoupBots.create() */
const makeSoupBots = () => {
'use strict';
const TAU = Math.PI * 2;
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const wrapA = a => ((a + Math.PI * 3) % TAU) - Math.PI;

let G = null, MAP = null, RS = null, K = null, T = 0;
/* segment types, their bot tastes and how a bot weighs each: segments.js */
const SEG = window.SoupSegments, FNS = SEG.names;
const TRAITS = ['aggression', 'caution', 'greed', 'curiosity', 'patience', 'opportunism', 'grudge'];
const NAMES = {
  aggression:['Fang', 'Razor', 'Snapper', 'Brute'],
  caution:['Hermit', 'Clam', 'Burrow', 'Shelly'],
  greed:['Hoarder', 'Gulper', 'Sponge', 'Glut'],
  curiosity:['Rover', 'Scout', 'Comet', 'Drifter'],
  patience:['Lurker', 'Warden', 'Sentinel', 'Stillwater'],
  opportunism:['Magpie', 'Jackal', 'Gull', 'Scrap'],
  grudge:['Grudge', 'Spite', 'Rancor', 'Feud']
};
/* what each trait means, for the end-of-round card */
const STYLE = {aggression:'hunts rivals', caution:'plays safe', greed:'collects hard', curiosity:'roams the map',
  patience:'waits in ambush', opportunism:'steals and scavenges', grudge:'never forgets a hit'};
/* where each letter is most common */
let LETTER_HOMES = null, REGIONS = null;

function init(api){
  G = api; MAP = api.MAP; RS = api.RS; K = MAP.K;
  /* where letters gather, and the regions a bot can call home (biomes.js) */
  const BIO = window.SoupBiomes;
  LETTER_HOMES = Object.fromEntries(Object.entries(BIO.LETTER_HOMES).map(([b, keys]) => [b, keys.map(k => K[k])]));
  REGIONS = Object.fromEntries(BIO.REGIONS.filter(r => r.cells && r.botHome).map(r => [r.id, r.cells.map(k => K[k])]));
}

/* ---------- birth: a random mind with one trait that stands out ---------- */
function makeMind(i, taken){
  const traits = {};
  for (const t of TRAITS) traits[t] = clamp(0.15 + 0.6 * Math.random() * Math.random() + 0.2 * Math.random(), 0, 1);
  /* each bot gets a different standout trait, and sometimes a second one */
  const free = TRAITS.filter(t => !taken.includes(t));
  const lead = pick(free.length ? free : TRAITS); taken.push(lead);
  traits[lead] = rnd(0.78, 1);
  if (Math.random() < 0.6){ const second = pick(TRAITS.filter(t => t !== lead)); traits[second] = Math.max(traits[second], rnd(0.55, 0.8)); }
  /* a couple of natural pairings so minds hang together */
  if (traits.caution > 0.7) traits.aggression *= 0.6;
  if (traits.aggression > 0.75) traits.caution *= 0.7;
  const skill = rnd(0.35, 1);
  const taste = {}; for (const f of FNS) taste[f] = rnd(0.75, 1.3);
  const homes = {}; for (const r of window.SoupBiomes.REGIONS) if (r.cells && r.botHome) homes[r.id] = r.botHome(traits);
  let r = Math.random() * Object.values(homes).reduce((a, b) => a + b, 0), home = 'lagoon';
  for (const [k, v] of Object.entries(homes)){ r -= v; if (r < 0){ home = k; break; } }
  /* the standout trait tilts which recipes it likes */
  for (const s of SEG.LIST) if (s.likedBy && s.likedBy.includes(lead)) taste[s.fn] *= rnd(1.3, 1.6);
  const name = pick(NAMES[lead]);
  return {name, lead, traits, skill, taste, home,
          react:0.55 - 0.32 * skill,           /* seconds between decisions */
          aim:(1 - skill) * 70,                /* how sloppy its steering is, in px */
          sight:800 + 300 * skill,             /* how far it notices letters and rivals: about a player's screen, so memory and exploring matter */
          anger:0, fear:0, boredom:0, grudges:{}, lastGain:0};
}
function describe(p){
  const m = p.mind; if (!m) return '';
  const top = TRAITS.slice().sort((a, b) => m.traits[b] - m.traits[a]).slice(0, 2);
  return top.map(t => STYLE[t]).join(', ');
}

/* ---------- shared bookkeeping each step: velocities, Cleaver tips, news ---------- */
function tick(dt){
  T += dt;
  for (const p of G.players){
    const h = p.s.head, v = p._v || (p._v = {x:h.x, y:h.y, vx:0, vy:0});
    if (dt > 0 && p.alive){
      let vx = (h.x - v.x) / dt, vy = (h.y - v.y) / dt; const s = Math.hypot(vx, vy);
      if (s > 500){ vx *= 500 / s; vy *= 500 / s; }
      const k = Math.min(1, dt * 5); v.vx += (vx - v.vx) * k; v.vy += (vy - v.vy) * k;
    } else { v.vx = 0; v.vy = 0; }
    v.x = h.x; v.y = h.y;
    /* where this strand's Cleaver spikes (anything with tips) are right now */
    const tips = p._tips || (p._tips = []); tips.length = 0;
    if (p.alive) for (const f of G.working(p)){
      const seg = SEG.get(f.fn); if (!seg || !seg.tips) continue;
      for (const j of seg.tips(f)){ const n = p.s.nodes[j]; if (n) tips.push(n); }
    }
    if (p.mind){
      const m = p.mind;
      m.anger = Math.max(0, m.anger - dt * 0.06); m.fear = Math.max(0, m.fear - dt * 0.1);
      for (const k in m.grudges){ m.grudges[k] *= 1 - dt * 0.015; if (m.grudges[k] < 0.05) delete m.grudges[k]; }
    }
  }
  for (let i = G.news.length - 1; i >= 0; i--) if (T - G.news[i].t > 20) G.news.splice(i, 1);
}
function onHit(victim, by, cut){
  const m = victim.mind; if (!m || !by) return;
  m.grudges[by.id] = (m.grudges[by.id] || 0) + (cut ? 1.6 : 0.8);
  m.anger = Math.min(2, m.anger + (cut ? 0.9 : 0.45) * (0.3 + m.traits.grudge + m.traits.aggression * 0.5));
  m.fear = Math.min(2, m.fear + (cut ? 0.8 : 0.4) * (0.3 + m.traits.caution));
  victim.ai.t = Math.min(victim.ai.t, 0.05);   /* react right away */
}
function onDeath(p){
  G.news.push({type:'death', x:p.s.head.x, y:p.s.head.y, t:T, who:p});
  if (p.mind){ p.mind.fear = Math.min(2, p.mind.fear + 0.5 * p.mind.traits.caution); }
}
function onRespawn(p){ const ai = p.ai; ai.mode = 'forage'; ai.modeT = 0; ai.path = null; ai.goal = null; ai.label = ''; }

/* ---------- looking around ---------- */
const working = p => G.working(p);
const hasFn = (p, fn) => G.has(p, fn);
function earlyFor(p){ return SEG.warnEarly(working(p)); }
function scores(){ return G.players.map(o => ({o, s:G.complexity(o)})).sort((a, b) => b.s - a.s); }

function perceive(p){
  const m = p.mind, h = p.s.head, S = m.sight, early = earlyFor(p);
  const info = {h, early, fear:0, fx:0, fy:0, threat:null, warn:null, rivals:[], frags:[], counts:{A:0, U:0, G:0, C:0}, total:0};
  /* letters nearby, by kind */
  for (const q of G.nucs){ if (Math.abs(q.x - h.x) > S || Math.abs(q.y - h.y) > S) continue; info.counts[q.b]++; info.total++; }
  /* rivals: who could hurt me, who could I hurt */
  let worst = 0;
  for (const o of G.players){
    if (o === p || !o.alive) continue;
    const oh = o.s.head, d = dist(h.x, h.y, oh.x, oh.y);
    if (d > S * 1.6) continue;
    info.rivals.push({o, d});
    if (!o._tips.length || d > 950) continue;
    /* reading body language: a rival with spikes swimming my way is a threat; a bot's plan can be read outright */
    const toMe = Math.atan2(h.y - oh.y, h.x - oh.x), facing = Math.cos(wrapA(o.s.heading - toMe));
    const intent = o.ai && o.ai.mode === 'hunt' && o.ai.prey === p ? 1.2 : 0.35 + 0.65 * Math.max(0, facing);
    const w = (1 - d / 950) * intent * Math.min(2, o._tips.length / 2);
    info.fear += w; info.fx += (h.x - oh.x) / (d || 1) * w; info.fy += (h.y - oh.y) / (d || 1) * w;
    if (w > worst){ worst = w; info.threat = o; }
  }
  /* warnings I can see: UV flashes and meteorites (earlier with a Detector) */
  for (const mt of MAP.meteors){ if (mt.t <= early && dist(h.x, h.y, mt.x, mt.y) < mt.r + 140) info.warn = {x:mt.x, y:mt.y, r:mt.r + 140, kind:'meteorite'}; }
  if (!info.warn) for (const u of MAP.uvFlashes){
    if (u.t <= early && dist(h.x, h.y, u.x, u.y) < u.r + 90 && working(p).length > 1) info.warn = {x:u.x, y:u.y, r:u.r + 90, kind:'UV flash'};
  }
  /* geysers about to burst under me, unless I want the ride */
  if (!info.warn) for (const g of MAP.geysers){
    if (g.phase === 'bubble' && dist(h.x, h.y, g.x, g.y) < g.r + 40 && p.ai.mode !== 'geyser') info.warn = {x:g.x, y:g.y, r:g.r + 70, kind:'geyser'};
  }
  for (const f of G.frags){ const n = f.s.nodes[Math.floor(f.s.length / 2)] || f.s.head, d = dist(h.x, h.y, n.x, n.y); if (d < S * 1.8) info.frags.push({f, d, n}); }
  const sc = scores(); info.rank = sc.findIndex(r => r.o === p) + 1; info.leader = sc[0].o; info.myScore = G.complexity(p);
  info.lead = sc[0].s - (sc[1] ? sc[1].s : 0);
  info.late = G.timeLeft < 50;
  info.damaged = p.s.functions.filter(f => f.damaged);
  info.cleaver = p._tips.length > 0;
  info.joinerArmed = working(p).some(f => f.jstate === 'armed') && !p.s.tail.length;
  return info;
}

/* ---------- planning: which recipe to build next ---------- */
function planRecipe(p, info){
  const m = p.mind, tr = m.traits, ai = p.ai, tail = p.s.tail;
  const kinds = new Set(working(p).map(f => f.fn));
  const tot = Math.max(8, info.total), share = b => (info.counts[b] + 1) / (tot + 4);
  const rate = Math.max(0.12, ai.rate || 0.3);
  const fragsNear = info.frags.filter(r => r.d < 2200).length;
  const rivalSpikes = info.rivals.filter(r => r.o._tips.length).length;
  const lastSt = p.s.functions[p.s.functions.length - 1];
  let best = null, bu = -1e9;
  const out = {};
  for (const fn of FNS){
    const L = G.recipeLen(fn);
    if (p.s.length + L > RS.MAXLEN) continue;
    const prog = RS.recipeProgress(tail, fn), fits = prog.k === tail.length;
    const left = L - (fits ? prog.k : 0);
    /* rarer letters around here make a recipe slower to finish */
    const core = RS.RECIPES[fn]; let slow = 0; for (const b of core) slow += 0.25 / share(b); slow /= core.length;
    const tEst = left / rate * clamp(slow, 0.6, 3);
    const n = G.countFn(p, fn);
    /* each segment type weighs itself (segments.js) */
    const c = {gain:kinds.has(fn) ? 1 : 3, want:0, tr, m, n, info, p, kinds, lastSt, rivalSpikes, G, has:f => hasFn(p, f)};
    const plan = SEG.get(fn).plan;
    if (plan && plan(c) === false) continue;
    const gain = c.gain, want = c.want;
    let u = (gain + Math.max(0, want)) * m.taste[fn] / Math.pow(5 + tEst, 0.75);
    if (fits) u += prog.k * 0.05; else u -= (tail.length - prog.k) * 0.04;
    if (tEst > G.timeLeft * 0.9) u *= 0.15;
    if (fn === ai.goal) u *= 1.2;
    out[fn] = u;
    if (u > bu){ bu = u; best = fn; }
  }
  ai.goal = best || 'Joiner'; ai.goalU = out; ai.planT = rnd(2.5, 4.5);
}

/* the letter I need next, or null for any letter (stems) */
function nextNeed(p){
  const ai = p.ai, tail = p.s.tail, prog = RS.recipeProgress(tail, ai.goal);
  if (prog.k !== tail.length) return {any:false, need:null, drop:true};
  const need = RS.recipeNeed(prog.t, ai.goal, prog.k);
  return {any:!need, need, drop:false};
}

/* ---------- choosing a letter to go after ---------- */
function bestLetter(p, info, need){
  const m = p.mind, tr = m.traits, h = info.h, S = m.sight;
  let best = null, bc = 1e9;
  for (const q of G.nucs){
    if (need && q.b !== need) continue;
    const dx = q.x - h.x, dy = q.y - h.y; if (Math.abs(dx) > S || Math.abs(dy) > S) continue;
    let c = Math.hypot(dx, dy);
    if (MAP.smokerAt(q.x, q.y, 120)) continue;
    /* letters in front of me are cheaper: turning around costs time */
    const ahead = Math.cos(wrapA(Math.atan2(dy, dx) - p.s.heading)); c *= 1.15 - 0.15 * ahead;
    if (c > 300 && !MAP.lineClear(h.x, h.y, q.x, q.y)) c *= 1.7;
    /* someone else is closer: the cautious give way, the greedy race for it */
    for (const r of info.rivals){
      if (r.d > c * 2 + 200) continue;
      const od = dist(r.o.s.head.x, r.o.s.head.y, q.x, q.y);
      if (od < c * 0.75) c *= 1.25 + 0.7 * (1 - tr.greed) + (r.o._tips.length ? tr.caution * 0.8 : 0);
    }
    if (q._claim && q._claim.p !== p && T - q._claim.t < 1.5 && q._claim.d < c) c *= 1.5;
    if (q._ban && q._ban[p.id] > T) continue;
    /* hazards around the letter */
    const t = MAP.typeAt(q.x, q.y);
    if (t === K.FLATS && MAP.tide < 0.5) c *= 1 + 0.8 * tr.caution;
    if (t === K.UV && working(p).length > 2) c *= 1 + 0.6 * tr.caution;
    if (MAP.saltAt(q.x, q.y) && SEG.any(working(p), 'saltBreaks')) c *= 1.6;
    if (info.threat){ const oh = info.threat.s.head; if (dist(oh.x, oh.y, q.x, q.y) < 300) c *= 1 + 1.5 * tr.caution; }
    if (c < bc){ bc = c; best = q; }
  }
  if (best) best._claim = {p, t:T, d:bc};
  return best;
}

/* ---------- memory: rich places this bot has found. Each visit to a place with plenty of letters records or refreshes it;
   memories fade over a couple of minutes unless visited again. So a bot's map of good places grows through the round. ---------- */
const SPOT_R = 350, SPOT_MIN = 6, SPOT_FADE = 120, SPOTS_MAX = 10;
function remember(p, h){
  const m = p.mind, spots = m.spots || (m.spots = []);
  for (const s of spots){ const k = Math.exp(-(T - s.t) / SPOT_FADE); s.v *= k; for (const b in s.c) s.c[b] *= k; s.t = T; }
  const near = {A:0, U:0, G:0, C:0}; let n = 0;
  for (const q of G.nucs) if (Math.abs(q.x - h.x) < SPOT_R && Math.abs(q.y - h.y) < SPOT_R){ near[q.b]++; n++; }
  if (n >= SPOT_MIN && !MAP.smokerAt(h.x, h.y, 300)){
    let s = spots.find(s => dist(s.x, s.y, h.x, h.y) < 500);
    if (!s){ s = {x:h.x, y:h.y, v:0, c:{A:0, U:0, G:0, C:0}, t:T}; spots.push(s); }
    s.x += (h.x - s.x) * 0.3; s.y += (h.y - s.y) * 0.3; s.v = Math.max(s.v, n);
    for (const b in near) s.c[b] = Math.max(s.c[b], near[b]);
  }
  m.spots = spots.filter(s => s.v > 1.5).sort((a, b) => b.v - a.v).slice(0, SPOTS_MAX);
}
/* the best remembered place for a letter (or for letters in general), allowing for how far away it is */
function bestMemory(p, need){
  const m = p.mind, h = p.s.head; let best = null, bu = 1.5;
  for (const s of m.spots || []){
    const d = dist(h.x, h.y, s.x, s.y); if (d < 300) continue;
    const u = (need ? s.c[need] * 2 + s.v * 0.3 : s.v) / (1 + d / 1500);
    if (u > bu){ bu = u; best = s; }
  }
  return best;
}

/* where to go when nothing I need is in sight */
function travelSpot(p, need){
  const m = p.mind, h = p.s.head;
  /* somewhere I remember being rich, unless curiosity sends me somewhere new */
  const memo = bestMemory(p, need);
  if (memo && Math.random() > 0.25 + 0.5 * m.traits.curiosity) return {x:memo.x, y:memo.y, why:'memory'};
  const types = need ? LETTER_HOMES[need] : REGIONS[m.home];
  /* fresh craters are full of A and G */
  if (need === 'A' || need === 'G'){ const c = MAP.craters.find(c => c.age < 40 && dist(h.x, h.y, c.x, c.y) < 3500); if (c) return {x:c.x, y:c.y, why:'crater'}; }
  for (let k = 0; k < 6; k++){
    const sp = Math.random() < 0.5 ? MAP.nearestOf(types, h.x + rnd(-900, 900), h.y + rnd(-900, 900), 4000) : MAP.randomOf(types);
    if (sp && !MAP.smokerAt(sp.x, sp.y, 300) && dist(h.x, h.y, sp.x, sp.y) > 250) return {x:sp.x, y:sp.y, why:need ? 'need' : 'home'};
  }
  const sp = MAP.spawnSpot(); return sp ? {x:sp.x, y:sp.y, why:'wander'} : {x:h.x, y:h.y, why:'wander'};
}

/* ---------- hunting: who and where to strike ---------- */
function preyValue(p, info, o, d){
  const m = p.mind, tr = m.traits;
  if (o.inv > 0 || o.fling) return null;
  const fl = o.s.functions, tailN = o.s.tail.length, from = o.s.length - tailN;
  let node = null, v = 0;
  /* a damaged function cuts in one more hit and leaves a fragment behind */
  const dmg = fl.filter(f => f.damaged);
  if (dmg.length){ const f = dmg[dmg.length - 1]; v = 2.2 + (o.s.length - f.start) * 0.04; node = Math.round((f.start + f.end) / 2); }
  /* a long loose tail: knock the letters off and eat them */
  if (tailN >= 4 && tailN * 0.3 * (0.5 + tr.opportunism + tr.greed * 0.5) > v){ v = tailN * 0.3 * (0.5 + tr.opportunism + tr.greed * 0.5); node = from + Math.floor(tailN / 2); }
  /* otherwise a working function with no Membrane beside it, on a strand with something worth taking:
     a strand with only one working segment (often just the Mover every strand starts with) is not worth a chase */
  if (node == null){
    const open = fl.filter(f => !f.damaged && f.fn && !(SEG.get(f.fn) || {}).shield && !G.shieldFor(o, f));
    if (!open.length || G.working(o).length < 2) return null;
    const f = open[open.length - 1]; v = 0.6 + 0.35 * open.length; node = Math.round((f.start + f.end) / 2);
  }
  if (MAP.saltAt(o.s.head.x, o.s.head.y)) v += 1.2;       /* one-hit cuts in a drying salt pool */
  v += (m.grudges[o.id] || 0) * (0.5 + 1.5 * tr.grudge);
  if (info.late && o === info.leader && info.rank > 1) v += 1.2 * (0.4 + tr.aggression);   /* knock the leader down */
  if (o === info.leader && info.lead >= 4) v += 0.5;
  if (o._tips.length && !SEG.any(working(p), 'shield')) v -= 1.2 * tr.caution;                      /* they bite back */
  if (MAP.shelterAt(o.s.head.x, o.s.head.y)) v -= 0.6;
  /* do not dog-pile: if others already hunt this one, look elsewhere */
  const hunters = G.players.filter(b => b !== p && b.ai && b.ai.mode === 'hunt' && b.ai.prey === o).length;
  v -= hunters * 0.9;
  return {o, node, v:v / (1 + d / 700)};
}

/* ---------- behaviours: each scores itself, the best one steers ---------- */
const MODES = {
  dodge:{
    score:(p, i) => i.warn ? 12 : 0,
    act(p, i){
      const w = i.warn, h = i.h;
      const sh = (w.kind !== 'geyser' && p.mind.traits.caution > 0.4) ? MAP.nearestOf([K.POCKET, K.BRINE], h.x, h.y, 400) : null;
      p.ai.label = sh ? `hiding from ${w.kind}` : `dodging ${w.kind}`;
      if (sh) return sh;
      const d = dist(h.x, h.y, w.x, w.y) || 1;
      return {x:w.x + (h.x - w.x) / d * (w.r + 220), y:w.y + (h.y - w.y) / d * (w.r + 220)};
    }
  },
  flee:{
    score(p, i){
      const tr = p.mind.traits; if (i.fear < 0.15) return 0;
      const brave = i.cleaver ? tr.aggression * 0.8 + p.mind.anger * 0.4 : 0;
      return i.fear * (0.8 + 1.6 * tr.caution + p.mind.fear) * (1.3 - brave) * (i.rank === 1 && i.late ? 1.5 : 1) + 0.3;
    },
    act(p, i){
      const h = i.h, tr = p.mind.traits;
      const sh = MAP.nearestOf([K.POCKET, K.BRINE, K.PORE], h.x, h.y, 700 + 400 * tr.caution);
      p.ai.label = `fleeing ${i.threat ? i.threat.name : ''}`.trim();
      const fx = i.fx, fy = i.fy, fl = Math.hypot(fx, fy) || 1;
      if (sh && (sh.x - h.x) * fx + (sh.y - h.y) * fy > -200){ p.ai.label += ' to shelter'; return sh; }
      return {x:h.x + fx / fl * 500, y:h.y + fy / fl * 500};
    }
  },
  hunt:{
    score(p, i){
      if (!i.cleaver || p.ai.huntCd > 0) return 0;
      const tr = p.mind.traits; let best = null;
      for (const r of i.rivals){ const pv = preyValue(p, i, r.o, r.d); if (pv && (!best || pv.v > best.v)) best = pv; }
      p.ai.preyPick = best;
      if (!best || best.v <= 0.2) return 0;
      const tail = p.s.tail.length;
      return best.v * (0.25 + 1.4 * tr.aggression + 0.6 * p.mind.anger + 0.3 * tr.opportunism) * (tail > 6 ? 0.6 : 1) * (p.ai.mode === 'lurk' ? 1.6 : 1);
    },
    act(p, i){
      const ai = p.ai, pk = ai.preyPick; if (!pk || !pk.o.alive || !pk.o.s.nodes.length) return null; ai.prey = pk.o;
      const o = pk.o, n = o.s.nodes[Math.min(pk.node, o.s.nodes.length - 1)] || o.s.head, h = i.h;
      /* aim where that part of them will be, then swim straight through so my spikes sweep across it */
      const v = o._v || {vx:0, vy:0}, d = dist(h.x, h.y, n.x, n.y), lead = clamp(d / 260, 0.15, 1.2);
      const px = n.x + v.vx * lead, py = n.y + v.vy * lead, dd = dist(h.x, h.y, px, py) || 1;
      ai.label = `hunting ${o.name}` + (pk.node >= o.s.length - o.s.tail.length ? '’s tail' : '');
      return {x:px + (px - h.x) / dd * 160, y:py + (py - h.y) / dd * 160};
    }
  },
  join:{
    score(p, i){
      if (!i.joinerArmed || !i.frags.length) return 0;
      const r = i.frags.reduce((a, b) => (a && a.d < b.d ? a : b), null);
      p.ai.fragPick = r;
      return 2.5 + 2 * p.mind.traits.opportunism - r.d / 1500;
    },
    act(p, i){
      const ai = p.ai, r = ai.fragPick, h = i.h, f = r && r.f; if (!f || !G.frags.includes(f)) return null;
      const c = f.s.nodes[Math.floor(f.s.length / 2)] || f.s.head, d = dist(h.x, h.y, c.x, c.y) || 1;
      ai.label = 'backing into a fragment';
      /* my tail follows my head's path, so swim straight through the fragment and keep going */
      return {x:c.x + (c.x - h.x) / d * 260, y:c.y + (c.y - h.y) / d * 260};
    }
  },
  scavenge:{
    score(p, i){
      const tr = p.mind.traits, h = i.h; let best = null, bv = 0;
      for (const c of MAP.craters){ if (c.age > 45) continue; const d = dist(h.x, h.y, c.x, c.y); if (d > 3800 || d < 160) continue; const v = (1.2 + 2 * tr.opportunism + tr.curiosity * 0.5) * (1 - d / 3800) * (1 - c.age / 45); if (v > bv){ bv = v; best = {x:c.x, y:c.y, what:'crater'}; } }
      for (const e of G.news){ if (e.type !== 'death' || T - e.t > 8) continue; const d = dist(h.x, h.y, e.x, e.y); if (d > 1600 || d < 120) continue; const v = (0.6 + 2 * tr.opportunism) * (1 - d / 1600); if (v > bv){ bv = v; best = {x:e.x, y:e.y, what:'wreck'}; } }
      /* a fight nearby: shadow it and pick up whatever falls off */
      if (tr.opportunism > 0.5) for (const a of i.rivals){ if (!a.o._tips.length || a.d > 1500) continue; for (const b of G.players){ if (b === p || b === a.o || !b.alive) continue; const dd = dist(a.o.s.head.x, a.o.s.head.y, b.s.head.x, b.s.head.y); if (dd < 260){ const v = tr.opportunism * 1.4 * (1 - a.d / 1500); if (v > bv){ bv = v; best = {x:(a.o.s.head.x + b.s.head.x) / 2, y:(a.o.s.head.y + b.s.head.y) / 2, what:'fight', keep:340}; } } } }
      p.ai.scav = best; return best ? bv : 0;
    },
    act(p, i){
      const s = p.ai.scav, h = i.h;
      p.ai.label = s.what === 'fight' ? 'shadowing a fight' : s.what === 'crater' ? 'racing to the crater' : 'picking over a wreck';
      if (s.keep){ const d = dist(h.x, h.y, s.x, s.y) || 1; if (d < s.keep) return {x:s.x + (h.x - s.x) / d * s.keep, y:s.y + (h.y - s.y) / d * s.keep}; }
      return s;
    }
  },
  mend:{
    score(p, i){
      if (!i.damaged.length || SEG.bodyOf(p.ai.goal) === 'helpers') return 0;
      const tr = p.mind.traits, h = i.h, sp = MAP.nearestOf([K.BRINE], h.x, h.y, 3000);
      p.ai.brine = sp; if (!sp) return 0;
      const inIce = MAP.typeAt(h.x, h.y) === K.BRINE;
      return i.damaged.length * (0.35 + 0.9 * tr.patience + 0.5 * tr.caution) * (inIce ? 1.6 : 1 - dist(h.x, h.y, sp.x, sp.y) / 3600);
    },
    act(p, i){
      const h = i.h, ai = p.ai;
      if (MAP.typeAt(h.x, h.y) === K.BRINE){
        ai.label = 'mending in the ice';
        /* drift slowly along the vein, picking up what it can */
        const q = bestLetter(p, i, nextNeed(p).need);
        if (q && dist(h.x, h.y, q.x, q.y) < 260 && MAP.typeAt(q.x, q.y) === K.BRINE) return q;
        const a = T * 0.6 + p.id; return {x:h.x + Math.cos(a) * 60, y:h.y + Math.sin(a) * 60};
      }
      ai.label = 'heading to the ice to mend';
      return ai.brine;
    }
  },
  lurk:{
    score(p, i){
      const tr = p.mind.traits, ai = p.ai;
      if (!i.cleaver || ai.lurkCd > 0 || tr.patience < 0.45) return 0;
      if (!ai.lurkAt || ai.mode !== 'lurk'){
        /* a good ambush spot: a drying salt pool (one-hit cuts), a chimney exit, or a busy pool */
        const salt = MAP.pools.filter(q => q.salt && MAP.tide < 0.5);
        const cand = salt.length ? salt.map(q => ({x:q.x, y:q.y, what:'salt pool'})) : MAP.springs.map(s => ({x:s.x, y:s.y, what:'hot spring'}));
        const h = i.h; cand.sort((a, b) => dist(h.x, h.y, a.x, a.y) - dist(h.x, h.y, b.x, b.y));
        ai.lurkAt = cand[0] || null;
      }
      if (!ai.lurkAt) return 0;
      return (0.5 + 1.3 * tr.patience) * (0.4 + tr.aggression) * (p.s.tail.length < 3 ? 1 : 0.4) * (ai.mode === 'lurk' && ai.modeT > 25 ? 0.2 : 1);
    },
    act(p, i){
      const L = p.ai.lurkAt, h = i.h;
      p.ai.label = `lurking by a ${L.what}`;
      if (dist(h.x, h.y, L.x, L.y) > 260) return L;
      const a = T * 0.5 + p.id * 2; return {x:L.x + Math.cos(a) * 170, y:L.y + Math.sin(a) * 170};
    }
  },
  geyser:{
    score(p, i){
      const tr = p.mind.traits, h = i.h; if (tr.curiosity < 0.45) return 0;
      const g = MAP.geysers.find(g => dist(h.x, h.y, g.x, g.y) < 900 && (g.phase === 'wait' && g.t < 4 || g.phase === 'bubble'));
      p.ai.ride = g || null;
      return g ? tr.curiosity * (0.6 + m_bored(p)) : 0;
    },
    act(p, i){ p.ai.label = 'riding a geyser'; const g = p.ai.ride; return {x:g.x, y:g.y}; }
  },
  explore:{
    score(p, i){ const tr = p.mind.traits; return tr.curiosity * (0.25 + 0.7 * m_bored(p)) + (p.ai.mode === 'explore' && p.ai.modeT < 25 ? 0.4 : 0); },
    act(p, i){
      const ai = p.ai, h = i.h;
      if (!ai.exploreAt || dist(h.x, h.y, ai.exploreAt.x, ai.exploreAt.y) < 200 || ai.modeT < 0.01){
        /* somewhere far, or a pumice raft to ride */
        const raft = MAP.rafts.length && Math.random() < 0.35 ? pick(MAP.rafts) : null;
        ai.exploreAt = raft ? {raft} : (MAP.randomOf(pick(Object.values(REGIONS))) || MAP.spawnSpot());
      }
      const e = ai.exploreAt;
      if (e.raft){ ai.label = 'riding a pumice raft'; return {x:e.raft.x, y:e.raft.y}; }
      ai.label = 'exploring'; return e;
    }
  },
  forage:{
    score(p, i){
      const nn = nextNeed(p), tr = p.mind.traits;
      if (p.s.tail.length >= G.MAXLOOSE || nn.drop) return 0;
      const q = bestLetter(p, i, nn.any ? null : nn.need);
      p.ai.food = q; p.ai.nn = nn;
      if (!q) return 0;
      return 1.2 + 0.7 * tr.greed + (i.late ? 0.6 : 0) + 0.4 * (p.s.tail.length > 0);
    },
    act(p, i){
      const q = p.ai.food, nn = p.ai.nn, ai = p.ai;
      /* chasing the same letter for too long: it is stuck somewhere awkward, so forget it for a while */
      if (ai.foodQ !== q){ ai.foodQ = q; ai.foodT = T; }
      else if (T - ai.foodT > 5){ (q._ban || (q._ban = {}))[p.id] = T + 20; ai.foodQ = null; }
      p.ai.label = nn.any ? `building a ${p.ai.goal}` : `needs ${nn.need} for a ${p.ai.goal}`;
      return q;
    }
  },
  travel:{
    score:() => 0.6,
    act(p, i){
      const ai = p.ai, h = i.h, nn = nextNeed(p);
      if (!ai.travelTo || dist(h.x, h.y, ai.travelTo.x, ai.travelTo.y) < 160 || ai.travelFor !== nn.need || ai.mode !== 'travel'){
        ai.travelTo = travelSpot(p, nn.any ? null : nn.need); ai.travelFor = nn.need;
      }
      const t = ai.travelTo;
      if (nn.drop) ai.label = 'dropping letters';
      else ai.label = t.why === 'crater' ? `off to a crater for ${nn.need}` : t.why === 'need' ? `searching for ${nn.need}` : t.why === 'memory' ? (nn.need ? `back to a good spot for ${nn.need}` : 'back to a good spot') : 'heading home';
      return t;
    }
  }
};
const m_bored = p => clamp(p.mind.boredom / 12, 0, 1.5);

/* ---------- the decision ---------- */
function think(p, dt){
  const ai = p.ai, m = p.mind, tail = p.s.tail;
  ai.t = (ai.t == null ? 0 : ai.t) - dt; ai.modeT = (ai.modeT || 0) + dt; ai.drop = (ai.drop || 0) - dt;
  ai.huntCd = (ai.huntCd || 0) - dt; ai.lurkCd = (ai.lurkCd || 0) - dt; ai.planT = (ai.planT || 0) - dt;
  m.boredom += dt;
  /* letters collected per second, smoothed: how fast I usually build */
  if (p.alive && T - (m.memT || 0) > 1){ m.memT = T; remember(p, p.s.head); }
  const n = p.s.length; if (ai.lastLen != null && n > ai.lastLen){ m.boredom = 0; ai.gotT = T; ai.rateGot = (ai.rateGot || 0) + Math.min(3, n - ai.lastLen); }
  ai.lastLen = n; ai.rateT = (ai.rateT || 0) + dt;
  if (ai.rateT > 5){ const got = (ai.rateGot || 0); ai.rate = (ai.rate || 0.3) * 0.7 + (got / ai.rateT) * 0.3; ai.rateT = 0; ai.rateGot = 0; }

  /* fold the moment a recipe is complete */
  if (tail.length >= 7 && RS.parseRecipes(tail, true).some(g => g.fn)){ G.doFold(p); ai.planT = 0; ai.goal = null; return steer(p); }
  if (!ai.goal || ai.planT <= 0){ const i = ai.info || perceive(p); planRecipe(p, i); }
  /* letters that do not fit the plan come off, one at a time */
  if (tail.length && RS.recipeProgress(tail, ai.goal).k < tail.length && ai.drop <= 0){ G.doDrop(p); ai.drop = 0.35 + 0.3 * (1 - m.skill); }

  if (ai.t > 0) return steer(p);
  ai.t = m.react * rnd(0.8, 1.2);
  const i = ai.info = perceive(p);

  /* score every behaviour; the current one gets a little stickiness so bots do not dither */
  let best = 'travel', bs = -1;
  for (const k in MODES){
    let s = MODES[k].score(p, i);
    if (k === ai.mode && s > 0) s *= 1.15 + (ai.modeT < 1.5 ? 0.3 : 0);
    s *= 1 + rnd(-0.08, 0.08) * (1.2 - m.skill);
    if (s > bs){ bs = s; best = k; }
  }
  if (best !== ai.mode){
    /* giving up a hunt that went nowhere: cool off for a while */
    if (ai.mode === 'hunt' && ai.modeT > 10) ai.huntCd = rnd(6, 14) * (1.3 - m.traits.aggression);
    if (ai.mode === 'lurk') ai.lurkCd = rnd(12, 25);
    ai.mode = best; ai.modeT = 0;
  }
  if (ai.mode === 'hunt' && ai.modeT > 14 + 10 * m.traits.patience){ ai.huntCd = rnd(8, 15); }
  if (best !== 'hunt') ai.prey = null;
  const tg = MODES[best].act(p, i) || {x:i.h.x, y:i.h.y};
  const err = m.aim; ai.goalPt = {x:tg.x + rnd(-err, err), y:tg.y + rnd(-err, err)};
  ai.follow = best === 'hunt' || best === 'join';   /* moving targets: re-aim every frame */
  return steer(p);
}

/* ---------- steering: walls, smokers, other strands' spikes ---------- */
function steer(p){
  const ai = p.ai, h = p.s.head, m = p.mind;
  let g = ai.goalPt || {x:h.x, y:h.y};
  if (ai.follow && ai.mode){ const tg = MODES[ai.mode].act(p, ai.info); if (tg) g = tg; }
  let tx = g.x, ty = g.y;
  /* walls in the way: follow a path through the open cells, steering at the furthest point still in view */
  if (!MAP.lineClear(h.x, h.y, tx, ty)){
    ai.pathT = (ai.pathT || 0) - 1 / 60;
    if (!ai.path || ai.pathT <= 0 || !ai.pathGoal || dist(ai.pathGoal.x, ai.pathGoal.y, tx, ty) > 150){
      ai.path = MAP.findPath(h.x, h.y, tx, ty); ai.pathGoal = {x:tx, y:ty}; ai.pathT = 1.5;
      if (!ai.path){ ai.travelTo = null; ai.exploreAt = null; }
    }
    if (ai.path && ai.path.length){
      while (ai.path.length > 1 && dist(h.x, h.y, ai.path[0].x, ai.path[0].y) < 60) ai.path.shift();
      let k = 0; for (let j = Math.min(ai.path.length - 1, 8); j > 0; j--) if (MAP.lineClear(h.x, h.y, ai.path[j].x, ai.path[j].y)){ k = j; break; }
      tx = ai.path[k].x; ty = ai.path[k].y;
    }
  } else ai.path = null;
  let dx = tx - h.x, dy = ty - h.y; const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
  const avoid = (zx, zy, zr, reach, k0) => {
    const dv = dist(h.x, h.y, zx, zy) || 1, edge = dv - zr;
    if (edge < reach){ const k = (reach - edge) / reach * k0; dx += (h.x - zx) / dv * k; dy += (h.y - zy) / dv * k; }
  };
  for (const v of MAP.smokers) avoid(v.x, v.y, v.r, 170, 2.8);
  /* keep clear of other strands' spikes, unless I am the one attacking */
  const shy = 0.4 + 1.4 * m.traits.caution;
  for (const o of G.players){
    if (o === p || !o.alive || !o._tips.length || (ai.mode === 'hunt' && ai.prey === o)) continue;
    if (Math.abs(o.s.head.x - h.x) > 400 || Math.abs(o.s.head.y - h.y) > 400) continue;
    for (const t of o._tips) avoid(t.x, t.y, 14, 90, shy);
  }
  /* aim at the real distance when close, so the strand slows and lines up instead of circling the target */
  const reach = ai.path ? 220 : clamp(d, 30, 220);
  p.tx = h.x + dx * reach; p.ty = h.y + dy * reach;
}

return {init, makeMind, describe, tick, think, onHit, onDeath, onRespawn, get time(){ return T; }, NAMES, TRAITS};
};
window.SoupBots = makeSoupBots();
window.SoupBots.create = makeSoupBots;
