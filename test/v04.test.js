import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { Store } from '../lib/store.js';
import { scanTree } from '../lib/scan.js';
import { buildSortPreview } from '../lib/sort-preview.js';
import { compareSessions } from '../lib/compare.js';
import { createFowsServer } from '../lib/server.js';

async function fixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'fows-v04-'));t.after(async()=>fs.rm(dir,{recursive:true,force:true}));const root=path.join(dir,'workspace');await fs.mkdir(root);return {dir,root,store:new Store(path.join(dir,'data'))};}
async function makeSession(store,id,root,snapshot){await store.beginSession(id,{id,root,status:'stopped',startedAt:new Date().toISOString()},snapshot);}

test('sort preview read-only and skips nested project files',async t=>{const {root,store}=await fixture(t);await fs.mkdir(path.join(root,'src'));await fs.writeFile(path.join(root,'photo.jpg'),'image');await fs.writeFile(path.join(root,'src','code.js'),'code');const snapshot=await scanTree(root);await store.saveInventory(snapshot);const result=buildSortPreview(snapshot);assert.equal(result.totalCandidates,1);assert.equal(result.proposals[0].proposal,'FOWS-Sorted/Images/photo.jpg');assert.equal(result.filesystemModified,false);await assert.rejects(fs.access(path.join(root,'FOWS-Sorted')));});

test('sort preview detects destination collisions',async t=>{const {root}=await fixture(t);await fs.mkdir(path.join(root,'FOWS-Sorted','Images'),{recursive:true});await fs.writeFile(path.join(root,'photo.jpg'),'image');await fs.writeFile(path.join(root,'FOWS-Sorted','Images','photo.jpg'),'old');const result=buildSortPreview(await scanTree(root));assert.equal(result.collisions,1);assert.equal(result.proposals[0].status,'COLLISION');});

test('sort preview rejects traversal target',async t=>{const {root}=await fixture(t);const snap=await scanTree(root);assert.throws(()=>buildSortPreview(snap,{target:'../outside'}));});

test('compare sessions same root latest snapshots',async t=>{const {root,store}=await fixture(t);await fs.writeFile(path.join(root,'hello.txt'),'hello');const first=await scanTree(root);await makeSession(store,'FOWS-LEFT',root,first);await fs.writeFile(path.join(root,'new.txt'),'new');const second=await scanTree(root);await makeSession(store,'FOWS-RIGHT',root,second);const comp=await compareSessions(store,'FOWS-LEFT','FOWS-RIGHT');assert.equal(comp.comparison.counts.CREATE,1);assert.equal(comp.comparison.events[0].path,'new.txt');});

test('compare refuses different roots',async t=>{const {root,dir,store}=await fixture(t);const other=path.join(dir,'other');await fs.mkdir(other);await makeSession(store,'FOWS-LEFT',root,await scanTree(root));await makeSession(store,'FOWS-RIGHT',other,await scanTree(other));await assert.rejects(compareSessions(store,'FOWS-LEFT','FOWS-RIGHT'),/roots differ/i);});

test('HTTP live activity, compare, sort preview remain read-only',async t=>{const {root,store}=await fixture(t);await fs.writeFile(path.join(root,'a.pdf'),'ok');const snap=await scanTree(root);await store.saveInventory(snap);await makeSession(store,'FOWS-LEFT',root,snap);await makeSession(store,'FOWS-RIGHT',root,snap);await store.appendEvents('FOWS-RIGHT',[{at:new Date().toISOString(),type:'CREATE',path:'a.pdf',beforeSize:0,afterSize:2,deltaBytes:2}]);const server=createFowsServer(store);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());const base='http://127.0.0.1:'+server.address().port;let r=await fetch(base+'/api/v1/sessions/FOWS-RIGHT/activity');assert.equal(r.status,200);assert.equal((await r.json()).recordedEvents,1);r=await fetch(base+'/api/v1/compare?left=FOWS-LEFT&right=FOWS-RIGHT');assert.equal(r.status,200);assert.equal((await r.json()).comparison.totalChanges,0);r=await fetch(base+'/api/v1/sort/preview?root='+encodeURIComponent(root));assert.equal(r.status,200);assert.equal((await r.json()).totalCandidates,1);r=await fetch(base+'/api/v1/sort/preview?root='+encodeURIComponent(root),{method:'POST'});assert.equal(r.status,405);r=await fetch(base+'/');assert.match(await r.text(),/Live Monitor/);await assert.rejects(fs.access(path.join(root,'FOWS-Sorted')));});
