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
const WALL = 0.86, DEFAULTS = {lagoon:1650, mounds:8, rin:190, rim:56, door:80, channel:300, spread:60, pockets:4, outer:['island', 'chimneys', 'ice', 'ridge']};

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

  for (let j = 0; j < GY; j++) for (let i = 0; i < GX; i++){
    const n = j * GX + i, x = (i + 0.5) * RES, y = (j + 0.5) * RES, d = dn(x, y);
    const n1 = fbm(g[2], x / 1400, y / 1400), n2 = fbm(g[3], x / 600, y / 600);
    const wL = 1 - smooth(0.9, 1.1, d), wO = smooth(1.62, 1.9, d), wM = Math.max(0, 1 - wL - wO);
    /* rolling middle depths in the lagoon (bands 3-6), more relief in the middle ring, raised and rough outside */
    const eL = 0.39 + 0.34 * n1 + 0.1 * n2, eM = 0.47 + 0.32 * n1 + 0.15 * n2;
    let ux = (x - cx) / RX, uy = (y - cy) / RY; const ul = Math.sqrt(ux * ux + uy * uy) || 1; ux /= ul; uy /= ul;
    let best = 0, bd = -2; for (let k = 0; k < K; k++){ const dd = ux * sites[k].ux + uy * sites[k].uy; if (dd > bd){ bd = dd; best = k; } }
    const OUTER_BASE = {island:0.62, chimneys:0.6, ice:0.62, ridge:0.55}, eO = (OUTER_BASE[sites[best].id] || 0.6) + 0.28 * n1 + 0.15 * n2;
    let e = wL * eL + wM * eM + wO * eO;
    /* channels: carved to black, with a slight bank either side */
    let cd = Infinity; for (const [A, B] of segs){ const v = segDist(x, y, A, B); if (v < cd) cd = v; }
    const c = 1 - smooth(half * 0.55, half, cd), bank = smooth(half * 0.9, half * 1.15, cd) * (1 - smooth(half * 1.15, half * 1.6, cd));
    e = e * (1 - c) + 0.03 * c + 0.05 * bank * (1 - c);
    E[n] = e; zone[n] = d < 1 ? 0 : d < 1.75 ? 1 : 2;
    w.lagoon[n] = wL * (1 - c); w.flats[n] = wM * (1 - c); w[sites[best].id][n] = wO * (1 - c); w.water[n] = c;
  }
  blur(E, GX, GY, 1);

  /* ---- player scale: ring mounds in the lagoon, old crater rims flooded inside, worn through in 2-3 doorways ---- */
  const mounds = [], letters = [], spawns = [], BASES = ['A', 'U', 'G', 'C'];
  for (let k = 0; k < p.mounds; k++){
    const a = a0 + TAU * k / p.mounds + (r() - 0.5) * 0.3, pos = at(a, 0.58 * (1 + (r() - 0.5) * 0.12));
    mounds.push({x:pos.x, y:pos.y, a, rin:p.rin * (0.9 + r() * 0.2), t:p.rim, doors:[], k});
  }
  const unit = (x, y) => { const l = Math.sqrt(x * x + y * y) || 1; return {x:x / l, y:y / l}; };
  const turn = (u, th) => { const c = dcos(th), s = dsin(th); return {x:u.x * c - u.y * s, y:u.x * s + u.y * c}; };
  mounds.forEach((m, k) => {
    const out = unit(m.x - cx, m.y - cy), nb = mounds[(k + 1) % mounds.length];
    m.doors.push(turn(out, (r() - 0.5) * 0.7));
    m.doors.push(unit(nb.x - m.x, nb.y - m.y));
    if (r() < 0.5) m.doors.push(turn(unit(cx - m.x, cy - m.y), (r() - 0.5) * 1.2));
  });
  const DOOR_FLOOR = 0.56, INSIDE = 0.1, RIM_TOP = 1.12;
  for (const m of mounds){
    const reach = m.rin + m.t + 60, i0 = Math.max(0, Math.floor((m.x - reach) / RES)), i1 = Math.min(GX - 1, Math.floor((m.x + reach) / RES));
    const j0 = Math.max(0, Math.floor((m.y - reach) / RES)), j1 = Math.min(GY - 1, Math.floor((m.y + reach) / RES));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++){
      const n = j * GX + i, dx = (i + 0.5) * RES - m.x, dy = (j + 0.5) * RES - m.y, rr = Math.sqrt(dx * dx + dy * dy);
      if (rr > reach) continue;
      const u = rr > 0 ? {x:dx / rr, y:dy / rr} : {x:1, y:0};
      const rin = m.rin * (1 + 0.08 * fbm(g[4], u.x * 1.3 + m.k * 7.1, u.y * 1.3));
      let e = E[n];
      const inside = 1 - smooth(rin - 55, rin - 5, rr);
      e = e + (INSIDE - e) * inside;
      let rim = smooth(rin - 15, rin + 10, rr) * (1 - smooth(rin + m.t - 10, rin + m.t + 45, rr));
      /* doorways: where the rim faces a door direction, it's worn down to a step (bands 3-4) */
      let gap = 0; for (const dv of m.doors){ const ex = u.x - dv.x, ey = u.y - dv.y, arc = Math.sqrt(ex * ex + ey * ey) * (rin + m.t / 2); gap = Math.max(gap, 1 - smooth(p.door * 0.35, p.door * 0.5, arc)); }
      const band = smooth(rin - 12, rin + 4, rr) * (1 - smooth(rin + m.t, rin + m.t + 30, rr));
      e = e + (DOOR_FLOOR - e) * gap * band;
      rim *= 1 - gap;
      E[n] = e + (RIM_TOP - e) * rim;
    }
    spawns.push({x:m.x, y:m.y});
    /* a varied handful inside, not renewed: every base at least once, never enough for a whole recipe */
    const hand = BASES.concat([BASES[Math.floor(r() * 4)], BASES[Math.floor(r() * 4)]]);
    for (const b of hand){ let x, y, tries = 0; do { x = m.x + (r() * 2 - 1) * m.rin * 0.72; y = m.y + (r() * 2 - 1) * m.rin * 0.72; } while ((x - m.x) * (x - m.x) + (y - m.y) * (y - m.y) > m.rin * m.rin * 0.5 && ++tries < 20); letters.push({x, y, b, where:'mound'}); }
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
  return {E, zone, weights:w, letters, spawns, mounds, pockets, channels:lines, centre:{x:cx, y:cy, RX, RY}, GX, GY};
}
return {generate, DEFAULTS, WALL, dsin, dcos};
})();
