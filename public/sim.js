/* RNA Strand Soup: the game itself, with no drawing and no page.
   The browser runs one for single-player and draws it; a server room (a Cloudflare Durable Object) runs one
   for everyone in the room and sends each player what is near them.

   const sim = SoupSim.create({MAP, BOTS, stage, minStrands, hooks})
     hooks: say(p, text)  a message for one human player
            fx(e)         a visual effect {x, y, col, r, dur, flash}
            dirty(p)      that player's strand or tail changed
            end(rows)     the round finished: rows = [{p, score}] best first
            tint(col)     the strand colours for a player colour (browser only), or null
   sim.reset(seed) builds a fresh map and bots;  sim.start() begins the round;  sim.step(dt) advances it.
   sim.addHuman(name, col) / sim.removePlayer(p) bring players in and out; bots fill the empty seats.
   Steering: set p.tx, p.ty (a point in the world) before each step. sim.fold(p) / sim.drop(p) are the buttons. */
window.SoupSim = (() => {
'use strict';
const RS = window.RNAStrand, SEG = window.SoupSegments;
const TAU = Math.PI * 2;
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const RECIPES = RS.RECIPES;
const recipeLen = fn => RECIPES[fn].length + 4;
const FN_NAMES = SEG.names;
const BOT_COLS = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9'];

/* the line of science a player gets the first time they reach each kind of place (biomes.js) */
const ZONE_FIRST = Object.fromEntries(Object.entries(window.SoupBiomes.ZONES).filter(([, z]) => z.intro).map(([k, z]) => [k, z.intro]));

function create(opts){
  const MAP = opts.MAP, BOTS = opts.BOTS, stage = opts.stage, W = MAP.W, H = MAP.H, MK = MAP.K;
  const hooks = Object.assign({say(){}, fx(){}, dirty(){}, end(){}, tint(){ return null; }}, opts.hooks || {});
  const ROUND = opts.round || 300, NUC_TARGET = opts.nucTarget || 350, LOBBY_NUCS = 150, MAXLOOSE = 16;
  /* lobby: a practice pool before a room's game (map.js); no bots, hazards, fragments, harm or clock */
  let lobby = false, nucTarget = NUC_TARGET;
  /* fragments drift until a Joiner takes them or a black smoker breaks them up; at most FRAG_MAX + 2 at once */
  const EAT_R = 16, HIT_R = 13, FRAG_MAX = 7, FRAG_EVERY = 25, FRAG_LIFE = Infinity;
  const OPEN_TYPES = MAP.CELLS.map((c, i) => i).filter(i => !MAP.CELLS[i].solid);
  let minStrands = opts.minStrands != null ? opts.minStrands : 10;

  let players = [], nucs = [], frags = [], news = [];
  let timeLeft = ROUND, state = 'idle', seed = 1, spawns = null, nextId = 1;
  let heatT = 0, spawnT = 0, fragT = FRAG_EVERY;

  const working = p => p.s ? p.s.functions.filter(f => !f.damaged) : [];
  const has = (p, fn) => working(p).some(f => f.fn === fn);
  const countFn = (p, fn) => working(p).filter(f => f.fn === fn).length;
  const humans = () => players.filter(p => !p.isBot);
  const tell = (p, text) => { if (p && !p.isBot) hooks.say(p, text); };
  const dirty = p => { if (p && !p.isBot) hooks.dirty(p); };
  const puff = (x, y, col, r) => hooks.fx({x, y, col, r:r || 26, dur:0.5});

  /* ---------- players ---------- */
  function onStrandEvent(p, type, d){
    if (type === 'burst'){
      /* a Cleaver's cut: every letter of the cut structure lands beside the one who cut it, so fighting feeds you */
      const by = p.cutBy;
      if (by && by.alive){ const h = by.s.head; for (const l of d.letters){ const a = rnd(0, TAU), r = rnd(30, 90); spawnNuc(h.x + Math.cos(a) * r, h.y + Math.sin(a) * r, l.b, {x:h.x, y:h.y, r:120}); } return; }
      for (const l of d.letters) if (Math.random() < 0.6) spawnNuc(l.x + rnd(-6, 6), l.y + rnd(-6, 6), l.b); return;
    }
    if (type === 'seq'){ dirty(p); return; }
    if (d && d.text && type !== 'damaged') tell(p, d.text);
  }
  function mkPlayer(name, col, x, y, mind){
    const p = {id:nextId++, name, col, isBot:!!mind, mind, seenZone:{}};
    birth(p, x, y);
    return p;
  }
  /* a fresh strand with one Mover (a new player, or a human carried into the next round) */
  function birth(p, x, y){
    if (p.s) p.s.remove();
    Object.assign(p, {alive:true, dead:0, inv:2, tx:x, ty:y, top:0, jcd:0, fling:null, iceT:0, ai:{t:rnd(0, 0.5), mode:'forage', modeT:0},
      /* this round's tallies, for the results screen */
      stats:{letters:0, folds:0, cuts:0, cutsTaken:0, hits:0, hitsTaken:0, joins:0, deaths:0}});
    p.s = stage.addStrand({seq:'', x, y, heading:rnd(0, TAU), onEvent:(t, d) => onStrandEvent(p, t, d), tint:hooks.tint(p.col, p.isBot)});
    giveMover(p);
  }
  /* every strand starts life with one folded Mover */
  function giveMover(p){ const m = RS.recipeSeq('Mover'); p.s.appendFolded(m, [{fn:'Mover', start:0, end:m.length - 1}]); }
  function addBot(){
    const used = players.filter(p => p.isBot), taken = used.map(p => p.mind.lead), names = players.map(p => p.name);
    const col = BOT_COLS.find(c => !used.some(p => p.col === c)) || pick(BOT_COLS);
    let mind, tries = 0; do { mind = BOTS.makeMind(used.length, taken.slice()); tries++; } while (names.includes(mind.name) && tries < 40);
    const k = used.length, sp = spawns ? spawns.bots[Math.floor(k * spawns.bots.length / Math.max(1, minStrands - 1)) % spawns.bots.length] : {x:W / 2, y:H / 2};
    const p = mkPlayer(mind.name, col, sp.x, sp.y, mind); players.push(p); return p;
  }
  function removePlayer(p){ const i = players.indexOf(p); if (i < 0) return; p.s.remove(); players.splice(i, 1); }
  /* bots fill the seats humans leave empty, and step aside (the one doing worst) when a human arrives */
  function fillBots(){
    if (!spawns) return;
    let bots = players.filter(p => p.isBot);
    while (players.length < minStrands) addBot();
    while (players.length > minStrands && (bots = players.filter(p => p.isBot)).length){
      bots.sort((a, b) => complexity(a) - complexity(b)); removePlayer(bots[0]);
    }
  }
  function addHuman(name, col){
    let x = W / 2, y = H / 2;
    if (spawns){ x = spawns.player.x + rnd(-160, 160); y = spawns.player.y + rnd(-160, 160); }
    const p = mkPlayer(name, col, x, y, null); players.push(p);
    if (spawns){ const o = MAP.solidAt(p.s.head.x, p.s.head.y) && MAP.nearestOf(OPEN_TYPES, p.s.head.x, p.s.head.y, 800); if (o) p.s.place(o.x, o.y); fillBots(); }
    return p;
  }
  function leave(p){ removePlayer(p); fillBots(); }

  /* ---------- actions ---------- */
  /* fold the loose tail: recipes where they match, junk for the rest */
  function fold(p){
    if (!p.alive || !p.s.tail) return false;
    /* players may fold a recipe with one wrong letter; bots fold only exact ones */
    const made = p.s.foldTail(p.isBot);
    p.stats.folds += made.filter(g => g.fn).length;
    const t = p.s.nodes[p.s.nodes.length - 1]; if (t) puff(t.x, t.y, p.col, 30);
    if (!p.isBot){
      dirty(p);
      const fns = made.filter(g => g.fn).map(g => { const n = SEG.strengthNote(g); return n ? `${g.fn} (${n})` : g.fn; }), junk = made.filter(g => !g.fn).reduce((n, g) => n + g.end - g.start + 1, 0);
      tell(p, fns.length ? `Folded: ${fns.join(', ')}.` + (junk ? ` ${plural(junk, 'letter')} matched no recipe and folded into junk.` : '') : `Folded junk: no recipe in that tail.`);
    }
    return true;
  }
  function drop(p){
    if (!p.alive) return;
    const t = p.s.nodes[p.s.nodes.length - 1], b = p.s.dropLast();
    if (!b) return;
    if (t) nucs.push({id:nucId++, x:clamp(t.x, 15, W - 15), y:clamp(t.y, 15, H - 15), b, vx:rnd(-14, 14), vy:rnd(-14, 14)});
    dirty(p);
  }
  let nucId = 1;
  function spawnNuc(x, y, b, home){
    if (x == null){ const sp = MAP.spawnSpot(); if (!sp) return; x = sp.x; y = sp.y; b = sp.b; home = sp.home; }
    nucs.push({id:nucId++, x:clamp(x, 15, W - 15), y:clamp(y, 15, H - 15), b:b || soupLetter(), vx:rnd(-5, 5), vy:rnd(-5, 5), home:home || null});
  }
  /* the soup's mix: plenty of A for loops and spacers, G and C for strong stems, fewer U */
  function soupLetter(){ const r = Math.random(); return r < 0.34 ? 'A' : r < 0.5 ? 'U' : r < 0.75 ? 'G' : 'C'; }
  let fragId = 1;
  function mkFrag(seq, segments, x, y, heading, owner){
    if (!seq) return null;
    /* full: the oldest fragment breaks up into letters to make room */
    if (frags.length >= FRAG_MAX + 2){ const old = frags.reduce((a, b) => a.age > b.age ? a : b); burstFrag(old); }
    const s = stage.addStrand({seq, segments, x, y, heading, tint:hooks.tint('muted', true)});
    s.setOpacity(0.7);
    const f = {id:fragId++, s, age:0, life:FRAG_LIFE, turn:rnd(-0.4, 0.4), owner, prev:{x, y}};
    frags.push(f); return f;
  }
  function spawnFrag(at){
    let x, y, tries = 0;
    if (at){ x = at.x; y = at.y; }   /* a chosen spot (dev mode) */
    else do { x = rnd(400, W - 400); y = rnd(400, H - 400); tries++; }
    while (tries < 200 && (![MK.OCEAN, MK.LAGOON, MK.UV].includes(MAP.typeAt(x, y)) || MAP.smokerAt(x, y, 300) || humans().some(h => dist(x, y, h.s.head.x, h.s.head.y) < 500)));
    const fns = [pick(['Mover', 'Cleaver', 'Membrane', 'Mover'])]; if (Math.random() < 0.5) fns.push(pick(['Mover', 'Cleaver', 'Membrane', 'Detector']));
    let seq = '', segments = [];
    for (const fn of fns){ const add = RS.recipeSeq(fn); segments.push({fn, start:seq.length, end:seq.length + add.length - 1}); seq += add; }
    mkFrag(seq, segments, x, y, rnd(0, TAU), null);
  }
  function removeFrag(f){ f.s.remove(); const i = frags.indexOf(f); if (i >= 0) frags.splice(i, 1); }

  function reset(newSeed, opt){
    lobby = !!(opt && opt.lobby); nucTarget = lobby ? LOBBY_NUCS : NUC_TARGET;
    const keep = humans();
    for (const p of players) if (p.isBot) p.s.remove();
    for (const f of frags.slice()) removeFrag(f);
    players = [];
    seed = newSeed != null ? newSeed : Math.floor(Math.random() * 1e9);
    spawns = MAP.generate(seed, lobby ? {lobby:true} : undefined);
    news = []; nucs = [];
    /* humans carry over between rounds as fresh strands, keeping who they are */
    for (const p of keep){ birth(p, spawns.player.x + rnd(-160, 160), spawns.player.y + rnd(-160, 160)); p.seenZone = {}; players.push(p); }
    fillBots();
    for (let i = 0; i < nucTarget; i++) spawnNuc();
    if (!lobby) for (let i = 0; i < 4; i++) spawnFrag();
    timeLeft = ROUND; state = 'ready'; fragT = FRAG_EVERY; heatT = 0; spawnT = 0;
  }
  function start(){ if (state === 'ready') state = 'play'; }

  /* ---------- movement ---------- */
  function swim(p, dt){
    const L = p.s.length, h = p.s.head, prev = {x:h.x, y:h.y};
    if (p.fling){
      /* a geyser threw you: you fly over rock and land in another pool */
      p.fling.t -= dt; p.s.move(p.fling.vx * dt, p.fling.vy * dt); p.s.step(dt, {turn:0, speed:0});
      if (p.fling.t <= 0){ if (MAP.solidAt(h.x, h.y)) p.s.setHead(p.fling.to.x, p.fling.to.y); p.fling = null; }
      return;
    }
    /* the strand swims at full effort everywhere; thick terrain (clay, brine, drained flats) is drag on how far it gets */
    const sw = SEG.swimOf(working(p));   /* Movers, or anything else with a swim bonus */
    const sp = 170 * (1 + sw.speed) / (1 + 0.003 * L) * (p.isBot ? 0.85 : 1), drag = MAP.speedAt(h.x, h.y);
    p.top = sp * drag;
    p.s.cruise(dt, {x:p.tx, y:p.ty}, p.isBot
      ? {speed:sp, drag, turnCap:2.6 + sw.turnBot, gain:2.5, ease:4, minSpeed:0.55, slowWithin:90 * Math.max(0.5, drag), phase:p.id}
      : {speed:sp, drag, turnCap:3 + sw.turn, hold:16});
    const fl = MAP.flowAt(h.x, h.y);
    if (fl.x || fl.y){ const k = 1 / (1 + 0.003 * L); p.s.move(fl.x * k * dt, fl.y * k * dt); }
    collide(p.s, prev);
  }
  /* walls: slide along them, or stop if there is nowhere to slide */
  function collide(s, prev){
    const h = s.head;
    const x = clamp(h.x, 20, W - 20), y = clamp(h.y, 20, H - 20);
    if (x !== h.x || y !== h.y) s.setHead(x, y);
    if (!MAP.solidAt(h.x, h.y)) return false;
    /* already inside a wall (spawned there, or the ice froze around it): pop out to the nearest open water */
    if (MAP.solidAt(prev.x, prev.y)){
      const o = MAP.nearestOf(OPEN_TYPES, h.x, h.y, 1500);
      if (o){ s.setHead(o.x, o.y); return true; }
    }
    if (!MAP.solidAt(h.x, prev.y)) s.setHead(h.x, prev.y, Math.atan2(0, h.x - prev.x || 1e-6));
    else if (!MAP.solidAt(prev.x, h.y)) s.setHead(prev.x, h.y, Math.atan2(h.y - prev.y || 1e-6, 0));
    else s.setHead(prev.x, prev.y, s.heading + Math.PI * 0.5);
    return true;
  }

  /* ---------- harm ---------- */
  function die(p){
    for (const n of p.s.nodes) if (Math.random() < 0.5) spawnNuc(n.x + rnd(-8, 8), n.y + rnd(-8, 8), 'AUGC'[Math.floor(Math.random() * 4)]);
    BOTS.onDeath(p); p.stats.deaths++;
    const h = p.s.head; puff(h.x, h.y, 'warn', 60);
    p.s.clear(); p.s.setOpacity(0);
    p.alive = false; p.dead = 2.5;
    dirty(p); tell(p, p.deathBy || 'Your core was destroyed and your strand fell apart into letters.');
  }
  function respawn(p){
    let x, y, tries = 0;
    do { x = rnd(400, W - 400); y = rnd(400, H - 400); tries++; } while (tries < 200 && (MAP.typeAt(x, y) !== MK.LAGOON && MAP.typeAt(x, y) !== MK.OCEAN || MAP.smokerAt(x, y, 400)));
    p.s.place(x, y, rnd(0, TAU)); giveMover(p); p.s.setOpacity(1); p.fling = null; p.ai.path = null;
    p.alive = true; p.inv = 2.5; p.tx = x; p.ty = y;
    if (p.isBot) BOTS.onRespawn(p);
    dirty(p); tell(p, 'A new core formed with a single Mover. Start again from there.');
  }
  /* a working shield (a Membrane) next to the struck function takes the hit instead */
  const isShield = fn => { const s = SEG.get(fn); return !!(s && s.shield); };
  /* a weak shield sometimes lets a hit through (only weak ones draw a random number) */
  const shieldHolds = sh => !sh || SEG.strength(sh) >= 1 || Math.random() < SEG.strength(sh);
  function shieldFor(p, st){
    if (!st || isShield(st.fn)) return null;
    const fl = p.s.functions, k = fl.findIndex(f => f.start === st.start);
    if (k < 0) return null;
    return [fl[k - 1], fl[k + 1]].find(f => f && isShield(f.fn) && !f.damaged) || null;
  }
  function strike(b, j, by, oneHit){
    const st = b.s.structureAt(j);
    if (!st){
      /* a loose letter: everything from it to the tail is knocked off and scatters */
      if (j < b.s.length - b.s.tail.length) return false;
      BOTS.onHit(b, by, false);
      b.s.shedFrom(j); b.inv = 1;
      dirty(b); tell(b, `${by.name}'s Cleaver knocked loose letters off your tail.`);
      return true;
    }
    let sh = shieldFor(b, st); if (!shieldHolds(sh)) sh = null;
    const tgt = sh ? {fn:sh.fn, start:sh.start, damaged:false} : st;
    const name = tgt.fn || 'junk arm';
    const n = b.s.nodes[j];
    if (tgt.damaged || (oneHit && !sh)){
      BOTS.onHit(b, by, true);
      by.stats.cuts++; b.stats.cutsTaken++;
      b.cutBy = by; const res = b.s.cutAt(tgt.start); b.cutBy = null;
      b.inv = 2.5;
      if (n) puff(n.x, n.y, 'warn', 40);
      if (res && res.tail && res.tailNodes.length){ const p0 = res.tailNodes[0], p1 = res.tailNodes[1] || p0; mkFrag(res.tail, res.tailSegs, p0.x, p0.y, Math.atan2(p0.y - p1.y, p0.x - p1.x), b.id); }
      const lost = res && res.tail ? res.tail.length : 0;
      dirty(b); tell(b, `${by.name} cut you at your ${name}.${lost ? ` ${lost} letters behind it floated free as a fragment. A Joiner on your tail can take them back.` : ''}`);
      tell(by, `You cut ${b.name}'s ${name}.${lost ? ' What was behind it floated free.' : ''}`);
      return true;
    }
    BOTS.onHit(b, by, false);
    by.stats.hits++; b.stats.hitsTaken++;
    b.s.damageAt(tgt.start); b.inv = 1.2;
    if (n) puff(n.x, n.y, 'warn', 22);
    dirty(b); tell(b, sh ? `Your ${sh.fn} took ${by.name}'s hit for your ${st.fn || 'arm'}.` : `${by.name} damaged your ${name}. It stops working until a Repairer mends it. Another hit cuts it off.`);
    tell(by, `You damaged ${b.name}'s ${name}. Hit it again to cut.`);
    return true;
  }

  /* ---------- the step ---------- */
  function step(dt){
    /* letters drift on the currents, stay near where they formed, bounce off walls, and boil away in smokers */
    for (let i = nucs.length - 1; i >= 0; i--){
      const q = nucs[i], fl = MAP.flowAt(q.x, q.y), ox = q.x, oy = q.y;
      q.x += (q.vx + fl.x * 0.5) * dt; q.y += (q.vy + fl.y * 0.5) * dt;
      q.vx *= 1 - 0.3 * dt; q.vy *= 1 - 0.3 * dt;
      if (q.home){ const hd = dist(q.x, q.y, q.home.x, q.home.y); if (hd > q.home.r){ q.vx += (q.home.x - q.x) / hd * 10 * dt; q.vy += (q.home.y - q.y) / hd * 10 * dt; } }
      if (Math.abs(q.vx) + Math.abs(q.vy) < 3){ q.vx = rnd(-5, 5); q.vy = rnd(-5, 5); }
      if (MAP.solidAt(q.x, q.y)){ q.x = ox; q.y = oy; q.vx = -q.vx; q.vy = -q.vy; }
      if (q.x < 12 || q.x > W - 12 || q.y < 12 || q.y > H - 12 || MAP.smokerAt(q.x, q.y)) nucs.splice(i, 1);
    }
    MAP.update(dt, mapEv, players.filter(p => p.alive).map(p => p.s.head));
    spawnT += dt; while (spawnT > 0.12){ spawnT -= 0.12; if (nucs.length < nucTarget) spawnNuc(); }
    for (const f of frags.slice()) stepFrag(f, dt);
    if (state !== 'play'){ for (const p of players) if (p.alive) p.s.step(dt, {target:p.s.head, speed:0}); return; }

    if (!lobby) timeLeft -= dt;
    BOTS.tick(dt);
    if (timeLeft <= 0){ timeLeft = 0; endRound(); return; }

    for (const p of players){
      if (!p.alive){ p.dead -= dt; if (p.dead <= 0) respawn(p); continue; }
      if (p.inv > 0) p.inv -= dt;
      if (p.jcd > 0) p.jcd -= dt;
      if (p.isBot) BOTS.think(p, dt);
      swim(p, dt);
      const h = p.s.head;
      /* some ground (clay) grabs letters: you can pick them up from further away */
      const reach = EAT_R * (MAP.cellAt(h.x, h.y).reach || 1);
      if (p.s.tail.length < MAXLOOSE && p.s.length < RS.MAXLEN && !p.fling){
        for (let i = nucs.length - 1; i >= 0; i--){
          const q = nucs[i];
          if (dist(h.x, h.y, q.x, q.y) < reach){
            p.s.append(q.b); nucs.splice(i, 1); dirty(p); p.stats.letters++;
            if (p.s.tail.length >= MAXLOOSE) tell(p, 'Your loose tail is full. Fold it or drop letters.');
            break;
          }
        }
      }
      if (p.inv <= 0 && !p.fling && MAP.smokerAt(h.x, h.y)){ p.deathBy = 'A black smoker shredded your core, and your strand fell apart into letters.'; die(p); continue; }
      /* the first time a human reaches each kind of place, a line of science about it */
      if (!p.isBot && !lobby){
        const z = MAP.zoneAt(h.x, h.y);
        if (ZONE_FIRST[z] && !p.seenZone[z]){ p.seenZone[z] = true; tell(p, ZONE_FIRST[z]); }
      }
    }

    /* Cleavers (anything with tips): each tip damages what it touches; damaged structures, or anything in magnesium, get cut.
       Not in the lobby: it is for practice */
    if (!lobby) for (const a of players){
      if (!a.alive) continue;
      for (const f of working(a)){
        const seg = SEG.get(f.fn); if (!seg || !seg.tips) continue;
        const R = HIT_R * SEG.strength(f);   /* a stronger Cleaver reaches further, a weak one has to touch closer */
        for (const tip of seg.tips(f)){
          const na = a.s.nodes[tip]; if (!na) continue;
          const oneHit = MAP.saltAt(na.x, na.y);
          for (const b of players){
            if (b === a || !b.alive || b.inv > 0) continue;
            const nb = b.s.nodes;
            for (let j = 0; j < nb.length; j++){
              if (Math.abs(nb[j].x - na.x) > R || Math.abs(nb[j].y - na.y) > R) continue;
              if (dist(na.x, na.y, nb[j].x, nb[j].y) > R) continue;
              if (strike(b, j, a, oneHit)) break;
            }
          }
        }
      }
    }
    /* Joiners (jaws): an armed Joiner on the tail takes in a fragment the tail touches */
    for (const p of players){
      if (!p.alive || p.jcd > 0 || !frags.length) continue;
      const jaws = working(p).find(f => f.jstate === 'armed'); if (!jaws) continue;
      const t = p.s.nodes[p.s.nodes.length - 1]; if (!t) continue;
      const reach = 30 * SEG.strength(jaws), f = frags.find(fr => fr.s.nodes.some(n => dist(t.x, t.y, n.x, n.y) < reach));
      if (!f) continue;
      /* loose letters at the front of the fragment fall away so the Joiner can close right around its first structure */
      const sg = f.s.segments.filter(g => g.fn), k0 = sg.length ? sg[0].start : f.s.length;
      const add = f.s.seq.slice(k0), addSegs = f.s.segments.filter(g => g.start >= k0).map(g => ({fn:g.fn, start:g.start - k0, end:g.end - k0}));
      for (let k = 0; k < k0 && k < f.s.length; k++){ const n = f.s.nodes[k]; if (n && Math.random() < 0.6) spawnNuc(n.x, n.y, f.s.seq[k]); }
      removeFrag(f);
      if (!add) continue;
      /* loose letters behind the Joiner fall away, so what it grabs attaches right behind it */
      const loose = p.s.tail.length; if (loose) p.s.shedFrom(p.s.length - loose);
      p.s.appendFolded(add, addSegs); p.jcd = 4; p.stats.joins++;
      puff(t.x, t.y, p.col, 34);
      if (!p.isBot){
        dirty(p);
        const fused = p.s.functions.find(u => u.jstate === 'fused');
        tell(p, `Your ${jaws.fn} took in a fragment of ${add.length} letters.` + (fused ? ' It fused around what it grabbed: +1.' : ''));
      }
    }
    /* smoker heat, salt pools and ice veins, twice a second */
    heatT += dt;
    if (heatT > 0.5){
      heatT = 0;
      for (const p of players){
        if (!p.alive) continue;
        const nn = p.s.nodes;
        if (p.inv <= 0) for (let j = 0; j < nn.length; j += 2){
          if (!MAP.smokerAt(nn[j].x, nn[j].y, 60)) continue;
          const st = p.s.structureAt(j);
          if (st && !st.damaged){ p.s.damageAt(j); puff(nn[j].x, nn[j].y, 'warn', 20); dirty(p); tell(p, `Heat from a black smoker damaged your ${st.fn || 'arm'}.`); break; }
        }
        for (const f of working(p)){
          const seg = SEG.get(f.fn), sb = seg && seg.saltBreaks; if (!sb) continue;
          const n = nn[Math.round((f.start + f.end) / 2)];
          if (!n || !MAP.saltAt(n.x, n.y) || Math.random() > sb / SEG.strength(f)) continue;
          p.s.damageAt(f.start); puff(n.x, n.y, 'mg', 24);
          dirty(p); tell(p, `The magnesium in this drying pool dissolved your ${f.fn}. A Repairer, or time in the ice veins, can mend it.`);
        }
        /* the cold slows breakdown: in an ice vein (any ground that mends), damage mends one structure at a time */
        const mends = MAP.cellAt(p.s.head.x, p.s.head.y).mends;
        if (mends){
          p.iceT = (p.iceT || 0) + 0.5;
          if (p.iceT >= mends){
            const d = p.s.functions.find(f => f.damaged);
            if (d){ p.iceT = 0; p.s.mendAt(d.start); dirty(p); tell(p, `The cold of the ice vein let your ${d.fn} mend.`); }
          }
        } else p.iceT = 0;
      }
    }
    /* fragments keep drifting in */
    fragT -= dt;
    if (fragT <= 0){ fragT = FRAG_EVERY; if (frags.length < 4 && !lobby) spawnFrag(); }
  }
  function stepFrag(f, dt){
    f.age += dt;
    f.turn += rnd(-0.6, 0.6) * dt; f.turn = clamp(f.turn, -0.5, 0.5);
    const h = f.s.head, prev = {x:h.x, y:h.y};
    f.s.step(dt, {turn:f.turn, speed:14});
    const fl = MAP.flowAt(h.x, h.y);
    if (fl.x || fl.y) f.s.move(fl.x * 0.7 * dt, fl.y * 0.7 * dt);
    if (collide(f.s, prev)) f.turn = rnd(-1.2, 1.2);
    if (f.age > f.life || MAP.smokerAt(h.x, h.y)) burstFrag(f);
  }
  /* a fragment breaks up: about half its letters land loose in the soup */
  function burstFrag(f){
    f.s.nodes.forEach((n, k) => { if (Math.random() < 0.5) spawnNuc(n.x + rnd(-10, 10), n.y + rnd(-10, 10), f.s.seq[k]); });
    removeFrag(f);
  }

  /* ---------- map events ---------- */
  /* a UV flash: damages exposed functions, rewrites loose letters, and makes new C and U */
  function uvFlash(r){
    hooks.fx({x:r.x, y:r.y, col:'sun', r:r.r, dur:0.6, flash:true});
    for (const q of nucs) if (dist(q.x, q.y, r.x, r.y) < r.r && Math.random() < 0.5) q.b = pick(RS.BASES.filter(b => b !== q.b));
    /* a few new C and U, but not past the soup's usual number of letters (flashes used to flood the shallows) */
    for (let k = 0; k < 3 && nucs.length < nucTarget + 30; k++){ const a = rnd(0, TAU), d = rnd(0, r.r * 0.8); spawnNuc(r.x + Math.cos(a) * d, r.y + Math.sin(a) * d, Math.random() < 0.5 ? 'C' : 'U', {x:r.x, y:r.y, r:r.r}); }
    for (const p of players){
      if (!p.alive) continue;
      const hit = [], changed = [];
      for (const f of p.s.functions){
        const n = p.s.nodes[Math.round((f.start + f.end) / 2)];
        if (!n || f.damaged || dist(n.x, n.y, r.x, r.y) > r.r || MAP.shelterAt(n.x, n.y) || Math.random() > 0.55) continue;
        { const sh = shieldFor(p, f); if (sh && shieldHolds(sh)) continue; }
        p.s.damageAt(f.start); hit.push(f.fn);
      }
      const from = p.s.length - p.s.tail.length;
      for (let i = from; i < p.s.length; i++){
        const n = p.s.nodes[i]; if (!n || dist(n.x, n.y, r.x, r.y) > r.r || MAP.shelterAt(n.x, n.y) || Math.random() > 0.5) continue;
        const old = p.s.seq[i], nb = pick(RS.BASES.filter(b => b !== old)); if (p.s.setLetter(i, nb)) changed.push(`${old} became ${nb}`);
      }
      if (hit.length || changed.length){ dirty(p); tell(p, 'UV flash: ' + [hit.length ? `damaged your ${hit.join(', ')}` : '', changed.length ? `loose ${changed.slice(0, 3).join(', ')}` : ''].filter(Boolean).join('; ') + '.'); }
    }
  }
  /* a meteorite: destroys cores near the middle, damages and scatters around it, then fills the crater with A and G */
  function impact(m){
    hooks.fx({x:m.x, y:m.y, col:'warn', r:m.r * 1.2, dur:0.9, flash:true});
    for (let i = nucs.length - 1; i >= 0; i--) if (dist(nucs[i].x, nucs[i].y, m.x, m.y) < m.r * 0.7) nucs.splice(i, 1);
    for (const p of players){
      if (!p.alive) continue;
      const h = p.s.head;
      if (dist(h.x, h.y, m.x, m.y) < m.r * 0.45 && !MAP.shelterAt(h.x, h.y) && p.inv <= 0){ p.deathBy = 'A meteorite struck right on top of you. Your strand fell apart into letters.'; die(p); continue; }
      const hit = [];
      for (const f of p.s.functions){
        const n = p.s.nodes[Math.round((f.start + f.end) / 2)];
        if (!n || f.damaged || dist(n.x, n.y, m.x, m.y) > m.r || MAP.shelterAt(n.x, n.y) || Math.random() > 0.7) continue;
        p.s.damageAt(f.start); hit.push(f.fn);
      }
      const from = p.s.length - p.s.tail.length;
      for (let i = from; i < p.s.length; i++){ const n = p.s.nodes[i]; if (n && dist(n.x, n.y, m.x, m.y) < m.r){ p.s.shedFrom(i); break; } }
      if (hit.length){ dirty(p); tell(p, `A meteorite struck nearby and damaged your ${hit.join(', ')}.`); }
      if (!p.isBot && !p.seenZone.crater && dist(h.x, h.y, m.x, m.y) < 1400){ p.seenZone.crater = true; tell(p, ZONE_FIRST.crater); }
    }
    for (let k = 0; k < 34; k++){ const a = rnd(0, TAU), d = Math.sqrt(Math.random()) * 140; spawnNuc(m.x + Math.cos(a) * d, m.y + Math.sin(a) * d, Math.random() < 0.5 ? 'A' : 'G', {x:m.x, y:m.y, r:150}); }
  }
  /* a geyser bursts: anything sitting on it is thrown toward another hot spring pool */
  function geyserBurst(g, to){
    hooks.fx({x:g.x, y:g.y, col:'flow', r:g.r * 1.6, dur:0.7});
    for (const p of players){
      if (!p.alive || p.fling) continue;
      const h = p.s.head; if (dist(h.x, h.y, g.x, g.y) > g.r) continue;
      let dest = to; if (dist(to.x, to.y, g.x, g.y) < 50){ dest = MAP.springs[(MAP.springs.indexOf(to) + 1) % MAP.springs.length]; }
      p.fling = {vx:(dest.x - h.x) / 0.8, vy:(dest.y - h.y) / 0.8, t:0.8, to:dest};
      tell(p, 'A geyser burst under you and threw you to another pool.');
    }
  }
  const mapEv = {uv:uvFlash, meteor:impact, geyser:geyserBurst};

  function complexity(p){
    const seen = {}; let score = 0;
    for (const f of working(p)){ score += seen[f.fn] ? 1 : 3; seen[f.fn] = true; score += f.bonus || 0; if (SEG.strength(f) > 1) score += 1; }
    return score;
  }
  function standings(){ return players.map(p => ({p, score:complexity(p)})).sort((a, b) => b.score - a.score); }
  function endRound(){ state = 'over'; hooks.end(standings()); }

  BOTS.init({MAP, RS, working, has, countFn, complexity, doFold:fold, doDrop:drop, recipeLen, shieldFor, MAXLOOSE,
    get players(){ return players; }, get nucs(){ return nucs; }, get frags(){ return frags; }, get news(){ return news; }, get timeLeft(){ return timeLeft; }});

  return {MAP, BOTS, stage, W, H, ROUND, MAXLOOSE, ZONE_FIRST, FN_NAMES,
    reset, start, step, addHuman, leave, fold, drop, spawnFrag, strike, uvFlash, impact, geyserBurst, complexity, standings,
    working, has, countFn, shieldFor, recipeLen,
    setMinStrands(n){ minStrands = n; fillBots(); },
    get players(){ return players; }, get nucs(){ return nucs; }, get frags(){ return frags; }, get news(){ return news; },
    get lobby(){ return lobby; }, get timeLeft(){ return timeLeft; }, set timeLeft(v){ timeLeft = v; }, get state(){ return state; }, get seed(){ return seed; }, get mapEv(){ return mapEv; }};
}

return {create, recipeLen, RECIPES, ZONE_FIRST, FN_NAMES, BOT_COLS, SEG};
})();
