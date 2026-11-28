/* RNA Strand Soup: the microscope look. Browser only; nothing here changes the game.
   Every effect is optional and chosen to be cheap on a Chromebook:
     vignette  'soft' (light falls off toward the corners) or 'eyepiece' (a round field of view, corners dark).
               A CSS gradient on a layer that never changes, so the compositor draws it for free after the first frame.
     rim       a faint blue-and-magenta fringe just inside the vignette, like a cheap lens's colour fringing. Same layer.
     grain     sensor noise: a small noise tile on a layer that only moves (transform), so it is never repainted.
     bokeh     out-of-focus specks drifting above and below the focal plane, moving slower (below) or faster (above)
               than the ground as the camera pans. A pre-drawn soft disc, drawn 20 to 30 times a frame.
     soft      the ground drawn out of focus (map.js blurs each cached chunk once, when it is made), so the letters and
               strands are the only sharp things: the shallow depth of field of a microscope.
     motes     floating particles in four parallax layers: three below the strands (far, small and dim, sliding slowly
               as the camera pans) and one above them (near, big and out of focus, sliding fastest). Mineral grains,
               clay flakes and tiny fatty-acid vesicles, which really were in early-Earth water. On by default; fewer in
               low detail; no drifting with reduced motion. About 120 small drawImage calls a frame.
     scale     a scale bar in nanometres, from the strand's own spacing (about 0.6 nm between letters).
     edge      (to test on a real Chromebook only) real blur around the edge with backdrop-filter. This one costs
               every frame on the graphics chip. On by default since Nov 2026; off in low detail, like grain.
   Choose with ?lens=soft,bokeh,... (or ?lens=off), or the buttons in ?dev. */
window.SoupLens = (() => {
'use strict';
const TAU = Math.PI * 2;
const ALL = ['motes', 'vignette', 'eyepiece', 'rim', 'grain', 'bokeh', 'soft', 'scale', 'edge'];
const DEFAULT = ['motes', 'eyepiece', 'grain', 'bokeh', 'edge'];

function create({pond, under, MAP, low = () => false}){
  /* the layer sits between the strands and the top canvas, so names, effects and the minimap stay bright */
  const el = document.createElement('div'); el.className = 'lens'; el.setAttribute('aria-hidden', 'true');
  const grain = document.createElement('div'); grain.className = 'grain'; el.appendChild(grain);
  const edge = document.createElement('div'); edge.className = 'edgeblur';
  pond.insertBefore(edge, under); pond.insertBefore(el, under);
  let on = new Set(DEFAULT), grainReady = false;

  function makeGrain(){
    if (grainReady) return; grainReady = true;
    const c = document.createElement('canvas'); c.width = c.height = 160;
    const g = c.getContext('2d'), img = g.createImageData(160, 160);
    for (let i = 0; i < img.data.length; i += 4){ const v = Math.random() * 255 | 0; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = Math.random() < 0.5 ? 255 : 0; }
    g.putImageData(img, 0, 0);
    grain.style.backgroundImage = `url(${c.toDataURL()})`;
  }
  function apply(){
    el.classList.toggle('soft', on.has('vignette') && !on.has('eyepiece'));
    el.classList.toggle('eyepiece', on.has('eyepiece'));
    el.classList.toggle('rim', on.has('rim'));
    /* the two that cost every frame (grain, edge) stay off in low detail (the Lo button), whatever is picked */
    const heavy = !low();
    grain.hidden = !(on.has('grain') && heavy); if (!grain.hidden) makeGrain();
    edge.hidden = !(on.has('edge') && heavy);
    edge.classList.toggle('round', on.has('eyepiece'));
    if (MAP.setSoft) MAP.setSoft(on.has('soft') ? 1.6 : 0);
  }
  function set(list){ on = new Set(list.filter(k => ALL.includes(k))); apply(); }
  function toggle(k){ if (on.has(k)) on.delete(k); else on.add(k); apply(); }

  /* bokeh: specks in screen space that wrap around, each at its own depth. Depth < 1 is below the focal plane
     (smaller, dimmer, drawn under the letters); depth > 1 is above it (bigger, fainter, drawn over the strands) */
  const sprite = (() => {
    const c = document.createElement('canvas'), n = 64; c.width = c.height = n;
    const g = c.getContext('2d'), gr = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
    gr.addColorStop(0, 'rgba(210,240,230,1)'); gr.addColorStop(0.55, 'rgba(210,240,230,.55)'); gr.addColorStop(0.8, 'rgba(210,240,230,.7)'); gr.addColorStop(1, 'rgba(210,240,230,0)');
    g.fillStyle = gr; g.fillRect(0, 0, n, n); return c;
  })();
  const specks = [];
  const rnd = (a, b) => a + Math.random() * (b - a);
  for (let i = 0; i < 18; i++) specks.push({x:Math.random(), y:Math.random(), z:rnd(0.35, 0.75), r:rnd(5, 14), a:rnd(0.05, 0.12), vx:rnd(-4, 4), vy:rnd(-3, 3), ph:rnd(0, TAU)});
  for (let i = 0; i < 9; i++) specks.push({x:Math.random(), y:Math.random(), z:rnd(1.4, 2.2), r:rnd(26, 70), a:rnd(0.03, 0.07), vx:rnd(-8, 8), vy:rnd(-6, 6), ph:rnd(0, TAU)});
  let lastT = null;
  function drawSpecks(g, back, camX, camY, cw, ch, scale, t, dpr){
    if (!on.has('bokeh')) return;
    const dt = lastT == null ? 0 : Math.min(0.1, t - lastT); if (back) lastT = t;
    g.save(); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const m = 80, spanX = cw + 2 * m, spanY = ch + 2 * m;
    /* every speck drifts a little on its own; the pass under the strands moves them all */
    if (back) for (const s of specks){ s.x = (s.x + s.vx * dt / spanX + 1) % 1; s.y = (s.y + s.vy * dt / spanY + 1) % 1; }
    for (const s of specks){
      if ((s.z < 1) !== back) continue;
      /* parallax: a speck at depth z moves z times as fast as the ground when the camera pans */
      let x = (s.x * spanX - camX * scale * s.z) % spanX; if (x < 0) x += spanX;
      let y = (s.y * spanY - camY * scale * s.z) % spanY; if (y < 0) y += spanY;
      const r = s.r * scale, a = s.a * (0.8 + 0.2 * Math.sin(t * 0.7 + s.ph));
      g.globalAlpha = a; g.drawImage(sprite, x - m - r, y - m - r, r * 2, r * 2);
    }
    g.restore();
  }
  /* ---------- motes: world-anchored particles in parallax layers ----------
     Each layer is cut into square tiles in its own (parallax) space; a tile's particles come from a hash of the tile,
     so the same particles are always in the same places when you swim back, and only visible tiles are drawn */
  const TINT = '210,240,230';
  const motesSprites = (() => {
    const mk = draw => { const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d'); g.translate(16, 16); draw(g); return c; };
    const grain = mk(g => { const gr = g.createRadialGradient(0, 0, 0, 0, 0, 15); gr.addColorStop(0, `rgba(${TINT},1)`); gr.addColorStop(0.35, `rgba(${TINT},.8)`); gr.addColorStop(1, `rgba(${TINT},0)`); g.fillStyle = gr; g.fillRect(-16, -16, 32, 32); });
    const vesicle = mk(g => { g.strokeStyle = `rgba(${TINT},.95)`; g.lineWidth = 2.2; g.fillStyle = `rgba(${TINT},.18)`; g.beginPath(); g.arc(0, 0, 12, 0, TAU); g.fill(); g.stroke();
      g.strokeStyle = `rgba(${TINT},.4)`; g.lineWidth = 1; g.beginPath(); g.arc(0, 0, 9, 0, TAU); g.stroke(); });
    const flake = mk(g => { g.fillStyle = `rgba(${TINT},.85)`; g.beginPath(); g.moveTo(-13, -3); g.lineTo(-4, -9); g.lineTo(11, -6); g.lineTo(14, 3); g.lineTo(2, 9); g.lineTo(-10, 6); g.closePath(); g.fill();
      g.strokeStyle = `rgba(${TINT},.5)`; g.lineWidth = 1; g.beginPath(); g.moveTo(-6, -2); g.lineTo(8, 1); g.stroke(); });
    return [grain, grain, grain, flake, flake, vesicle];
  })();
  /* z: how fast the layer slides compared with the ground (below the strands < 1 < above them).
     n: particles per tile, size in screen px, alpha, and the slow current each layer drifts on (px/s in layer space) */
  const LAYERS = [
    {z:0.45, n:5, size:[1.6, 3.2], a:0.16, vx:3, vy:-1.5, front:false},
    {z:0.7, n:4, size:[3, 5.5], a:0.28, vx:-4, vy:2, front:false},
    {z:0.88, n:2, size:[4, 8], a:0.28, vx:5, vy:3, front:false},
    {z:1.35, n:0.6, size:[12, 26], a:0.11, vx:-7, vy:-4, front:true}];
  const TS = 360;
  const hash = (x, y, k) => { let h = (x * 374761393 + y * 668265263 + k * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  function drawMotes(g, front, camX, camY, cw, ch, scale, t, dpr){
    if (!on.has('motes')) return;
    const fewer = low() ? 0.5 : 1, tt = still.matches ? 0 : t;
    g.save(); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    LAYERS.forEach((L, li) => {
      if (L.front !== front) return;
      /* the layer's own camera: the ground camera times z, centred on the middle of the screen, plus its current */
      const ox = (camX * scale + cw / 2) * L.z - cw / 2 - L.vx * tt, oy = (camY * scale + ch / 2) * L.z - ch / 2 - L.vy * tt;
      const ix0 = Math.floor(ox / TS) - 1, ix1 = Math.floor((ox + cw) / TS) + 1, iy0 = Math.floor(oy / TS) - 1, iy1 = Math.floor((oy + ch) / TS) + 1;
      const zs = Math.sqrt(scale);
      for (let iy = iy0; iy <= iy1; iy++) for (let ix = ix0; ix <= ix1; ix++){
        const n = L.n * fewer, count = Math.floor(n) + (hash(ix, iy, li * 7 + 99) < n % 1 ? 1 : 0);
        for (let k = 0; k < count; k++){
          const r = (j) => hash(ix * 31 + k, iy * 17 + j, li);
          const sp = front ? motesSprites[0] : motesSprites[(r(1) * motesSprites.length) | 0];
          const sz = (L.size[0] + r(2) * (L.size[1] - L.size[0])) * zs;
          /* each particle also wanders a little on its own */
          const ph = r(3) * TAU, w = 0.15 + r(4) * 0.25;
          const x = ix * TS + r(5) * TS - ox + Math.sin(tt * w + ph) * 6, y = iy * TS + r(6) * TS - oy + Math.cos(tt * w * 0.8 + ph) * 6;
          if (x < -sz || y < -sz || x > cw + sz || y > ch + sz) continue;
          /* the layers below the strands are in the water, so rock and ice in front of them hide them */
          if (!front && MAP.solidAt(camX + x / scale, camY + y / scale)) continue;
          g.globalAlpha = L.a * (0.65 + 0.35 * r(7)) * (0.85 + 0.15 * Math.sin(tt * 0.9 + ph));
          if (sp === motesSprites[0]){ g.drawImage(sp, x - sz, y - sz, sz * 2, sz * 2); continue; }
          const ang = r(8) * TAU + tt * (r(9) - 0.5) * 0.4, c = Math.cos(ang) * sz / 16, s = Math.sin(ang) * sz / 16;
          g.setTransform(c * dpr, s * dpr, -s * dpr, c * dpr, x * dpr, y * dpr); g.drawImage(sp, -16, -16);
          g.setTransform(dpr, 0, 0, dpr, 0, 0);
        }
      }
    });
    g.restore();
  }
  apply();
  return {set, toggle, refresh:apply, has:k => on.has(k), get list(){ return [...on]; }, ALL,
    drawBack:(g, ...a) => { drawMotes(g, false, ...a); drawSpecks(g, true, ...a); }, drawFront:(g, ...a) => { drawMotes(g, true, ...a); drawSpecks(g, false, ...a); }};
}
/* about 0.6 nm between letters along an RNA backbone; the strand draws them LB px apart */
const NM_PER_LETTER = 0.6;
return {create, NM_PER_LETTER, ALL};
})();
