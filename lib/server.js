import http from 'node:http';
import { diffSnapshots, summarizeEvents } from './diff.js';
import { buildSessionReport, eventsToCsv } from './report.js';
import { compareSessions } from './compare.js';
import { buildSortPreview } from './sort-preview.js';
import { sanitizeId } from './util.js';

const HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FOWS · Dashboard</title><style>
:root{color-scheme:dark}*{box-sizing:border-box}body{font:14px system-ui,Segoe UI,sans-serif;margin:0;background:#0b1120;color:#e5edf9}.wrap{max-width:1200px;margin:28px auto;padding:0 18px}h1{font-size:27px;margin:0}h2{font-size:17px;margin:0 0 16px}.muted{color:#98aac7}.panel{border:1px solid #2d405b;border-radius:14px;background:#151f31;padding:19px;margin:17px 0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px}.metric{padding:15px;background:#202c42;border-radius:11px}.metric strong{display:block;font-size:26px;margin:8px 0}table{width:100%;border-collapse:collapse;word-break:break-word}th{text-align:left;color:#9aafce}td,th{padding:10px;border-bottom:1px solid #304159}button,select{background:#28466a;color:#fff;border:1px solid #486e9e;border-radius:8px;padding:9px 12px;cursor:pointer;max-width:100%}button:focus-visible,select:focus-visible{outline:2px solid #bbddff}select{width:100%}label{display:block;color:#acbdda;margin-bottom:6px}pre{white-space:pre-wrap;word-break:break-word;max-height:420px;overflow:auto}code{color:#b4d9ff}.bar{height:10px;margin:7px 0;background:#1b3450;border-radius:8px;overflow:hidden}.bar>span{display:block;height:100%;background:#66b5f4}.badge{padding:4px 9px;border-radius:100px;background:#244563}small{color:#b7c9df}.row{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.status{color:#80d6a9}.events{max-height:300px;overflow:auto}.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:13px}
</style></head><body><main class="wrap"><div class="row"><div><h1>FOWS · Live Monitor</h1><div class="muted">v0.4.0-node · Read-only dashboard · Automatic refresh every 3 seconds</div></div><div class="badge" id="indicator">Loading…</div></div><div class="grid" style="margin-top:18px"><div class="metric"><small>Tracked inventories</small><strong id="inventoryCount">-</strong></div><div class="metric"><small>Sessions</small><strong id="sessionCount">-</strong></div><div class="metric"><small>Recorded events (selected)</small><strong id="eventCount">-</strong></div><div class="metric"><small>Net size diff (selected)</small><strong id="netSize">-</strong></div></div><section class="panel"><h2>Session activity</h2><div class="grid2"><div><label for="session">Select session</label><select id="session"></select></div><div><label for="left">Compare left session</label><select id="left"></select></div><div><label for="right">Compare right session</label><select id="right"></select></div></div><div class="row" style="margin-top:13px"><small id="sessionStatus">Choose a session.</small><button id="compare">Compare sessions</button></div><div id="chart"></div><h2>Recent observed events</h2><div id="events" class="events"></div></section><div class="grid2"><section class="panel"><h2>Session snapshot diff</h2><pre id="diff">Select a session</pre></section><section class="panel"><h2>Two-session comparison</h2><pre id="comparison">Compare sessions sharing the same root.</pre></section></div><section class="panel"><h2>Inventories & sort preview (no writes)</h2><div id="inventories"></div><pre id="sortResult">Choose an inventory to preview suggestions.</pre></section><small>Snapshot and journal statistics are approximate. This page does not scan file contents, modify files, or offer cleanup.</small></main><script>
'use strict';
const $=id=>document.getElementById(id);
const api=async url=>{const r=await fetch(url,{cache:'no-store'});let body=await r.json();if(!r.ok)throw Error(body.error||'HTTP '+r.status);return body};
const node=(tag,value)=>{const e=document.createElement(tag);if(value!==undefined)e.textContent=String(value);return e};
const bytes=n=>new Intl.NumberFormat('en',{maximumFractionDigits:2}).format((n||0)/1048576)+' MiB';
const compact=(obj,max=5500)=>{const j=JSON.stringify(obj,null,2);return j.length>max?j.slice(0,max)+'…':j};
let sessions=[],inventories=[],busy=false;
function fillSelect(id,rows,makeLabel){const s=$(id),prev=s.value;s.replaceChildren();rows.forEach(r=>{const o=node('option',makeLabel(r));o.value=r.id;s.append(o)});if(rows.some(r=>r.id===prev))s.value=prev}
function listTable(rows,head,render){const t=node('table'),h=node('tr');head.forEach(x=>h.append(node('th',x)));t.append(h);rows.forEach(r=>{const tr=node('tr');render(r).forEach(c=>{const td=node('td');td.append(c);tr.append(td)});t.append(tr)});return t}
async function loadBase(){sessions=await api('/api/v1/sessions');inventories=await api('/api/v1/inventories');$('inventoryCount').textContent=inventories.length;$('sessionCount').textContent=sessions.length;
 for(const id of ['session','left','right'])fillSelect(id,sessions,r=>r.id+' · '+r.status);
 if(sessions.length>1 && !$('right').dataset.initialized){$('right').value=sessions[1].id;$('right').dataset.initialized='1'}
 const host=$('inventories');host.replaceChildren();if(!inventories.length)host.textContent='No saved inventory. Run fows scan --root PATH';
 else host.append(listTable(inventories,['Root','Files','Size','Preview'],r=>[node('code',r.root),node('span',r.summary.files),node('span',bytes(r.summary.totalBytes)),(()=>{const b=node('button','Preview sort');b.onclick=async()=>{try{$('sortResult').textContent=compact(await api('/api/v1/sort/preview?root='+encodeURIComponent(r.root)));}catch(e){$('sortResult').textContent=e.message}};return b})()]));
}
async function refreshSession(){const id=$('session').value;if(!id)return;const base='/api/v1/sessions/'+encodeURIComponent(id);const [live,diff]=await Promise.all([api(base+'/activity?limit=50'),api(base+'/diff')]);$('sessionStatus').textContent='Status: '+live.status+' · '+live.root+' · last snapshot '+(live.scannedAt||'-');$('eventCount').textContent=live.recordedEvents;$('netSize').textContent=bytes(diff.netBytes);$('diff').textContent=compact({counts:diff.counts,netBytes:diff.netBytes,events:diff.events.slice(0,30)});
 const eventHost=$('events');eventHost.replaceChildren();const ev=live.recentEvents.slice().reverse();if(!ev.length)eventHost.textContent='No events recorded yet';else eventHost.append(listTable(ev,['Time','Event','Path','Net change'],r=>[node('span',r.at||'-'),node('span',r.type),node('code',r.path),node('span',bytes(r.deltaBytes))]));
 const chart=$('chart');chart.replaceChildren();chart.append(node('small','Events per minute — latest recorded buckets'));const max=Math.max(1,...live.timeline.map(x=>x.count));live.timeline.slice(-12).forEach(b=>{const row=node('div');row.append(node('small',b.start+'  '+b.count+' events'));const track=node('div');track.className='bar';const value=node('span');value.style.width=(b.count/max*100)+'%';track.append(value);row.append(track);chart.append(row)});
}
$('compare').onclick=async()=>{try{const left=$('left').value,right=$('right').value;if(!left||!right)throw Error('Choose two sessions');const result=await api('/api/v1/compare?left='+encodeURIComponent(left)+'&right='+encodeURIComponent(right));$('comparison').textContent=compact(result);}catch(e){$('comparison').textContent=e.message}};
async function refresh(){if(busy)return;busy=true;try{await loadBase();await refreshSession();$('indicator').textContent='Connected · '+new Date().toLocaleTimeString();$('indicator').className='badge status';}catch(e){$('indicator').textContent='Error';$('indicator').className='badge';$('sessionStatus').textContent=e.message;}finally{busy=false}}
$('session').addEventListener('change',refreshSession);refresh();setInterval(refresh,3000);
</script></body></html>`;

function sendJson(res, code, value) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(value));
}
const boundedInt=(value, defaultValue, max)=>{if(value===null)return defaultValue;const n=Number(value);if(!Number.isSafeInteger(n)||n<1||n>max){const e=new Error('Invalid limit (1..'+max+')');e.code='INVALID_INPUT';throw e}return n};

export function createFowsServer(store) {
  return http.createServer(async (req, res) => {
    try {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Read-only server. Method not allowed.' });
      const url=new URL(req.url,'http://localhost');
      const pathname=url.pathname;
      if (pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'", 'x-content-type-options':'nosniff', 'referrer-policy':'no-referrer' });
        res.end(HTML); return;
      }
      if (pathname === '/api/v1/health') return sendJson(res,200,{ok:true,mode:'read-only',version:'0.4.0-node'});
      if (pathname === '/api/v1/inventories') return sendJson(res,200,await store.listInventories());
      if (pathname === '/api/v1/sessions') return sendJson(res,200,await store.listSessions());
      if (pathname === '/api/v1/sort/preview') {
        const root=url.searchParams.get('root');if(!root){const e=new Error('Missing root');e.code='INVALID_INPUT';throw e}
        const inventory=await store.loadInventory(root);
        return sendJson(res,200,buildSortPreview(inventory,{limit:boundedInt(url.searchParams.get('limit'),100,1000)}));
      }
      if (pathname === '/api/v1/compare') {
        const left=url.searchParams.get('left'),right=url.searchParams.get('right');
        if(!left||!right){const e=new Error('Missing left/right session');e.code='INVALID_INPUT';throw e}
        return sendJson(res,200,await compareSessions(store,left,right,{limit:boundedInt(url.searchParams.get('limit'),100,1000)}));
      }
      const match=/^\/api\/v1\/sessions\/([\w-]+)\/(diff|events|report|report\.csv|activity)$/.exec(pathname);
      if(match){
        const id=sanitizeId(match[1]);
        if(match[2]==='events')return sendJson(res,200,await store.readEvents(id));
        if(match[2]==='report')return sendJson(res,200,await buildSessionReport(store,id));
        if(match[2]==='report.csv'){
          const csv=eventsToCsv(await buildSessionReport(store,id,{top:1000}));
          res.writeHead(200,{'content-type':'text/csv; charset=utf-8','content-disposition':`attachment; filename="${id}-diff.csv"`,'cache-control':'no-store','x-content-type-options':'nosniff'});res.end(csv);return;
        }
        if(match[2]==='activity'){
          const limit=boundedInt(url.searchParams.get('limit'),50,1000);
          const [session,latest,events]=await Promise.all([store.loadSession(id),store.loadSnapshot(id,'latest'),store.readEvents(id)]);
          return sendJson(res,200,{id,root:session.root,status:session.status,scannedAt:latest.scannedAt,recordedEvents:events.length,recentEvents:events.slice(-limit),timeline:summarizeEvents(events,60).slice(-12),note:'Events are observed, not physical disk read/write totals.'});
        }
        const [base,current]=await Promise.all([store.loadSnapshot(id,'baseline'),store.loadSnapshot(id,'latest')]);
        return sendJson(res,200,{session:id,...diffSnapshots(base,current)});
      }
      sendJson(res,404,{error:'Not found'});
    }catch(error){const code=['ENOENT','ENOTDIR'].includes(error.code)?404:['INVALID_INPUT','ROOT_MISMATCH'].includes(error.code)||/Invalid session/.test(error.message)?400:500;sendJson(res,code,{error:error.message});}
  });
}
