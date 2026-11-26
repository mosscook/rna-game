/* One room of RNA Soup: a Cloudflare Durable Object.
   Everyone who opens rna.game/<name> reaches the same object. It runs the one true copy of the game
   (the same sim.js the browser uses for single-player) and sends each player what is near them,
   in the format public/net.js reads.

   Life of a room: the first player wakes it and a round starts. Rounds run back to back (play, a short
   results screen, a fresh map). Bots fill empty seats. When the last player leaves, the room waits a
   little in case it was a refresh, then stops its loop and is forgotten. Nothing about players is stored. */
import {DurableObject} from 'cloudflare:workers';
import {makeGame, FN} from './game.js';

/* which deploy this is (Cloudflare's version id), so pages loaded before a deploy can offer a refresh */
export function versionOf(env){ const m = env && env.CF_VERSION_METADATA; return (m && m.id) || 'dev'; }

const HZ = 30, TICK = 1 / HZ;
const MIN_STRANDS = 10;          /* bots keep the room at least this busy */
const MAX_HUMANS = 12;           /* more than this and Chromebooks struggle to draw the room */
const MAX_WATCHERS = 6;          /* tabs that only watch (a teacher's projector): no strand, not counted as players */
const ROUND = 300;               /* seconds of play */
const RESULTS = 15;              /* seconds on the results screen before the next map */
const GRACE = 30;                /* seconds a dropped player's strand waits for them to come back */
const SLEEP_AFTER = 30;          /* seconds an empty room waits before it stops */
const VIEW_X = 1500, VIEW_Y = 1100;   /* half the size of the area each player is sent */
const HUMAN_COLS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8', 'h9', 'h10', 'h11', 'h12'];
const ST = {play:'p', over:'o', ready:'r', idle:'i'};
const MAX_MSG = 300, MSG_PER_SEC = 60;

const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100, r3 = v => Math.round(v * 1000) / 1000;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const randomCodon = () => [0, 0, 0].map(() => 'AUGC'[Math.floor(Math.random() * 4)]).join('');

export class GameRoom extends DurableObject {
  constructor(ctx, env){
    super(ctx, env);
    this.clients = new Set();
    this.away = new Map();       /* tab token -> {p, until} for players whose connection dropped */
    this.game = null;
    this.timer = null;
    /* shorter rounds for local testing: wrangler dev --var ROUND_SECONDS:20 */
    this.round = Number(env && env.ROUND_SECONDS) || ROUND;
    this.results = Number(env && env.RESULTS_SECONDS) || RESULTS;
  }

  async fetch(req){
    /* the names in use, for the join screen; asking does not wake a sleeping room */
    if (new URL(req.url).pathname === '/names'){
      const taken = this.sim ? this.sim.players.filter(p => !p.isBot).map(p => p.name) : [];
      return Response.json({taken}, {headers:{'Cache-Control':'no-store'}});
    }
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', {status:426});
    const pair = new WebSocketPair(), [client, server] = Object.values(pair);
    server.accept();
    const c = {ws:server, p:null, watcher:false, watch:null, known:new Map(), budget:MSG_PER_SEC, budgetAt:Date.now(), cx:0, cy:0};
    this.clients.add(c);
    if (!this.game) this.wake();
    server.addEventListener('message', e => this.onMessage(c, e.data));
    server.addEventListener('close', () => this.onClose(c));
    server.addEventListener('error', () => this.onClose(c));
    return new Response(null, {status:101, webSocket:client});
  }

  /* ---------- the room's life ---------- */
  wake(){
    this.fxQ = [];
    this.qk = new Map();
    this.rosterKey = '';
    this.k = 0;
    this.overT = 0;
    this.emptyT = 0;
    this.game = makeGame({minStrands:MIN_STRANDS, round:this.round, hooks:{
      say:(p, text) => { const c = this.clientOf(p); if (c) this.send(c, {t:'say', text}); },
      fx:e => this.fxQ.push(e),
      end:rows => this.onEnd(rows)
    }});
    this.sim = this.game.sim;
    this.sim.reset();
    this.sim.start();
    this.last = Date.now(); this.acc = 0;
    this.timer = setInterval(() => this.loop(), 1000 / HZ);
  }
  sleep(){
    clearInterval(this.timer); this.timer = null;
    if (this.game) this.game.stage.dispose();
    this.game = null; this.sim = null; this.away.clear();
  }
  loop(){
    if (!this.sim) return;
    const now = Date.now();
    const el = Math.min(0.5, (now - this.last) / 1000);
    this.last = now; this.acc += el;
    let n = 0;
    while (this.acc >= TICK && n < 4){ this.acc -= TICK; this.tick(); n++; }
    if (n === 4) this.acc = 0;   /* fell behind: skip ahead rather than spiral */
    if (n) this.sendSnapshots();

    /* dropped players who didn't come back */
    for (const [tok, a] of this.away) if (now > a.until){ this.away.delete(tok); this.sim.leave(a.p); }
    /* nobody here: stop after a while */
    if (!this.clients.size){ this.emptyT += el; if (this.emptyT > SLEEP_AFTER) this.sleep(); }
    else this.emptyT = 0;
  }
  tick(){
    this.k++;
    if (this.sim.state === 'over'){ this.overT -= TICK; if (this.overT <= 0) return this.newRound(); }
    this.sim.step(TICK);
    this.sendChanges();
  }
  onEnd(rows){
    this.overT = this.results;
    this.broadcast({t:'e', rows:rows.map(r => [r.p.id, r.p.name, r.p.col, r.score, r.p.isBot ? 1 : 0])});
  }
  newRound(){
    this.sim.reset();
    this.sim.start();
    this.qk.clear();
    for (const c of this.clients) if (c.p || c.watcher) this.welcome(c);
    /* everyone now has every strand as it is, and the roster */
    for (const p of this.sim.players) this.qk.set('p' + p.id, this.qKey(this.strandParts(p.s)));
    for (const f of this.sim.frags) this.qk.set('f' + f.id, this.qKey(this.strandParts(f.s)));
    this.rosterKey = this.sim.players.map(p => `${p.id}:${p.name}:${p.col}:${p.isBot ? 1 : 0}`).join(',');
  }

  /* ---------- players coming and going ---------- */
  onMessage(c, data){
    if (typeof data !== 'string' || data.length > MAX_MSG || !this.sim) return;
    const now = Date.now();
    c.budget = Math.min(MSG_PER_SEC, c.budget + (now - c.budgetAt) / 1000 * MSG_PER_SEC); c.budgetAt = now;
    if (c.budget < 1) return;
    c.budget--;
    let m; try { m = JSON.parse(data); } catch(e){ return; }
    if (!m || typeof m !== 'object') return;
    const p = c.p;
    switch (m.t){
      case 'j': this.join(c, m); break;
      case 'i':
        if (p && p.alive && c.watch == null && Number.isFinite(m.x) && Number.isFinite(m.y)){ p.tx = clamp(m.x, 5, this.sim.W - 5); p.ty = clamp(m.y, 5, this.sim.H - 5); }
        break;
      case 'f': if (p && this.sim.state === 'play') this.sim.fold(p); break;
      case 'd': if (p && this.sim.state === 'play') this.sim.drop(p); break;
      case 'ping': if (Number.isFinite(m.at)) this.send(c, {t:'pong', at:m.at}); break;
      case 'v':
        /* spectate: follow another strand (its id), or null to go back to your own. Your own strand waits where it is. */
        c.watch = Number.isInteger(m.id) && this.sim.players.some(o => o.id === m.id) ? m.id : null;
        if (p && c.watch != null){ p.tx = p.s.head.x; p.ty = p.s.head.y; }
        break;
    }
  }
  join(c, m){
    if (c.p || c.watcher) return;
    if (m.watch){
      /* watch only: no strand, no seat taken from bots */
      if ([...this.clients].filter(o => o.watcher).length >= MAX_WATCHERS){ this.send(c, {t:'full', watch:1}); try { c.ws.close(1000, 'Too many watchers'); } catch(e){} this.clients.delete(c); return; }
      c.watcher = true;
      this.welcome(c);
      return;
    }
    const name = typeof m.name === 'string' && /^[AUGC]{3}$/.test(m.name) ? m.name : randomCodon();
    const tok = typeof m.tok === 'string' && /^[a-z0-9]{6,40}$/i.test(m.tok) ? m.tok : null;
    let p = null;
    if (tok){
      /* a refreshed tab, or a dropped connection, takes its strand back */
      const a = this.away.get(tok);
      if (a){ p = a.p; this.away.delete(tok); }
      else for (const o of this.clients) if (o !== c && o.p && o.p.tok === tok){ p = o.p; o.p = null; this.clients.delete(o); try { o.ws.close(1000, 'Opened in another tab'); } catch(e){} break; }
    }
    if (!p){
      if (this.humanCount() >= MAX_HUMANS){ this.send(c, {t:'full'}); try { c.ws.close(1000, 'Room full'); } catch(e){} this.clients.delete(c); return; }
      p = this.sim.addHuman(name, this.freeColor());
      p.tok = tok;
    }
    p.name = name;
    c.p = p;
    this.rosterKey = '';
    this.welcome(c);
  }
  onClose(c){
    if (!this.clients.delete(c)) return;
    const p = c.p; c.p = null;
    if (!p || !this.sim) return;
    p.tx = p.s.head.x; p.ty = p.s.head.y;
    if (p.tok) this.away.set(p.tok, {p, until:Date.now() + GRACE * 1000});
    else this.sim.leave(p);
  }
  humanCount(){ return this.sim.players.filter(p => !p.isBot).length; }
  freeColor(){
    const used = new Set(this.sim.players.filter(p => !p.isBot).map(p => p.col));
    return HUMAN_COLS.find(col => !used.has(col)) || HUMAN_COLS[Math.floor(Math.random() * HUMAN_COLS.length)];
  }
  clientOf(p){ for (const c of this.clients) if (c.p === p) return c; return null; }

  /* ---------- what gets sent ---------- */
  send(c, obj){ try { c.ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj)); } catch(e){} }
  broadcast(obj){ const s = JSON.stringify(obj); for (const c of this.clients) if (c.p || c.watcher) this.send(c, s); }

  /* everything a player needs on arrival, or when a new map starts */
  welcome(c){
    const sim = this.sim;
    c.known = new Map();
    this.send(c, {t:'w', v:versionOf(this.env), id:c.p ? c.p.id : null, seed:sim.seed, st:ST[sim.state] || 'i', tl:r1(sim.timeLeft)});
    this.send(c, this.rosterMsg());
    for (const p of sim.players) this.send(c, this.strandMsg(p.s, p.id, false));
    for (const f of sim.frags) this.send(c, this.strandMsg(f.s, f.id, true));
    this.send(c, Object.assign({t:'m'}, this.game.MAP.netState()));
    this.send(c, this.scoresMsg());
  }
  rosterMsg(){ return {t:'r', P:this.sim.players.map(p => [p.id, p.name, p.col, p.isBot ? 1 : 0])}; }
  scoresMsg(){ return {t:'b', B:this.sim.players.map(p => [p.id, this.sim.complexity(p)])}; }
  /* a strand's letters, folds and damage (sent only when they change) */
  strandParts(s){
    const sg = s.segments;
    const dm = []; for (const g of sg){ const st = s.structureAt(g.start); if (st && st.damaged) dm.push(g.start); }
    return {seq:s.seq, sg:sg.map(g => [g.fn ? FN.indexOf(g.fn) : -1, g.start, g.end]), dm};
  }
  strandMsg(s, id, frag){ const q = this.strandParts(s); return frag ? {t:'q', id, f:1, ...q} : {t:'q', id, ...q}; }
  qKey(q){ return q.seq + '|' + q.sg.join(';') + '|' + q.dm.join(','); }

  /* after each step: roster and strand shapes that changed go to everyone */
  sendChanges(){
    const sim = this.sim;
    const rk = sim.players.map(p => `${p.id}:${p.name}:${p.col}:${p.isBot ? 1 : 0}`).join(',');
    if (rk !== this.rosterKey){ this.rosterKey = rk; this.broadcast(this.rosterMsg()); }
    const live = new Set();
    const check = (s, id, frag) => {
      const key = (frag ? 'f' : 'p') + id; live.add(key);
      const q = this.strandParts(s), k = this.qKey(q);
      if (this.qk.get(key) === k) return;
      this.qk.set(key, k);
      this.broadcast(frag ? {t:'q', id, f:1, ...q} : {t:'q', id, ...q});
    };
    for (const p of sim.players) check(p.s, p.id, false);
    for (const f of sim.frags) check(f.s, f.id, true);
    for (const key of this.qk.keys()) if (!live.has(key)) this.qk.delete(key);
  }

  /* each player gets the strands, fragments, letters and effects near them */
  sendSnapshots(){
    const sim = this.sim, st = ST[sim.state] || 'i', tl = r1(sim.timeLeft);
    const P = sim.players.map(p => {
      const s = p.s, h = s.head;
      /* positions to a tenth of a pixel and heading to a thousandth: whole pixels made long arms wobble on other screens */
      return {p, x:h.x, y:h.y, e:[p.id, r1(h.x), r1(h.y), r3(s.heading), Math.round(s.moving * 100), Math.round(s.limp * 100),
        p.alive ? 1 : 0, r1(Math.max(0, p.inv || 0)), (p.ai && p.ai.label) || '']};
    });
    const F = sim.frags.map(f => ({x:f.s.head.x, y:f.s.head.y, e:[f.id, r1(f.s.head.x), r1(f.s.head.y), r3(f.s.heading)]}));
    const X = this.fxQ.splice(0).map(e => ({x:e.x, y:e.y, e:[Math.round(e.x), Math.round(e.y), e.col, Math.round(e.r || 26), e.dur || 0.5, e.flash ? 1 : 0]}));
    const near = (c, x, y, mx = 0) => Math.abs(x - c.cx) < VIEW_X + mx && Math.abs(y - c.cy) < VIEW_Y + mx;
    const every = n => this.k % n === 0;
    const mapMsg = every(8) ? JSON.stringify(Object.assign({t:'m'}, this.game.MAP.netState())) : null;
    const scores = every(HZ) ? JSON.stringify(this.scoresMsg()) : null;
    const mini = every(HZ) ? JSON.stringify({t:'a', A:sim.players.filter(p => p.alive).map(p => [p.id, Math.round(p.s.head.x), Math.round(p.s.head.y)])}) : null;

    for (const c of this.clients){
      const me = c.p; if (!me && !c.watcher) continue;
      /* the area sent is around the strand being watched, or your own */
      const focus = (c.watch != null && sim.players.find(o => o.id === c.watch)) || me || sim.players[0];
      if (!focus) continue;
      c.cx = focus.s.head.x; c.cy = focus.s.head.y;
      /* letters: new ones in view, ones that moved or changed, and ones that left or were eaten */
      const add = [], mov = [], del = [];
      const seen = new Set();
      for (const q of sim.nucs){
        if (q.id == null) continue;
        const k = c.known.get(q.id);
        if (near(c, q.x, q.y, k ? 200 : 0)){
          seen.add(q.id);
          if (!k){ add.push([q.id, Math.round(q.x), Math.round(q.y), q.b]); c.known.set(q.id, [q.x, q.y, q.b]); }
          else if (Math.abs(k[0] - q.x) + Math.abs(k[1] - q.y) > 3 || k[2] !== q.b){ mov.push([q.id, Math.round(q.x), Math.round(q.y), q.b]); k[0] = q.x; k[1] = q.y; k[2] = q.b; }
        }
      }
      for (const id of c.known.keys()) if (!seen.has(id)){ del.push(id); c.known.delete(id); }
      const snap = {t:'s', k:this.k, tl, st,
        P:P.filter(o => o.p === me || o.p === focus || near(c, o.x, o.y)).map(o => o.e),
        F:F.filter(o => near(c, o.x, o.y)).map(o => o.e)};
      if (add.length || mov.length || del.length) snap.N = [add, mov, del];
      const xs = X.filter(o => near(c, o.x, o.y, 400)).map(o => o.e);
      if (xs.length) snap.X = xs;
      this.send(c, snap);
      if (mapMsg) this.send(c, mapMsg);
      if (scores) this.send(c, scores);
      if (mini) this.send(c, mini);
    }
  }
}
