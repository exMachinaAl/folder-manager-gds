import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { scanTree, groupTypes } from '../lib/scan.js';
import { shouldExclude } from '../lib/util.js';
import { diffSnapshots, summarizeEvents } from '../lib/diff.js';
import { Store } from '../lib/store.js';
import { runWatch } from '../lib/watch.js';
import { createFowsServer } from '../lib/server.js';

async function fixture(fn) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'fows-test-'));
  try { return await fn(folder); } finally { await fs.rm(folder, { recursive: true, force: true }); }
}

test('glob exclusions and nested directories', () => {
  assert.equal(shouldExclude('node_modules/pkg/index.js', ['**/node_modules/**']), true);
  assert.equal(shouldExclude('abc/node_modules/pkg/index.js', ['**/node_modules/**']), true);
  assert.equal(shouldExclude('notes.txt', ['**/*.txt']), true);
  assert.equal(shouldExclude('src/main.js', ['**/*.txt']), false);
});

test('scanner totals and skip symlink without traversing', async () => fixture(async root => {
  await fs.mkdir(path.join(root, 'src'));
  await fs.mkdir(path.join(root, 'node_modules', 'pkg'), { recursive: true });
  await fs.writeFile(path.join(root, 'src', 'main.js'), '12345');
  await fs.writeFile(path.join(root, 'node_modules', 'pkg', 'index.js'), 'ignored');
  const snapshot = await scanTree(root, { exclude: ['**/node_modules/**'] });
  assert.equal(snapshot.summary.files, 1);
  assert.equal(snapshot.summary.totalBytes, 5);
  assert.equal(snapshot.summary.errors, 0);
  assert.equal(groupTypes(snapshot)[0].extension, '.js');
  assert.ok(!snapshot.entries.some(e => e.path.includes('node_modules')));
}));

test('diff captures new, modified and deleted files', async () => fixture(async root => {
  await fs.writeFile(path.join(root, 'old.txt'), 'before');
  await fs.writeFile(path.join(root, 'edit.txt'), 'a');
  const base = await scanTree(root);
  await fs.rm(path.join(root, 'old.txt'));
  await fs.writeFile(path.join(root, 'edit.txt'), 'updated');
  await fs.writeFile(path.join(root, 'new.txt'), 'new');
  const current = await scanTree(root);
  const diff = diffSnapshots(base, current);
  assert.deepEqual(diff.counts, { CREATE: 1, MODIFY: 1, DELETE: 1 });
  assert.equal(diff.netBytes, 3);
}));

test('watch writes a session journal and persists final diff', async () => fixture(async folder => {
  const root = path.join(folder, 'workspace');
  const dataDir = path.join(folder, 'fows-meta');
  await fs.mkdir(root);
  const store = new Store(dataDir);
  const started = runWatch(store, { root, exclude: [], intervalMs: 250, seconds: 2 });
  await new Promise(resolve => setTimeout(resolve, 550));
  await fs.writeFile(path.join(root, 'hello.md'), '# hello');
  const result = await started;
  const [before, current, events, meta] = await Promise.all([
    store.loadSnapshot(result.id, 'baseline'), store.loadSnapshot(result.id, 'latest'), store.readEvents(result.id), store.loadSession(result.id)
  ]);
  assert.equal(meta.status, 'stopped');
  assert.ok(events.find(e => e.type === 'CREATE' && e.path === 'hello.md'));
  assert.ok(diffSnapshots(before, current).events.some(e => e.path === 'hello.md'));
  assert.ok(summarizeEvents(events, 1).length >= 1);
}));

test('read-only HTTP server exposes health and rejects mutations', async () => fixture(async folder => {
  const server = createFowsServer(new Store(path.join(folder, 'data')));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const health = await fetch(`http://127.0.0.1:${port}/api/v1/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).mode, 'read-only');
    const reject = await fetch(`http://127.0.0.1:${port}/api/v1/sessions`, { method: 'POST' });
    assert.equal(reject.status, 405);
    const html = await fetch(`http://127.0.0.1:${port}/`);
    assert.match(await html.text(), /FOWS · Dashboard/);
  } finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}));
