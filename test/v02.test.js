import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { Store } from '../lib/store.js';
import { runWatch } from '../lib/watch.js';
import { checkInstallation, digest } from '../lib/upgrade-state.js';

async function fixture(task) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fows-v02-'));
  try { return await task(dir); }
  finally { await fs.rm(dir, { recursive: true, force: true }); }
}

test('poll strategy records mode and remains compatible', async () => fixture(async dir => {
  const root = path.join(dir, 'root');
  await fs.mkdir(root);
  const store = new Store(path.join(dir, 'meta'));
  const start = runWatch(store, { root, intervalMs: 250, seconds: 1, strategy: 'poll' });
  await new Promise(resolve => setTimeout(resolve, 400));
  await fs.writeFile(path.join(root, 'a.txt'), 'hello');
  const result = await start;
  assert.equal(result.watcherMode, 'poll');
  assert.ok((await store.readEvents(result.id)).some(e => e.path === 'a.txt'));
}));

test('hybrid strategy reconciles final changes and closes watcher', async () => fixture(async dir => {
  const root = path.join(dir, 'root');
  await fs.mkdir(root);
  const store = new Store(path.join(dir, 'meta'));
  const start = runWatch(store, { root, intervalMs: 800, seconds: 2, strategy: 'hybrid', debounceMs: 100 });
  await new Promise(resolve => setTimeout(resolve, 350));
  await fs.writeFile(path.join(root, 'new.md'), 'new file');
  const result = await start;
  assert.ok(['hybrid', 'poll'].includes(result.watcherMode));
  assert.ok((await store.readEvents(result.id)).some(e => e.path === 'new.md'));
  assert.equal((await store.loadSession(result.id)).status, 'stopped');
}));

test('version checker flags drift without modifying file', async () => fixture(async dir => {
  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'fows', version: '0.2.0-node' }));
  await fs.writeFile(path.join(dir, 'safe.txt'), 'official');
  const expected = await digest(path.join(dir, 'safe.txt'));
  await fs.mkdir(path.join(dir, '.fows'));
  await fs.writeFile(path.join(dir, '.fows', 'install-state.json'), JSON.stringify({ appVersion: '0.2.0-node', managedFiles: { 'safe.txt': expected } }));
  assert.equal((await checkInstallation(dir)).status, 'clean');
  await fs.writeFile(path.join(dir, 'safe.txt'), 'custom');
  const observed = await checkInstallation(dir);
  assert.equal(observed.status, 'drift');
  assert.deepEqual(observed.drift, ['safe.txt']);
  assert.equal(await fs.readFile(path.join(dir, 'safe.txt'), 'utf8'), 'custom');
}));
