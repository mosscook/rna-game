/* =====================================================================
   Biomes: the kinds of ground, the named places players see, and the regions that build the map.
   map.js, sim.js, bots.js and the page all read this file. To add a biome:
     1. add its ground types to CELLS (or reuse existing ones),
     2. add the place name and its line of science to ZONES,
     3. add a region to REGIONS that paints it onto the map.
   Moving hazards (the tide, geysers, shifting ice, meteorites, UV flashes, rafts) still live in map.js.

   CELLS: one entry per ground type. Its position in the list is the number stored in the map grid,
   so add new types at the end.
     key        name in code (MAP.K.LAGOON)
     solid      a wall: nothing swims through it
     speed      how far a strand gets at full effort (1 = open water)
     spawn      how many letters gather per cell, relative to the rest of the map
     mix        which letters: a key of MIX
     lowTideSpawn  multiplies spawn at low tide
     color      ground colour; walls also have an edge colour
     layer      drawing order among water (or among walls): higher draws on top
     texture    optional: draws the small details in one cell
     mini       optional: shown on the minimap as this type instead
     zone       the ZONES entry a player standing here is in ('' = none)
     shelter    keeps out UV flashes and meteorites
     reach      multiplies how far away a strand grabs letters
     mends      damage mends after this many seconds here (one structure at a time)
   ===================================================================== */
window.SoupBiomes = (() => {
'use strict';
const TAU = Math.PI * 2;

/* letter mixes: plenty of A for loops and spacers, G and C for strong stems, fewer U */
const MIX = {
  soup:{A:0.34, U:0.16, G:0.25, C:0.25}, even:{A:0.25, U:0.25, G:0.25, C:0.25},
  purine:{A:0.38, U:0.12, G:0.38, C:0.12}, pyrimidine:{A:0.12, U:0.38, G:0.12, C:0.38}
};

const CELLS = [
  {key:'DEEP',    solid:false, speed:1,    spawn:0,    mix:'soup', color:'#03060a', zone:'ocean'},
  {key:'OCEAN',   solid:false, speed:1,    spawn:0.04, mix:'soup', color:'#07110f', zone:'ocean'},
  {key:'LAGOON',  solid:false, speed:1,    spawn:0.9,  mix:'soup', color:'#0c2420', layer:4, zone:'lagoon'},
  {key:'FLATS',   solid:false, speed:1,    spawn:0.7,  mix:'soup', color:'#2a2a1f', layer:3, zone:'flats', lowTideSpawn:3, mini:'LAGOON'},
  {key:'RIDGE',   solid:true,  speed:0,    spawn:0,    mix:'soup', color:'#262a28', edge:'#3a3f3a', layer:1, zone:''},
  {key:'CHIMNEY', solid:true,  speed:0,    spawn:0,    mix:'soup', color:'#8f8a7c', edge:'#c8c2b0', layer:4, zone:'',
   texture(g, x, y, h1, h2, cx, cy, hash, CELL){ g.fillStyle = '#4c4a43'; for (let k = 0; k < 3; k++){ g.beginPath(); g.arc(x + hash(cx * 3 + k, cy) * CELL, y + hash(cx, cy * 3 + k) * CELL, 2 + h1 * 4, 0, TAU); g.fill(); } }},
  {key:'PORE',    solid:false, speed:0.85, spawn:0.45, mix:'even', color:'#0e1a1a', layer:6, zone:'pores'},
  {key:'POCKET',  solid:false, speed:0.8,  spawn:5,    mix:'even', color:'#15271f', layer:7, zone:'pocket', shelter:true,
   texture(g, x, y, h1, h2, cx, cy, hash, CELL){ if (h1 < 0.5){ g.fillStyle = 'rgba(160,220,170,.12)'; g.beginPath(); g.arc(x + h2 * CELL, y + h1 * CELL * 2, 6, 0, TAU); g.fill(); } }},
  {key:'ROCK',    solid:true,  speed:0,    spawn:0,    mix:'soup', color:'#121215', edge:'#34343c', layer:2, zone:'',
   texture(g, x, y, h1, h2, cx, cy, hash, CELL){ if (h1 < 0.3){ g.fillStyle = '#22222a'; g.beginPath(); g.arc(x + h2 * CELL, y + h1 * CELL * 3, 3 + h2 * 5, 0, TAU); g.fill(); } }},
  {key:'SPRING',  solid:false, speed:0.9,  spawn:1.6,  mix:'purine', color:'#0f3034', layer:5, zone:'spring'},
  {key:'CLAY',    solid:false, speed:0.45, spawn:1.6,  mix:'soup', color:'#3b2e22', layer:2, zone:'clay', reach:1.8,
   texture(g, x, y, h1, h2, cx, cy, hash, CELL){ g.fillStyle = 'rgba(120,95,70,.5)'; g.fillRect(x + h1 * CELL, y + h2 * CELL, 2, 2); g.fillRect(x + h2 * CELL, y + h1 * CELL, 1.5, 1.5); }},
  {key:'UV',      solid:false, speed:1,    spawn:2.2,  mix:'pyrimidine', color:'#22385a', layer:1, zone:'uv',
   texture(g, x, y, h1, h2, cx, cy, hash, CELL){ if (h1 < 0.25){ g.fillStyle = 'rgba(190,210,255,.18)'; g.fillRect(x + h2 * CELL, y + h1 * CELL * 4 % CELL, 10, 1.5); } }},
  {key:'ICE',     solid:true,  speed:0,    spawn:0,    mix:'soup', color:'#8cbad0', edge:'#cdeaf7', layer:3, zone:'',
   texture(g, x, y, h1, h2, cx, cy, hash, CELL){ if (h1 < 0.35){ g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(x + h1 * CELL, y + h2 * CELL); g.lineTo(x + h2 * CELL, y + CELL * (1 - h1)); g.stroke(); } }},
  {key:'BRINE',   solid:false, speed:0.5,  spawn:1.1,  mix:'even', color:'#0c2431', layer:8, zone:'ice', shelter:true, mends:6}
];
const K = Object.fromEntries(CELLS.map((c, i) => [c.key, i]));

/* places a player can be in: the name shown on screen, and the line of science the first time they arrive.
   Some depend on the moment rather than the ground (map.js zoneAt): salt (a lagoon pool drying at low tide),
   stranded (the flats at low tide), smoker, raft and crater. */
const ZONES = {
  lagoon:{label:'Tide-pool lagoon',
    intro:'The tide-pool lagoon. Giant tides flood these pools and leave them to dry. Each cycle concentrates nucleotides, and drying helps them link. Watch the tide: drained flats strand you, but their edges fill with letters.'},
  flats:{label:'Tidal flats: flooded'},
  stranded:{label:'Tidal flats: drained, you are stranded',
    intro:'The tide is out and you are stranded on the flats. Drying concentrates nucleotides here, but you can barely move until the water returns.'},
  salt:{label:'Drying salt pool: magnesium. Cleavers cut in one hit, Membranes dissolve',
    intro:'This pool is drying out and its salts are concentrating: magnesium. Ribozymes need magnesium to fold, so Cleavers cut in one hit here, but it breaks Membranes apart.'},
  pores:{label:'White chimney pores: warm and narrow',
    intro:'White chimneys: towers of carbonate riddled with tiny pores. Warm water seeps through and pushes molecules into dead-end pockets where they pile up.'},
  pocket:{label:'Nursery pocket: safe from UV and meteorites, rich in letters',
    intro:'A nursery pocket. Molecules collect in dead ends like this, out of reach of UV and meteorites. A real hypothesis for where RNA could build up.'},
  smoker:{label:'Black smoker: scalding',
    intro:'Black smokers: acidic jets of black mineral smoke at over 350 °C. They shred RNA. Touching one destroys your core.'},
  spring:{label:'Hot spring terrace: rich in A and G',
    intro:'Volcanic hot springs. Steaming pools step down the slope, and wet–dry cycles on their rims may be the best way to grow long strands. Purines (A and G) are common here. Watch for geysers.'},
  clay:{label:'Clay flats: slow, but you grab letters from further away',
    intro:'Clay flats. Clay surfaces grab nucleotides and help link them, and lab experiments grew chains of about 50 this way. You swim slowly, but you grab letters from further away.'},
  uv:{label:'UV shallows: rich in C and U, and UV flashes damage you',
    intro:'UV shallows. With no ozone layer, UV light plus simple chemicals in shallow water built nucleotides, especially C and U. The same UV damages RNA: watch for flashes.'},
  ice:{label:'Ice vein: slow and safe, damage slowly mends',
    intro:'Ice veins. Freezing squeezes molecules into thin, concentrated brine channels, and the cold slows breakdown. RNA enzymes still work in ice. Slow and safe: damage slowly mends here.'},
  raft:{label:'Inside a pumice raft: sheltered',
    intro:'A pumice raft: foamy volcanic rock drifting on the currents. Inside it you are sheltered from UV and meteorites.'},
  crater:{label:'Fresh crater: rich in A and G',
    intro:'A fresh meteorite crater. Meteorites carried nucleobases, ribose and phosphorus, and the crater stays warm. Grab the letters before the others do.'},
  ocean:{label:'Open ocean: almost no letters',
    intro:'The open ocean. Water here is too dilute for chemistry to get going: a desert. Head back toward the lagoon, the chimneys or the island.'}
};

/* where bots look for each letter, best first */
const LETTER_HOMES = {A:['SPRING', 'POCKET', 'LAGOON'], G:['SPRING', 'POCKET', 'LAGOON'], C:['UV', 'POCKET', 'FLATS'], U:['UV', 'POCKET', 'FLATS']};

/* REGIONS build the map, in this order (the order matters: the same seed must always make the same map).
   build(B) paints ground types and adds features. B has the map size (W, H, CELL), K, the seeded random
   numbers (rng, rr, fbm noise), painting tools (each, setC, blob, carveLine, typeAtCell), the feature lists
   (pools, springs, flows, geysers, smokers, rafts, labels), and B.lagoon once the lagoon is built.
   A region with cells and botHome can be a bot's home: botHome(traits) is how much a bot with those traits likes it. */
const REGIONS = [
  {id:'edge', /* the open ocean darkens toward the edges */
   build(B){
    const {W, H, CELL, K, TAU, each, setC, blob, carveLine, typeAtCell, rr, rng, fbm, pools, springs, flows, geysers, smokers, rafts, labels:LABELS} = B;
    /* the open ocean darkens toward the edges: a desert of dilute water */
    each((cx, cy, x, y) => { const e = Math.min(x, y, W - x, H - y); if (e < 420 + 160 * fbm(x / 400, y / 400)) setC(cx, cy, K.DEEP); });
   }},

  {id:'lagoon',
   cells:['LAGOON', 'FLATS'], botHome:t => 0.5 + t.greed,
   build(B){
    const {W, H, CELL, K, TAU, each, setC, blob, carveLine, typeAtCell, rr, rng, fbm, pools, springs, flows, geysers, smokers, rafts, labels:LABELS} = B;
    /* 1. tide-pool lagoon in the middle */
    const L = {x:W * 0.5, y:H * 0.5, a:1180, b:1380};
    each((cx, cy, x, y) => { const d = Math.hypot((x - L.x) / L.a, (y - L.y) / L.b); if (d < 0.85 + 0.3 * fbm(x / 500, y / 500)) setC(cx, cy, K.FLATS); });
    pools.push({x:L.x, y:L.y, r:300, salt:false});
    for (let tries = 0; pools.length < 10 && tries < 400; tries++){
      const a = rr(0, TAU), d = Math.sqrt(rng()) * 0.78, x = L.x + Math.cos(a) * L.a * d, y = L.y + Math.sin(a) * L.b * d, r = rr(160, 300);
      if (pools.some(p => Math.hypot(p.x - x, p.y - y) < p.r + r + 90)) continue;
      pools.push({x, y, r, salt:false});
    }
    pools.forEach(p => blob(p.x, p.y, p.r, K.LAGOON));
    /* drying pools concentrate salts: these turn into magnesium pools at low tide */
    pools.slice(1).sort(() => rng() - 0.5).slice(0, 3).forEach(p => { p.salt = true; });
    /* low rock ridges wander between the pools */
    each((cx, cy, x, y) => { if (typeAtCell(cx, cy) === K.FLATS && Math.abs(fbm(x / 380 + 40, y / 380) - 0.5) < 0.022 && !pools.some(p => Math.hypot(p.x - x, p.y - y) < p.r + 70)) setC(cx, cy, K.RIDGE); });
    LABELS.push({t:'TIDE-POOL LAGOON', x:L.x, y:L.y - L.b - 40});
    B.lagoon = L;   /* the regions after this one place themselves around the lagoon */
   }},

  {id:'island',
   cells:['SPRING', 'CLAY', 'UV'], botHome:t => 0.3 + t.curiosity + t.greed * 0.3,
   build(B){
    const {W, H, CELL, K, TAU, each, setC, blob, carveLine, typeAtCell, rr, rng, fbm, pools, springs, flows, geysers, smokers, rafts, labels:LABELS} = B;
    const L = B.lagoon;
    /* 2. volcanic island to the east */
    const I = {x:W * 0.82, y:H * 0.5, a:960, b:1500};
    const inIsland = (x, y) => Math.hypot((x - I.x) / I.a, (y - I.y) / I.b) < 0.88 + 0.26 * fbm(x / 420 + 9, y / 420);
    /* UV shallows ring the island's beaches, clay flats spread from its western foot */
    each((cx, cy, x, y) => {
      const d = Math.hypot((x - I.x) / (I.a + 520), (y - I.y) / (I.b + 520));
      if (typeAtCell(cx, cy) !== K.DEEP && d < 0.95 + 0.2 * fbm(x / 350, y / 350 + 7)) setC(cx, cy, K.UV);
    });
    each((cx, cy, x, y) => { if (x < I.x - I.a * 0.5 && Math.abs(y - I.y) < 850 + 200 * fbm(x / 300, y / 300 + 3) && x > I.x - I.a - 760 && typeAtCell(cx, cy) === K.UV) setC(cx, cy, K.CLAY); });
    each((cx, cy, x, y) => { if (inIsland(x, y)) setC(cx, cy, K.ROCK); });
    /* hot spring terraces step down the slope from the peak toward the west coast, joined by spillways */
    const steps = 7, path = [];
    for (let k = 0; k < steps; k++){
      const f = k / (steps - 1);
      path.push({x:I.x + I.a * 0.55 - f * I.a * 1.25, y:I.y + Math.sin(k * 1.7) * I.b * 0.42 + rr(-80, 80)});
    }
    path.forEach((p, k) => { const s = {x:p.x, y:p.y, r:rr(130, 175), k}; springs.push(s); blob(s.x, s.y, s.r, K.SPRING); });
    for (let k = 0; k + 1 < springs.length; k++){
      const a = springs[k], b = springs[k + 1], m = {x:(a.x + b.x) / 2 + rr(-60, 60), y:(a.y + b.y) / 2 + rr(-60, 60)};
      carveLine([a, m, b], 2, K.SPRING);
      flows.push({pts:[a, m, b], w:110, v:140, kind:'spill'});
    }
    /* the lowest pool spills out across the clay into the lagoon */
    const low = springs[springs.length - 1], out = [{x:low.x, y:low.y}, {x:I.x - I.a - 120, y:low.y * 0.6 + I.y * 0.4}, {x:L.x + L.a * 0.95, y:L.y + rr(-200, 200)}];
    carveLine(out.slice(0, 2), 2, K.SPRING, [K.ROCK]);
    flows.push({pts:out, w:150, v:115, kind:'spill'});
    springs.filter((s, k) => k % 2 === 1).forEach(s => geysers.push({x:s.x, y:s.y, r:85, t:rr(2, 10), phase:'wait'}));
    LABELS.push({t:'HOT SPRINGS', x:I.x, y:I.y - I.b * 0.62}, {t:'CLAY FLATS', x:I.x - I.a - 380, y:I.y + 120}, {t:'UV SHALLOWS', x:I.x, y:I.y + I.b + 330}, {t:'UV SHALLOWS', x:I.x, y:I.y - I.b - 300});
   }},

  {id:'chimneys',
   cells:['PORE', 'POCKET'], botHome:t => 0.3 + t.caution + t.patience * 0.5,
   build(B){
    const {W, H, CELL, K, TAU, each, setC, blob, carveLine, typeAtCell, rr, rng, fbm, pools, springs, flows, geysers, smokers, rafts, labels:LABELS} = B;
    const L = B.lagoon;
    /* 3. white chimneys to the west: a pore maze with nursery pockets, black smokers at its deep edge */
    const MX0 = 500, MY0 = 1800, MC = 5, mw = 9, mh = 15, MX1 = MX0 + mw * MC * CELL, MY1 = MY0 + mh * MC * CELL;
    const c0x = MX0 / CELL, c0y = MY0 / CELL;
    for (let cy = c0y; cy < c0y + mh * MC; cy++) for (let cx = c0x; cx < c0x + mw * MC; cx++) setC(cx, cy, K.CHIMNEY);
    const seen = new Uint8Array(mw * mh), links = [];
    const carveCell = (i, j, t) => { for (let oy = 1; oy < 4; oy++) for (let ox = 1; ox < 4; ox++) setC(c0x + i * MC + ox, c0y + j * MC + oy, t); };
    const carveLink = (i, j, di, dj) => {
      if (di) { const x = c0x + Math.max(i, i + di) * MC; for (let oy = 1; oy < 4; oy++) for (let ox = -1; ox < 1; ox++) setC(x + ox, c0y + j * MC + oy, K.PORE); }
      else { const y = c0y + Math.max(j, j + dj) * MC; for (let ox = 1; ox < 4; ox++) for (let oy = -1; oy < 1; oy++) setC(c0x + i * MC + ox, y + oy, K.PORE); }
    };
    const deg = new Uint8Array(mw * mh), stack = [[Math.floor(mw / 2), Math.floor(mh / 2)]];
    seen[stack[0][1] * mw + stack[0][0]] = 1;
    while (stack.length){
      const [i, j] = stack[stack.length - 1];
      const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([di, dj]) => { const a = i + di, b = j + dj; return a >= 0 && b >= 0 && a < mw && b < mh && !seen[b * mw + a]; });
      if (!nb.length){ stack.pop(); continue; }
      const [di, dj] = nb[Math.floor(rng() * nb.length)];
      links.push([i, j, di, dj]); deg[j * mw + i]++; deg[(j + dj) * mw + i + di]++;
      seen[(j + dj) * mw + i + di] = 1; stack.push([i + di, j + dj]);
    }
    /* a few loops so the maze has more than one way through */
    for (let k = 0; k < 18; k++){ const i = Math.floor(rr(0, mw - 1)), j = Math.floor(rr(0, mh - 1)), h = rng() < 0.5; links.push(h ? [i, j, 1, 0] : [i, j, 0, 1]); deg[j * mw + i]++; deg[(h ? j : j + 1) * mw + (h ? i + 1 : i)]++; }
    for (let j = 0; j < mh; j++) for (let i = 0; i < mw; i++) carveCell(i, j, K.PORE);
    links.forEach(([i, j, di, dj]) => carveLink(i, j, di, dj));
    /* entrances: three on the lagoon side, one north toward the ice, one south */
    const exits = [];
    for (const j of [2, 7, 12]){ const y = c0y + j * MC; for (let ox = 0; ox < 3; ox++) for (let oy = 1; oy < 4; oy++) setC(c0x + mw * MC - 1 + ox, y + oy, K.PORE); exits.push({x:MX1 + 60, y:(y + 2.5) * CELL}); deg[j * mw + mw - 1]++; }
    for (let oy = -2; oy < 1; oy++) for (let ox = 1; ox < 4; ox++){ setC(c0x + 5 * MC + ox, c0y + oy, K.PORE); setC(c0x + 3 * MC + ox, c0y + mh * MC + oy + 1, K.PORE); }
    deg[5]++; deg[(mh - 1) * mw + 3]++;
    /* dead ends become nursery pockets: warm, safe, and full of letters */
    const pockets = [];
    for (let j = 0; j < mh; j++) for (let i = 1; i < mw; i++) if (deg[j * mw + i] === 1){ carveCell(i, j, K.POCKET); pockets.push([i, j]); }
    /* a ragged rim so the chimney field does not look like a box */
    each((cx, cy, x, y) => {
      const inside = x > MX0 && x < MX1 && y > MY0 && y < MY1, near = x > MX0 - 260 && x < MX1 + 200 && y > MY0 - 220 && y < MY1 + 220;
      if (!inside && near && typeAtCell(cx, cy) === K.OCEAN && fbm(x / 160, y / 160 + 21) > 0.6) setC(cx, cy, K.CHIMNEY);
    });
    exits.forEach(e => carveLine([{x:e.x - 80, y:e.y}, {x:e.x + 180, y:e.y}], 3, K.PORE, [K.CHIMNEY]));
    /* black smokers stand in the westmost column of the maze and out in the deep water beyond it */
    for (let j = 1; j < mh; j += 3){ smokers.push({x:(c0x + 2.5) * CELL, y:(c0y + j * MC + 2.5) * CELL, r:rr(52, 66)}); }
    for (let k = 0; k < 3; k++) smokers.push({x:rr(240, 400), y:rr(MY0 + 300, MY1 - 300), r:rr(60, 80)});
    /* seeping warm water carries letters out of the chimneys toward the lagoon */
    exits.forEach(e => flows.push({pts:[e, {x:(e.x + L.x - L.a) / 2, y:e.y * 0.7 + L.y * 0.3}, {x:L.x - L.a * 0.85, y:e.y * 0.4 + L.y * 0.6}], w:130, v:70, kind:'seep'}));
    LABELS.push({t:'WHITE CHIMNEYS', x:(MX0 + MX1) / 2, y:MY0 - 150}, {t:'BLACK SMOKERS', x:420, y:MY1 + 160});
   }},

  {id:'ice',
   cells:['BRINE'], botHome:t => 0.2 + t.caution * 0.6 + t.patience * 0.4,
   build(B){
    const {W, H, CELL, K, TAU, each, setC, blob, carveLine, typeAtCell, rr, rng, fbm, pools, springs, flows, geysers, smokers, rafts, labels:LABELS} = B;
    const L = B.lagoon;
    /* 4. the cold corner: ice veins */
    const IX = 2700, IY = 1520;
    each((cx, cy, x, y) => { const d = Math.hypot(x / IX, y / IY); if (d < 0.95 + 0.18 * fbm(x / 300 + 5, y / 300) && typeAtCell(cx, cy) !== K.CHIMNEY) setC(cx, cy, K.ICE); });
    const veins = [];
    for (let v = 0; v < 7; v++){
      /* each vein starts at the ice's southern or eastern edge and wanders inward */
      let x, y, a;
      if (v % 2){ x = rr(400, IX - 300); y = IY * 1.05; a = -Math.PI / 2 + rr(-0.5, 0.5); }
      else { x = IX * 1.05; y = rr(300, IY - 250); a = Math.PI + rr(-0.5, 0.5); }
      const pts = [{x, y}];
      for (let k = 0; k < 22; k++){ a += rr(-0.55, 0.55); x += Math.cos(a) * 90; y += Math.sin(a) * 90; x = Math.max(160, Math.min(IX, x)); y = Math.max(160, Math.min(IY, y)); pts.push({x, y}); }
      veins.push(pts); carveLine(pts, 2, K.BRINE, [K.ICE]);
    }
    /* meltwater runs from the ice toward the lagoon */
    flows.push({pts:[{x:IX * 0.85, y:IY * 1.05}, {x:IX + 500, y:IY + 450}, {x:L.x - L.a * 0.7, y:L.y - L.b * 0.6}], w:150, v:75, kind:'melt'});
    LABELS.push({t:'ICE VEINS', x:IX * 0.45, y:IY * 0.45});
   }},

  {id:'gyre',
   build(B){
    const {W, H, CELL, K, TAU, each, setC, blob, carveLine, typeAtCell, rr, rng, fbm, pools, springs, flows, geysers, smokers, rafts, labels:LABELS} = B;
    const L = B.lagoon;
    /* 5. the ocean gyre circles the lagoon, carrying pumice rafts */
    const raftRoute = B.raftRoute = []; for (let k = 0; k <= 48; k++){ const a = k / 48 * TAU; raftRoute.push({x:L.x + Math.cos(a) * (L.a + 380), y:L.y + Math.sin(a) * (L.b + 420)}); }
    flows.push({pts:raftRoute, w:220, v:55, kind:'gyre', loop:true});
    for (let k = 0; k < 5; k++) rafts.push({u:k / 5 + rr(0, 0.05), r:rr(105, 130), gaps:[rr(0, TAU), rr(0, TAU)], spin:rr(-0.05, 0.05), x:0, y:0, rot:rr(0, TAU)});
    B.placeRafts(0);
    LABELS.push({t:'OPEN OCEAN', x:W * 0.5, y:H - 330}, {t:'OPEN OCEAN', x:W * 0.5, y:300});
   }}
];

return {MIX, CELLS, K, ZONES, LETTER_HOMES, REGIONS};
})();
