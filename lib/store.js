import path from 'node:path';
import { promises as fs } from 'node:fs';
import { shaPath, writeJsonAtomic, readJson, sanitizeId } from './util.js';

export class Store {
  constructor(dataDir) { this.dataDir = dataDir; }
  inventoryPath(root) { return path.join(this.dataDir, 'inventories', shaPath(path.resolve(root)), 'latest.json'); }
  sessionDir(id) { return path.join(this.dataDir, 'sessions', sanitizeId(id)); }
  async saveInventory(snapshot) { await writeJsonAtomic(this.inventoryPath(snapshot.root), snapshot); return this.inventoryPath(snapshot.root); }
  async loadInventory(root) { return readJson(this.inventoryPath(root)); }
  async beginSession(id, meta, baseline) {
    const folder = this.sessionDir(id);
    await fs.mkdir(path.dirname(folder), { recursive: true });
    await fs.mkdir(folder, { recursive: false });
    await writeJsonAtomic(path.join(folder, 'meta.json'), meta);
    await writeJsonAtomic(path.join(folder, 'baseline.json'), baseline);
    await writeJsonAtomic(path.join(folder, 'latest.json'), baseline);
    return folder;
  }
  async saveLatest(id, snapshot) { await writeJsonAtomic(path.join(this.sessionDir(id), 'latest.json'), snapshot); }
  async loadSession(id) { return readJson(path.join(this.sessionDir(id), 'meta.json')); }
  async loadSnapshot(id, which) { if (!['baseline', 'latest'].includes(which)) throw new Error('Invalid snapshot name'); return readJson(path.join(this.sessionDir(id), `${which}.json`)); }
  async updateSession(id, patch) { const previous = await this.loadSession(id); await writeJsonAtomic(path.join(this.sessionDir(id), 'meta.json'), { ...previous, ...patch }); }
  async appendEvents(id, events) {
    if (!events.length) return;
    const body = events.map(e => JSON.stringify(e)).join('\n') + '\n';
    await fs.appendFile(path.join(this.sessionDir(id), 'events.jsonl'), body, 'utf8');
  }
  async readEvents(id) {
    let data;
    try { data = await fs.readFile(path.join(this.sessionDir(id), 'events.jsonl'), 'utf8'); }
    catch (err) { if (err.code === 'ENOENT') return []; throw err; }
    const entries = [];
    for (const line of data.split('\n')) if (line.trim()) { try { entries.push(JSON.parse(line)); } catch { /* tolerate incomplete final journal record */ } }
    return entries;
  }
  async listSessions() {
    let dirs;
    try { dirs = await fs.readdir(path.join(this.dataDir, 'sessions'), { withFileTypes: true }); }
    catch (err) { if (err.code === 'ENOENT') return []; throw err; }
    const found = [];
    for (const entry of dirs.filter(e => e.isDirectory())) {
      try { found.push(await this.loadSession(entry.name)); } catch { /* skip invalid session directory */ }
    }
    return found.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }
  async listInventories() {
    let dirs;
    try { dirs = await fs.readdir(path.join(this.dataDir, 'inventories'), { withFileTypes: true }); }
    catch (err) { if (err.code === 'ENOENT') return []; throw err; }
    const found = [];
    for (const entry of dirs.filter(e => e.isDirectory())) {
      try {
        const snapshot = await readJson(path.join(this.dataDir, 'inventories', entry.name, 'latest.json'));
        found.push({ id: entry.name, root: snapshot.root, scannedAt: snapshot.scannedAt, summary: snapshot.summary });
      } catch { /* ignore corrupt inventory */ }
    }
    return found.sort((a, b) => b.scannedAt.localeCompare(a.scannedAt));
  }
}
