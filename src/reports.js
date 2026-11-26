/* Anonymous health reports from players' pages: JavaScript errors and slow frame rates, so a playtest shows what broke
   or struggled on the classroom's machines. One Durable Object keeps the most recent reports in its own storage.
   Nothing that identifies a player is sent or kept: no names, no codons, no room names, no IP addresses.
   Read them at /reports?key=<REPORT_KEY> (a secret set in the Cloudflare dashboard); without the secret set, reading is off. */
import {DurableObject} from 'cloudflare:workers';

const KEEP = 2000;               /* the most recent reports kept */
const PER_MINUTE = 120;          /* more than this in a minute are dropped (a broken page in a loop) */
const FIELDS = ['kind', 'v', 'mode', 'msg', 'where', 'fps', 'fpsLow', 'stepMs', 'drawMs', 'px', 'screen', 'dpr', 'cros', 'low', 'strands', 'secs'];

export class ReportLog extends DurableObject {
  constructor(ctx, env){
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS r (id INTEGER PRIMARY KEY AUTOINCREMENT, t INTEGER, body TEXT)');
    this.minute = 0; this.count = 0;
  }
  async fetch(req){
    const url = new URL(req.url);
    if (req.method === 'POST' && url.pathname === '/add'){
      const m = Math.floor(Date.now() / 60000);
      if (m !== this.minute){ this.minute = m; this.count = 0; }
      if (++this.count > PER_MINUTE) return new Response(null, {status:204});
      let r; try { r = await req.json(); } catch(e){ return new Response(null, {status:400}); }
      /* keep only the known fields, as short plain values */
      const clean = {};
      for (const k of FIELDS){ const v = r[k]; if (typeof v === 'number' && Number.isFinite(v)) clean[k] = Math.round(v * 100) / 100; else if (typeof v === 'string') clean[k] = v.slice(0, 300); else if (typeof v === 'boolean') clean[k] = v; }
      if (clean.kind !== 'error' && clean.kind !== 'slow') return new Response(null, {status:400});
      this.sql.exec('INSERT INTO r (t, body) VALUES (?, ?)', Date.now(), JSON.stringify(clean));
      this.sql.exec('DELETE FROM r WHERE id <= (SELECT MAX(id) FROM r) - ?', KEEP);
      return new Response(null, {status:204});
    }
    if (url.pathname === '/list'){
      const rows = this.sql.exec('SELECT t, body FROM r ORDER BY id DESC LIMIT ?', KEEP).toArray().map(x => Object.assign({t:x.t}, JSON.parse(x.body)));
      return Response.json(rows, {headers:{'Cache-Control':'no-store'}});
    }
    return new Response('Not found', {status:404});
  }
}

/* a readable page of the reports: counts first, then the newest */
export function reportsPage(rows){
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;'}[c]));
  const errors = rows.filter(r => r.kind === 'error'), slow = rows.filter(r => r.kind === 'slow');
  const byMsg = new Map(); for (const r of errors){ const k = r.msg + ' @ ' + r.where; byMsg.set(k, (byMsg.get(k) || 0) + 1); }
  const when = t => new Date(t).toLocaleString('en-US', {timeZone:'America/Chicago', month:'short', day:'numeric', hour:'numeric', minute:'2-digit'});
  const table = (head, body) => `<table><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr>${body.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table>`;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>rna.game health reports</title>
<style>body{font:14px/1.45 system-ui,sans-serif;margin:24px;color:#1d2136;background:#f6f7fb}h1{font-size:20px}h2{font-size:15px;margin-top:28px}
table{border-collapse:collapse;background:#fff;font-size:12.5px}td,th{border:1px solid #d2d6e2;padding:4px 8px;text-align:left;vertical-align:top}th{background:#eceef4}
p{color:#596079}</style></head><body>
<h1>rna.game health reports</h1>
<p>${rows.length} reports kept (the most recent ${KEEP}). ${errors.length} errors, ${slow.length} slow sessions. Times are US Central.</p>
<h2>Errors, most common first</h2>
${byMsg.size ? table(['Times', 'Error and where'], [...byMsg].sort((a, b) => b[1] - a[1]).map(([k, n]) => [n, k])) : '<p>None.</p>'}
<h2>Slow sessions (under 20 frames a second)</h2>
${slow.length ? table(['When', 'Avg fps', 'Worst fps', 'Step ms', 'Draw ms', 'Canvas px', 'Screen', 'Chromebook', 'Low detail', 'Strands', 'Mode', 'Version'],
  slow.map(r => [when(r.t), r.fps, r.fpsLow, r.stepMs, r.drawMs, r.px, r.screen, r.cros ? 'yes' : 'no', r.low ? 'on' : 'off', r.strands, r.mode, r.v])) : '<p>None.</p>'}
<h2>Every error, newest first</h2>
${errors.length ? table(['When', 'Error', 'Where', 'Mode', 'Chromebook', 'Screen', 'Seconds in', 'Version'],
  errors.slice(0, 300).map(r => [when(r.t), r.msg, r.where, r.mode, r.cros ? 'yes' : 'no', r.screen, r.secs, r.v])) : '<p>None.</p>'}
</body></html>`;
}
