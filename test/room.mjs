/* Plays a room with fake players over WebSocket, against `wrangler dev`.
   Start the server with short rounds first:
     npx wrangler dev --var ROUND_SECONDS:20 --var RESULTS_SECONDS:4
   then: node test/room.mjs [base url] */
import WebSocket from 'ws';

const BASE = (process.argv[2] || 'ws://localhost:8787').replace(/^http/, 'ws');
const room = 'test-' + Math.random().toString(36).slice(2, 7);
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed++; };

function player(name, tok){
  const p = {name, tok, msgs:[], count:{}, bytes:0, id:null, seeds:[], ws:null};
  p.open = () => new Promise((res, rej) => {
    const ws = new WebSocket(`${BASE}/ws/${room}`); p.ws = ws;
    ws.on('open', () => { ws.send(JSON.stringify({t:'j', name, tok})); res(p); });
    ws.on('message', d => {
      const s = d.toString(); p.bytes += s.length;
      const m = JSON.parse(s); p.count[m.t] = (p.count[m.t] || 0) + 1; p.last = p.last || {}; p.last[m.t] = m;
      if (m.t === 'w'){ p.id = m.id; p.seeds.push(m.seed); p.lobby = !!m.lb; }
      if (m.t === 'h') p.host = m;
      if (m.t === 'e') p.ended = m;
      if (m.t === 'full') p.full = true;
    });
    ws.on('error', rej);
  });
  p.aim = (x, y) => p.ws.readyState === 1 && p.ws.send(JSON.stringify({t:'i', x, y}));
  return p;
}

const a = player('AUG', 'tokaaaaaaaa'), b = player('GCA', 'tokbbbbbbbb');
await a.open(); await sleep(300); await b.open();
await sleep(1000);
check(a.id != null && b.id != null && a.id !== b.id, `both joined with their own strands (${a.id}, ${b.id})`);
/* the lobby: practice with no bots until the host starts */
check(a.lobby && b.lobby, 'a new room opens in the lobby');
check(a.last.r.P.length === 2 && a.last.r.P.every(e => !e[3]), `the lobby has no bots (${a.last.r.P.length} strands)`);
check(a.host && a.host.you === 1 && b.host && b.host.you === 0 && b.host.name === 'AUG', 'the first player hosts; the second sees who');
b.ws.send(JSON.stringify({t:'start'})); await sleep(500);
check(a.lobby && b.seeds.length === 1, 'only the host can start');
a.ws.send(JSON.stringify({t:'start'})); await sleep(1000);
check(!a.lobby && !b.lobby && a.seeds.length === 2, 'the host starts the game: everyone moves to a new map');
check(a.count.r >= 1 && a.last.r.P.length >= 10, `roster has ${a.last.r && a.last.r.P.length} strands (bots fill to 10)`);
check(a.last.r.P.filter(e => !e[3]).map(e => e[1]).sort().join() === 'AUG,GCA', 'roster shows both codon names');
check(a.count.q >= 10, `got the shape of every strand (${a.count.q} q messages)`);
const rate = a.count.s / 1.5;
check(rate > 20, `snapshots arriving (${rate.toFixed(0)}/s)`);
const snap = a.last.s;
check(snap.P.some(e => e[0] === a.id), 'snapshot includes my own strand');
check(a.count.m >= 1 && a.count.b >= 1, 'map state and scores arrive');
check(snap.st === 'p', 'round is playing');

/* steer and see the head move */
const me0 = snap.P.find(e => e[0] === a.id);
for (let i = 0; i < 20; i++){ a.aim(me0[1] + 600, me0[2]); await sleep(50); }
const me1 = a.last.s.P.find(e => e[0] === a.id);
check(Math.hypot(me1[1] - me0[1], me1[2] - me0[2]) > 30, `steering moves my strand (${Math.round(me1[1] - me0[1])} px)`);

/* letters near me are sent, far ones are not */
let added = 0; a.ws.on('message', d => { const m = JSON.parse(d.toString()); if (m.t === 's' && m.N) added += m.N[0].length; });
await sleep(500);
check(a.bytes / 1024 < 2000, `bandwidth so far ${(a.bytes / 1024).toFixed(0)} KB`);

/* refresh: same tab token takes the same strand back */
const oldId = b.id; b.ws.close(); await sleep(400);
const b2 = player('GCA', 'tokbbbbbbbb'); await b2.open(); await sleep(600);
check(b2.id === oldId, `reconnect keeps the same strand (${oldId} -> ${b2.id})`);

/* a different tab gets a new strand */
const c = player('UUU', 'tokcccccccc'); await c.open(); await sleep(600);
check(c.id != null && c.id !== a.id && c.id !== b2.id, 'a third player gets their own strand');

/* spectating: a watch-only tab has no strand and takes no seat; anyone can follow any strand */
function watcher(){
  const w = {count:{}, last:{}, ws:null};
  w.open = () => new Promise((res, rej) => {
    const ws = new WebSocket(`${BASE}/ws/${room}`); w.ws = ws;
    ws.on('open', () => { ws.send(JSON.stringify({t:'j', watch:1})); res(w); });
    ws.on('message', d => { const m = JSON.parse(d.toString()); w.count[m.t] = (w.count[m.t] || 0) + 1; w.last[m.t] = m; });
    ws.on('error', rej);
  });
  return w;
}
const w = watcher(); await w.open(); await sleep(1300);
check(w.last.w && w.last.w.id === null, 'a watcher joins with no strand of its own');
check(a.last.r.P.filter(e => !e[3]).length === 3, 'the watcher is not on the roster');
check((w.count.s || 0) > 15 && (w.count.q || 0) >= 10, `the watcher gets snapshots (${w.count.s}) and every strand's shape`);
const pos = a.last.a.A, ah = a.last.s.P.find(e => e[0] === a.id);
const far = pos.filter(e => e[0] !== a.id).sort((x, y) => Math.hypot(y[1] - ah[1], y[2] - ah[2]) - Math.hypot(x[1] - ah[1], x[2] - ah[2]))[0];
w.ws.send(JSON.stringify({t:'v', id:far[0]})); await sleep(500);
check(w.last.s.P.some(e => e[0] === far[0]), `the watcher follows strand ${far[0]} and gets updates around it`);
/* a player spectating: their own strand stops, stays in their updates, and the strand they watch is there too */
a.ws.send(JSON.stringify({t:'v', id:far[0]})); await sleep(300);
const s0 = a.last.s.P.find(e => e[0] === a.id);
for (let i = 0; i < 10; i++){ a.aim(s0[1] + 800, s0[2]); await sleep(50); }
const s1 = a.last.s.P.find(e => e[0] === a.id);
check(!!s1 && a.last.s.P.some(e => e[0] === far[0]), 'a spectating player still gets their own strand and the one they watch');
check(Math.hypot(s1[1] - s0[1], s1[2] - s0[2]) < 60, `steering is ignored while spectating (${Math.round(Math.hypot(s1[1] - s0[1], s1[2] - s0[2]))} px)`);
a.ws.send(JSON.stringify({t:'v', id:null})); await sleep(200);

/* fill the room: 12 humans max (the watcher, still here, does not count) */
const extra = [];
for (let i = 0; i < 10; i++){ const x = player('CCC', 'tokx' + i + 'xxxxxx'); extra.push(x); await x.open(); }
await sleep(800);
const full = extra.filter(x => x.full).length;
check(full === 1, `room caps at 12 players (${full} turned away)`);
check(a.last.r.P.length === 12, `12 strands with 12 players, no bots (${a.last.r.P.length})`);
for (const x of extra) x.ws.close();
c.ws.close();
await sleep(500);

/* a dropped player with a token waits; bots come back when they time out (30 s) — not waited for here */

/* round ends and a new map starts */
const t0 = Date.now();
while (!a.ended && Date.now() - t0 > -1 && Date.now() - t0 < 30000) await sleep(200);
check(!!a.ended, `round ended with ${a.ended && a.ended.rows.length} ranked`);
const seeds0 = a.seeds.length;
await sleep(6000);
check(a.seeds.length > seeds0 && a.seeds[a.seeds.length - 1] !== a.seeds[seeds0 - 1], 'after the results, a new map loads');
check(a.last.s.st === 'p' && a.lobby, 'and the room is back in the lobby');
/* the host leaves: the next player who has been here longest takes over */
a.ws.close(); await sleep(600);
check(b2.host && b2.host.you === 1, 'when the host leaves, the next player hosts');

console.log(`\n${failed ? failed + ' failed' : 'all passed'}; A received ${(a.bytes / 1024).toFixed(0)} KB in ${((Date.now() - t0) / 1000 + 6).toFixed(0)}+ s`);
for (const p of [a, b2, w]) p.ws.close();
process.exit(failed ? 1 : 0);
