import http from 'node:http';
import { diffSnapshots } from './diff.js';
import { sanitizeId } from './util.js';

const HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FOWS Dashboard</title><style>
:root{color-scheme:dark}*{box-sizing:border-box}body{font:15px system-ui,Segoe UI,sans-serif;margin:0;background:#0f1522;color:#e5eaf2}.wrap{max-width:980px;margin:30px auto;padding:0 18px}h1{font-size:26px;margin:0 0 3px}.muted{color:#96a6c1}.panel{border:1px solid #34435a;border-radius:13px;background:#1a2435;padding:19px;margin:15px 0}table{width:100%;border-collapse:collapse;word-break:break-word}th{text-align:left;color:#91a2bc}td,th{padding:10px;border-bottom:1px solid #34435a}button{background:#263e62;color:#fff;border:1px solid #42658b;border-radius:8px;padding:8px 11px;cursor:pointer}small{color:#b9c8da}code{color:#abd2ff}pre{white-space:pre-wrap;max-height:430px;overflow:auto}</style></head><body><main class="wrap"><h1>FOWS · Dashboard</h1><div class="muted">Read-only local workspace monitor</div><section class="panel"><h2>Inventories</h2><div id="inv">Loading...</div></section><section class="panel"><h2>Sessions</h2><div id="sessions">Loading...</div></section><section class="panel"><h2>Diff detail</h2><pre id="diff">Select a session above.</pre></section></main><script>
const j = async url => {const r=await fetch(url); if(!r.ok)throw Error(await r.text()); return r.json()};
const el = (tag,content) => {const n=document.createElement(tag);if(content!==undefined)n.textContent=String(content);return n};
const tbody=(rows, keys, parent)=>{parent.replaceChildren();if(!rows.length){parent.textContent='No data yet.';return;}const t=el('table'),h=el('tr');keys.forEach(([label])=>h.append(el('th',label)));t.append(h);rows.forEach(row=>{const tr=el('tr');keys.forEach(([,f])=>{const c=el('td');c.append(f(row));tr.append(c)});t.append(tr)});parent.append(t)};
const fmt = n=>new Intl.NumberFormat('en',{maximumFractionDigits:1}).format((n||0)/1048576)+' MiB';
async function load(){try{const inv=await j('/api/v1/inventories');tbody(inv,[['Root',r=>el('code',r.root)],['Files',r=>el('span',r.summary.files)],['Size',r=>el('span',fmt(r.summary.totalBytes))]],document.getElementById('inv'));const sessions=await j('/api/v1/sessions');tbody(sessions,[['Session',r=>el('code',r.id)],['Status',r=>el('span',r.status)],['Events',r=>el('span',r.eventCount||0)],['Action',r=>{const b=el('button','View diff');b.addEventListener('click',async()=>{try{const d=await j('/api/v1/sessions/'+encodeURIComponent(r.id)+'/diff');document.getElementById('diff').textContent=JSON.stringify(d,null,2)}catch(e){document.getElementById('diff').textContent=String(e)}});return b}]],document.getElementById('sessions'));}catch(e){document.getElementById('sessions').textContent=String(e)}}load();setInterval(load,5000);
</script></body></html>`;

function sendJson(res, code, value) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(value));
}

export function createFowsServer(store) {
  return http.createServer(async (req, res) => {
    try {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Read-only server. Method not allowed.' });
      const pathname = new URL(req.url, 'http://localhost').pathname;
      if (pathname === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'self'; script-src 'unsafe-inline' 'self'; style-src 'unsafe-inline' 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" }); res.end(HTML); return; }
      if (pathname === '/api/v1/health') return sendJson(res, 200, { ok: true, mode: 'read-only', version: '0.2.0-node' });
      if (pathname === '/api/v1/inventories') return sendJson(res, 200, await store.listInventories());
      if (pathname === '/api/v1/sessions') return sendJson(res, 200, await store.listSessions());
      const match = /^\/api\/v1\/sessions\/([\w-]+)\/(diff|events)$/.exec(pathname);
      if (match) {
        const id = sanitizeId(match[1]);
        if (match[2] === 'events') return sendJson(res, 200, await store.readEvents(id));
        const [base, current] = await Promise.all([store.loadSnapshot(id, 'baseline'), store.loadSnapshot(id, 'latest')]);
        return sendJson(res, 200, { session: id, ...diffSnapshots(base, current) });
      }
      sendJson(res, 404, { error: 'Not found' });
    } catch (error) { sendJson(res, ['ENOENT', 'ENOTDIR'].includes(error.code) ? 404 : 500, { error: error.message }); }
  });
}
