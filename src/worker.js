/* rna.game: serves the game page and routes each room's connection to its Durable Object.
     rna.game/                 the game against bots, plus a box to join a room
     rna.game/<room>           a shared room: anyone who opens the same name plays together
     rna.game/r/<room>         the same room (older links)
     rna.game/ws/<room>        the room's WebSocket (the page connects here itself)
     rna.game/version          which version is live, so open pages can offer a refresh after a deploy
     rna.game/names/<room>     the codon names in use in a room, so the join screen can suggest a free one
     rna.game/report           (POST) an anonymous health report from a page: an error, or a slow frame rate
     rna.game/reports?key=…    the reports, for whoever holds the REPORT_KEY secret
   Room names: letters, numbers and dashes, up to 32, not case sensitive. */
import {versionOf} from './room.js';
export {GameRoom} from './room.js';
export {ReportLog} from './reports.js';
import {reportsPage} from './reports.js';

const NAME = '[a-z0-9][a-z0-9-]{0,31}';
const WS = new RegExp(`^/ws/(${NAME})$`, 'i');
const PAGE = new RegExp(`^/(?:r/)?(${NAME})/?$`, 'i');
/* paths that are never rooms */
const RESERVED = new Set(['ws', 'r', 'api', 'privacy', 'about', 'index', 'favicon', 'robots', 'version', 'lab', 'names', 'report', 'reports']);
const NAMES = new RegExp(`^/names/(${NAME})$`, 'i');

export default {
  async fetch(req, env){
    const url = new URL(req.url);

    if (url.pathname === '/version')
      return Response.json({v:versionOf(env)}, {headers:{'Cache-Control':'no-store'}});

    /* health reports: written by pages, read with the secret key */
    if (url.pathname === '/report' && req.method === 'POST'){
      const body = await req.text();
      if (body.length > 2000) return new Response(null, {status:413});
      return env.REPORTS.get(env.REPORTS.idFromName('log')).fetch(new Request(new URL('/add', url), {method:'POST', body}));
    }
    if (url.pathname === '/reports'){
      const key = env.REPORT_KEY;
      if (!key || url.searchParams.get('key') !== key) return new Response('Not found', {status:404});
      const rows = await (await env.REPORTS.get(env.REPORTS.idFromName('log')).fetch(new Request(new URL('/list', url)))).json();
      return new Response(reportsPage(rows), {headers:{'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-store'}});
    }

    const nm = url.pathname.match(NAMES);
    if (nm) return env.ROOMS.get(env.ROOMS.idFromName(nm[1].toLowerCase())).fetch(new Request(new URL('/names', url)));

    const ws = url.pathname.match(WS);
    if (ws){
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', {status:426});
      const room = ws[1].toLowerCase();
      return env.ROOMS.get(env.ROOMS.idFromName(room)).fetch(req);
    }

    const page = url.pathname.match(PAGE);
    if (page && !RESERVED.has(page[1].toLowerCase())){
      const room = page[1].toLowerCase();
      /* one spelling per room: rna.game/Period3/ and rna.game/r/period3 both go to rna.game/period3 */
      if (url.pathname !== '/' + room){ url.pathname = '/' + room; return Response.redirect(url.toString(), 301); }
      const res = await env.ASSETS.fetch(new Request(new URL('/', url), req));
      return new Response(res.body, {status:res.status, headers:noStore(res.headers)});
    }

    return env.ASSETS.fetch(req);
  }
};

function noStore(h){ const out = new Headers(h); out.set('Cache-Control', 'no-cache'); return out; }
