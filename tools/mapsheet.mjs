/* Draws generated worlds to PNG, with no browser: a contact sheet of many seeds (to judge how much layouts vary), or
   one map bigger, or a close-up of one place (to judge its pattern).
     node tools/mapsheet.mjs --out docs/mapgen/after.png                    12 seeds, 4 across
     node tools/mapsheet.mjs --seeds 7,8,9 --cols 3 --out x.png
     node tools/mapsheet.mjs --places --seed 7 --out docs/mapgen/places.png  a 1500 px close-up of every place
     node tools/mapsheet.mjs --set '{"asymmetry":0}' ...                     any worldgen setting
   Also prints build times and the checks for each seed. */
import {writeFileSync} from 'node:fs';
import {deflateSync} from 'node:zlib';
import '../src/dom-shim.js';
import '../public/worldgen.js';
const WG = globalThis.WorldGen;
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true); };

function png(w, h, rgb){
  const crcT = new Int32Array(256); for (let n = 0; n < 256; n++){ let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c; }
  const crc = b => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (t, d) => { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length, 0); b.write(t, 4, 'latin1'); d.copy(b, 8); b.writeUInt32BE(crc(b.subarray(4, 8 + d.length)), 8 + d.length); return b; };
  const head = Buffer.alloc(13); head.writeUInt32BE(w, 0); head.writeUInt32BE(h, 4); head[8] = 8; head[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y++) Buffer.from(rgb.buffer, y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', deflateSync(raw, {level:9})), chunk('IEND', Buffer.alloc(0))]);
}
/* 3x5 digits, for the seed in each corner */
const DIG = ['111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001', '111100111001111', '111100111101111', '111001001001001', '111101111101111', '111101111001111'];
function label(img, IW, x0, y0, txt, s = 3){
  [...String(txt)].forEach((ch, k) => { const d = DIG[+ch]; if (!d) return;
    for (let j = 0; j < 5; j++) for (let i = 0; i < 3; i++) if (d[j * 3 + i] === '1') for (let b = 0; b < s; b++) for (let a = 0; a < s; a++){ const o = ((y0 + j * s + b) * IW + x0 + k * 4 * s + i * s + a) * 3; img[o] = img[o + 1] = img[o + 2] = 255; } });
}
/* one world drawn into img at (ox, oy): the window (wx, wy, ww, wh) of the world, pw x ph pixels. Filled bands, each
   place's colour, black depths, a dark line at each band edge; spawns as white dots */
function drawWorld(world, img, IW, ox, oy, pw, ph, win){
  const surf = WG.surface(world), W = world.GX * world.RES, H = world.GY * world.RES, {x:wx, y:wy, w:ww, h:wh} = win || {x:0, y:0, w:W, h:H}, col = [0, 0, 0], px = ww / pw;
  for (let j = 0; j < ph; j++) for (let i = 0; i < pw; i++){
    const x = wx + (i + 0.5) * px, y = wy + (j + 0.5) * px, e = surf.elev(x, y), b = WG.bandOf(e), o = ((oy + j) * IW + ox + i) * 3;
    surf.colour(x, y, col);
    let f = WG.BRIGHT[b];
    if (b < 7){ const e2 = surf.elev(x + px, y), e3 = surf.elev(x, y + px); if (WG.bandOf(e2) !== b || WG.bandOf(e3) !== b) f *= 0.6; }
    img[o] = b === 7 ? 3 : col[0] * f; img[o + 1] = b === 7 ? 5 : col[1] * f; img[o + 2] = b === 7 ? 7 : col[2] * f;
  }
  for (const s of world.spawns){ const i = Math.round((s.x - wx) / px), j = Math.round((s.y - wy) / px), r = Math.max(2, Math.round(30 / px));
    for (let b = -r; b <= r; b++) for (let a = -r; a <= r; a++) if (a * a + b * b <= r * r && i + a >= 0 && i + a < pw && j + b >= 0 && j + b < ph){ const o = ((oy + j + b) * IW + ox + i + a) * 3; img[o] = img[o + 1] = img[o + 2] = 255; } }
}
const set = arg('set', null) ? JSON.parse(arg('set')) : {};
const size = +arg('size', 0.7), W = Math.round(9200 * size / 100) * 100, H = Math.round(6000 * size / 100) * 100;
const make = seed => { const t0 = performance.now(); const w = WG.generate(Object.assign({}, set, {seed, W, H, RES:25, scale:size})); w.ms = performance.now() - t0; return w; };
const out = arg('out', 'mapsheet.png');
if (arg('places', false)){
  /* a close-up of each place, centred on the middle of its biggest stretch */
  const world = make(+arg('seed', 7)), ids = world.PIDS.filter(id => id !== 'water'), S = +arg('span', 1500), P = 500, IW = P * 3 + 8, IH = P * 2 + 4, img = new Uint8Array(IW * IH * 3);
  ids.forEach((id, k) => { const q = world.PIDS.indexOf(id); let bx = 0, by = 0, bn = -1;
    /* the cell with the most of its own place within 12 cells: a coarse search */
    for (let j = 6; j < world.GY; j += 6) for (let i = 6; i < world.GX; i += 6){ let c = 0; for (let b = -12; b <= 12; b += 3) for (let a = -12; a <= 12; a += 3){ const ii = i + a, jj = j + b; if (ii >= 0 && jj >= 0 && ii < world.GX && jj < world.GY && world.pid[jj * world.GX + ii] === q) c++; } if (c > bn){ bn = c; bx = i; by = j; } }
    const x = Math.max(0, Math.min(W - S, bx * world.RES - S / 2)), y = Math.max(0, Math.min(H - S, by * world.RES - S / 2));
    drawWorld(world, img, IW, (k % 3) * (P + 4), Math.floor(k / 3) * (P + 4), P, P, {x, y, w:S, h:S}); });
  writeFileSync(out, png(IW, IH, img)); console.log('wrote', out, ids.join(' '));
} else {
  const seeds = arg('seeds', null) ? String(arg('seeds')).split(',').map(Number) : Array.from({length:+arg('n', 12)}, (_, k) => +arg('seed', 1) + k);
  const cols = +arg('cols', 4), pw = +arg('px', 640), ph = Math.round(pw * H / W), rows = Math.ceil(seeds.length / cols), IW = cols * (pw + 6), IH = rows * (ph + 6), img = new Uint8Array(IW * IH * 3);
  let total = 0, fails = 0;
  seeds.forEach((seed, k) => { const world = make(seed), ox = (k % cols) * (pw + 6), oy = Math.floor(k / cols) * (ph + 6); total += world.ms; if (!world.checks.ok) fails++;
    drawWorld(world, img, IW, ox, oy, pw, ph); label(img, IW, ox + 8, oy + 8, seed);
    const c = world.checks; console.log(`seed ${seed}: ${world.ms.toFixed(0)} ms, ${c.ok ? 'ok' : 'FAIL'}, tries ${c.tries}, spread ${c.spawnSpread.toFixed(2)}, lagoon mid ${c.lagoonMid.toFixed(2)}, carved ${c.carved}, filled ${c.filled}${c.unlinked.length ? ', unlinked ' + c.unlinked : ''}${c.layout ? ', ' + c.layout : ''}${c.small && c.small.length ? ', small ' + c.small : ''}`); });
  writeFileSync(out, png(IW, IH, img)); console.log(`wrote ${out}; mean build ${(total / seeds.length).toFixed(0)} ms; ${fails} failed checks`);
}
