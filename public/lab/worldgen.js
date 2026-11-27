/* RNA Strand Soup: world generator, lab steps 1-2, founded by meteor impacts. Zones, deep channels, the lagoon's ring mounds with doorways,
   letter seeding and spawns, as one elevation field E (0 bottomless .. 1 surface; above 0.86 is a wall) on a grid.

   Only basic arithmetic (+ - * /, Math.floor, Math.sqrt, Math.imul), never Math.sin/cos/exp/atan2: those may differ
   by a last bit between browsers, and growth amplifies any difference. With this rule the server and every browser
   build the identical map from a seed. dsin/dcos below are plain series instead.

   Scales (see the map design doc): world (zones, channels) -> region (craters, volcanoes, lava channels) -> place
   (later: reaction-diffusion) -> player (ring mounds, doorways, letters). */
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
const WALL = 0.86, DEFAULTS = {lagoon:1650, mounds:7, rin:280, rim:58, door:50, channel:220, spread:20, pockets:4, rosettes:60, gap:10, slope:30, dither:2.3, craters:36, basins:2, chimneys:6, lava:4, impacts:3, ispread:0.55, erosion:0.5, calderas:2, scale:1, outer:['island', 'chimneys', 'ice', 'ridge']};

function generate(o){
  const p = Object.assign({}, DEFAULTS, o), {W, H, RES} = p, GX = Math.round(W / RES), GY = Math.round(H / RES), N = GX * GY;
  const r = rng(p.seed * 2654435761);
  const g = Array.from({length:6}, () => noiseGrid(r));
  const E = new Float32Array(N), zone = new Uint8Array(N);
  const w = {lagoon:new Float32Array(N), flats:new Float32Array(N), water:new Float32Array(N)};
  p.outer.forEach(id => w[id] = new Float32Array(N));

  /* ---- world scale, founded by meteors: 1-3 big impacts near the centre. Their merged, worn basins are the lagoon;
     their raised rims, the craggy highlands around it; everything further out is measured from them. dn(x, y) is the
     distance from the impact field in basin radii (1 = the old rim): a smooth union of tilted ellipses, roughened by
     erosion noise, so the lagoon is central but never a plain oval ---- */
  const S = p.scale || 1, impacts = [];
  const R1 = p.lagoon * S * (0.85 + 0.15 * r()), mx = W / 2 + (r() - 0.5) * 0.06 * W, my = H / 2 + (r() - 0.5) * 0.06 * H;
  for (let k = 0; k < Math.max(1, p.impacts); k++){
    const R = k ? R1 * (0.42 + 0.3 * r()) : R1, a = r() * TAU, d = k ? p.ispread * R1 * (0.6 + 0.5 * r()) : p.ispread * R1 * 0.25 * r(), tilt = r() * PI;
    impacts.push({x:mx + d * dcos(a), y:my + d * dsin(a), R, c:dcos(tilt), s:dsin(tilt), asp:0.78 + 0.2 * r()});
  }
  const dI = (m, x, y) => { const ex = x - m.x, ey = y - m.y, u = (ex * m.c + ey * m.s) / m.R, v = (ey * m.c - ex * m.s) / (m.R * m.asp); return Math.sqrt(u * u + v * v); };
  const KS = 0.2 + 0.4 * p.erosion, EA = 0.08 + 0.16 * p.erosion, EB = 0.03 + 0.09 * p.erosion;
  const smin = (a, b) => { const h = Math.max(KS - Math.abs(a - b), 0) / KS; return Math.min(a, b) - h * h * KS * 0.25; };
  let cx = 0, cy = 0, sw0 = 0; for (const m of impacts){ const q = m.R * m.R; cx += m.x * q; cy += m.y * q; sw0 += q; } cx /= sw0; cy /= sw0;
  let RX = 0, RY = 0; for (const m of impacts){ RX = Math.max(RX, Math.abs(m.x - cx) + m.R); RY = Math.max(RY, Math.abs(m.y - cy) + m.R * 0.9); }
  const dn = (x, y) => { let d = dI(impacts[0], x, y); for (let k = 1; k < impacts.length; k++) d = smin(d, dI(impacts[k], x, y));
    return d + EA * fbm(g[0], x / (1800 * S), y / (1800 * S)) + EB * fbm(g[0], x / (650 * S) + 31, y / (650 * S)); };
  /* the point at angle a from the centre where dn first reaches d */
  const at = (a, d) => { const ux = dcos(a), uy = dsin(a); let t = 0; while (t < 9000 && dn(cx + ux * t, cy + uy * t) < d) t += 15; return {x:cx + ux * t, y:cy + uy * t}; };
  const a0 = r() * TAU, K = p.outer.length;
  const sites = p.outer.map((id, k) => { const a = a0 + TAU * k / K + (r() - 0.5) * 0.5; return {id, a, ux:dcos(a), uy:dsin(a)}; });

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
  const PIDS = ['lagoon', 'flats'].concat(p.outer).concat(['water']), pid = new Uint8Array(N), F = new Float32Array(N), DN = new Float32Array(N), L0 = new Float32Array(N), L1 = new Float32Array(N), CH = new Float32Array(N), BK = new Float32Array(N);
  const blobG = PIDS.map(() => noiseGrid(r));
  for (let j = 0; j < GY; j++) for (let i = 0; i < GX; i++){
    const n = j * GX + i, x = (i + 0.5) * RES, y = (j + 0.5) * RES, d = dn(x, y); DN[n] = d;
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
    const d = DN[n];
    if (id === 'lagoon'){
      /* the impacts' eroded central peaks survive as islands; the floor shallows toward the old rim */
      for (const m of impacts) if (m.R > R1 * 0.4){ const c = 1 - smooth(0, 0.22, dI(m, x, y)); if (c > 0) e += 0.3 * c * (0.65 + 0.35 * fbm(g[4], x / (300 * S), y / (300 * S))); }
      e += 0.12 * smooth(0.7, 1.0, d);
    } else if (id === 'flats'){
      /* the raised rim: highest just outside the old rim, craggy (ridged noise: sharp crests), falling away outward */
      const rim = smooth(0.85, 1.05, d) * (1 - smooth(1.15, 1.8, d)), rid = Math.max(0, 1 - 2 * Math.abs(fbm(g[4], x / (380 * S), y / (380 * S))));
      e += rim * (0.12 + 0.18 * rid);
    }
    if (id !== 'water'){
      const gapHalf = p.gap * (0.6 + 0.8 * (0.5 + 0.5 * fbm(g[5], x / 500, y / 500)));
      F[n] = smooth(gapHalf, gapHalf + p.slope, dist[n]) * (1 - CH[n]);
      e *= smooth(gapHalf, gapHalf + p.slope, dist[n]);
      e = e * (1 - CH[n]) + 0.03 * CH[n] + 0.05 * BK[n] * (1 - CH[n]);
    }
    E[n] = e; zone[n] = id === 'lagoon' ? 0 : id === 'flats' ? 1 : id === 'water' ? 3 : 2;
    w[id][n] = 1;
  }
  blur(E, GX, GY, 1);

  /* ---- region scale: landforms stamped into the height field. Craters first (oldest), then volcanoes on top, then
     lava channels walked downhill from the vents. Every change is scaled by F, the zone's own "distance from its
     border" ramp, so landforms never bridge the black gaps between zones. Region randomness has its own stream, so
     the zones, channels and mounds above stay exactly as they were for a seed */
  const r2 = rng(p.seed * 2654435761 + 977), g2 = Array.from({length:3}, () => noiseGrid(r2)), letters2 = [];
  const pidOf = id => PIDS.indexOf(id), cellOf = (x, y) => Math.min(GY - 1, Math.max(0, Math.floor(y / RES))) * GX + Math.min(GX - 1, Math.max(0, Math.floor(x / RES)));
  const BASES2 = ['A', 'U', 'G', 'C'];
  /* a random spot well inside a place (or any land but the lagoon), away from what's already there */
  function siteIn(test, minDist, clear, tries){
    for (let t = 0; t < tries; t++){
      const x = (0.03 + 0.94 * r2()) * W, y = (0.03 + 0.94 * r2()) * H, n = cellOf(x, y);
      if (!test(pid[n]) || dist[n] < minDist || F[n] < 0.9) continue;
      if (clear(x, y)) return {x, y};
    }
    return null;
  }
  /* stamp: for each cell in reach, f(rr, ux, uy, e) gives the new height; warped distance makes the outline organic */
  function stamp(x0, y0, R, warp, k, f, ext = 1.9){
    const reach = R * ext + warp, i0 = Math.max(0, Math.floor((x0 - reach) / RES)), i1 = Math.min(GX - 1, Math.floor((x0 + reach) / RES));
    const j0 = Math.max(0, Math.floor((y0 - reach) / RES)), j1 = Math.min(GY - 1, Math.floor((y0 + reach) / RES));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++){
      const n = j * GX + i; if (F[n] <= 0 || zone[n] === 0) continue;
      const x = (i + 0.5) * RES, y = (j + 0.5) * RES;
      const wx = x - x0 + warp * fbm(g2[0], x / 230 + k * 2.7, y / 230), wy = y - y0 + warp * fbm(g2[0], x / 230 + 7.3, y / 230 + k * 1.9);
      const d = Math.sqrt(wx * wx + wy * wy), rr = d / R; if (rr > ext) continue;
      const ux = d > 0 ? wx / d : 1, uy = d > 0 ? wy / d : 0, e = E[n];
      E[n] = e + (f(rr, ux, uy, e) - e) * F[n];
    }
  }
  const far = (list, x, y, pad) => list.every(q => { const dx = x - q.x, dy = y - q.y; return Math.sqrt(dx * dx + dy * dy) > (q.R || 0) + pad; });

  /* craters: sizes from a power law (many small, few big: R = Rmin / sqrt(1-u), so N(>R) ~ 1/R^2). Small ones are
     bowls holding a deep pool; mid-size ones have a flat floor and a central peak; the biggest (basins) a broken ring
     of peaks. Rims rise gently with 1-2 breaches so every floor can be swum into */
  const craters = [];
  const landNotLagoon = q => q !== 0 && q !== WATER;
  function crater(c){
    const R = c.R, rimH = (c.basin ? 0.22 : 0.16) + 0.05 * r2(), floor = R < 170 ? 0.1 : 0.2, k = c.k;
    const breaches = [r2() * TAU]; if (R > 220 || r2() < 0.4) breaches.push(breaches[0] + PI * (0.6 + 0.8 * r2()));
    const bv = breaches.map(a => ({x:dcos(a), y:dsin(a)}));
    stamp(c.x, c.y, R, R * 0.22, k, (rr, ux, uy, e) => {
      let br = 1; for (const b of bv){ const ex = ux - b.x, ey = uy - b.y; br = Math.min(br, smooth(0.12, 0.42, Math.sqrt(ex * ex + ey * ey))); }
      const amp = 0.6 + 0.8 * (0.5 + 0.5 * fbm(g2[1], ux * 1.4 + k * 5.1, uy * 1.4));
      let v = e;
      if (R < 170) v = v + (floor - v) * (1 - smooth(0.3, 0.92, rr));                     /* bowl */
      else {
        v = v + (floor - v) * (1 - smooth(0.62, 0.93, rr));                                 /* flat floor */
        if (R < 380) v = v + (0.58 - v) * (1 - smooth(0.04, 0.2, rr));                      /* central peak */
        else { const ring = 1 - smooth(0.05, 0.14, Math.abs(rr - 0.5)), broken = smooth(-0.35, 0.1, fbm(g2[2], ux * 2.2 + k, uy * 2.2));
               v = v + (0.6 - v) * ring * broken; }                                           /* peak ring */
      }
      const rim = smooth(0.78, 1.0, rr) * (1 - smooth(1.0, 1.5, rr));
      v += rimH * amp * rim * br;
      const bw = (1 - br) * smooth(0.55, 0.75, rr) * (1 - smooth(1.5, 1.75, rr));      /* breach: a passable notch */
      if (v > 0.66) v = v + (0.66 - v) * bw;
      return v;
    });
  }
  /* big basins first, in outer places other than the island */
  const basinPlaces = p.outer.filter(id => id !== 'island');
  for (let b = 0; b < p.basins && basinPlaces.length; b++){
    /* places are broken up by the border blobs, so shrink the basin until it fits well inside one */
    const id = basinPlaces[b % basinPlaces.length];
    for (let R = (460 + r2() * 240) * S; R >= 260 * S; R *= 0.85){
      const s0 = siteIn(q => q === pidOf(id), R * 0.45, (x, y) => far(craters, x, y, R * 0.9), 300);
      if (s0){ craters.push({x:s0.x, y:s0.y, R, k:craters.length, basin:true}); break; }
    }
  }
  for (let t = 0, made = 0, want = Math.round(p.craters * S * S); made < want && t < want * 30; t++){
    const u = r2(), R = 70 / Math.sqrt(1 - u * 0.97); if (R > 420 * S) continue;
    const s0 = siteIn(landNotLagoon, R * 0.4, (x, y) => far(craters.filter(c => c.R > 300), x, y, R * 0.8), 4);
    if (!s0) continue; craters.push({x:s0.x, y:s0.y, R, k:craters.length}); made++;
  }
  craters.sort((a, b) => b.R - a.R).forEach(crater);              /* big ones first, so small craters pock their rims */

  /* volcanoes. The island: 2-3 overlapping shields whose tops break the surface (walls), so it reads as land. The
     chimneys: small steep cones with a deep vent pit in the middle (hydrothermal chimneys: heat and chemistry) */
  const vents = [];
  /* big volcanoes: a broad cone whose rim reaches the surface around a full-depth caldera, breached in 1-2 places so
     you can swim in. Like the lagoon's mounds, but bigger and further out: room for dangers later */
  for (let c = 0; c < p.calderas; c++){
    let site = null, R = (250 + r2() * 120) * Math.max(0.75, S);
    for (; !site && R >= 150; R *= 0.85) site = siteIn(q => q >= 2 && q < WATER, R * 0.7, (x, y) => far(craters.filter(b => b.basin), x, y, R * 2.2) && far(vents, x, y, R * 2.4), 300);
    if (!site) continue;
    const a = r2() * TAU, bv = [a, a + PI * (0.7 + 0.6 * r2())].slice(0, r2() < 0.5 ? 1 : 2).map(t => ({x:dcos(t), y:dsin(t)}));
    vents.push({x:site.x, y:site.y, R, kind:'caldera', k:400 + c, bv});
  }
  const islandPid = pidOf('island'), chimPid = pidOf('chimneys');
  if (islandPid >= 0){
    let c0 = null; for (let md = 300; !c0 && md >= 80; md *= 0.7) c0 = siteIn(q => q === islandPid, md, (x, y) => far(craters, x, y, 200), 500);
    if (c0) for (let v = 0, n = 2 + Math.floor(r2() * 2); v < n; v++){
      const a = r2() * TAU, d = v ? 180 + r2() * 160 : 0, R = 300 + r2() * 180;
      vents.push({x:c0.x + d * dcos(a), y:c0.y + d * dsin(a), R, kind:'shield', k:200 + v});
    }
  }
  if (chimPid >= 0) for (let v = 0, t = 0; v < p.chimneys && t < 400; t++){
    const R = 120 + r2() * 100, s0 = siteIn(q => q === chimPid, R, (x, y) => far(vents, x, y, R + 60) && far(craters, x, y, R * 0.5), 3);
    if (s0){ vents.push({x:s0.x, y:s0.y, R, kind:'chimney', k:300 + v}); v++; }
  }
  for (const v of vents){
    if (v.kind === 'caldera') stamp(v.x, v.y, v.R, v.R * 0.2, v.k, (rr, ux, uy, e) => {
      let br = 1; for (const b of v.bv){ const ex = ux - b.x, ey = uy - b.y; br = Math.min(br, smooth(0.15, 0.4, Math.sqrt(ex * ex + ey * ey))); }
      let val = e + 0.3 * (1 - smooth(0.9, 2.5, rr)) + 0.14 * smooth(0.7, 1.0, rr) * (1 - smooth(1.0, 1.5, rr));
      val = val + (0.04 - val) * (1 - smooth(0.62, 0.92, rr));                            /* the deep caldera */
      const bw = (1 - br) * smooth(0.5, 0.8, rr) * (1 - smooth(2.2, 2.6, rr));
      if (val > 0.6) val += (0.6 - val) * bw;
      return val;
    }, 2.6);
    else if (v.kind === 'shield') stamp(v.x, v.y, v.R, v.R * 0.25, v.k, (rr, ux, uy, e) => e + 0.26 * (1 - smooth(0, 1.6, rr)) + 0.16 * (1 - smooth(0, 0.45, rr)));   /* broad flanks you can climb, a small summit that breaks the surface */
    else stamp(v.x, v.y, v.R, v.R * 0.18, v.k, (rr, ux, uy, e) => {
      const cone = e + 0.2 * (1 - smooth(0.2, 1.3, rr));
      return cone + (0.06 - cone) * (1 - smooth(0.2, 0.4, rr));                             /* the deep vent pit */
    });
  }

  /* lava channels: from each shield, walk steepest-downhill (with a little noise) until the water; then carve a
     half-refilled channel (a middle-depth lane: faster than the flanks, a way inland) between low levees */
  const lavas = [], LD = new Float32Array(N).fill(BIG);
  for (const v of vents) if (v.kind === 'shield') for (let c = 0; c < Math.ceil(p.lava / 2); c++){
    if (lavas.length >= p.lava) break;
    const a = r2() * TAU; let i = Math.floor((v.x + v.R * 0.15 * dcos(a)) / RES), j = Math.floor((v.y + v.R * 0.15 * dsin(a)) / RES);
    const path = [], seen = new Set(); let dx = dcos(a), dy = dsin(a);
    for (let s = 0; s < 320; s++){
      if (i < 1 || j < 1 || i >= GX - 1 || j >= GY - 1) break;
      const n = j * GX + i; path.push({x:(i + 0.5) * RES, y:(j + 0.5) * RES}); seen.add(n);
      if (E[n] < 0.16 && s > 4) break;
      let best = -1, bv = Infinity;
      for (let q = -1; q <= 1; q++) for (let o = -1; o <= 1; o++){
        if (!q && !o) continue; const m = n + q * GX + o; if (seen.has(m)) continue;
        const l = Math.sqrt(o * o + q * q), along = (o * dx + q * dy) / l;
        const val = E[m] + 0.07 * fbm(g2[1], (i + o) / 5 + c * 3.7 + v.k, (j + q) / 5) - 0.012 * along;   /* noise makes it meander; a little momentum */
        if (val < bv){ bv = val; best = m; }
      }
      if (best < 0) break;
      const ni = best % GX, nj = (best - ni) / GX; dx = dx * 0.6 + (ni - i) * 0.4; dy = dy * 0.6 + (nj - j) * 0.4; i = ni; j = nj;
    }
    if (path.length < 8) continue;
    /* round the grid steps off (Chaikin corner cutting, twice) so the channel curves instead of zig-zagging */
    let pts = path; for (let it = 0; it < 3; it++){ const q2 = [pts[0]]; for (let k2 = 0; k2 + 1 < pts.length; k2++){ const A = pts[k2], B = pts[k2 + 1]; q2.push({x:A.x * 0.75 + B.x * 0.25, y:A.y * 0.75 + B.y * 0.25}, {x:A.x * 0.25 + B.x * 0.75, y:A.y * 0.25 + B.y * 0.75}); } q2.push(pts[pts.length - 1]); pts = q2; }
    path.length = 0; for (let k2 = 0; k2 < pts.length; k2 += 2) path.push(pts[k2]);
    lavas.push(path);
    const halfW = 38 + r2() * 14, rad = halfW * 2;
    for (const pt of path){
      const i0 = Math.max(0, Math.floor((pt.x - rad) / RES)), i1 = Math.min(GX - 1, Math.floor((pt.x + rad) / RES)), j0 = Math.max(0, Math.floor((pt.y - rad) / RES)), j1 = Math.min(GY - 1, Math.floor((pt.y + rad) / RES));
      for (let jj = j0; jj <= j1; jj++) for (let ii = i0; ii <= i1; ii++){ const m = jj * GX + ii, ex = (ii + 0.5) * RES - pt.x, ey = (jj + 0.5) * RES - pt.y, d = Math.sqrt(ex * ex + ey * ey) / halfW; if (d < LD[m]) LD[m] = d; }
    }
  }
  for (let n = 0; n < N; n++){ const d = LD[n]; if (d >= 2 || F[n] <= 0) continue;
    const e = E[n], floor = 0.4, inC = 1 - smooth(0.55, 1.0, d), levee = smooth(0.9, 1.15, d) * (1 - smooth(1.2, 2.0, d));
    const v = (inC > 0 && e > floor ? e + (floor - e) * inC : e) + 0.07 * levee;
    E[n] = e + (v - e) * F[n]; }

  /* rewards: letters gather on crater floors (impact heat) and around chimney pits (vent chemistry) */
  for (const c of craters) if (c.R > 200) for (let q = 0, t = 0; q < (c.basin ? 14 : 7) && t < 120; t++){
    const a = r2() * TAU, d = c.R * (0.15 + 0.4 * r2()), x = c.x + d * dcos(a), y = c.y + d * dsin(a);
    if (E[cellOf(x, y)] >= WALL - 0.1) continue; letters2.push({x, y, b:BASES2[Math.floor(r2() * 4)], where:'crater'}); q++; }
  for (const v of vents) if (v.kind === 'caldera') for (let q = 0; q < 10; q++){
    const a = r2() * TAU, d = v.R * 0.45 * r2(); letters2.push({x:v.x + d * dcos(a), y:v.y + d * dsin(a), b:BASES2[Math.floor(r2() * 4)], where:'caldera'}); }
  for (const v of vents) if (v.kind === 'chimney') for (let q = 0; q < 5; q++){
    const a = r2() * TAU, d = v.R * (0.45 + 0.25 * r2()); letters2.push({x:v.x + d * dcos(a), y:v.y + d * dsin(a), b:BASES2[Math.floor(r2() * 4)], where:'vent'}); }

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
  for (const l of letters2) letters.push(l);
  return {E, zone, weights:w, letters, spawns, impacts, craters, vents, lavas, mounds, rosettes, pockets, channels:lines, centre:{x:cx, y:cy, RX, RY}, GX, GY};
}
return {generate, DEFAULTS, WALL, dsin, dcos};
})();
