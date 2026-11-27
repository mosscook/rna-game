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
     scale     a scale bar in nanometres, from the strand's own spacing (about 0.6 nm between letters).
     edge      (to test on a real Chromebook only) real blur around the edge with backdrop-filter. This one costs
               every frame on the graphics chip, so it is off unless asked for.
   Choose with ?lens=soft,bokeh,... (or ?lens=off), or the buttons in ?dev. */
window.SoupLens = (() => {
'use strict';
const TAU = Math.PI * 2;
const ALL = ['vignette', 'eyepiece', 'rim', 'grain', 'bokeh', 'soft', 'scale', 'edge'];
const DEFAULT = [];

function create({pond, under, MAP}){
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
    grain.hidden = !on.has('grain'); if (on.has('grain')) makeGrain();
    edge.hidden = !on.has('edge');
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
  apply();
  return {set, toggle, has:k => on.has(k), get list(){ return [...on]; }, ALL,
    drawBack:(g, ...a) => drawSpecks(g, true, ...a), drawFront:(g, ...a) => drawSpecks(g, false, ...a)};
}
/* about 0.6 nm between letters along an RNA backbone; the strand draws them LB px apart */
const NM_PER_LETTER = 0.6;
return {create, NM_PER_LETTER, ALL};
})();
