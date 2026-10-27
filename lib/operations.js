import path from 'node:path';
import crypto from 'node:crypto';
import { promises as fs, constants, createReadStream } from 'node:fs';
import { scanTree } from './scan.js';
import { buildSortPreview } from './sort-preview.js';
import { writeJsonAtomic, sanitizeId, isInsideOrEqual } from './util.js';

const TEMPLATES = Object.freeze({
  developer: ['Projects', 'Projects/NodeJS', 'Projects/Python', 'Projects/Laravel', 'Documents', 'Exports', 'Temporary'],
  school: ['Administration', 'Curriculum', 'Learning', 'Learning/Materials', 'Learning/Assignments', 'Reports', 'Exports'],
  general: ['Projects', 'Documents', 'Media', 'Archives', 'Temporary', 'Exports']
});
const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const RESERVED_WINDOWS = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
const OP_LIMIT = 1000;
const BYTE_LIMIT = 2 * 1024 ** 3; // fixed conservative MVP ceiling per sort job
const now = () => new Date().toISOString();
const operationId = () => `OP-${Date.now()}-${crypto.randomBytes(5).toString('hex')}`;
const opsDir = dataDir => path.join(dataDir, 'operations');
const opPath = (dataDir, id) => path.join(opsDir(dataDir), `${sanitizeId(id)}.json`);
const writeOperation = async (dataDir, op) => writeJsonAtomic(opPath(dataDir, op.id), op);
export const readOperation = async (dataDir, id) => JSON.parse(await fs.readFile(opPath(dataDir, id), 'utf8'));
const getStat = async p => { try { return await fs.lstat(p); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
const shaFile = file => new Promise((resolve, reject) => {
  const h = crypto.createHash('sha256'); const stream = createReadStream(file);
  stream.on('data', b => h.update(b)); stream.on('error', reject);
  stream.on('end', () => resolve(h.digest('hex')));
});
const ensureName = value => { if (!NAME.test(value || '') || RESERVED_WINDOWS.test(value || '') || ['.', '..'].includes(value)) throw new Error('Name/target must be a safe single directory name (letters, digits, underscore, dash)'); return value; };
const ensureInside = (root, target) => {
  if (!isInsideOrEqual(root, target) || root === target) throw new Error('Refusing path outside target root');
};
async function assertSafeDirectory(input, { mustExist = true } = {}) {
  const absolute = path.resolve(input);
  // Walk through all existing path components: reject junctions, symlinks, files, and special nodes.
  const chain = [];
  let cursor = absolute;
  for (;;) { chain.unshift(cursor); const parent = path.dirname(cursor); if (parent === cursor) break; cursor = parent; }
  for (const item of chain) {
    const stat = await getStat(item);
    if (!stat) { if (mustExist) throw new Error(`Missing directory: ${item}`); return absolute; }
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Unsafe directory or symlink in path: ${item}`);
  }
  return absolute;
}
async function safeFile(root, relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || path.posix.isAbsolute(relative) || relative.split('/').some(s => !s || s === '.' || s === '..')) throw new Error('Unsafe relative filename');
  const dst = path.join(root, ...relative.split('/')); ensureInside(root, dst);
  await assertSafeDirectory(path.dirname(dst), { mustExist:true });
  const stat = await getStat(dst);
  if (!stat || !stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error(`Source file missing, linked, or changed: ${relative}`);
  return { dst, stat };
}
async function ensureUnused(root, name) {
  const target = path.join(root, ensureName(name)); ensureInside(root, target);
  if (await getStat(target)) throw new Error(`Destination already exists; choose a fresh name: ${target}`);
  return target;
}
export function availableTemplates() { return Object.fromEntries(Object.entries(TEMPLATES).map(([k,v]) => [k,[...v]])); }
export async function workspacePreview({root, name, template = 'developer'}) {
  if (!TEMPLATES[template]) throw new Error(`Unknown template: ${template}. Available: ${Object.keys(TEMPLATES).join(', ')}`);
  const base = await assertSafeDirectory(root);
  const target = await ensureUnused(base, name);
  return { root:base, target, name, template, directories: [name, ...TEMPLATES[template].map(p => `${name}/${p}`)], dryRun:true };
}
export async function workspaceCreate({root, name, template = 'developer', dataDir, confirmed = false}) {
  if (!confirmed) return workspacePreview({root,name,template});
  const preview = await workspacePreview({root,name,template});
  const op = { id:operationId(), kind:'workspace', status:'running', createdAt:now(), root:preview.root, target:preview.target, template, expected:preview.directories, created:[] };
  await writeOperation(dataDir, op);
  try {
    for (const rel of preview.directories) {
      const dest = path.join(preview.root, ...rel.split('/')); ensureInside(preview.root,dest);
      await assertSafeDirectory(path.dirname(dest));
      op.active=rel; await writeOperation(dataDir,op);
      await fs.mkdir(dest, {recursive:false});
      op.created.push(rel); op.active=null; await writeOperation(dataDir,op);
    }
    op.status = 'completed'; op.finishedAt=now(); await writeOperation(dataDir,op);
    return op;
  } catch (error) {
    op.status='failed'; op.error=error.message; await writeOperation(dataDir,op); throw new Error(`Workspace creation interrupted: ${error.message}. Review operation ${op.id} and run undo if needed.`);
  }
}
export async function planSort({root, target = 'FOWS-Sorted', dataDir}) {
  const base = await assertSafeDirectory(root);
  await ensureUnused(base,target);
  const inventory = await scanTree(base,{dataDir});
  if (inventory.errors.length) throw new Error(`Incomplete scan (${inventory.errors.length} inaccessible locations); sorting plan refused`);
  const preview = buildSortPreview(inventory,{target,limit:OP_LIMIT});
  if (preview.collisions || preview.totalCandidates > OP_LIMIT) throw new Error('Sort plan has collisions or exceeds 1000 top-level files');
  const files = [];
  let bytes = 0;
  for (const p of preview.proposals) {
    const {dst,stat} = await safeFile(base,p.source);
    bytes += stat.size;
    if (bytes > BYTE_LIMIT) throw new Error('Sort plan exceeds 2 GiB cap; partition this job');
    files.push({source:p.source, dest:p.proposal, size:stat.size, mtimeMs:Math.round(stat.mtimeMs), sha256:await shaFile(dst)});
  }
  if (!files.length) throw new Error('No eligible root-level files to sort');
  const op = {id:operationId(),kind:'sort-copy',status:'planned',createdAt:now(),root:base,target,files,created:[],bytes,plannedCount:files.length};
  await writeOperation(dataDir,op);
  return {id:op.id,status:op.status,root:base,target,files:files.length,bytes,samples:files.slice(0,15),note:'No files copied. Commit with: sort-commit --plan ID --yes'};
}
export async function sortCommit({dataDir, planId, confirmed = false}) {
  const op = await readOperation(dataDir,planId);
  if (op.kind !== 'sort-copy' || op.status !== 'planned') throw new Error('Sort operation is not a pending plan');
  if (!confirmed) throw new Error('Commit requires --yes (after reviewing plan)');
  const base = await assertSafeDirectory(op.root);
  const target = await ensureUnused(base, op.target);
  if (op.files.length > OP_LIMIT || op.bytes > BYTE_LIMIT) throw new Error('Plan exceeds safety cap');
  // Verify every source BEFORE making any changes, to avoid partially applied stale plans.
  for (const file of op.files) {
    const {dst,stat} = await safeFile(base,file.source);
    if (stat.size !== file.size || Math.round(stat.mtimeMs) !== file.mtimeMs || (await shaFile(dst)) !== file.sha256) throw new Error(`File changed after plan: ${file.source}. Generate a new plan.`);
  }
  op.status='running'; await writeOperation(dataDir,op);
  try {
    await fs.mkdir(target); op.createdTarget=true; await writeOperation(dataDir,op);
    for (const item of op.files) {
      const dest = path.join(base,...item.dest.split('/'));
      ensureInside(base,dest);
      await assertSafeDirectory(target);
      const categoryDir=path.dirname(dest);
      const categoryStat=await getStat(categoryDir);
      if (!categoryStat) await fs.mkdir(categoryDir);
      await assertSafeDirectory(categoryDir);
      if (await getStat(dest)) throw new Error(`Destination occupied: ${item.dest}`);
      const {dst:source,stat} = await safeFile(base,item.source);
      if (stat.size !== item.size || Math.round(stat.mtimeMs) !== item.mtimeMs || (await shaFile(source)) !== item.sha256) throw new Error(`File changed during copy: ${item.source}`);
      // Record intent before writing, so recovery can inspect a crash between copy and journal update.
      op.active = item.dest; await writeOperation(dataDir,op);
      await fs.copyFile(source,dest,constants.COPYFILE_EXCL);
      if ((await shaFile(dest)) !== item.sha256 || (await shaFile(source)) !== item.sha256) throw new Error(`Copied or source file mismatch: ${item.dest}`);
      op.created.push({dest:item.dest,sha256:item.sha256}); op.active=null; await writeOperation(dataDir,op);
    }
    op.status='completed'; op.finishedAt=now(); await writeOperation(dataDir,op);
    return {id:op.id,status:op.status,files:op.created.length,bytes:op.bytes,target};
  } catch (error) {
    op.status='failed'; op.error=error.message; await writeOperation(dataDir,op);
    throw new Error(`Sort copy stopped: ${error.message}. Sources untouched; use undo --id ${op.id} --yes to clean verified copies.`);
  }
}
export async function undoOperation({dataDir,id,confirmed=false}) {
  if (!confirmed) throw new Error('Undo requires --yes');
  const op = await readOperation(dataDir,id);
  if (!['workspace','sort-copy'].includes(op.kind)) throw new Error('Unknown operation type');
  if (!['completed','failed','running','undo-partial'].includes(op.status)) throw new Error(`Cannot undo operation status '${op.status}'`);
  const base = await assertSafeDirectory(op.root);
  const removed=[]; const skipped=[];
  if (op.kind === 'workspace') {
    const own = op.active && !op.created.includes(op.active) ? [...op.created,op.active] : [...op.created];
    for (const rel of own.reverse()) {
      const dest = path.join(base,...rel.split('/')); ensureInside(base,dest);
      if (!await getStat(dest)) continue;
      try { await assertSafeDirectory(dest); await fs.rmdir(dest); removed.push(rel); }
      catch (e) { skipped.push({path:rel,why:e.code || e.message}); }
    }
  } else {
    const pending = new Map(op.created.map(x => [x.dest,x.sha256]));
    if (op.active && !pending.has(op.active)) pending.set(op.active, op.files.find(x => x.dest === op.active)?.sha256);
    for (const [rel,sum] of pending) {
      const dest=path.join(base,...rel.split('/')); ensureInside(base,dest);
      const stat=await getStat(dest);
      if (!stat) continue;
      // Delete ONLY if the bytes are unchanged from the created copy.
      try {
        await assertSafeDirectory(path.dirname(dest));
        if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || !sum || (await shaFile(dest)) !== sum) { skipped.push({path:rel,why:'changed or unsafe'}); continue; }
        await fs.unlink(dest); removed.push(rel);
      } catch(e) { skipped.push({path:rel,why:e.code || e.message}); }
    }
    const target=path.join(base,op.target);
    if (await getStat(target)) {
      try { await assertSafeDirectory(target); const children=await fs.readdir(target); for (const name of children) {
        const p=path.join(target,name); const s=await getStat(p); if (s?.isDirectory() && !s.isSymbolicLink()) await fs.rmdir(p).catch(()=>{});
      } await fs.rmdir(target); removed.push(op.target); }
      catch(e) { skipped.push({path:op.target,why:e.code || e.message}); }
    }
  }
  op.status=skipped.length?'undo-partial':'undone'; op.undoAt=now(); op.undoRemoved=removed; op.undoSkipped=skipped;
  await writeOperation(dataDir,op);
  return {id,status:op.status,removed,skipped};
}
export async function listOperations(dataDir) {
  let names=[]; try { names=await fs.readdir(opsDir(dataDir)); } catch(e) { if(e.code==='ENOENT') return []; throw e; }
  const ops=[];
  for (const name of names.filter(n=>/^OP-[A-Za-z0-9-]+\.json$/.test(n))) {
    try {const op=await readOperation(dataDir,name.slice(0,-5)); ops.push({id:op.id,kind:op.kind,status:op.status,root:op.root,target:op.target,createdAt:op.createdAt});} catch { /* skip corrupt entries in list; direct lookup will fail */ }
  }
  return ops.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}
