/* RNA Strand Soup: the multiplayer client.
   A room on the server runs the game; this keeps a mirror of what is near you and shows it smoothly.
   - Other strands and fragments are drawn about 0.1 s in the past, blended between the server's snapshots.
   - Your own strand is predicted here with the same steering the server uses, so it answers the pointer at once,
     and is gently pulled toward where the server says it is.
   - Letters, map state (tide, rafts, geysers, meteorites, UV, ice), scores and messages arrive as they change.

   const net = SoupNet.create({RS, MAP, stage, hooks:{say, dirty, end, welcome, status, tint, fx}})
   net.connect(url, name, {watch}); each frame: net.update(dt, aim) where aim is {x, y} or null.
   watch:true joins without a strand, to watch only. net.spectate(id) follows another strand (null: your own again);
   the server then sends what is near that strand.
   It also looks like the single-player sim to the page: players, nucs, frags, state, timeLeft, standings(),
   working(p), has(p, fn), complexity(p), fold(p), drop(p), me. */
window.SoupNet = (() => {
'use strict';
const SEG = window.SoupSegments, FN = SEG.names;   /* the server numbers segment types in this order */
const DELAY = 0.1;                 /* how far behind the server other strands are drawn, seconds */
const STATES = {p:'play', o:'over', r:'ready', i:'idle'};
const now = () => performance.now() / 1000;
const wrapA = a => ((a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function create(o){
  const {RS, MAP, stage} = o;
  const hooks = Object.assign({say(){}, dirty(){}, end(){}, welcome(){}, status(){}, tint(){ return null; }, fx(){}, outdated(){}, host(){}}, o.hooks || {});
  /* o.version: the page's own version, or a function returning it (the page learns it from /version after loading) */
  const pageVersion = () => typeof o.version === 'function' ? o.version() : o.version;
  let lobby = false, isHost = false, hostName = '', auto = false, autoEnd = 0, worldSize = 0, mapKind = 'world';   /* the room's lobby before a game, and who can start it */
  let ws = null, meId = null, seed = null, state = 'connecting', tl = 0, tlAt = 0, offset = null, rtt = 0.08, url = '', name = '', watchOnly = false, watchId = null;
  let lastSend = 0, lastAim = null, retry = 0, closedByUs = false;
  /* a random token for this tab only (gone when the tab closes): lets a refresh or a dropped connection take your strand back */
  let tok = null;
  try { tok = sessionStorage.getItem('soup.tok'); if (!tok){ tok = Math.random().toString(36).slice(2) + Date.now().toString(36); sessionStorage.setItem('soup.tok', tok); } } catch(e){ tok = Math.random().toString(36).slice(2); }
  const P = new Map(), F = new Map(), N = new Map(), roster = new Map(), scores = new Map();
  let players = [], frags = [], nucs = [], mini = [];
  const hist = [];                 /* your predicted head positions, to compare with what the server saw */
  const lists = () => { players = [...P.values()]; frags = [...F.values()]; };

  /* ---------- mirrors ---------- */
  function mirror(id){
    let m = P.get(id);
    if (m) return m;
    const r = roster.get(id) || {name:'···', col:'p1', bot:1};
    m = {id, name:id === meId ? 'You' : r.name, col:id === meId ? 'stain' : r.col, isBot:id === meId ? false : !!r.bot, alive:false, inv:0, ai:{label:''}, mind:null,
         buf:[], s:null, shown:false, qk:null, tx:0, ty:0};
    m.s = stage.addStrand({seq:'', x:0, y:0, heading:0, tint:id === meId ? null : hooks.tint(m.col, m.isBot)});
    m.s.setVisible(false);
    P.set(id, m); lists(); return m;
  }
  function fragMirror(id){
    let f = F.get(id);
    if (f) return f;
    f = {id, buf:[], s:stage.addStrand({seq:'', x:0, y:0, heading:0, tint:hooks.tint('muted', true)}), shown:false, qk:null, seen:now(), owner:null};
    f.s.setOpacity(0.7); f.s.setVisible(false);
    F.set(id, f); lists(); return f;
  }
  function dropMirror(map, id){ const m = map.get(id); if (!m) return; m.s.remove(); map.delete(id); lists(); }
  function clearAll(){ for (const id of [...P.keys()]) dropMirror(P, id); for (const id of [...F.keys()]) dropMirror(F, id); N.clear(); nucs = []; hist.length = 0; }

  function applyQ(m){
    const t = m.f ? fragMirror(m.id) : mirror(m.id), s = t.s;
    const key = m.seq + '|' + m.sg.join(';');
    if (t.qk !== key){
      t.qk = key;
      s.setSeq(m.seq, m.sg.map(([fi, a, b, q]) => ({fn:fi >= 0 ? FN[fi] : null, start:a, end:b, q:q == null ? 1 : q})));
    }
    /* damage: match the server's list exactly */
    const dm = new Set(m.dm);
    for (const g of s.segments){
      const st = s.structureAt(g.start); if (!st) continue;
      if (dm.has(g.start) && !st.damaged) s.damageAt(g.start);
      else if (!dm.has(g.start) && st.damaged) s.mendAt(g.start);
    }
    /* Cleavers growing back: the page counts each one down from what the server said */
    if (!m.f){ const was = t.rest || new Map(); t.rest = new Map((m.rs || []).map(([a, l]) => [a, was.has(a) ? was.get(a) : now() + l])); for (const a of was.keys()) if (!t.rest.has(a)) s.setRest(a, 0); }
    if (!m.f && m.id === meId) hooks.dirty();
  }

  /* ---------- messages ---------- */
  function onMessage(e){
    let m; try { m = JSON.parse(e.data); } catch(err){ return; }
    switch (m.t){
      case 'w':
        meId = m.id == null ? null : m.id; retry = 0;
        /* the server was redeployed since this page loaded: offer a refresh (the game keeps working meanwhile) */
        { const mine = pageVersion(); if (m.v && mine && m.v !== 'dev' && m.v !== mine) hooks.outdated(m.v); }
        if (m.seed !== seed || !!m.lb !== lobby || (m.wd || 0) !== worldSize){ seed = m.seed; lobby = !!m.lb; worldSize = m.wd || 0; clearAll(); MAP.generate(seed, lobby ? {lobby:true} : worldSize ? {world:{size:worldSize}} : undefined);
          if (m.wh && MAP.worldHash !== m.wh) console.warn('This browser grew a different map from the room (world fingerprint ' + MAP.worldHash + ' vs ' + m.wh + ')'); }
        else { N.clear(); nucs = []; }   /* rejoining the same map: the server sends the nearby letters again */
        state = STATES[m.st] || m.st; tl = m.tl; tlAt = now();
        if (meId != null) mirror(meId).name = 'You';
        if (watchId != null) send({t:'v', id:watchId});   /* after a reconnect or a new round, keep watching */
        hooks.welcome(m); break;
      case 'r': {
        roster.clear();
        for (const [id, nm, col, bot] of m.P) roster.set(id, {name:nm, col, bot});
        for (const id of [...P.keys()]) if (!roster.has(id)) dropMirror(P, id);
        for (const [id, r] of roster){ const mm = P.get(id); if (mm && id !== meId){ mm.name = r.name; mm.isBot = !!r.bot; if (mm.col !== r.col){ mm.col = r.col; const tn = hooks.tint(r.col, mm.isBot); if (tn) mm.s.tint(tn.spine, tn.goo); } } }
        break;
      }
      case 'q': applyQ(m); break;
      case 's': onSnap(m); break;
      case 'a': mini = m.A; for (const [id, x, y] of m.A){ const mm = P.get(id); if (mm){ mm.mx = x; mm.my = y; } } break;
      case 'b': scores.clear(); for (const [id, sc] of m.B) scores.set(id, sc); break;
      case 'm': MAP.applyNet(m); break;
      case 'say': hooks.say(m.text); break;
      case 'e': state = 'over'; hooks.end(m.rows.map(([id, nm, col, sc, bot, st]) => ({p:P.get(id) || {id, name:nm, col, isBot:!!bot, s:{length:0}}, score:sc,
        stats:st ? {letters:st[0], folds:st[1], cuts:st[2], cutsTaken:st[3], hits:st[4], hitsTaken:st[5], joins:st[6], deaths:st[7]} : null}))); break;
      case 'pong': rtt = rtt * 0.8 + (now() - m.at) * 0.2; break;
      case 'h': isHost = !!m.you; hostName = m.name || ''; auto = !!m.auto; mapKind = m.mp || 'world'; autoEnd = m.in ? now() + m.in : 0; hooks.host(); break;
      case 'full': hooks.status(m.watch ? 'Too many people are watching this room.' : 'This room is full. Try another room name.'); closedByUs = true; break;
    }
  }
  function onSnap(m){
    const st = m.k / 30, t = now(), est = st - t;
    offset = offset == null ? est : (est > offset + 0.25 || est < offset - 0.25) ? est : offset + (est - offset) * 0.05;
    tl = m.tl; tlAt = t; state = STATES[m.st] || state;
    for (const e of m.P){
      const [id, x, y, h, mv, lp, alive, inv, label] = e, mm = mirror(id);
      const was = mm.alive; mm.alive = !!alive; mm.inv = inv; mm.ai.label = label || '';
      if (was !== mm.alive && id === meId){ hooks.dirty(); if (!mm.alive) mm.shown = false; }
      mm.buf.push({t:st, x, y, h, mv:mv / 100, lp:lp / 100, at:t}); if (mm.buf.length > 30) mm.buf.shift();
      mm.last = st;
      if (id === meId) correct(mm, x, y, h, t);
    }
    /* a freshly cut piece also says how long it can still be taken and how far through fading it is */
    for (const [id, x, y, h, fr, fd] of m.F || []){ const f = fragMirror(id); f.buf.push({t:st, x, y, h, mv:0.2, lp:0}); if (f.buf.length > 30) f.buf.shift(); f.last = st; f.seen = t; f.gone = false; if (fr != null){ f.fresh = fr; f.fade = fd < 0 ? null : fd; f.cutAt = t; } }
    if (m.N){
      const [add, mov, del] = m.N;
      /* a fifth entry marks a letter that is breaking down: the page fades it out from the moment it hears */
      const now = performance.now() / 1000, fading = (q, d) => { if (d && q.dAt == null) q.dAt = now; };
      for (const [id, x, y, b, d] of add){ const q = {id, x, y, b}; fading(q, d); N.set(id, q); }
      for (const [id, x, y, b, d] of mov){ let q = N.get(id); if (q){ q.x = x; q.y = y; q.b = b; } else N.set(id, q = {id, x, y, b}); fading(q, d); }
      for (const id of del) N.delete(id);
      nucs = [...N.values()];
    }
    for (const [x, y, col, r, dur, flash] of m.X || []) hooks.fx({x, y, col, r, dur, flash:!!flash});
    /* strands that left your view: hide them until they come back */
    for (const mm of P.values()) if (mm.last != null && mm.last < st - 0.4 && mm.id !== meId){ mm.shown = false; mm.alive = false; }
    /* fragments the server stopped sending (taken in by a Joiner, burst, or out of view): hide them at once, not just
       stop moving them, and forget them after a while */
    for (const f of F.values()) if (t - f.seen > 0.3){ f.gone = true; if (f.shown){ f.shown = false; f.s.setVisible(false); } if (t - f.seen > 90) dropMirror(F, f.id); }
  }

  /* ---------- your own strand: predicted here, corrected by the server ---------- */
  function predict(me, dt, aim){
    const s = me.s, h = s.head, prev = {x:h.x, y:h.y};
    /* the same swim rule as sim.js */
    const sw = SEG.swimOf(s.functions.filter(f => !f.damaged)), L = s.length;
    const sp = 170 * (1 + sw.speed) / (1 + 0.003 * L), drag = MAP.speedAt(h.x, h.y);
    const tg = aim || {x:h.x, y:h.y};
    s.cruise(dt, tg, {speed:sp, drag, turnCap:3 + sw.turn, hold:16});
    const fl = MAP.flowAt(h.x, h.y);
    if (fl.x || fl.y){ const k = 1 / (1 + 0.003 * L); s.move(fl.x * k * dt, fl.y * k * dt); }
    /* walls, as the server does them */
    const W = MAP.W, H = MAP.H;
    const x = clamp(h.x, 20, W - 20), y = clamp(h.y, 20, H - 20); if (x !== h.x || y !== h.y) s.setHead(x, y);
    if (MAP.solidAt(h.x, h.y)){
      if (!MAP.solidAt(h.x, prev.y)) s.setHead(h.x, prev.y);
      else if (!MAP.solidAt(prev.x, h.y)) s.setHead(prev.x, h.y);
      else s.setHead(prev.x, prev.y);
    }
    hist.push({t:now(), x:h.x, y:h.y}); while (hist.length && hist[0].t < now() - 2) hist.shift();
  }
  function correct(me, sx, sy, sh, t){
    if (!me.alive){ return; }
    const s = me.s, h = s.head;
    if (!me.shown){ s.place(sx, sy, sh); me.shown = true; hist.length = 0; return; }
    /* where were we when the server took this snapshot? about half a round trip plus a send interval ago */
    const then = t - rtt / 2 - 1 / 30;
    let ref = null; for (let i = hist.length - 1; i >= 0; i--){ if (hist[i].t <= then){ ref = hist[i]; break; } }
    if (!ref) ref = {x:h.x, y:h.y};
    const ex = sx - ref.x, ey = sy - ref.y, e = Math.hypot(ex, ey);
    if (e > 140){ s.place(sx, sy, sh); hist.length = 0; me.cx = me.cy = 0; return; }      /* thrown by a geyser, respawned, pushed: jump */
    /* small errors are eased out over the next few frames rather than in one jump (a jump makes the arms shake) */
    if (e > 2){ me.cx = ex * 0.25; me.cy = ey * 0.25; }
  }

  /* ---------- the frame ---------- */
  /* between two snapshots the head runs along a smooth curve (Catmull-Rom through the snapshots around it), heading too.
     Straight lines between snapshots put a small corner in the path 15 times a second, and long arms (a Mover's blades,
     a Cleaver's spikes) swing at every corner: the shake. */
  function sample(buf, rt){
    if (!buf.length) return null;
    if (rt <= buf[0].t) return buf[0];
    for (let i = buf.length - 1; i > 0; i--){
      const a = buf[i - 1], b = buf[i];
      if (rt >= a.t && rt <= b.t){
        const p0 = buf[i - 2] || a, p3 = buf[i + 1] || b, f = (rt - a.t) / ((b.t - a.t) || 1), f2 = f * f, f3 = f2 * f;
        const cr = (q0, q1, q2, q3) => 0.5 * (2 * q1 + (q2 - q0) * f + (2 * q0 - 5 * q1 + 4 * q2 - q3) * f2 + (3 * q1 - q0 - 3 * q2 + q3) * f3);
        const ha = a.h, h0 = ha - wrapA(a.h - p0.h), hb = ha + wrapA(b.h - a.h), h3 = hb + wrapA(p3.h - b.h);
        return {x:cr(p0.x, a.x, b.x, p3.x), y:cr(p0.y, a.y, b.y, p3.y), h:wrapA(cr(h0, ha, hb, h3)), mv:b.mv, lp:b.lp};
      }
    }
    /* ran past the newest snapshot: keep going a little in the same direction, then hold */
    const b = buf[buf.length - 1], a = buf[buf.length - 2] || b, over = Math.min(0.2, rt - b.t), span = (b.t - a.t) || 1;
    return {x:b.x + (b.x - a.x) / span * over, y:b.y + (b.y - a.y) / span * over, h:b.h, mv:b.mv, lp:b.lp};
  }
  function update(dt, aim){
    MAP.coast(dt);
    const t = now();
    /* steering goes to the server about 15 times a second, plus a ping now and then for the round trip */
    if (ws && ws.readyState === 1 && (meId != null || watchOnly)){
      if (aim && meId != null && watchId == null && t - lastSend > 1 / 15 && (!lastAim || Math.abs(aim.x - lastAim.x) + Math.abs(aim.y - lastAim.y) > 1 || t - lastSend > 0.5)){
        ws.send(JSON.stringify({t:'i', x:Math.round(aim.x), y:Math.round(aim.y)})); lastSend = t; lastAim = {x:aim.x, y:aim.y};
      }
      if (!update.pingT || t - update.pingT > 2){ update.pingT = t; ws.send(JSON.stringify({t:'ping', at:t})); }
    }
    if (offset == null) return;
    const rt = t + offset - DELAY;
    for (const mm of P.values()){
      if (mm.rest && mm.rest.size) for (const [a, until] of mm.rest) mm.s.setRest(a, window.SoupSegments.restOf(until - now()));
      if (mm.id === meId){
        if (mm.alive && mm.shown && state === 'play'){
          if (mm.cx || mm.cy){ const k = Math.min(1, dt * 12), dx = mm.cx * k, dy = mm.cy * k, h = mm.s.head; mm.s.setHead(h.x + dx, h.y + dy); mm.cx -= dx; mm.cy -= dy; if (Math.abs(mm.cx) + Math.abs(mm.cy) < 0.05) mm.cx = mm.cy = 0; }
          predict(mm, dt, aim);
        }
        else if (mm.buf.length){ const b = mm.buf[mm.buf.length - 1]; if (!mm.shown && mm.alive){ mm.s.place(b.x, b.y, b.h); mm.shown = true; } mm.s.follow(dt, b.x, b.y, b.h, {moving:b.mv, limp:b.lp}); }
        continue;
      }
      if (!mm.alive) continue;
      const p = sample(mm.buf, rt); if (!p) continue;
      if (!mm.shown){ mm.s.place(p.x, p.y, p.h); mm.shown = true; }
      mm.s.follow(dt, p.x, p.y, p.h, {moving:p.mv, limp:p.lp});
    }
    for (const f of F.values()){
      /* gone: the server stopped sending it. Without this check it was shown again on the very next frame, which is why
         fragments stayed on the map after being taken (rooms only; single player removes them directly) */
      if (!f.buf.length || f.gone) continue;
      const p = sample(f.buf, rt);
      if (!f.shown){ f.s.place(p.x, p.y, p.h); f.shown = true; }
      f.s.follow(dt, p.x, p.y, p.h, {moving:0.2, limp:0});
      if (f.fresh != null){
        /* run the pulse and fade on here between snapshots, from what the last one said */
        const SG = window.SoupSegments, el = now() - f.cutAt;
        let fr = 0, fd = null; if (f.fade == null){ fr = f.fresh - el; if (fr <= 0) fd = SG.CUT_FADE + fr; } else fd = f.fade - el;
        f.s.setOpacity(SG.fragAlpha(fr, fd, now()));
      }
    }
  }

  /* ---------- connection ---------- */
  function connect(u, nm, opt){
    url = u; name = nm; closedByUs = false; if (opt) watchOnly = !!opt.watch;
    hooks.status('Connecting…');
    ws = new WebSocket(url);
    ws.onopen = () => { ws.send(JSON.stringify(watchOnly ? {t:'j', watch:1} : {t:'j', name, tok})); hooks.status(''); };
    ws.onmessage = onMessage;
    ws.onclose = () => {
      if (closedByUs) return;
      /* dropped: try again with a growing wait, keeping the same name */
      retry = Math.min(retry + 1, 6); hooks.status('Connection lost. Reconnecting…');
      setTimeout(() => connect(url, name), 500 * retry);
    };
    ws.onerror = () => {};
  }
  const working = p => p && p.s ? p.s.functions.filter(f => !f.damaged) : [];
  function complexity(p){
    if (scores.has(p.id)) return scores.get(p.id);
    const seen = {}; let sc = 0; for (const f of working(p)){ sc += seen[f.fn] ? 1 : 3; seen[f.fn] = true; sc += f.bonus || 0; if (SEG.strength(f) > 1) sc += 1; } return sc;
  }
  const send = obj => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); };

  return {connect, update, working, complexity,
    has:(p, fn) => working(p).some(f => f.fn === fn),
    fold(p){ if (!p || !p.s.tail) return false; send({t:'f'}); return true; },
    drop(){ send({t:'d'}); },
    standings(){ return players.filter(p => roster.has(p.id) || p.id === meId).map(p => ({p, score:complexity(p)})).sort((a, b) => b.score - a.score); },
    close(){ closedByUs = true; if (ws) ws.close(); },
    spectate(id){ watchId = id == null ? null : id; send({t:'v', id:watchId}); },
    start(){ send({t:'start'}); },
    setAuto(on){ send({t:'auto', on:!!on}); },
    setMap(kind){ send({t:'map', v:kind}); },
    get mapKind(){ return mapKind; },
    get auto(){ return auto; }, get autoIn(){ return autoEnd ? Math.max(0, autoEnd - now()) : 0; },
    get lobby(){ return lobby; }, get isHost(){ return isHost; }, get hostName(){ return hostName; },
    inRoster:id => roster.has(id),
    get watchOnly(){ return watchOnly; },
    debug:obj => send(Object.assign({t:'debug'}, obj)),   /* ignored by real servers; local testing only */
    get me(){ return meId != null ? P.get(meId) || null : null; }, get players(){ return players; }, get frags(){ return frags.filter(f => f.shown); }, get nucs(){ return nucs; },
    get mini(){ return mini; }, get state(){ return state; }, get timeLeft(){ return Math.max(0, tl - (state === 'play' ? now() - tlAt : 0)); },
    get rtt(){ return rtt; }, get seed(){ return seed; }};
}

return {create};
})();
