/* RNA Strand Soup: world generator, step 1 (lab test). Zones, deep channels, the lagoon's ring mounds with doorways,
   letter seeding and spawns, as one elevation field E (0 bottomless .. 1 surface; above 0.86 is a wall) on a grid.

   Only basic arithmetic (+ - * /, Math.floor, Math.sqrt, Math.imul), never Math.sin/cos/exp/atan2: those may differ
   by a last bit between browsers, and growth amplifies any difference. With this rule the server and every browser
   build the identical map from a seed. dsin/dcos below are plain series instead.

   Scales (see the map design doc): world (zones, channels) -> region (later: craters, volcanoes) -> place (later:
   reaction-diffusion) -> player (here: ring mounds, doorways, letters). */
window.WorldGen = (() => {
'use strict';
const PI = 3.141592653589793, TAU = 2 * PI;
function dsin(x){
  x = x - TAU * Math.floor((x + PI) / TAU);
  if (x > PI / 2) x = PI - x; else if (x < -PI / 2) x = -PI - x;
  const x2 = x * x;
  return x * (1 - x2 / 6 * (1 - x2 / 20 * (1 - x2 / 42 * (1 - x2 / 72 * (1 - x2 / 110 * (1 - x2 / 156))))));
}
const dcos = x => dsin(x + PI / 2);
function rng(seed){ let a = seed >>> 0 || 1; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const smooth = (a, b, x) => { const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a); return t * t * (3 - 2 * t); };
function noiseGrid(r){ const g = new Float32Array(64 * 64); for (let i = 0; i < g.length; i++) g[i] = r() * 2 - 1; return g; }
function vnoise(g, x, y){
  const i = Math.floor(x), j = Math.floor(y), tx = x - i, ty = y - j, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const a = (u, v) => g[((v & 63) << 6) + (u & 63)];
  return (a(i, j) * (1 - sx) + a(i + 1, j) * sx) * (1 - sy) + (a(i, j + 1) * (1 - sx) + a(i + 1, j + 1) * sx) * sy;
}
const fbm = (g, x, y) => vnoise(g, x, y) * 0.55 + vnoise(g, x * 2.03 + 17.1, y * 2.03 + 3.3) * 0.28 + vnoise(g, x * 4.1 + 5.7, y * 4.1 + 29.2) * 0.17;
const segDist = (x, y, a, b) => { const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy; let t = L ? ((x - a.x) * dx + (y - a.y) * dy) / L : 0; t = t < 0 ? 0 : t > 1 ? 1 : t; const ex = x - a.x - t * dx, ey = y - a.y - t * dy; return Math.sqrt(ex * ex + ey * ey); };
function blur(a, GX, GY, r){
  const t = new Float32Array(a.length);
  for (let j = 0; j < GY; j++){ let s = 0, c = 0; for (let i = -r; i < GX + r; i++){ if (i + r < GX){ s += a[j * GX + i + r]; c++; } if (i - r - 1 >= 0){ s -= a[j * GX + i - r - 1]; c--; } if (i >= 0 && i < GX) t[j * GX + i] = s / c; } }
  for (let i = 0; i < GX; i++){ let s = 0, c = 0; for (let j = -r; j < GY + r; j++){ if (j + r < GY){ s += t[(j + r) * GX + i]; c++; } if (j - r - 1 >= 0){ s -= t[(j - r - 1) * GX + i]; c--; } if (j >= 0 && j < GY) a[j * GX + i] = s / c; } }
}

/* the depth bands (as in the lab): E >= WALL is a wall; the black depth is below 0.14 */
const WALL = 0.86, DEFAULTS = {lagoon:1650, mounds:7, rin:280, rim:58, door:50, channel:220, spread:20, pockets:4, rosettes:60, gap:10, slope:30, dither:2.3, outer:['island', 'chimneys', 'ice', 'ridge']};

function generate(o){
  const p = Object.assign({}, DEFAULTS, o), {W, H, RES} = p, GX = Math.round(W / RES), GY = Math.round(H / RES), N = GX * GY;
  const r = rng(p.seed * 2654435761);
  const g = Array.from({length:6}, () => noiseGrid(r));
  const E = new Float32Array(N), zone = new Uint8Array(N);
  const w = {lagoon:new Float32Array(N), flats:new Float32Array(N), water:new Float32Array(N)};
  p.outer.forEach(id => w[id] = new Float32Array(N));

  /* ---- world scale: the lagoon in the middle, a middle ring, outer areas split among the places ---- */
  const cx = W / 2 + (r() - 0.5) * 400, cy = H / 2 + (r() - 0.5) * 300, RX = p.lagoon, RY = p.lagoon * 0.78;
  const a0 = r() * TAU, K = p.outer.length;
  const sites = p.outer.map((id, k) => { const a = a0 + TAU * k / K + (r() - 0.5) * 0.5; return {id, a, ux:dcos(a), uy:dsin(a)}; });
  const dn = (x, y) => { const ex = (x - cx) / RX, ey = (y - cy) / RY; return Math.sqrt(ex * ex + ey * ey) + 0.16 * fbm(g[0], x / 1800, y / 1800); };
  const at = (a, d) => ({x:cx + RX * d * dcos(a), y:cy + RY * d * dsin(a)});

  /* ---- deep channels, laid down first so the land forms around them ----
     a ring between the middle ring and the outer areas, three quarters of the way round; spokes from the lagoon's edge
     to the ring through the gaps between places; and a connector from the ring into every outer place */
  const lines = [], ringStart = a0 + PI / K + (r() - 0.5) * 0.4, ring = [];
  for (let k = 0; k <= 54; k++){ const a = ringStart + 1.5 * PI * k / 54; ring.push(at(a, 1.82 * (1 + 0.05 * fbm(g[1], k * 0.3, 1.7)))); }
  lines.push(ring);
  const meander = (A, B, n, amp, gi) => { const pts = [], dx = B.x - A.x, dy = B.y - A.y, L = Math.sqrt(dx * dx + dy * dy), nx = -dy / L, ny = dx / L;
    for (let k = 0; k <= n; k++){ const t = k / n, m = amp * fbm(g[gi], t * 2.3 + gi * 3.1, 0.5) * (1 - (2 * t - 1) * (2 * t - 1)); pts.push({x:A.x + dx * t + nx * m, y:A.y + dy * t + ny * m}); } return pts; };
  const gaps = sites.map((s, k) => s.a + PI / K).slice(0, 3);
  gaps.forEach((a, k) => lines.push(meander(at(a, 0.98), at(a + (r() - 0.5) * 0.3, 1.82), 14, 260, 2 + (k % 3))));
  sites.forEach((s, k) => lines.push(meander(at(s.a + (r() - 0.5) * 0.25, 1.82), at(s.a, 2.45), 10, 200, 3 + (k % 2))));
  const segs = []; for (const L of lines) for (let k = 0; k + 1 < L.length; k++) segs.push([L[k], L[k + 1]]);
  const half = p.channel / 2;

  /* ---- every point belongs to exactly one place: discrete zones ----
     Each place has a smooth weight (zones by distance from the lagoon, outer places by direction). Near a border the
     weights are close, so a blobby noise per place decides: the two zones interleave in blob-shaped islands ("dither"
     in discrete blobs) instead of blending. Channels are their own place. */
  const PIDS = ['lagoon', 'flats'].concat(p.outer).concat(['water']), pid = new Uint8Array(N), L0 = new Float32Array(N), L1 = new Float32Array(N), CH = new Float32Array(N), BK = new Float32Array(N);
  const blobG = PIDS.map(() => noiseGrid(r));
  for (let j = 0; j < GY; j++) for (let i = 0; i < GX; i++){
    const n = j * GX + i, x = (i + 0.5) * RES, y = (j + 0.5) * RES, d = dn(x, y);
    const wL = 1 - smooth(0.74, 1.26, d), wO = smooth(1.45, 2.05, d), wM = Math.max(0, 1 - wL - wO);
    let ux = (x - cx) / RX, uy = (y - cy) / RY; const ul = Math.sqrt(ux * ux + uy * uy) || 1; ux /= ul; uy /= ul;
    let bd = -2; const dots = sites.map(s0 => { const v = ux * s0.ux + uy * s0.uy; if (v > bd) bd = v; return v; });
    let st = 0; const sw = dots.map(v => { const q = Math.max(0, 1 - (bd - v) / 0.45); st += q; return q; });
    const score = [wL, wM].concat(sw.map(q => wO * q / st));
    let best = 0, bs = -9;
    for (let k = 0; k < score.length; k++){
      const blob = fbm(blobG[k], x / 520, y / 520) * 0.5 + fbm(blobG[k], x / 230 + 40, y / 230) * 0.5;
      const v = score[k] + p.dither * blob; if (v > bs){ bs = v; best = k; }
    }
    let cd = Infinity; for (const [A, B] of segs){ const v = segDist(x, y, A, B); if (v < cd) cd = v; }
    CH[n] = 1 - smooth(half * 0.55, half, cd); BK[n] = smooth(half * 0.9, half * 1.15, cd) * (1 - smooth(half * 1.15, half * 1.6, cd));
    pid[n] = CH[n] > 0.5 ? PIDS.length - 1 : best;
    L0[n] = fbm(g[2], x / 1400, y / 1400); L1[n] = fbm(g[3], x / 600, y / 600);
  }
  /* distance to the nearest border between two land places (two-pass chamfer, in px); channels don't count */
  const WATER = PIDS.length - 1, BIG = 1e9, dist = new Float32Array(N).fill(BIG);
  for (let j = 0; j < GY; j++) for (let i = 0; i < GX; i++){
    const n = j * GX + i, a = pid[n]; if (a === WATER) continue;
    const nb = [i > 0 ? n - 1 : -1, i < GX - 1 ? n + 1 : -1, j > 0 ? n - GX : -1, j < GY - 1 ? n + GX : -1];
    if (nb.some(m => m >= 0 && pid[m] !== a && pid[m] !== WATER)) dist[n] = RES / 2;
  }
  const D1 = RES, D2 = RES * 1.4142135623730951;
  for (let j = 0; j < GY; j++) for (let i = 0; i < GX; i++){ const n = j * GX + i; let v = dist[n];
    if (i > 0) v = Math.min(v, dist[n - 1] + D1); if (j > 0){ v = Math.min(v, dist[n - GX] + D1); if (i > 0) v = Math.min(v, dist[n - GX - 1] + D2); if (i < GX - 1) v = Math.min(v, dist[n - GX + 1] + D2); } dist[n] = v; }
  for (let j = GY - 1; j >= 0; j--) for (let i = GX - 1; i >= 0; i--){ const n = j * GX + i; let v = dist[n];
    if (i < GX - 1) v = Math.min(v, dist[n + 1] + D1); if (j < GY - 1){ v = Math.min(v, dist[n + GX] + D1); if (i < GX - 1) v = Math.min(v, dist[n + GX + 1] + D2); if (i > 0) v = Math.min(v, dist[n + GX - 1] + D2); } dist[n] = v; }

  /* ---- elevation, each place by its own rule; every border drops to black, then rises gently ---- */
  const OUTER_BASE = {island:0.62, chimneys:0.6, ice:0.62, ridge:0.55};
  for (let j = 0; j < GY; j++) for (let i = 0; i < GX; i++){
    const n = j * GX + i, x = (i + 0.5) * RES, y = (j + 0.5) * RES, id = PIDS[pid[n]], n1 = L0[n], n2 = L1[n];
    let e = id === 'lagoon' ? 0.39 + 0.34 * n1 + 0.1 * n2 : id === 'flats' ? 0.47 + 0.32 * n1 + 0.15 * n2 : id === 'water' ? 0.03 : (OUTER_BASE[id] || 0.6) + 0.28 * n1 + 0.15 * n2;
    if (id !== 'water'){
      const gapHalf = p.gap * (0.6 + 0.8 * (0.5 + 0.5 * fbm(g[5], x / 500, y / 500)));
      e *= smooth(gapHalf, gapHalf + p.slope, dist[n]);
      e = e * (1 - CH[n]) + 0.03 * CH[n] + 0.05 * BK[n] * (1 - CH[n]);
    }
    E[n] = e; zone[n] = id === 'lagoon' ? 0 : id === 'flats' ? 1 : id === 'water' ? 3 : 2;
    w[id][n] = 1;
  }
  blur(E, GX, GY, 1);

  /* ---- player scale: rings. Lumpy, warped, of uneven thickness, so they read as leopard-print rosettes rather than
     circles. Where a rim thins it also drops: low saddles you can cross slowly. Mounds force 2-3 such doorways and
     reach the surface elsewhere; the smaller rosettes are low ridges (slow, never walls) that break up on their own */
  function stampRing(m){
    const reach = (m.rin + m.t) * 1.45 + m.slopeOut + m.warp, i0 = Math.max(0, Math.floor((m.x - reach) / RES)), i1 = Math.min(GX - 1, Math.floor((m.x + reach) / RES));
    const j0 = Math.max(0, Math.floor((m.y - reach) / RES)), j1 = Math.min(GY - 1, Math.floor((m.y + reach) / RES));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++){
      const n = j * GX + i, x = (i + 0.5) * RES, y = (j + 0.5) * RES;
      if (zone[n] !== 0) continue;
      const wx = x - m.x + m.warp * fbm(g[5], x / 170 + m.k * 3.1, y / 170), wy = y - m.y + m.warp * fbm(g[5], x / 170 + 9.7, y / 170 + m.k * 1.3);
      const rr = Math.sqrt(wx * wx + wy * wy); if (rr > reach) continue;
      const ux = rr > 0 ? wx / rr : 1, uy = rr > 0 ? wy / rr : 0;
      const rin = m.rin * (1 + 0.22 * fbm(g[4], ux * 1.2 + m.k * 7.1, uy * 1.2));
      let thick = m.t * (0.35 + 1.2 * Math.max(0, Math.min(1, 0.5 + 1.5 * fbm(g[1], ux * 1.6 + m.k * 3.3, uy * 1.6 + 5))));
      for (const dv of m.doors){ const ex = ux - dv.x, ey = uy - dv.y, arc = Math.sqrt(ex * ex + ey * ey) * (rin + m.t / 2); thick *= 1 - 0.85 * (1 - smooth(m.door * 0.35, m.door * 1.2, arc)); }
      const s0 = rr - rin, rim = smooth(-m.slopeIn, 0, s0) * (1 - smooth(thick, thick + m.slopeOut, s0));
      const top = m.floor + (m.top - m.floor) * smooth(0.3 * m.t, 0.8 * m.t, thick);
      let e = E[n];
      const bowl = 1 - smooth(-m.slopeIn * 1.6, -m.slopeIn * 0.4, s0);
      e = e + (m.inside(e) - e) * bowl;
      E[n] = e + (top - e) * rim;
    }
  }
  const mounds = [], letters = [], spawns = [], BASES = ['A', 'U', 'G', 'C'];
  for (let k = 0; k < p.mounds; k++){
    const a = a0 + TAU * k / p.mounds + (r() - 0.5) * 0.3, pos = at(a, 0.56 * (1 + (r() - 0.5) * 0.12)), rin = p.rin * (0.85 + r() * 0.3);
    mounds.push({x:pos.x, y:pos.y, a, rin, t:p.rim, doors:[], k, door:p.door, warp:rin * 0.28, slopeIn:80, slopeOut:110, top:0.96, floor:0.56, inside:() => 0.08});
  }
  const unit = (x, y) => { const l = Math.sqrt(x * x + y * y) || 1; return {x:x / l, y:y / l}; };
  const turn = (u, th) => { const c = dcos(th), s = dsin(th); return {x:u.x * c - u.y * s, y:u.x * s + u.y * c}; };
  mounds.forEach((m, k) => {
    const out = unit(m.x - cx, m.y - cy), nb = mounds[(k + 1) % mounds.length];
    m.doors.push(turn(out, (r() - 0.5) * 0.7));
    m.doors.push(unit(nb.x - m.x, nb.y - m.y));
    if (r() < 0.5) m.doors.push(turn(unit(cx - m.x, cy - m.y), (r() - 0.5) * 1.2));
  });
  /* rosettes first (low), then the mounds over them */
  const rosettes = [];
  for (let tries = 0; rosettes.length < p.rosettes && tries < p.rosettes * 60; tries++){
    const x = cx + (r() * 2 - 1) * RX * 0.95, y = cy + (r() * 2 - 1) * RY * 0.95, rin = 45 + r() * 55;
    if (dn(x, y) > 0.86) continue;
    if (mounds.some(m => Math.sqrt((x - m.x) * (x - m.x) + (y - m.y) * (y - m.y)) < m.rin + m.t + rin + 90)) continue;
    if (rosettes.some(q => Math.sqrt((x - q.x) * (x - q.x) + (y - q.y) * (y - q.y)) < (q.rin + rin) * 1.25 + 40)) continue;
    const top = 0.62 + r() * 0.1;
    rosettes.push({x, y, rin, t:22 + r() * 18, doors:[], k:100 + rosettes.length, door:0, warp:rin * 0.35, slopeIn:45, slopeOut:60, top, floor:0.5, inside:e => e - 0.1});
  }
  rosettes.forEach(stampRing);
  mounds.forEach(stampRing);
  for (const m of mounds){
    spawns.push({x:m.x, y:m.y});
    /* a varied handful inside, not renewed: every base at least once, never enough for a whole recipe */
    const hand = BASES.concat([BASES[Math.floor(r() * 4)], BASES[Math.floor(r() * 4)]]);
    for (const b of hand){ let x, y, tries = 0; do { x = m.x + (r() * 2 - 1) * m.rin * 0.6; y = m.y + (r() * 2 - 1) * m.rin * 0.6; } while ((x - m.x) * (x - m.x) + (y - m.y) * (y - m.y) > m.rin * m.rin * 0.36 && ++tries < 20); letters.push({x, y, b, where:'mound'}); }
  }
  const inMound = (x, y, pad) => mounds.some(m => (x - m.x) * (x - m.x) + (y - m.y) * (y - m.y) < (m.rin + m.t + pad) * (m.rin + m.t + pad));
  const eAt = (x, y) => E[Math.min(GY - 1, Math.max(0, Math.floor(y / RES))) * GX + Math.min(GX - 1, Math.max(0, Math.floor(x / RES)))];
  /* a thin even spread over the lagoon outside the mounds */
  for (let k = 0, tries = 0; k < p.spread && tries < p.spread * 40; tries++){
    const x = cx + (r() * 2 - 1) * RX, y = cy + (r() * 2 - 1) * RY;
    if (dn(x, y) > 0.97 || inMound(x, y, 25) || eAt(x, y) >= WALL - 0.1) continue;
    letters.push({x, y, b:BASES[Math.floor(r() * 4)], where:'spread'}); k++;
  }
  /* denser pockets between neighbouring mounds: meeting points */
  const pockets = [];
  for (let k = 0; k < p.pockets && k * 2 < mounds.length; k++){
    const A = mounds[(k * 2) % mounds.length], B = mounds[(k * 2 + 1) % mounds.length];
    const px = (A.x + B.x) / 2 + (cx - (A.x + B.x) / 2) * 0.18, py = (A.y + B.y) / 2 + (cy - (A.y + B.y) / 2) * 0.18;
    pockets.push({x:px, y:py});
    for (let q = 0, tries = 0; q < 10 && tries < 200; tries++){ const x = px + (r() * 2 - 1) * 110, y = py + (r() * 2 - 1) * 110; if (inMound(x, y, 15) || eAt(x, y) >= WALL - 0.1) continue; letters.push({x, y, b:BASES[Math.floor(r() * 4)], where:'pocket'}); q++; }
  }
  return {E, zone, weights:w, letters, spawns, mounds, rosettes, pockets, channels:lines, centre:{x:cx, y:cy, RX, RY}, GX, GY};
}
return {generate, DEFAULTS, WALL, dsin, dcos};
})();
