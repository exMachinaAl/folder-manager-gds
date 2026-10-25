import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { Store } from '../lib/store.js';
import { buildSessionReport, eventsToCsv, reportAsText } from '../lib/report.js';
import { createFowsServer } from '../lib/server.js';

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(),'fows-v03-'));
  t.after(() => fs.rm(directory,{recursive:true,force:true}));
  const store = new Store(path.join(directory,'data'));
  const id = 'FOWS-TESTV03';
  const baseline = {
    root: directory, scannedAt:'2026-10-25T12:00:00.000Z',
    summary:{files:1,directories:0,totalBytes:12},
    entries:[{path:'keep.txt',type:'file',size:12,mtimeMs:1000}]
  };
  const latest = {
    root: directory, scannedAt:'2026-10-25T12:00:02.000Z',
    summary:{files:2,directories:0,totalBytes:42},
    entries:[baseline.entries[0],{path:'=calc.csv',type:'file',size:30,mtimeMs:2000}]
  };
  await store.beginSession(id,{id,root:directory,startedAt:'2026-10-25T12:00:00Z',status:'running',polls:1},baseline);
  await store.saveLatest(id,latest);
  await store.appendEvents(id,[{at:'2026-10-25T12:00:02Z',type:'CREATE',path:'=calc.csv',entryType:'file',beforeSize:0,afterSize:30,deltaBytes:30}]);
  await store.updateSession(id,{status:'stopped',stoppedAt:'2026-10-25T12:00:03Z',eventCount:1});
  return {store,id};
}

test('report correlates snapshots and event activity', async t => {
  const {store,id} = await fixture(t);
  const r=await buildSessionReport(store,id);
  assert.equal(r.diff.netBytes,30);
  assert.equal(r.diff.counts.CREATE,1);
  assert.equal(r.activity.recordedEvents,1);
  assert.equal(r.activity.observedBytes,30);
  assert.equal(r.session.durationSeconds,3);
  assert.equal(r.timeline['1s'].length,1);
  assert.match(reportAsText(r,n=>`${n} B`),/net 30 B/);
});

test('CSV escapes formula names and preserves negative numeric values', async t => {
  const {store,id}=await fixture(t);
  const csv=eventsToCsv(await buildSessionReport(store,id));
  assert.match(csv, /"'=calc\.csv"/);
  assert.match(csv,/"30"/);
});

test('HTTP report JSON and CSV accessible read-only', async t => {
  const {store,id}=await fixture(t);
  const srv=createFowsServer(store);
  await new Promise(resolve=>srv.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>srv.close(resolve)));
  const url=`http://127.0.0.1:${srv.address().port}/api/v1/sessions/${id}`;
  const res=await fetch(url+'/report');
  assert.equal(res.status,200);
  assert.equal((await res.json()).diff.changedPaths,1);
  const csv=await fetch(url+'/report.csv');
  assert.equal(csv.status,200);
  assert.match(csv.headers.get('content-type'),/text\/csv/);
  assert.match(await csv.text(),/calc.csv/);
  const denied=await fetch(url+'/report',{method:'POST'});
  assert.equal(denied.status,405);
});
