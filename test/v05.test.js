import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { workspacePreview, workspaceCreate, planSort, sortCommit, undoOperation, listOperations, readOperation } from '../lib/operations.js';

async function sandbox(fn) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'fows-v05-'));
  const root=path.join(base,'target'); const dataDir=path.join(base,'internal-data');
  await fs.mkdir(root);
  try { await fn({base,root,dataDir}); } finally {await fs.rm(base,{recursive:true,force:true});}
}
const exists=async file=>fs.lstat(file).then(()=>true,e=>{if(e.code==='ENOENT')return false; throw e;});

test('workspace preview never writes, create works, undo removes only empty directories', async()=>sandbox(async ({root,dataDir})=>{
  const preview=await workspacePreview({root,name:'Classroom',template:'school'});
  assert.equal(preview.dryRun,true); assert.equal(await exists(preview.target),false);
  const created=await workspaceCreate({root,name:'Classroom',template:'school',dataDir,confirmed:true});
  assert.equal(created.status,'completed');
  const own=path.join(root,'Classroom','Reports','teacher.txt');
  await fs.writeFile(own,'keep my data');
  const undo=await undoOperation({dataDir,id:created.id,confirmed:true});
  assert.equal(undo.status,'undo-partial'); assert.equal(await fs.readFile(own,'utf8'),'keep my data');
  await fs.unlink(own);
  const again=await undoOperation({dataDir,id:created.id,confirmed:true});
  assert.equal(again.status,'undone'); assert.equal(await exists(preview.target),false);
}));

test('sort plan does not change filesystem; commit makes verified copies and undo removes only owned copy',async()=>sandbox(async({root,dataDir})=>{
  await fs.writeFile(path.join(root,'notes.txt'),'abc\n'); await fs.writeFile(path.join(root,'book.pdf'),'fakepdf');
  await fs.mkdir(path.join(root,'src')); await fs.writeFile(path.join(root,'src','index.js'),'nested untouched');
  const plan=await planSort({root,dataDir,target:'Sorted'});
  assert.equal(plan.files,2); assert.equal(await exists(path.join(root,'Sorted')),false);
  await assert.rejects(()=>sortCommit({dataDir,planId:plan.id}),/requires --yes/);
  const output=await sortCommit({dataDir,planId:plan.id,confirmed:true});
  assert.equal(output.files,2);
  assert.equal(await fs.readFile(path.join(root,'Sorted','Documents','notes.txt'),'utf8'),'abc\n');
  assert.equal(await fs.readFile(path.join(root,'notes.txt'),'utf8'),'abc\n');
  assert.equal(await exists(path.join(root,'Sorted','Code','index.js')),false);
  await fs.writeFile(path.join(root,'Sorted','Documents','notes.txt'),'someone changed this');
  const undone=await undoOperation({dataDir,id:plan.id,confirmed:true});
  assert.equal(undone.status,'undo-partial');
  assert.equal(await fs.readFile(path.join(root,'Sorted','Documents','notes.txt'),'utf8'),'someone changed this');
  assert.equal(await exists(path.join(root,'Sorted','Documents','book.pdf')),false);
  assert.equal(await fs.readFile(path.join(root,'book.pdf'),'utf8'),'fakepdf');
  assert.equal((await listOperations(dataDir)).length,1);
}));

test('stale source changes block sort commit before target folder is created',async()=>sandbox(async({root,dataDir})=>{
  const src=path.join(root,'data.csv'); await fs.writeFile(src,'one');
  const plan=await planSort({root,dataDir}); await fs.writeFile(src,'changed');
  await assert.rejects(()=>sortCommit({dataDir,planId:plan.id,confirmed:true}),/changed after plan/);
  assert.equal(await exists(path.join(root,'FOWS-Sorted')),false);
  assert.equal((await readOperation(dataDir,plan.id)).status,'planned');
}));

test('sort refuses existing output and nested symlink workspace',async()=>sandbox(async({base,root,dataDir})=>{
  await fs.writeFile(path.join(root,'A.pdf'),'a');
  await fs.mkdir(path.join(root,'FOWS-Sorted'));
  await assert.rejects(()=>planSort({root,dataDir}),/already exists/);
  if(process.platform !== 'win32') {
    const proxy=path.join(base,'link'); await fs.symlink(root,proxy,'dir');
    await assert.rejects(()=>workspacePreview({root:proxy,name:'ABC'}),/symlink/);
  }
}));

test('workspace name traversal and sort destination path traversal blocked',async()=>sandbox(async({root,dataDir})=>{
  await assert.rejects(()=>workspacePreview({root,name:'../oops'}),/safe single/);
  await fs.writeFile(path.join(root,'a.txt'),'a');
  await assert.rejects(()=>planSort({root,target:'../oops',dataDir}),/safe single/);
}));
