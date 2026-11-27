/* A room switched to the generated world, against `wrangler dev`: the host picks it in the lobby, starts, and every
   player is told the world's size and fingerprint, which a local build of the same seed must match. */
import WebSocket from 'ws';
import '../src/dom-shim.js';
import '../public/segments.js'; import '../public/rna-strand.js'; import '../public/biomes.js'; import '../public/worldgen.js'; import '../public/map.js';
const BASE = process.env.BASE || 'ws://localhost:8787', room = 'wtest' + Math.floor(Math.random() * 1e6);
const ws = new WebSocket(`${BASE}/ws/${room}`); const got = [];
const wait = (f, ms = 15000) => new Promise((ok, no) => { const t0 = Date.now(); const iv = setInterval(() => { const m = got.find(f); if (m){ clearInterval(iv); ok(m); } else if (Date.now() - t0 > ms){ clearInterval(iv); no(new Error('timeout')); } }, 50); });
ws.on('message', d => { try { got.push(JSON.parse(d)); } catch(e){} });
await new Promise(ok => ws.on('open', ok));
ws.send(JSON.stringify({t:'j', name:'HOST', tok:'t' + Date.now()}));
await wait(m => m.t === 'h' && m.you);
ws.send(JSON.stringify({t:'map', v:'world'}));
await wait(m => m.t === 'h' && m.mp === 'world');
console.log('ok   the host picked the generated world');
got.length = 0; ws.send(JSON.stringify({t:'start'}));
const w = await wait(m => m.t === 'w' && !m.lb, 30000);
if (w.wd !== 0.7 || !w.wh) throw new Error('welcome without a world: ' + JSON.stringify(w));
console.log('ok   the round is a world of size', w.wd);
const MAP = globalThis.SoupMap.create(); MAP.generate(w.seed, {world:{size:w.wd}});
if (MAP.worldHash !== w.wh) throw new Error(`fingerprints differ: here ${MAP.worldHash}, room ${w.wh}`);
console.log('ok   a local build of seed', w.seed, 'matches the room\'s map exactly');
ws.close(); process.exit(0);
