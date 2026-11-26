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
const W = 9200, H = 6000, CELL = 50, GW = W / CELL, GH = H / CELL, CH = 10, CR = 0.8;
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
let raftRoute = null, melted = new Set(), byType = [], tide = 1, clock = 0, iceT = 12, meteorT = 30, uvT = 4;
const cellIdx = (cx, cy) => cy * GW + cx;
const typeAtCell = (cx, cy) => (cx < 0 || cy < 0 || cx >= GW || cy >= GH) ? K.DEEP : grid[cellIdx(cx, cy)];
const typeAt = (x, y) => typeAtCell(Math.floor(x / CELL), Math.floor(y / CELL));

/* ---------- generation ---------- */
/* the lobby: before a room's game starts, players wait in a small walled pool with clumps of letters that keep refilling.
   No hazards, no tide effects, nothing that moves but letters and strands. */
let lobby = false, lobbyClumps = [];
const LOBBY = {x:W / 2, y:H / 2, a:1100, b:700};
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
  seed = s >>> 0 || 1; lat = new Float32Array(64 * 64); for (let i = 0; i < lat.length; i++) lat[i] = rng();
  grid = new Uint8Array(GW * GH).fill(K.OCEAN);
  flows = []; pools = []; springs = []; smokers = []; geysers = []; rafts = []; craters = []; meteors = []; uvFlashes = []; LABELS.length = 0;
  melted = new Set(); chunks.clear(); tide = 1; clock = 0; iceT = 12; meteorT = rr(25, 40); uvT = 3;
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
const solidAt = (x, y) => !!SOLID[typeAt(x, y)] || !!raftWallAt(x, y);
const lowTide = () => tide < 0.35;
const poolAt = (x, y) => pools.find(p => Math.hypot(x - p.x, y - p.y) < p.r * 0.9) || null;
const saltAt = (x, y) => { const p = poolAt(x, y); return !!(p && p.salt && tide < 0.45); };
const smokerAt = (x, y, pad) => smokers.find(s => Math.hypot(x - s.x, y - s.y) < s.r + (pad || 0)) || null;
const craterAt = (x, y) => craters.find(c => Math.hypot(x - c.x, y - c.y) < c.r) || null;
function speedAt(x, y){
  const t = typeAt(x, y);
  if (t === K.FLATS) return 0.3 + 0.7 * Math.min(1, tide / 0.55);
  return CELLS[t].speed || 1;
}
const cellAt = (x, y) => CELLS[typeAt(x, y)];
/* shelters: nursery pockets, ice veins and the inside of a pumice raft keep out radiation and meteorites */
const shelterAt = (x, y) => !!CELLS[typeAt(x, y)].shelter || !!raftInside(x, y);
function zoneAt(x, y){
  if (smokerAt(x, y, 90)) return 'smoker';
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
  if (iceT <= 0){
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
    else { const list = byType[K.UV], i = list[Math.floor(Math.random() * list.length)]; x = (i % GW + 0.5) * CELL; y = (Math.floor(i / GW) + 0.5) * CELL; }
    uvFlashes.push({x, y, r:150 + Math.random() * 50, t:3.5});
  }
  for (const u of uvFlashes){ u.t -= dt; if (u.t <= 0) ev.uv && ev.uv(u); }
  uvFlashes = uvFlashes.filter(u => u.t > 0);
}

/* ---------- drawing: cached terrain chunks, plus what moves ---------- */
const chunks = new Map(); let renderBudget = 0;
function dirty(cx, cy){ chunks.delete(Math.floor(cx / CH) + ',' + Math.floor(cy / CH)); mini.dirty = true; }
const hash = (a, b) => { let h = Math.imul(a, 374761393) + Math.imul(b, 668265263); h = Math.imul(h ^ h >>> 13, 1274126177); return ((h ^ h >>> 16) >>> 0) / 4294967296; };
function renderChunk(kx, ky){
  const c = document.createElement('canvas'), px = CH * CELL * CR; c.width = c.height = px;
  const g = c.getContext('2d'); g.scale(CR, CR); g.translate(-kx * CH * CELL, -ky * CH * CELL);
  const cx0 = kx * CH - 1, cy0 = ky * CH - 1, cx1 = kx * CH + CH, cy1 = ky * CH + CH;
  g.fillStyle = COL[K.OCEAN]; g.fillRect(kx * CH * CELL, ky * CH * CELL, CH * CELL, CH * CELL);
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
  for (let cy = cy0 + 1; cy < cy1; cy++) for (let cx = cx0 + 1; cx < cx1; cx++){
    const t = typeAtCell(cx, cy), x = cx * CELL, y = cy * CELL, h1 = hash(cx, cy), h2 = hash(cy, cx);
    const tex = CELLS[t] && CELLS[t].texture; if (tex) tex(g, x, y, h1, h2, cx, cy, hash, CELL);
  }
  return c;
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
  const S = CH * CELL, k0 = Math.max(0, Math.floor(camX / S)), k1 = Math.min(Math.ceil(W / S) - 1, Math.floor((camX + vw) / S));
  const j0 = Math.max(0, Math.floor(camY / S)), j1 = Math.min(Math.ceil(H / S) - 1, Math.floor((camY + vh) / S));
  for (let ky = j0; ky <= j1; ky++) for (let kx = k0; kx <= k1; kx++){
    const c = chunk(kx, ky);
    if (c) g.drawImage(c, kx * S, ky * S, S, S);
    else { g.fillStyle = COL[K.OCEAN]; g.fillRect(kx * S, ky * S, S, S); }
  }
  /* warm the cache just outside the view so swimming into new ground does not stutter */
  for (let ky = j0 - 1; ky <= j1 + 1 && renderBudget > 0; ky++) for (let kx = k0 - 1; kx <= k1 + 1 && renderBudget > 0; kx++){
    if (kx < 0 || ky < 0 || kx * S >= W || ky * S >= H || chunks.has(kx + ',' + ky)) continue; chunk(kx, ky);
  }
  /* the tide: water floods the flats and drains away again */
  const cx0 = Math.max(0, Math.floor(camX / CELL)), cx1 = Math.min(GW - 1, Math.floor((camX + vw) / CELL)), cy0 = Math.max(0, Math.floor(camY / CELL)), cy1 = Math.min(GH - 1, Math.floor((camY + vh) / CELL));
  const wet = Math.min(1, tide / 0.6);
  if (wet > 0.02){
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
  /* the UV shallows shimmer */
  const sh = 0.05 + 0.04 * Math.sin(t * 1.3);
  g.globalAlpha = sh; g.fillStyle = '#9fb8ff'; g.beginPath();
  for (let cy = cy0; cy <= cy1; cy += 1) for (let cx = cx0; cx <= cx1; cx += 1) if (grid[cy * GW + cx] === K.UV){ const x = cx * CELL, y = cy * CELL; g.rect(x, y, CELL, CELL); }
  g.fill(); g.globalAlpha = 1;
}
const seen = (x, y, pad, camX, camY, vw, vh) => x > camX - pad && x < camX + vw + pad && y > camY - pad && y < camY + vh + pad;
function drawOver(g, camX, camY, vw, vh, t){
  /* currents: arrows drift along each stream */
  g.lineCap = 'round';
  for (const f of flows){
    const P = f.pts;
    for (let i = 0; i + 1 < P.length; i++){
      const a = P[i], b = P[i + 1], L = Math.hypot(b.x - a.x, b.y - a.y);
      if (!seen((a.x + b.x) / 2, (a.y + b.y) / 2, L / 2 + f.w, camX, camY, vw, vh)) continue;
      const ux = (b.x - a.x) / L, uy = (b.y - a.y) / L, sp = 90, off = (t * f.v * 0.6) % sp;
      g.strokeStyle = f.kind === 'spill' ? 'rgba(140,220,220,.45)' : f.kind === 'melt' ? 'rgba(180,220,255,.4)' : 'rgba(120,160,210,.32)'; g.lineWidth = 2.2;
      g.beginPath();
      for (let d = off; d < L; d += sp) for (const o of [-f.w * 0.25, f.w * 0.25]){
        const x = a.x + ux * d - uy * o, y = a.y + uy * d + ux * o;
        g.moveTo(x - ux * 9 - uy * 6, y - uy * 9 + ux * 6); g.lineTo(x, y); g.lineTo(x - ux * 9 + uy * 6, y - uy * 9 - ux * 6);
      }
      g.stroke();
    }
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
  const rgb = COL.map(h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);
  for (let i = 0; i < grid.length; i++){ const t = grid[i], mt = CELLS[t].mini ? K[CELLS[t].mini] : t, [r, gg, b] = rgb[mt], o = i * 4; img.data[o] = Math.min(255, r * 1.6 + 8); img.data[o + 1] = Math.min(255, gg * 1.6 + 8); img.data[o + 2] = Math.min(255, b * 1.6 + 10); img.data[o + 3] = 255; }
  g.putImageData(img, 0, 0); mini.c = c; mini.dirty = false;
}
function drawMinimap(g, x, y, w){
  if (mini.dirty) buildMinimap();
  g.imageSmoothingEnabled = true; g.drawImage(mini.c, x, y, w, w * H / W);
  for (const s of smokers){ g.fillStyle = '#ff6a3a'; g.fillRect(x + s.x / W * w - 1, y + s.y / H * w * H / W - 1, 2.5, 2.5); }
  for (const r of rafts){ g.fillStyle = '#c9bfa6'; g.beginPath(); g.arc(x + r.x / W * w, y + r.y / H * w * H / W, 2, 0, TAU); g.fill(); }
  for (const m of meteors){ g.strokeStyle = '#ff9a5a'; g.beginPath(); g.arc(x + m.x / W * w, y + m.y / H * w * H / W, 4, 0, TAU); g.stroke(); }
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

return {W, H, CELL, K, CELLS, generate, update, typeAt, cellAt, solidAt, speedAt, flowAt, zoneAt, shelterAt, saltAt, smokerAt, lowTide, poolAt,
  spawnSpot, findPath, lineClear, nearestOf, randomOf, netState, applyNet, coast, typeCount:t => byType[t].length, drawBase, drawOver, drawWarnings, drawMinimap,
  setLabelDrawer:f => { label = f; },
  get lobby(){ return lobby; }, get tide(){ return tide; }, get springs(){ return springs; }, get smokers(){ return smokers; }, get rafts(){ return rafts; }, get pools(){ return pools; },
  get meteors(){ return meteors; }, get uvFlashes(){ return uvFlashes; }, get craters(){ return craters; }, get geysers(){ return geysers; }, get chunkCount(){ return chunks.size; }};
};
window.SoupMap = makeSoupMap();
window.SoupMap.create = makeSoupMap;
