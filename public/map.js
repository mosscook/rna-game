/* =====================================================================
   RNA world map: a blend of the places early RNA might have formed.
   Built from the "RNA world environments" notes:
     a tide-pool lagoon in the middle; white chimneys (a pore maze with nursery pockets) sinking west
     to black smokers; a volcanic island east with hot spring terraces, spillways and geysers, clay
     flats at its base and UV shallows on its beaches; a cold corner of ice veins; pumice rafts drifting
     on the currents; meteorites anywhere; and the dilute open ocean as a desert at the edges.
   The terrain is a grid of 50 px cells. It is drawn in 500 px chunks that are rendered once, cached,
   and only drawn when on screen, so a big map costs about the same as a small one.
   ===================================================================== */
/* a factory: the browser uses the default instance; a server room makes its own with SoupMap.create() */
const makeSoupMap = () => {
'use strict';
const TAU = Math.PI * 2;
/* the size is fixed for the classic map; a generated world (worldgen.js) can be smaller, so W/H/GW/GH are reset per map */
const BASE_W = 9200, BASE_H = 6000, CELL = 50, CH = 10, CR = 0.8;
let W = BASE_W, H = BASE_H, GW = W / CELL, GH = H / CELL;
/* ground types, places and regions: biomes.js */
const BIO = window.SoupBiomes, CELLS = BIO.CELLS, K = BIO.K, MIX = BIO.MIX;
const SOLID = CELLS.map(c => c.solid ? 1 : 0), COL = CELLS.map(c => c.color);
const byLayer = list => list.sort((a, b) => CELLS[a].layer - CELLS[b].layer);
const WATER_LAYERS = byLayer(CELLS.map((c, i) => i).filter(i => CELLS[i].layer && !CELLS[i].edge));
const WALL_LAYERS = byLayer(CELLS.map((c, i) => i).filter(i => CELLS[i].edge));
const LABELS = [];

/* ---------- seeded randomness and smooth noise ---------- */
let seed = 1;
const rng = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const rr = (a, b) => a + rng() * (b - a);
let lat = null;
function noise(x, y){
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const g = (i, j) => lat[((i & 63) * 64 + (j & 63))];
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = g(xi, yi), b = g(xi + 1, yi), c = g(xi, yi + 1), d = g(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm = (x, y) => (noise(x, y) + 0.5 * noise(x * 2.1, y * 2.1) + 0.25 * noise(x * 4.3, y * 4.3)) / 1.75;

/* ---------- state ---------- */
let grid = null, flows = [], pools = [], springs = [], smokers = [], geysers = [], rafts = [], craters = [], meteors = [], uvFlashes = [];
let lavas = [];   /* active volcanoes: lava pools in vents and calderas, and lava running down the island's channels */
let raftRoute = null, melted = new Set(), byType = [], tide = 1, clock = 0, iceT = 12, meteorT = 30, uvT = 4;
const cellIdx = (cx, cy) => cy * GW + cx;
const typeAtCell = (cx, cy) => (cx < 0 || cy < 0 || cx >= GW || cy >= GH) ? K.DEEP : grid[cellIdx(cx, cy)];
const typeAt = (x, y) => typeAtCell(Math.floor(x / CELL), Math.floor(y / CELL));

/* ---------- generation ---------- */
/* the lobby: before a room's game starts, players wait in a small walled pool with clumps of letters that keep refilling.
   No hazards, no tide effects, nothing that moves but letters and strands. */
let lobby = false, lobbyClumps = [];
const LOBBY = {x:BASE_W / 2, y:BASE_H / 2, a:1100, b:700};
function generateLobby(){
  grid.fill(K.ROCK);
  const each = (fn) => { for (let cy = 0; cy < GH; cy++) for (let cx = 0; cx < GW; cx++) fn(cx, cy, (cx + 0.5) * CELL, (cy + 0.5) * CELL); };
  each((cx, cy, x, y) => { const d = Math.hypot((x - LOBBY.x) / LOBBY.a, (y - LOBBY.y) / LOBBY.b); if (d < 0.9 + 0.12 * fbm(x / 300, y / 300)) grid[cellIdx(cx, cy)] = K.LAGOON; });
  for (let k = 0; k < 7; k++){ const a = k / 7 * TAU + rr(-0.25, 0.25), d = rr(0.42, 0.66); lobbyClumps.push({x:LOBBY.x + Math.cos(a) * LOBBY.a * d, y:LOBBY.y + Math.sin(a) * LOBBY.b * d, r:120}); }
  LABELS.push({t:'LOBBY', x:LOBBY.x, y:LOBBY.y - LOBBY.b - 60});
  raftRoute = [];
  byType = CELLS.map(() => []);
  for (let i = 0; i < grid.length; i++) if (!SOLID[grid[i]]) byType[grid[i]].push(i);
  buildMinimap();
  const ring = []; for (let i = 0; i < 12; i++){ const t = (i + 0.5) / 12 * TAU; ring.push({x:LOBBY.x + Math.cos(t) * LOBBY.a * 0.25, y:LOBBY.y + Math.sin(t) * LOBBY.b * 0.25}); }
  return {player:{x:LOBBY.x, y:LOBBY.y}, bots:ring};
}
/* opt.lobby: build the lobby instead of the world */
function generate(s, opt){
  seed = s >>> 0 || 1; world = null; surf = null;
  if (opt && opt.lobby && !opt.classic){ chunks.clear(); return generateMiniLobby(s >>> 0 || 1); }
  if (opt && opt.world){ chunks.clear(); return generateWorld(s >>> 0 || 1, opt.world === true ? {} : opt.world); }
  W = BASE_W; H = BASE_H; GW = W / CELL; GH = H / CELL; lat = new Float32Array(64 * 64); for (let i = 0; i < lat.length; i++) lat[i] = rng();
  grid = new Uint8Array(GW * GH).fill(K.OCEAN);
  flows = []; pools = []; springs = []; smokers = []; geysers = []; rafts = []; craters = []; meteors = []; uvFlashes = []; LABELS.length = 0;
  lavas = []; melted = new Set(); chunks.clear(); tide = 1; clock = 0; iceT = 12; meteorT = rr(25, 40); uvT = 3;
  lobby = !!(opt && opt.lobby); lobbyClumps = [];
  if (lobby) return generateLobby();
  const setC = (cx, cy, t) => { cx = Math.floor(cx); cy = Math.floor(cy); if (cx >= 0 && cy >= 0 && cx < GW && cy < GH) grid[cellIdx(cx, cy)] = t; };
  const each = (fn) => { for (let cy = 0; cy < GH; cy++) for (let cx = 0; cx < GW; cx++) fn(cx, cy, (cx + 0.5) * CELL, (cy + 0.5) * CELL); };
  const blob = (x, y, r, t, onlyOn) => {
    const c0 = Math.floor((x - r * 1.3) / CELL), c1 = Math.ceil((x + r * 1.3) / CELL), r0 = Math.floor((y - r * 1.3) / CELL), r1 = Math.ceil((y + r * 1.3) / CELL);
    for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++){
      const px = (cx + 0.5) * CELL, py = (cy + 0.5) * CELL, d = Math.hypot(px - x, py - y) / r;
      const wob = 0.82 + 0.36 * fbm(px / 260, py / 260);
      if (d < wob && (!onlyOn || onlyOn.includes(typeAtCell(cx, cy)))) setC(cx, cy, t);
    }
  };
  const carveLine = (pts, wCells, t, onlyOn) => {
    for (let i = 0; i + 1 < pts.length; i++){
      const a = pts[i], b = pts[i + 1], L = Math.hypot(b.x - a.x, b.y - a.y), n = Math.ceil(L / (CELL * 0.5));
      for (let k = 0; k <= n; k++){
        const x = a.x + (b.x - a.x) * k / n, y = a.y + (b.y - a.y) * k / n, cx = Math.floor(x / CELL), cy = Math.floor(y / CELL), h = Math.floor(wCells / 2);
        for (let oy = -h; oy < wCells - h; oy++) for (let ox = -h; ox < wCells - h; ox++){ if (!onlyOn || onlyOn.includes(typeAtCell(cx + ox, cy + oy))) setC(cx + ox, cy + oy, t); }
      }
    }
  };
  /* the regions paint the map in order (biomes.js) */
  const B = {W, H, CELL, GW, GH, K, TAU, rng, rr, fbm, each, setC, blob, carveLine, typeAtCell,
    pools, springs, flows, geysers, smokers, rafts, labels:LABELS, lagoon:null,
    get raftRoute(){ return raftRoute; }, set raftRoute(v){ raftRoute = v; }, placeRafts};
  for (const region of BIO.REGIONS) region.build(B);
  const L = B.lagoon;

  /* spawn tables: every open cell, grouped by type */
  byType = CELLS.map(() => []);
  for (let i = 0; i < grid.length; i++) if (!SOLID[grid[i]]) byType[grid[i]].push(i);
  buildMinimap();
  const open = sp => nearestOf([K.LAGOON, K.FLATS, K.OCEAN], sp.x, sp.y, 1500) || sp;
  /* bots start spread round the lagoon, evenly around a ring about halfway out */
  const ring = []; for (let i = 0; i < 12; i++){ const t = (i + 0.5) / 12 * Math.PI * 2; ring.push({x:L.x + Math.cos(t) * L.a * 0.6, y:L.y + Math.sin(t) * L.b * 0.55}); }
  return {player:open({x:L.x, y:L.y}), bots:ring.map(open)};
}

/* ---------- a generated world (worldgen.js): depth bands instead of painted regions ----------
   The world gives a depth field; the game reads walls and swim speed straight from it (smooth, 12.5 px), and keeps
   its 50 px grid of ground types for everything else: letters, shelters, bots' paths, the tide on the highland
   shallows, UV on the island's beaches, brine in the ice. Chimney pits are black smokers; big volcanoes' calderas
   hold hot springs with a geyser; the larger streams are currents. */
let world = null, surf = null, worldHash = 0;
/* how a generated world is drawn (the page's look settings, editable in ?dev):
   fill     0..1   how strongly each band is filled with its place's colour (0: the deep colour everywhere)
   depth    0..1.5 how much darker each deeper band gets (1: the lab's steps; 0: every band equally bright)
   line     0..1   the outline drawn where each band starts
   lineW    px     its width, at normal zoom
   lineFade 0..1   how much the outlines dim with depth (0: every line equally bright)
   wall     0..1   the least brightness walls keep, so they read as solid even with no fill
   deep     [r,g,b] the colour of the black depths, and of the ground where fill is 0
   colours  {place: [r,g,b]} each place's colour (missing ones use worldgen's) */
const LOOK_BASE = {fill:1, depth:1, line:0, lineW:1, lineFade:0.5, wall:0, wallLine:1, hueShift:0, gap:0, layers:3, gapCurve:1, sides:3, sideDark:0.6, bright:1, sat:1, deep:[3, 5, 7], colours:{}, coloursLow:{}};
/* hue shifting: each place's layers run from its top colour (the highest layer) to a bottom colour (the deepest). The
   bottom is the place's coloursLow entry if it has one, or else the top colour turned hueShift degrees round the wheel */
function hueTurn([r, g, b], deg){
  r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d || !deg) return [r * 255, g * 255, b * 255];
  const s = d / (1 - Math.abs(2 * l - 1)); let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = ((h * 60 + deg) % 360 + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
  const [a, bb, cc] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(a + m) * 255, (bb + m) * 255, (cc + m) * 255];
}
const PLACE_KEYS = () => Object.keys(window.WorldGen.PLACE_COL);
function lowsOf(L){
  const out = {}, base = window.WorldGen.PLACE_COL;
  for (const id of PLACE_KEYS()){ const top = (L.colours && L.colours[id]) || base[id]; out[id] = (L.coloursLow && L.coloursLow[id]) || hueTurn(top, L.hueShift || 0); }
  return out;
}
const shifting = L => !!(L.hueShift || (L.coloursLow && Object.keys(L.coloursLow).length));
let look = Object.assign({}, LOOK_BASE);
function setWorldLook(o){
  const key = L => JSON.stringify([L.colours || {}, L.coloursLow || {}, L.hueShift || 0]), recol = key(Object.assign({}, LOOK_BASE, o || {})) !== key(look);
  look = Object.assign({}, LOOK_BASE, o || {});
  if (recol && surf) surf.recolour(look.colours, lowsOf(look));
  mini.dirty = true; chunks.clear();
}
const PLACE_NAME = {lagoon:'TIDE-POOL LAGOON', flats:'HIGHLANDS', island:'VOLCANIC ISLAND', chimneys:'WHITE CHIMNEYS', ice:'ICE VEINS', ridge:'OCEAN RIDGE'};
const MEND_E = 0.62;   /* the generated world's ice mends at this elevation and above (the top two swimmable bands) */
function generateWorld(s, o){
  const WG = window.WorldGen, size = Math.max(0.4, Math.min(1, o.size || 0.7));
  W = Math.round(BASE_W * size / 100) * 100; H = Math.round(BASE_H * size / 100) * 100; GW = W / CELL; GH = H / CELL;
  flows = []; pools = []; springs = []; smokers = []; geysers = []; rafts = []; craters = []; meteors = []; uvFlashes = []; LABELS.length = 0;
  melted = new Set(); tide = 1; clock = 0; iceT = 12; meteorT = rr(25, 40); uvT = 3; lobby = false; lobbyClumps = []; raftRoute = [];
  world = WG.generate(Object.assign({}, o.settings || {}, {seed:s, W, H, RES:25, scale:size}));
  if (o.texture){ const tx = WG.texture(world, {amp:(o.settings && o.settings.texture) ?? 1, aniso:(o.settings && o.settings.align) ?? 1}); tx.step(o.textureIters || 3000); tx.apply(); }
  surf = WG.surface(world); if (Object.keys(look.colours).length || shifting(look)) surf.recolour(look.colours, lowsOf(look));
  /* a fingerprint of the depth field: the room sends its own, so a browser can tell if it grew a different map */
  worldHash = 0; for (let n = 0; n < world.E.length; n++) worldHash = (worldHash + Math.round(world.E[n] * 1000) * (n % 997 + 1)) % 2147483647;
  const WALL = WG.WALL, G = world.GX, R = world.RES, idAt = (x, y) => world.PIDS[world.pid[Math.min(world.GY - 1, Math.floor(y / R)) * G + Math.min(G - 1, Math.floor(x / R))]];
  const calderas = world.vents.filter(v => v.kind === 'caldera');
  grid = new Uint8Array(GW * GH);
  for (let cy = 0; cy < GH; cy++) for (let cx = 0; cx < GW; cx++){
    const x = (cx + 0.5) * CELL, y = (cy + 0.5) * CELL, e = surf.elev(x, y), id = idAt(x, y);
    let t;
    if (e >= WALL) t = id === 'ice' ? K.ICE : id === 'chimneys' ? K.CHIMNEY : id === 'flats' ? K.RIDGE : K.ROCK;
    else if (id === 'lagoon') t = K.LAGOON;
    else if (calderas.some(v => Math.hypot(x - v.x, y - v.y) < v.R * 0.8)) t = K.SPRING;
    else if (e < 0.14) t = K.DEEP;
    else if (id === 'flats') t = e >= 0.5 ? K.FLATS : K.OCEAN;
    else if (id === 'island') t = e >= 0.62 ? K.UV : e >= 0.38 ? K.CLAY : K.OCEAN;
    else if (id === 'chimneys') t = e >= 0.62 ? K.POCKET : K.PORE;
    else if (id === 'ice') t = e >= MEND_E ? K.BRINE : K.SLUSH;   /* only the higher ice mends, so mending means a trip deep in */
    else t = K.OCEAN;
    grid[cy * GW + cx] = t;
  }
  for (const v of world.vents) if (v.kind === 'chimney') smokers.push({x:v.x, y:v.y, r:Math.max(40, v.R * 0.3)});
  /* active volcanoes: about half the shields and calderas, chosen from the seed so every screen agrees. A shield's vent
     pit holds a lava pool and lava runs down its channels; an active caldera's floor is a lava lake (and has no geyser).
     The lava swells and ebbs: each flow's front creeps down its channel and back over half a minute or so */
  lavas = [];
  const cones = world.vents.filter(v => v.kind === 'shield' || v.kind === 'caldera');
  let active = cones.filter(v => hash(s, v.k) < 0.5); if (!active.length && cones.length) active = [cones[0]];
  /* at least one active shield with a channel, so there is always a flow to see */
  const shields = cones.filter(v => v.kind === 'shield'), ownerOf = path => shields.reduce((a, u) => !a || Math.hypot(path[0].x - u.x, path[0].y - u.y) < Math.hypot(path[0].x - a.x, path[0].y - a.y) ? u : a, null);
  if (world.lavas.length && !world.lavas.some(path => active.includes(ownerOf(path)))){ const o = ownerOf(world.lavas[0]); if (o) active.push(o); }
  for (const v of active){
    const P = 34 + hash(s, v.k + 7) * 22, ph = hash(s, v.k + 11);
    if (v.kind === 'caldera'){ lavas.push({kind:'pool', x:v.x, y:v.y, r0:v.R * 0.22, r1:v.R * 0.4, lo:0, P, ph}); continue; }
    lavas.push({kind:'pool', x:v.x, y:v.y, r0:v.R * 0.1, r1:v.R * 0.18, lo:0, P, ph});
    for (const path of world.lavas){
      /* each channel belongs to the shield it starts nearest */
      if (ownerOf(path) !== v || Math.hypot(path[0].x - v.x, path[0].y - v.y) > v.R * 0.6) continue;
      /* from the vent itself, and no further than 1400 px down the channel */
      let pts = [{x:v.x, y:v.y}, ...path.map(q => ({x:q.x, y:q.y}))];
      for (let it = 0; it < 2; it++){ const q2 = [pts[0]]; for (let k = 0; k + 1 < pts.length; k++){ const A = pts[k], B = pts[k + 1]; q2.push({x:A.x * 0.75 + B.x * 0.25, y:A.y * 0.75 + B.y * 0.25}, {x:A.x * 0.25 + B.x * 0.75, y:A.y * 0.25 + B.y * 0.75}); } q2.push(pts[pts.length - 1]); pts = q2; }
      const cum = [0];
      for (let k = 1; k < pts.length; k++){ cum.push(cum[k - 1] + Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y)); if (cum[k] > 1400){ pts.length = k + 1; break; } }
      cum.length = pts.length;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const q of pts){ x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); }
      lavas.push({kind:'flow', pts, cum, total:cum[cum.length - 1], w:18, lo:0.3, P, ph:ph + 0.08, box:[x0, y0, x1, y1]});
    }
  }
  for (const v of calderas){ const sp = {x:v.x, y:v.y, r:v.R * 0.55, k:springs.length}; springs.push(sp); if (!active.includes(v)) geysers.push({x:v.x + v.R * 0.25, y:v.y, r:85, t:rr(2, 10), phase:'wait'}); }
  for (const c of world.craters) if (c.R > 200) springs.push({x:c.x, y:c.y, r:c.R * 0.4, k:springs.length});
  if (geysers.length && springs.length < 2) geysers.length = 0;
  /* the bigger streams run as currents, toward deep water */
  world.rivers.filter(r => r[r.length - 1].f >= 3).sort((a, b) => b.length - a.length).slice(0, 24).forEach(r => {
    const pts = r.filter((q, k) => k % 4 === 0 || k === r.length - 1).map(q => ({x:q.x, y:q.y}));
    if (pts.length > 1) flows.push({pts, w:Math.min(150, 60 + 12 * Math.sqrt(r[r.length - 1].f)), v:55, kind:'melt'});
  });
  /* names, at the middle of each place's biggest stretch */
  const sum = {};
  for (let n = 0; n < world.pid.length; n += 3){ if (world.ramp[n] < 0.99) continue; const id = world.PIDS[world.pid[n]]; if (!PLACE_NAME[id]) continue; const q = sum[id] || (sum[id] = {x:0, y:0, n:0}); q.x += (n % G + 0.5) * R; q.y += (Math.floor(n / G) + 0.5) * R; q.n++; }
  for (const id in sum){ const q = sum[id]; if (q.n > 50) LABELS.push({t:PLACE_NAME[id], x:q.x / q.n, y:q.y / q.n}); }
  byType = CELLS.map(() => []);
  for (let i = 0; i < grid.length; i++) if (!SOLID[grid[i]]) byType[grid[i]].push(i);
  buildMinimap();
  /* humans start in the ring mounds, one per mound in turn; bots fill the mounds after them, then the lagoon */
  const homes = world.spawns.map(p => ({x:p.x, y:p.y}));
  const bots = homes.slice(1).concat(homes.slice(0, 1));
  return {player:homes[0], homes, bots};
}

/* the lobby as a mini generated world: one small lagoon from two impacts, three ring mounds and a few rosettes, a
   ring of highland around it and a scrap of the outer places at the edges, drawn in the world's own look. Still the
   lobby: no hazards, no currents, letters gathered in clumps that refill, humans one per mound */
const MINI_LOBBY = {size:0.4, settings:{lagoon:2500, impacts:2, ispread:0.5, mounds:3, rin:150, rim:44, door:70, rosettes:16,
  craters:20, basins:0, chimneys:0, calderas:0, lava:0, rivers:0.4, spread:20, pockets:0}};
function generateMiniLobby(s){
  const sp = generateWorld(s, MINI_LOBBY);
  lobby = true; flows = []; smokers = []; geysers = []; springs = []; lavas = []; LABELS.length = 0;
  const c = world.centre, open = (x, y) => !solidAt(x, y) && !solidAt(x + 70, y) && !solidAt(x - 70, y) && !solidAt(x, y + 70) && !solidAt(x, y - 70);
  /* clumps: one inside each mound, then open lagoon water around the middle */
  lobbyClumps = world.mounds.map(m => ({x:m.x, y:m.y, r:Math.min(110, m.rin * 0.55)}));
  for (let t = 0; t < 400 && lobbyClumps.length < 8; t++){
    const a = rr(0, TAU), d = Math.sqrt(Math.random()) * c.RX * 0.85, x = c.x + Math.cos(a) * d, y = c.y + Math.sin(a) * d * 0.8;
    if (open(x, y) && lobbyClumps.every(q => Math.hypot(q.x - x, q.y - y) > 360)) lobbyClumps.push({x, y, r:110});
  }
  LABELS.push({t:'LOBBY', x:c.x, y:Math.max(120, c.y - c.RY - 40)});
  byType = CELLS.map(() => []);
  for (let i = 0; i < grid.length; i++) if (!SOLID[grid[i]]) byType[grid[i]].push(i);
  buildMinimap();
  return sp;
}

/* ---------- queries ---------- */
function placeRafts(dt){
  const n = raftRoute.length - 1, perim = 2 * Math.PI * Math.sqrt(((1180 + 380) ** 2 + (1380 + 420) ** 2) / 2);
  for (const r of rafts){
    r.u = (r.u + dt * 32 / perim) % 1; r.rot += r.spin * dt;
    const f = r.u * n, k = Math.floor(f), a = raftRoute[k], b = raftRoute[k + 1];
    r.x = a.x + (b.x - a.x) * (f - k); r.y = a.y + (b.y - a.y) * (f - k);
  }
}
function raftWallAt(x, y){
  for (const r of rafts){
    const d = Math.hypot(x - r.x, y - r.y);
    if (d < r.r - 16 || d > r.r + 16) continue;
    const a = Math.atan2(y - r.y, x - r.x) - r.rot;
    if (r.gaps.some(g => Math.abs(((a - g + Math.PI * 3) % TAU) - Math.PI) < 0.42)) continue;
    return r;
  }
  return null;
}
const raftInside = (x, y) => rafts.find(r => Math.hypot(x - r.x, y - r.y) < r.r - 18) || null;
const solidAt = (x, y) => world ? (x < 0 || y < 0 || x >= W || y >= H || surf.elev(x, y) >= window.WorldGen.WALL) : (!!SOLID[typeAt(x, y)] || !!raftWallAt(x, y));
const lowTide = () => tide < 0.35;
const poolAt = (x, y) => pools.find(p => Math.hypot(x - p.x, y - p.y) < p.r * 0.9) || null;
const saltAt = (x, y) => { const p = poolAt(x, y); return !!(p && p.salt && tide < 0.45); };
const smokerAt = (x, y, pad) => smokers.find(s => Math.hypot(x - s.x, y - s.y) < s.r + (pad || 0)) || null;
const craterAt = (x, y) => craters.find(c => Math.hypot(x - c.x, y - c.y) < c.r) || null;
function speedAt(x, y){
  const t = typeAt(x, y);
  if (world){ const v = window.WorldGen.speedOf(surf.elev(x, y)); return t === K.FLATS ? v * (0.45 + 0.55 * Math.min(1, tide / 0.55)) : v; }
  if (t === K.FLATS) return 0.3 + 0.7 * Math.min(1, tide / 0.55);
  return CELLS[t].speed || 1;
}
const cellAt = (x, y) => CELLS[typeAt(x, y)];
/* shelters: nursery pockets, ice veins and the inside of a pumice raft keep out radiation and meteorites */
const shelterAt = (x, y) => !!CELLS[typeAt(x, y)].shelter || !!raftInside(x, y);
/* lava: how far it reaches now (0..1 of its full size) */
const lavaExt = q => q.lo + (1 - q.lo) * (0.5 - 0.5 * Math.cos(TAU * (clock / q.P + q.ph)));
/* the nearest lava to a point: {d, x, y}, d being the distance from the lava's edge (negative inside), x, y the nearest
   point of its middle. Only lava within 'within' px is looked at; null if none */
function lavaNear(x, y, within = 0){
  let best = null;
  for (const q of lavas){
    if (q.kind === 'pool'){
      const r = q.r0 + (q.r1 - q.r0) * lavaExt(q), d = Math.hypot(x - q.x, y - q.y) - r;
      if (d <= within && (!best || d < best.d)) best = {d, x:q.x, y:q.y};
      continue;
    }
    const b = q.box, pad = q.w + within;
    if (x < b[0] - pad || x > b[2] + pad || y < b[1] - pad || y > b[3] + pad) continue;
    const L = lavaExt(q) * q.total, P = q.pts;
    for (let k = 1; k < P.length && q.cum[k - 1] < L; k++){
      const A = P[k - 1], B0 = P[k], sl = q.cum[k] - q.cum[k - 1] || 1, f = Math.min(1, (L - q.cum[k - 1]) / sl);
      const bx = A.x + (B0.x - A.x) * f, by = A.y + (B0.y - A.y) * f, vx = bx - A.x, vy = by - A.y, vv = vx * vx + vy * vy || 1;
      const u = Math.max(0, Math.min(1, ((x - A.x) * vx + (y - A.y) * vy) / vv)), px = A.x + vx * u, py = A.y + vy * u, d = Math.hypot(x - px, y - py) - q.w;
      if (d <= within && (!best || d < best.d)) best = {d, x:px, y:py};
    }
  }
  return best;
}
const lavaAt = (x, y, pad = 0) => !!lavaNear(x, y, pad);
function zoneAt(x, y){
  if (smokerAt(x, y, 90)) return 'smoker';
  if (lavas.length && lavaAt(x, y, 40)) return 'lava';
  if (raftInside(x, y)) return 'raft';
  if (craterAt(x, y)) return 'crater';
  const t = typeAt(x, y);
  if (t === K.LAGOON) return saltAt(x, y) ? 'salt' : 'lagoon';
  if (t === K.FLATS) return lowTide() ? 'stranded' : 'flats';
  return CELLS[t].zone || 'ocean';
}
/* water flow at a point: spillways, seeps, meltwater and the gyre */
function flowAt(x, y){
  let fx = 0, fy = 0;
  for (const f of flows){
    const P = f.pts;
    for (let i = 0; i + 1 < P.length; i++){
      const a = P[i], b = P[i + 1], vx = b.x - a.x, vy = b.y - a.y, l2 = vx * vx + vy * vy || 1;
      if (x < Math.min(a.x, b.x) - f.w || x > Math.max(a.x, b.x) + f.w || y < Math.min(a.y, b.y) - f.w || y > Math.max(a.y, b.y) + f.w) continue;
      let u = ((x - a.x) * vx + (y - a.y) * vy) / l2; u = Math.max(0, Math.min(1, u));
      const d = Math.hypot(a.x + vx * u - x, a.y + vy * u - y);
      if (d > f.w / 2) continue;
      const l = Math.sqrt(l2), k = f.v * (1 - d / (f.w / 2) * 0.5);
      fx += vx / l * k; fy += vy / l * k; break;
    }
  }
  return {x:fx, y:fy};
}

/* ---------- letters: where they gather and what they are ---------- */
const fromMix = m => { let r = Math.random(); for (const b of ['A', 'U', 'G', 'C']){ r -= m[b]; if (r < 0) return b; } return 'A'; };
function spawnSpot(){
  if (lobby){
    /* the lobby's letters gather in clumps */
    const c = lobbyClumps[Math.floor(Math.random() * lobbyClumps.length)], a = Math.random() * TAU, d = Math.sqrt(Math.random()) * c.r;
    return {x:c.x + Math.cos(a) * d, y:c.y + Math.sin(a) * d, b:fromMix(MIX.soup), home:{x:c.x, y:c.y, r:c.r + 30}};
  }
  /* pick a cell weighted by how rich its type is (drained flats get richer at low tide), then a letter from its mix */
  let total = 0; const w = CELLS.map((inf, t) => { const v = byType[t].length * inf.spawn * (inf.lowTideSpawn ? (lowTide() ? inf.lowTideSpawn : 1) : 1); total += v; return v; });
  let r = Math.random() * total, t = 0; for (; t < w.length; t++){ r -= w[t]; if (r < 0) break; }
  t = Math.min(t, w.length - 1);
  const list = byType[t]; if (!list.length) return null;
  const i = list[Math.floor(Math.random() * list.length)], cx = i % GW, cy = Math.floor(i / GW);
  const x = (cx + Math.random()) * CELL, y = (cy + Math.random()) * CELL;
  return {x, y, b:fromMix(MIX[CELLS[t].mix]), home:{x:(cx + 0.5) * CELL, y:(cy + 0.5) * CELL, r:140}};
}

/* ---------- path finding for bots: breadth-first over open cells ---------- */
function lineClear(x0, y0, x1, y1){
  const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (CELL * 0.5));
  for (let k = 1; k < n; k++){ const x = x0 + (x1 - x0) * k / n, y = y0 + (y1 - y0) * k / n; if (SOLID[typeAt(x, y)]) return false; }
  return true;
}
function findPath(x0, y0, x1, y1, maxNodes){
  if (![x0, y0, x1, y1].every(Number.isFinite)) return null;
  /* both ends inside the map: a cell off the edge has no path back, and once looped forever here */
  const cell = (x, y) => cellIdx(Math.max(0, Math.min(GW - 1, Math.floor(x / CELL))), Math.max(0, Math.min(GH - 1, Math.floor(y / CELL))));
  const s = cell(x0, y0), g = cell(x1, y1);
  if (SOLID[grid[g]]) return null;
  const prev = new Int32Array(GW * GH).fill(-1), q = new Int32Array(Math.min(GW * GH, maxNodes || GW * GH)); let h = 0, t = 0;
  q[t++] = s; prev[s] = s;
  while (h < t){
    const c = q[h++]; if (c === g) break;
    const cx = c % GW, cy = (c - cx) / GW;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]){
      const nx = cx + dx, ny = cy + dy; if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
      const n = ny * GW + nx; if (prev[n] >= 0 || SOLID[grid[n]]) continue;
      prev[n] = c; if (t < q.length) q[t++] = n;
    }
  }
  if (prev[g] < 0) return null;
  const out = []; for (let c = g, n = 0; c !== s && n < GW * GH; c = prev[c], n++) out.push({x:(c % GW + 0.5) * CELL, y:(Math.floor(c / GW) + 0.5) * CELL});
  return out.reverse();
}

/* ---------- the living map: tide, geysers, rafts, shifting ice, meteorites, UV flashes ---------- */
function update(dt, ev, heads){
  clock += dt;
  if (lobby){ tide = 0.5 + 0.5 * Math.cos(clock * TAU / 80); return; }   /* the lobby has no hazards */
  /* tides: an 80-second cycle, high to low and back */
  tide = 0.5 + 0.5 * Math.cos(clock * TAU / 80);
  placeRafts(dt);
  for (const c of craters){ c.age += dt; }
  craters = craters.filter(c => c.age < c.life);
  /* geysers bubble, then burst and fling whatever sits on them toward another pool */
  for (const g of geysers){
    g.t -= dt;
    if (g.phase === 'wait' && g.t <= 0){ g.phase = 'bubble'; g.t = 1.6; }
    else if (g.phase === 'bubble' && g.t <= 0){ g.phase = 'burst'; g.t = 0.7; const to = springs[Math.floor(Math.random() * springs.length)]; ev.geyser && ev.geyser(g, to); }
    else if (g.phase === 'burst' && g.t <= 0){ g.phase = 'wait'; g.t = 9 + Math.random() * 7; }
  }
  /* ice veins shift: channels widen in places, then those cells freeze back over */
  iceT -= dt;
  if (iceT <= 0 && !world){
    iceT = 10;
    const free = (cx, cy) => !heads.some(h => Math.hypot(h.x - (cx + 0.5) * CELL, h.y - (cy + 0.5) * CELL) < 220);
    for (const key of [...melted]){ if (Math.random() < 0.5){ const cx = key % GW, cy = (key - cx) / GW; if (free(cx, cy)){ grid[key] = K.ICE; melted.delete(key); dirty(cx, cy); } } }
    for (let k = 0; k < 40; k++){
      const list = byType[K.BRINE]; const i = list[Math.floor(Math.random() * list.length)], cx = i % GW, cy = (i - cx) / GW;
      const [dx, dy] = [[1, 0], [-1, 0], [0, 1], [0, -1]][Math.floor(Math.random() * 4)], n = cellIdx(cx + dx, cy + dy);
      if (typeAtCell(cx + dx, cy + dy) === K.ICE && cx + dx > 1 && cy + dy > 1){ grid[n] = K.BRINE; melted.add(n); dirty(cx + dx, cy + dy); }
    }
  }
  /* meteorites: a warning streak, then an impact that wipes out what is nearby and leaves a warm crater full of letters */
  meteorT -= dt;
  if (meteorT <= 0){
    meteorT = 35 + Math.random() * 30;
    let x, y, tries = 0;
    const near = heads.length && Math.random() < 0.4;
    do { x = near ? heads[0].x + (Math.random() - 0.5) * 1400 : 500 + Math.random() * (W - 1000); y = near ? heads[0].y + (Math.random() - 0.5) * 1000 : 500 + Math.random() * (H - 1000); tries++; }
    while (tries < 40 && (SOLID[typeAt(x, y)] || shelterAt(x, y) || typeAt(x, y) === K.DEEP));
    meteors.push({x, y, t:4.5, r:240});
  }
  for (const m of meteors){
    m.t -= dt;
    if (m.t <= 0){ craters.push({x:m.x, y:m.y, r:150, age:0, life:90}); ev.meteor && ev.meteor(m); }
  }
  meteors = meteors.filter(m => m.t > 0);
  /* UV: bright flashes over the shallows, mostly where a strand is swimming there */
  uvT -= dt;
  if (uvT <= 0){
    uvT = 3 + Math.random() * 4;
    const inUV = heads.filter(h => typeAt(h.x, h.y) === K.UV);
    let x, y;
    if (inUV.length && Math.random() < 0.7){ const h = inUV[Math.floor(Math.random() * inUV.length)]; x = h.x + (Math.random() - 0.5) * 500; y = h.y + (Math.random() - 0.5) * 500; }
    else { const list = byType[K.UV]; if (!list.length) return; const i = list[Math.floor(Math.random() * list.length)]; x = (i % GW + 0.5) * CELL; y = (Math.floor(i / GW) + 0.5) * CELL; }
    uvFlashes.push({x, y, r:150 + Math.random() * 50, t:3.5});
  }
  for (const u of uvFlashes){ u.t -= dt; if (u.t <= 0) ev.uv && ev.uv(u); }
  uvFlashes = uvFlashes.filter(u => u.t > 0);
}

/* ---------- drawing: cached terrain chunks, plus what moves ---------- */
const chunks = new Map(); let renderBudget = 0;
function dirty(cx, cy){ chunks.delete(Math.floor(cx / CH) + ',' + Math.floor(cy / CH)); mini.dirty = true; }
const hash = (a, b) => { let h = Math.imul(a, 374761393) + Math.imul(b, 668265263); h = Math.imul(h ^ h >>> 13, 1274126177); return ((h ^ h >>> 16) >>> 0) / 4294967296; };
/* the microscope look (lens.js) can draw the ground out of focus: each chunk is blurred once, when it is made.
   It is drawn with a margin first, so neighbouring chunks blur into each other without seams */
let softPx = 0, softMode = 'low';
function setSoft(px, mode){ if (px === softPx && (mode || softMode) === softMode) return; softPx = px; softMode = mode || softMode; chunks.clear(); }
/* a generated world is drawn from its depth field: each pixel takes its place's colour at its band's brightness, black
   in the depths, with a soft one-pixel edge between bands (the lab's look, without the raised layers) */
/* ---------- the generated world's ground, one chunk at a time ----------
   Each pixel: the deep colour, then each band from the deep up at its brightness, blended toward the deep by fill;
   walls keep a dim tint; outlines where each band starts; the wall's edge brighter. With a layer gap (parallax), the
   top bands are pictures of their own: the floor is drawn with everything above band L shown as band L, and each raised
   band k (L-1 up to the walls, band 0) gets a transparent picture of just its shape, so drawBase can lift it toward the
   eye. Their 'sides' are the same shapes darkened, stacked between one layer and the next like cliff faces */
const parallaxLayers = Lk => Lk.gap > 0 ? Math.max(1, Math.min(4, Math.round(Lk.layers || 3))) : 0;
function renderWorldChunk(kx, ky){
  const WG = window.WorldGen, T = WG.T, BR = WG.BRIGHT, Lk = look, L = parallaxLayers(Lk);
  /* drawn a little under screen resolution when filled (the bands are smooth curves); at full resolution with outlines */
  const R = softPx && softMode === 'low' ? 0.34 : Lk.line > 0 ? CR : 0.6, S = CH * CELL, pad = softPx && !L ? Math.ceil(softPx * 4) : 0, n = Math.round((S + 2 * pad) * R), step = (S + 2 * pad) / n;
  const c = document.createElement('canvas'); c.width = c.height = n;
  const g = c.getContext('2d'), img = g.createImageData(n, n), d = img.data, col = [0, 0, 0], low = [0, 0, 0], bc = [0, 0, 0], hs = shifting(Lk);
  const x0 = kx * S - pad, y0 = ky * S - pad, m = n + 1, ev = new Float32Array(m * m);
  for (let py = 0; py < m; py++) for (let px = 0; px < m; px++) ev[py * m + px] = surf.elev(x0 + (px + 0.5) * step, y0 + (py + 0.5) * step);
  const [d0, d1, d2] = Lk.deep, fill = Lk.fill, sp = Lk.depth, lineA = Lk.line, lw = Math.max(0.3, Lk.lineW) * 0.8, fade = Lk.lineFade, wallB = Lk.wall, wl = Lk.wallLine == null ? 1 : Lk.wallLine;
  const brt = Lk.bright == null ? 1 : Lk.bright, sat = Lk.sat == null ? 1 : Lk.sat, tone = brt !== 1 || sat !== 1;
  const bright = BR.map(v => Math.max(0, 1 - (1 - v) * sp)), lineM = BR.map(v => 1 - fade * (1 - v));
  /* the raised bands' pictures, and the box each one's pixels fall in */
  const lay = []; for (let k = 0; k < L; k++) lay.push({img:g.createImageData(n, n), x0:n, y0:n, x1:-1, y1:-1});
  let e = 0, grad = 1;
  const bandCol = k => {
    if (!hs && !tone) return col;
    const f = hs ? (6 - k) / 6 : 1; bc[0] = low[0] + (col[0] - low[0]) * f; bc[1] = low[1] + (col[1] - low[1]) * f; bc[2] = low[2] + (col[2] - low[2]) * f;
    /* brightness and saturation */
    if (tone){ const gr = (bc[0] + bc[1] + bc[2]) / 3; for (let q = 0; q < 3; q++) bc[q] = (gr + (bc[q] - gr) * sat) * brt; }
    return bc;
  };
  /* the colour of this pixel with nothing above band 'top' (top 0 = everything, walls included) */
  const out = [0, 0, 0];
  function shade(top){
    let r = d0, gg = d1, b = d2;
    if (fill > 0) for (let k = 6; k >= top; k--){
      const a = (e - T[k]) / grad + 0.5; if (a <= 0) break;
      const t = a > 1 ? 1 : a, cc = bandCol(k);
      r += (d0 + (cc[0] * bright[k] - d0) * fill - r) * t; gg += (d1 + (cc[1] * bright[k] - d1) * fill - gg) * t; b += (d2 + (cc[2] * bright[k] - d2) * fill - b) * t;
    }
    /* walls keep at least a dim tint of their place, so they still read as solid */
    if (top === 0 && wallB > 0 && wallB > fill * bright[0]){
      const a = (e - T[0]) / grad + 0.5;
      if (a > 0){ const t = a > 1 ? 1 : a; r += (d0 + (col[0] * wallB - d0) - r) * t; gg += (d1 + (col[1] * wallB - d1) - gg) * t; b += (d2 + (col[2] * wallB - d2) - b) * t; }
    }
    /* outlines where each band starts */
    if (lineA > 0) for (let k = 6; k >= Math.max(1, top); k--){
      const a = (1 - Math.abs(e - T[k]) / (grad * lw)) * lineA; if (a <= 0) continue;
      const mm = lineM[k], t = a > 1 ? 1 : a, cc = bandCol(k);
      r += (cc[0] * mm - r) * t; gg += (cc[1] * mm - gg) * t; b += (cc[2] * mm - b) * t;
    }
    /* the wall's edge, where swimming stops: wider, at full brightness and lifted toward white by wallLine, even in a
       filled look. At 0 it is drawn like the other outlines */
    if (top === 0){ const la = Math.max(lineA, Math.min(1, wl) * 0.9), a = (1 - Math.abs(e - T[0]) / (grad * lw * (1 + 0.6 * wl))) * la;
      if (a > 0){
        const t = a > 1 ? 1 : a, mm = wl > 0 ? 1 : lineM[0], wh = Math.min(0.6, 0.3 * wl);
        const tr = col[0] * mm + (255 - col[0] * mm) * wh, tg = col[1] * mm + (255 - col[1] * mm) * wh, tb = col[2] * mm + (255 - col[2] * mm) * wh;
        r += (tr - r) * t; gg += (tg - gg) * t; b += (tb - b) * t;
      } }
    out[0] = r; out[1] = gg; out[2] = b; return out;
  }
  for (let py = 0; py < n; py++) for (let px = 0; px < n; px++){
    const x = x0 + (px + 0.5) * step, y = y0 + (py + 0.5) * step, o = (py * n + px) * 4;
    if (x < 0 || y < 0 || x >= W || y >= H){ d[o] = d0; d[o + 1] = d1; d[o + 2] = d2; d[o + 3] = 255; continue; }
    const i = py * m + px, ex = ev[i + 1] - ev[i], ey = ev[i + m] - ev[i]; e = ev[i]; grad = Math.sqrt(ex * ex + ey * ey) + 1e-6;
    if (e < T[6] - (lw + 1) * grad){ d[o] = d0; d[o + 1] = d1; d[o + 2] = d2; d[o + 3] = 255; continue; }
    /* each band's colour: the place's colour, or with hue shifting, part way from its bottom colour (band 6) to its top (band 0) */
    if (hs) surf.colour2(x, y, col, low); else { surf.colour(x, y, col); low[0] = col[0]; low[1] = col[1]; low[2] = col[2]; }
    const f = shade(L); d[o] = f[0]; d[o + 1] = f[1]; d[o + 2] = f[2]; d[o + 3] = 255;
    for (let k = 0; k < L; k++){
      const a = (e - T[k]) / grad + 0.5 + lw * 0.6; if (a <= 0) continue;
      const q = lay[k], qd = q.img.data, s2 = shade(k);
      qd[o] = s2[0]; qd[o + 1] = s2[1]; qd[o + 2] = s2[2]; qd[o + 3] = 255 * (a > 1 ? 1 : a);
      if (px < q.x0) q.x0 = px; if (px > q.x1) q.x1 = px; if (py < q.y0) q.y0 = py; if (py > q.y1) q.y1 = py;
    }
  }
  g.putImageData(img, 0, 0);
  if (L){
    /* each raised band as a picture of just its box, with a darkened copy for its sides */
    const dark = Math.max(0, Math.min(1, Lk.sideDark == null ? 0.6 : Lk.sideDark)), layers = lay.map(q => {
      if (q.x1 < 0) return null;
      const w = q.x1 - q.x0 + 1, h = q.y1 - q.y0 + 1, lc = document.createElement('canvas'); lc.width = w; lc.height = h;
      lc.getContext('2d').putImageData(q.img, -q.x0, -q.y0, q.x0, q.y0, w, h);
      let side = null;
      if ((Lk.sides || 0) > 0){ side = document.createElement('canvas'); side.width = w; side.height = h; const sg = side.getContext('2d');
        sg.drawImage(lc, 0, 0); sg.globalCompositeOperation = 'source-atop'; sg.fillStyle = `rgba(${d0},${d1},${d2},${dark})`; sg.fillRect(0, 0, w, h); }
      return {c:lc, side, x:q.x0 * step, y:q.y0 * step, w:w * step, h:h * step};
    });
    return {floor:c, layers};
  }
  if (!pad) return c;
  const o2 = document.createElement('canvas'); o2.width = o2.height = Math.round(S * R);
  const q = o2.getContext('2d'); q.filter = `blur(${(softPx * R * (softMode === 'low' ? 0.5 : 1)).toFixed(2)}px)`;
  q.drawImage(c, -pad * R, -pad * R);
  return o2;
}
function renderChunk(kx, ky){
  if (world) return renderWorldChunk(kx, ky);
  /* soft ground is drawn at a lower resolution (fewer pixels to fill, and the upscale softens it), then lightly blurred */
  const R = softPx && softMode === 'low' ? 0.34 : CR;
  const S = CH * CELL, pad = softPx ? Math.ceil(softPx * 4) : 0, px = S * R;
  const c = document.createElement('canvas'); c.width = c.height = Math.round((S + 2 * pad) * R);
  const g = c.getContext('2d'); g.scale(R, R); g.translate(-kx * S + pad, -ky * S + pad);
  const cx0 = kx * CH - 1, cy0 = ky * CH - 1, cx1 = kx * CH + CH, cy1 = ky * CH + CH;
  g.fillStyle = COL[K.OCEAN]; g.fillRect(kx * S - pad, ky * S - pad, S + 2 * pad, S + 2 * pad);
  for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++){ if (typeAtCell(cx, cy) === K.DEEP){ g.fillStyle = COL[K.DEEP]; g.fillRect(cx * CELL, cy * CELL, CELL, CELL); } }
  /* water and ground types as overlapping round blobs, so borders come out soft */
  const blobs = (t, rad) => { g.fillStyle = COL[t]; g.beginPath(); for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) if (typeAtCell(cx, cy) === t){ const x = (cx + 0.5) * CELL, y = (cy + 0.5) * CELL; g.moveTo(x + rad, y); g.arc(x, y, rad, 0, TAU); } g.fill(); };
  for (const t of WATER_LAYERS) blobs(t, CELL * 0.74);
  /* solid walls: an edge colour first, then the fill slightly smaller, so the union gets one outline */
  for (const t of WALL_LAYERS){
    g.fillStyle = CELLS[t].edge; g.beginPath();
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) if (typeAtCell(cx, cy) === t){ const x = (cx + 0.5) * CELL, y = (cy + 0.5) * CELL; g.moveTo(x + CELL * 0.74, y); g.arc(x, y, CELL * 0.74, 0, TAU); }
    g.fill();
    g.fillStyle = COL[t]; g.beginPath();
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) if (typeAtCell(cx, cy) === t){ const x = (cx + 0.5) * CELL, y = (cy + 0.5) * CELL; g.moveTo(x + CELL * 0.66, y); g.arc(x, y, CELL * 0.66, 0, TAU); }
    g.fill();
  }
  /* texture: pores in the chimneys, cracks in the ice, grit in the clay, sparkle in the shallows */
  const e = pad ? 0 : 1;
  for (let cy = cy0 + e; cy <= cy1 - e; cy++) for (let cx = cx0 + e; cx <= cx1 - e; cx++){
    const t = typeAtCell(cx, cy), x = cx * CELL, y = cy * CELL, h1 = hash(cx, cy), h2 = hash(cy, cx);
    const tex = CELLS[t] && CELLS[t].texture; if (tex) tex(g, x, y, h1, h2, cx, cy, hash, CELL);
  }
  if (!pad) return c;
  const out = document.createElement('canvas'); out.width = out.height = Math.round(px);
  const o = out.getContext('2d'); o.filter = `blur(${(softPx * R * (softMode === 'low' ? 0.5 : 1)).toFixed(2)}px)`;
  o.drawImage(c, -pad * R, -pad * R);
  return out;
}
function chunk(kx, ky){
  const key = kx + ',' + ky;
  let c = chunks.get(key);
  if (c){ chunks.delete(key); chunks.set(key, c); return c; }
  if (renderBudget <= 0) return null;
  renderBudget--;
  c = renderChunk(kx, ky); chunks.set(key, c);
  while (chunks.size > 48) chunks.delete(chunks.keys().next().value);
  return c;
}
/* draw the ground under everything: only the chunks in view, at most a few new ones per frame */
function drawBase(g, camX, camY, vw, vh, t){
  renderBudget = 3;
  /* parallax, as a camera above the water sees it: the strands swim at the surface, and the ground lies below it, each
     layer deeper than the one above. A layer at depth d is drawn scaled about the middle of the view by 1 / (1 + d x gap),
     as a pinhole camera would see it: the walls (which reach the surface, and are where strands collide) are drawn as
     they are, and deeper ground looks a little smaller and slides more slowly than the strands as the view moves. Off to
     the sides you look down past the edge of each layer at the one below, and its sides (thin darkened slices, if on)
     fill that drop like cliff faces */
  const L = world ? parallaxLayers(look) : 0, P = L ? look.gap : 0, cx = camX + vw / 2, cy = camY + vh / 2;
  const hOf = i => Math.pow(i + 1, look.gapCurve || 1), top = L ? hOf(L - 1) : 0;
  const zOf = depth => 1 / (1 + depth * P);
  const at = (depth, fn) => { const z = zOf(depth); if (z === 1) return fn(); g.save(); g.translate(cx, cy); g.scale(z, z); g.translate(-cx, -cy); fn(); g.restore(); };
  /* the deepest layer looks smallest, so more of the map is needed to fill the view */
  const zf = zOf(top), hw = vw / 2 / zf, hh = vh / 2 / zf, S = CH * CELL;
  const k0 = Math.max(0, Math.floor((cx - hw) / S)), k1 = Math.min(Math.ceil(W / S) - 1, Math.floor((cx + hw) / S));
  const j0 = Math.max(0, Math.floor((cy - hh) / S)), j1 = Math.min(Math.ceil(H / S) - 1, Math.floor((cy + hh) / S));
  at(top, () => {
    for (let ky = j0; ky <= j1; ky++) for (let kx = k0; kx <= k1; kx++){
      const c = chunk(kx, ky);
      if (c) g.drawImage(c.floor || c, kx * S, ky * S, S, S);
      else { g.fillStyle = COL[K.OCEAN]; g.fillRect(kx * S, ky * S, S, S); }
    }
  });
  if (L){
    const slices = Math.round(look.sides || 0), list = [];
    for (let ky = j0; ky <= j1; ky++) for (let kx = k0; kx <= k1; kx++){ const c = chunks.get(kx + ',' + ky); if (c && c.layers) list.push([kx, ky, c]); }
    /* from the deepest raised layer up to the walls; each one's sides span the drop to the layer below it */
    for (let i = 0; i < L; i++){
      const k = L - 1 - i, d1 = top - hOf(i), d0 = i ? top - hOf(i - 1) : top;
      for (let s2 = 0; s2 < slices; s2++){ const dd = d0 + (d1 - d0) * s2 / slices;
        at(dd, () => { for (const [kx, ky, c] of list){ const q = c.layers[k]; if (q && q.side) g.drawImage(q.side, kx * S + q.x, ky * S + q.y, q.w, q.h); } }); }
      at(d1, () => { for (const [kx, ky, c] of list){ const q = c.layers[k]; if (q) g.drawImage(q.c, kx * S + q.x, ky * S + q.y, q.w, q.h); } });
    }
  }
  /* warm the cache just outside the view so swimming into new ground does not stutter */
  for (let ky = j0 - 1; ky <= j1 + 1 && renderBudget > 0; ky++) for (let kx = k0 - 1; kx <= k1 + 1 && renderBudget > 0; kx++){
    if (kx < 0 || ky < 0 || kx * S >= W || ky * S >= H || chunks.has(kx + ',' + ky)) continue; chunk(kx, ky);
  }
  /* the tide: water floods the flats and drains away again */
  const cx0 = Math.max(0, Math.floor(camX / CELL)), cx1 = Math.min(GW - 1, Math.floor((camX + vw) / CELL)), cy0 = Math.max(0, Math.floor(camY / CELL)), cy1 = Math.min(GH - 1, Math.floor((camY + vh) / CELL));
  const wet = Math.min(1, tide / 0.6);
  if (wet > 0.02 && !world){
    g.globalAlpha = wet * 0.92; g.fillStyle = COL[K.LAGOON]; g.beginPath();
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) if (grid[cy * GW + cx] === K.FLATS){ const x = (cx + 0.5) * CELL, y = (cy + 0.5) * CELL; g.moveTo(x + CELL * 0.74, y); g.arc(x, y, CELL * 0.74, 0, TAU); }
    g.fill(); g.globalAlpha = 1;
  }
  /* salt pools glow green as they dry out */
  for (const p of pools){
    if (!p.salt || !seen(p.x, p.y, p.r + 60, camX, camY, vw, vh)) continue;
    const k = Math.max(0, (0.45 - tide) / 0.45);
    g.globalAlpha = 0.12 + 0.3 * k; g.fillStyle = '#6f9a5c'; g.beginPath(); g.arc(p.x, p.y, p.r * 0.85, 0, TAU); g.fill();
    g.globalAlpha = 0.5 + 0.4 * k; g.setLineDash([3, 6]); g.strokeStyle = '#8fc07a'; g.lineWidth = 2; g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
  }
  /* the UV shallows: on the classic map a soft shimmer over their squares. In the generated world, sunlight glints
     instead: a few points in each shallow cell twinkle briefly, so the shallows read as bright, sunlit water without
     drawing the cell grid. Stateless (a function of the clock), so nothing is stored */
  if (!world){
    const sh = 0.05 + 0.04 * Math.sin(t * 1.3);
    g.globalAlpha = sh; g.fillStyle = '#9fb8ff'; g.beginPath();
    for (let cy = cy0; cy <= cy1; cy += 1) for (let cx = cx0; cx <= cx1; cx += 1) if (grid[cy * GW + cx] === K.UV){ const x = cx * CELL, y = cy * CELL; g.rect(x, y, CELL, CELL); }
    g.fill(); g.globalAlpha = 1;
  } else {
    g.fillStyle = '#dfe8ff';
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++){
      if (grid[cy * GW + cx] !== K.UV) continue;
      {
        const id = cy * GW + cx, per = 3 + hash(id, 1) * 4, ph = (t / per + hash(id, 2)) % 1;
        if (ph > 0.1) continue;
        const cyc = Math.floor(t / per + hash(id, 2)), a = Math.sin(Math.PI * ph / 0.1);
        const x = (cx + hash(id, cyc * 7 + 3)) * CELL, y = (cy + hash(id, cyc * 7 + 5)) * CELL, r = 0.6 + 0.9 * a;
        g.globalAlpha = 0.32 * a; g.fillRect(x - r * 2, y - 0.5, r * 4, 1); g.fillRect(x - 0.5, y - r * 2, 1, r * 4);
      }
    }
    g.globalAlpha = 1;
  }
}
const seen = (x, y, pad, camX, camY, vw, vh) => x > camX - pad && x < camX + vw + pad && y > camY - pad && y < camY + vh + pad;
function drawOver(g, camX, camY, vw, vh, t){
  /* currents: motes that wink into being somewhere along a stream, drift with it for a few seconds and fade away.
     Stateless: each mote's life is a function of the clock, so nothing is stored and every screen agrees closely enough */
  for (let fi = 0; fi < flows.length; fi++){
    const f = flows[fi], P = f.pts;
    if (!f.cum){ f.cum = [0]; for (let i = 1; i < P.length; i++) f.cum.push(f.cum[i - 1] + Math.hypot(P[i].x - P[i - 1].x, P[i].y - P[i - 1].y)); }
    const total = f.cum[f.cum.length - 1]; if (total < 1) continue;
    const n = Math.ceil(total / 55), rgb = f.kind === 'spill' ? '170,235,235' : f.kind === 'melt' ? '200,230,255' : '160,195,235';
    for (let k = 0; k < n; k++){
      const life = 2.6 + hash(fi * 977 + k, 3) * 2.4, tt = t / life + hash(fi * 977 + k, 5), cyc = Math.floor(tt), age = tt - cyc;
      const travel = life * f.v * 0.6, d = hash(fi * 977 + k, cyc * 31 + 7) * total + age * travel;
      if (d >= total) continue;
      let i = 1; while (i < f.cum.length - 1 && f.cum[i] < d) i++;
      const A = P[i - 1], B = P[i], seg = f.cum[i] - f.cum[i - 1] || 1, u = (d - f.cum[i - 1]) / seg;
      const ux = (B.x - A.x) / seg, uy = (B.y - A.y) / seg, o = (hash(fi * 977 + k, cyc * 31 + 11) - 0.5) * f.w * 0.7;
      const x = A.x + (B.x - A.x) * u - uy * o, y = A.y + (B.y - A.y) * u + ux * o;
      if (!seen(x, y, 10, camX, camY, vw, vh)) continue;
      const fade = Math.sin(Math.PI * age), r = 1.2 + hash(fi * 977 + k, 13) * 1.6;
      g.fillStyle = `rgba(${rgb},${(0.55 * fade * fade).toFixed(3)})`; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    }
  }
  /* lava: a dark crust, a glowing body and a bright core that streams downhill, with a hot front where it is advancing */
  for (const q of lavas){
    const ext = lavaExt(q);
    if (q.kind === 'pool'){
      const r = q.r0 + (q.r1 - q.r0) * ext; if (!seen(q.x, q.y, r + 60, camX, camY, vw, vh)) continue;
      const gr = g.createRadialGradient(q.x, q.y, r * 0.2, q.x, q.y, r + 50);
      const br = 0.85 + 0.15 * Math.sin(t * 1.7 + q.ph * 9);
      gr.addColorStop(0, `rgba(240,150,70,${(0.6 * br).toFixed(3)})`); gr.addColorStop(r / (r + 50) * 0.75, 'rgba(190,62,26,.5)'); gr.addColorStop(r / (r + 50), 'rgba(90,22,12,.45)'); gr.addColorStop(1, 'rgba(90,22,12,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(q.x, q.y, r + 50, 0, TAU); g.fill();
      g.globalAlpha = 0.3; g.strokeStyle = '#f0a860'; g.lineWidth = 1.5; g.setLineDash([4, 16]); g.lineDashOffset = -t * 8;
      g.beginPath(); g.arc(q.x, q.y, r * 0.6, 0, TAU); g.stroke(); g.setLineDash([]); g.lineDashOffset = 0; g.globalAlpha = 1;
      continue;
    }
    const b = q.box; if (b[2] < camX - 60 || b[0] > camX + vw + 60 || b[3] < camY - 60 || b[1] > camY + vh + 60) continue;
    const L = ext * q.total, P = q.pts; let fx = P[0].x, fy = P[0].y;
    g.beginPath(); g.moveTo(P[0].x, P[0].y);
    for (let k = 1; k < P.length; k++){
      if (q.cum[k] <= L){ g.lineTo(P[k].x, P[k].y); fx = P[k].x; fy = P[k].y; continue; }
      const f = (L - q.cum[k - 1]) / (q.cum[k] - q.cum[k - 1] || 1); fx = P[k - 1].x + (P[k].x - P[k - 1].x) * f; fy = P[k - 1].y + (P[k].y - P[k - 1].y) * f; g.lineTo(fx, fy); break;
    }
    g.lineJoin = 'round'; g.lineCap = 'round';
    g.strokeStyle = 'rgba(70,16,9,.5)'; g.lineWidth = q.w * 2 + 10; g.stroke();
    g.strokeStyle = 'rgba(180,56,24,.5)'; g.lineWidth = q.w * 2; g.stroke();
    g.strokeStyle = 'rgba(235,120,50,.4)'; g.lineWidth = q.w * 0.9; g.stroke();
    g.strokeStyle = 'rgba(255,190,110,.45)'; g.lineWidth = 2; g.setLineDash([5, 19]); g.lineDashOffset = -t * 30; g.stroke(); g.setLineDash([]); g.lineDashOffset = 0;
    /* the front: glows while it advances, dull while it ebbs */
    const adv = Math.sin(TAU * (clock / q.P + q.ph)) > 0, fr = g.createRadialGradient(fx, fy, 2, fx, fy, q.w * 2);
    fr.addColorStop(0, adv ? 'rgba(250,160,80,.55)' : 'rgba(200,80,40,.25)'); fr.addColorStop(1, 'rgba(200,80,40,0)');
    g.fillStyle = fr; g.beginPath(); g.arc(fx, fy, q.w * 2, 0, TAU); g.fill();
  }
  /* craters: a warm rim that cools over time */
  for (const c of craters){
    if (!seen(c.x, c.y, c.r + 40, camX, camY, vw, vh)) continue;
    const k = 1 - c.age / c.life;
    g.globalAlpha = 0.25 * k; g.fillStyle = '#e07a3c'; g.beginPath(); g.arc(c.x, c.y, c.r, 0, TAU); g.fill();
    g.globalAlpha = 0.6 * k + 0.2; g.strokeStyle = '#6a4a3a'; g.lineWidth = 8; g.stroke(); g.globalAlpha = 1;
  }
  /* black smokers: towers pouring black, scalding plumes */
  for (const s of smokers){
    if (!seen(s.x, s.y, s.r + 150, camX, camY, vw, vh)) continue;
    const gr = g.createRadialGradient(s.x, s.y, s.r * 0.2, s.x, s.y, s.r + 90);
    gr.addColorStop(0, 'rgba(255,110,60,.55)'); gr.addColorStop(s.r / (s.r + 90), 'rgba(140,40,20,.35)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(s.x, s.y, s.r + 90, 0, TAU); g.fill();
    g.fillStyle = '#050505'; g.beginPath(); g.arc(s.x, s.y, s.r * 0.75, 0, TAU); g.fill();
    for (let k = 0; k < 5; k++){ const a = t * 0.6 + k * 1.3, rr2 = s.r * (0.5 + ((t * 0.4 + k * 0.2) % 1)); g.globalAlpha = 0.5 * (1 - ((t * 0.4 + k * 0.2) % 1)); g.fillStyle = '#111'; g.beginPath(); g.arc(s.x + Math.cos(a) * rr2 * 0.6, s.y + Math.sin(a) * rr2 * 0.6, s.r * 0.35, 0, TAU); g.fill(); }
    g.globalAlpha = 1; g.strokeStyle = '#ff7a45'; g.lineWidth = 2; g.setLineDash([2, 6]); g.beginPath(); g.arc(s.x, s.y, s.r, 0, TAU); g.stroke(); g.setLineDash([]);
  }
  /* geysers: steam, bubbling, then a burst */
  for (const q of geysers){
    if (!seen(q.x, q.y, q.r + 60, camX, camY, vw, vh)) continue;
    const bub = q.phase === 'bubble', bur = q.phase === 'burst';
    g.globalAlpha = bur ? 0.6 : bub ? 0.35 + 0.25 * Math.sin(t * 20) : 0.18; g.strokeStyle = '#d8f4f2'; g.lineWidth = bur ? 6 : 2;
    g.beginPath(); g.arc(q.x, q.y, bur ? q.r * (1.2 - q.t) : q.r * 0.6, 0, TAU); g.stroke();
    if (bur){ g.fillStyle = '#e8fbfa'; g.globalAlpha = 0.25; g.beginPath(); g.arc(q.x, q.y, q.r * 1.3, 0, TAU); g.fill(); }
    g.globalAlpha = 1;
  }
  /* pumice rafts: foamy rings with gaps, shelters that drift on the gyre */
  for (const r of rafts){
    if (!seen(r.x, r.y, r.r + 30, camX, camY, vw, vh)) continue;
    g.globalAlpha = 0.18; g.fillStyle = '#b9ad94'; g.beginPath(); g.arc(r.x, r.y, r.r - 16, 0, TAU); g.fill(); g.globalAlpha = 1;
    for (let k = 0; k < 40; k++){
      const a = k / 40 * TAU, rel = a;
      if (r.gaps.some(gp => Math.abs(((rel - gp + Math.PI * 3) % TAU) - Math.PI) < 0.42)) continue;
      const aa = a + r.rot, x = r.x + Math.cos(aa) * r.r, y = r.y + Math.sin(aa) * r.r;
      g.fillStyle = k % 3 ? '#a99f88' : '#8a826f'; g.beginPath(); g.arc(x, y, 10 + hash(k, 7) * 6, 0, TAU); g.fill();
      g.fillStyle = '#4d473c'; g.beginPath(); g.arc(x + 3, y - 2, 2, 0, TAU); g.fill();
    }
  }
  /* biome names, faint, so the map can be learned */
  for (const L of LABELS){ if (seen(L.x, L.y, 300, camX, camY, vw, vh)) label(g, L.t, L.x, L.y); }
}
/* warnings drawn above the strands: UV flashes and incoming meteorites */
function drawWarnings(g, camX, camY, vw, vh, t, early, text){
  for (const u of uvFlashes){
    if (u.t > early || !seen(u.x, u.y, u.r + 40, camX, camY, vw, vh)) continue;
    const pulse = 0.5 + 0.5 * Math.sin(t * 14);
    g.globalAlpha = 0.1 + 0.14 * pulse; g.fillStyle = '#e8e2a0'; g.beginPath(); g.arc(u.x, u.y, u.r, 0, TAU); g.fill();
    g.globalAlpha = 1; g.lineWidth = 3; g.strokeStyle = '#e3c54a'; g.setLineDash([10, 8]); g.stroke(); g.setLineDash([]);
    text(`UV ${Math.max(0, u.t).toFixed(1)}`, u.x, u.y - u.r - 8);
  }
  for (const m of meteors){
    if (!seen(m.x, m.y, m.r + 400, camX, camY, vw, vh)) continue;
    const k = 1 - m.t / 4.5;
    g.globalAlpha = 0.2 + 0.3 * k; g.strokeStyle = '#ff9a5a'; g.lineWidth = 3; g.setLineDash([12, 8]); g.beginPath(); g.arc(m.x, m.y, m.r, 0, TAU); g.stroke(); g.setLineDash([]);
    const sx = m.x - 900 * (1 - k), sy = m.y - 700 * (1 - k);
    g.globalAlpha = 0.9; g.strokeStyle = '#ffd2a0'; g.lineWidth = 4; g.beginPath(); g.moveTo(sx - 120, sy - 95); g.lineTo(sx, sy); g.stroke();
    g.fillStyle = '#fff3e0'; g.beginPath(); g.arc(sx, sy, 7, 0, TAU); g.fill(); g.globalAlpha = 1;
    text(`METEORITE ${Math.max(0, m.t).toFixed(1)}`, m.x, m.y - m.r - 10);
  }
}
let label = (g, t, x, y) => { g.font = '800 42px system-ui, sans-serif'; g.textAlign = 'center'; g.fillStyle = 'rgba(230,235,255,.13)'; g.fillText(t, x, y); };

/* ---------- minimap: the whole map drawn once at one pixel per cell ---------- */
const mini = {c:null, dirty:true};
function buildMinimap(){
  const c = mini.c || document.createElement('canvas'); c.width = GW; c.height = GH;
  const g = c.getContext && c.getContext('2d'); if (!g){ mini.dirty = false; return; }   /* no canvas (a server room): nothing to draw */
  const img = g.createImageData(GW, GH);
  if (world){
    /* the world's own look (fill, outlines, walls, colours), with half the bands: wall, shallows (1-2), middle (3-4),
       deep (5-6) and black. At one pixel per 50 px cell the full seven bands are a blur of rings; four read at a glance */
    const WG = window.WorldGen, T = WG.T, BR = WG.BRIGHT, Lk = look, col = [0, 0, 0], [d0, d1, d2] = Lk.deep;
    const CUT = [T[0], T[2], T[4], T[6]], REP = [0, 1.5, 3.5, 5.5];
    const brAt = r => { const k = Math.floor(r), f = r - k, v = BR[k] + (BR[Math.min(6, k + 1)] - BR[k]) * f; return Math.max(0, 1 - (1 - v) * Lk.depth); };
    const band = new Uint8Array(GW * GH), cols = new Float32Array(GW * GH * 3), low = [0, 0, 0], hs = shifting(Lk);
    for (let cy = 0; cy < GH; cy++) for (let cx = 0; cx < GW; cx++){
      const x = (cx + 0.5) * CELL, y = (cy + 0.5) * CELL, e = surf.elev(x, y), n = cy * GW + cx;
      let b = 0; while (b < 4 && e < CUT[b]) b++; band[n] = b;
      /* with hue shifting, the colour part way down for this coarse band */
      if (hs){ surf.colour2(x, y, col, low); const f = (6 - REP[Math.min(3, b)]) / 6; for (let k = 0; k < 3; k++) col[k] = low[k] + (col[k] - low[k]) * f; } else surf.colour(x, y, col);
      cols[n * 3] = col[0]; cols[n * 3 + 1] = col[1]; cols[n * 3 + 2] = col[2];
    }
    /* a little more fill than the big map, so the overview never goes all black; lines where the coarse band changes */
    const fill = Math.max(Lk.fill, 0.3), line = Math.max(Lk.line, Lk.fill < 0.5 ? 0.6 : 0);
    for (let cy = 0; cy < GH; cy++) for (let cx = 0; cx < GW; cx++){
      const n = cy * GW + cx, b = band[n], o = n * 4, cr = cols[n * 3], cg = cols[n * 3 + 1], cb = cols[n * 3 + 2];
      let r = d0, gg = d1, bb = d2;
      if (b < 4){
        const m = brAt(REP[b]) * 1.15;
        r = d0 + (cr * m - d0) * fill; gg = d1 + (cg * m - d1) * fill; bb = d2 + (cb * m - d2) * fill;
        if (b === 0 && Lk.wall > fill * m){ r = d0 + (cr * Lk.wall - d0); gg = d1 + (cg * Lk.wall - d1); bb = d2 + (cb * Lk.wall - d2); }
      }
      /* an edge: a neighbour (right or below) is a shallower coarse band; the line takes the shallower band's brightness */
      const nb = Math.min(cx < GW - 1 ? band[n + 1] : b, cy < GH - 1 ? band[n + GW] : b, cx > 0 ? band[n - 1] : b, cy > 0 ? band[n - GW] : b);
      if (line > 0 && nb < b){ const mm = 1 - Lk.lineFade * (1 - brAt(REP[nb])) * 0.8; r += (cr * mm - r) * line; gg += (cg * mm - gg) * line; bb += (cb * mm - bb) * line; }
      img.data[o] = Math.min(255, r); img.data[o + 1] = Math.min(255, gg); img.data[o + 2] = Math.min(255, bb); img.data[o + 3] = 255;
    }
    /* active lava, at its fullest */
    const hot = (x, y) => { const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL); if (cx < 0 || cy < 0 || cx >= GW || cy >= GH) return; const o = (cy * GW + cx) * 4; img.data[o] = 235; img.data[o + 1] = 96; img.data[o + 2] = 36; };
    for (const q of lavas){
      if (q.kind === 'pool'){ for (let y = q.y - q.r1; y <= q.y + q.r1; y += CELL / 2) for (let x = q.x - q.r1; x <= q.x + q.r1; x += CELL / 2) if (Math.hypot(x - q.x, y - q.y) <= q.r1) hot(x, y); continue; }
      for (let k = 1; k < q.pts.length; k++){ const A = q.pts[k - 1], B = q.pts[k], n = Math.ceil(Math.hypot(B.x - A.x, B.y - A.y) / (CELL / 2)); for (let j = 0; j <= n; j++) hot(A.x + (B.x - A.x) * j / n, A.y + (B.y - A.y) * j / n); }
    }
    g.putImageData(img, 0, 0); mini.c = c; mini.dirty = false; return;
  }
  const rgb = COL.map(h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);
  for (let i = 0; i < grid.length; i++){ const t = grid[i], mt = CELLS[t].mini ? K[CELLS[t].mini] : t, [r, gg, b] = rgb[mt], o = i * 4; img.data[o] = Math.min(255, r * 1.6 + 8); img.data[o + 1] = Math.min(255, gg * 1.6 + 8); img.data[o + 2] = Math.min(255, b * 1.6 + 10); img.data[o + 3] = 255; }
  g.putImageData(img, 0, 0); mini.c = c; mini.dirty = false;
}
/* the part of the map the minimap shows: the lobby's pool and a margin, or the whole world */
function miniView(){
  if (!lobby || world) return {x:0, y:0, w:W, h:H};
  const mw = (LOBBY.a + 350) * 2, mh = mw * H / W;
  return {x:LOBBY.x - mw / 2, y:LOBBY.y - mh / 2, w:mw, h:mh};
}
function drawMinimap(g, x, y, w){
  if (mini.dirty) buildMinimap();
  const v = miniView(), k = w / v.w, px = X => x + (X - v.x) * k, py = Y => y + (Y - v.y) * k;
  g.imageSmoothingEnabled = true; g.drawImage(mini.c, v.x / CELL, v.y / CELL, v.w / CELL, v.h / CELL, x, y, w, v.h * k);
  for (const s of smokers){ g.fillStyle = '#ff6a3a'; g.fillRect(px(s.x) - 1, py(s.y) - 1, 2.5, 2.5); }
  for (const r of rafts){ g.fillStyle = '#c9bfa6'; g.beginPath(); g.arc(px(r.x), py(r.y), 2, 0, TAU); g.fill(); }
  for (const m of meteors){ g.strokeStyle = '#ff9a5a'; g.beginPath(); g.arc(px(m.x), py(m.y), 4, 0, TAU); g.stroke(); }
}

/* ---------- network: a server room sends its live map state; a client mirrors it ----------
   The terrain itself comes from the seed (generate is deterministic), so only what changes during a round is sent. */
const r2 = v => Math.round(v * 100) / 100, PHC = {wait:'w', bubble:'b', burst:'x'};
function netState(){
  return {c:r2(clock), r:rafts.map(r => [Math.round(r.u * 1e5) / 1e5, r2(r.rot)]), g:geysers.map(g => [PHC[g.phase], r2(g.t)]),
          cr:craters.map(c => [Math.round(c.x), Math.round(c.y), c.r, r2(c.age), c.life]), m:meteors.map(m => [Math.round(m.x), Math.round(m.y), r2(m.t), m.r]),
          uv:uvFlashes.map(u => [Math.round(u.x), Math.round(u.y), Math.round(u.r), r2(u.t)]), melt:[...melted]};
}
const PH = {w:'wait', b:'bubble', x:'burst'};
function applyNet(st){
  if (!st || !grid) return;
  clock = st.c; tide = 0.5 + 0.5 * Math.cos(clock * TAU / 80);
  st.r.forEach((v, i) => { const r = rafts[i]; if (r){ r.u = v[0]; r.rot = v[1]; } }); placeRafts(0);
  st.g.forEach((v, i) => { const g = geysers[i]; if (g){ g.phase = PH[v[0]] || 'wait'; g.t = v[1]; } });
  craters = st.cr.map(v => ({x:v[0], y:v[1], r:v[2], age:v[3], life:v[4]}));
  meteors = st.m.map(v => ({x:v[0], y:v[1], t:v[2], r:v[3]}));
  uvFlashes = st.uv.map(v => ({x:v[0], y:v[1], r:v[2], t:v[3]}));
  const now = new Set(st.melt);
  for (const key of [...melted]) if (!now.has(key)){ grid[key] = K.ICE; melted.delete(key); dirty(key % GW, Math.floor(key / GW)); }
  for (const key of now) if (!melted.has(key)){ grid[key] = K.BRINE; melted.add(key); dirty(key % GW, Math.floor(key / GW)); }
}
/* between server updates a client keeps the clock, tide, rafts and timers moving, but makes no events of its own */
function coast(dt){
  if (!grid || !raftRoute) return;
  clock += dt; tide = 0.5 + 0.5 * Math.cos(clock * TAU / 80); placeRafts(dt);
  for (const c of craters) c.age += dt;
  for (const g of geysers) g.t = Math.max(0, g.t - dt);
  for (const m of meteors) m.t = Math.max(0, m.t - dt);
  for (const u of uvFlashes) u.t = Math.max(0, u.t - dt);
}

/* ---------- queries for the bots: where is the nearest or a random cell of some kinds ---------- */
function nearestOf(types, x, y, maxD){
  const cx0 = Math.floor(x / CELL), cy0 = Math.floor(y / CELL), want = new Uint8Array(CELLS.length);
  for (const t of types) want[t] = 1;
  const R = Math.ceil((maxD || 3000) / CELL);
  for (let r = 0; r <= R; r++){
    let best = null, bd = 1e9;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++){
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const cx = cx0 + dx, cy = cy0 + dy;
      if (cx < 0 || cy < 0 || cx >= GW || cy >= GH || !want[grid[cy * GW + cx]]) continue;
      const d = dx * dx + dy * dy; if (d < bd){ bd = d; best = {x:(cx + 0.5) * CELL, y:(cy + 0.5) * CELL}; }
    }
    if (best) return best;
  }
  return null;
}
function randomOf(types){
  let total = 0; for (const t of types) total += byType[t].length;
  if (!total) return null;
  let r = Math.floor(Math.random() * total);
  for (const t of types){ const L = byType[t]; if (r < L.length){ const i = L[r]; return {x:(i % GW + 0.5) * CELL, y:(Math.floor(i / GW) + 0.5) * CELL}; } r -= L.length; }
  return null;
}

return {get W(){ return W; }, get H(){ return H; }, get world(){ return world; }, get surface(){ return surf; }, get worldHash(){ return world ? worldHash : 0; }, get worldLook(){ return JSON.parse(JSON.stringify(look)); }, setWorldLook, LOOK_BASE, CELL, K, CELLS, generate, update, typeAt, cellAt, solidAt, speedAt, flowAt, zoneAt, shelterAt, saltAt, smokerAt, lowTide, poolAt,
  spawnSpot, miniView, findPath, lineClear, nearestOf, randomOf, netState, applyNet, coast, typeCount:t => byType[t].length, drawBase, drawOver, drawWarnings, drawMinimap,
  setLabelDrawer:f => { label = f; },
  get lavas(){ return lavas; }, lavaAt, lavaNear, lowsOf,
  get lobby(){ return lobby; }, get tide(){ return tide; }, get springs(){ return springs; }, get smokers(){ return smokers; }, get rafts(){ return rafts; }, get pools(){ return pools; },
  get meteors(){ return meteors; }, get uvFlashes(){ return uvFlashes; }, get craters(){ return craters; }, get geysers(){ return geysers; }, get chunkCount(){ return chunks.size; }, setSoft, renderChunk};
};
window.SoupMap = makeSoupMap();
window.SoupMap.create = makeSoupMap;
