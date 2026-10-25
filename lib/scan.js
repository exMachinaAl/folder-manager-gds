import path from 'node:path';
import { promises as fs } from 'node:fs';
import { normalizeRel, shouldExclude, isInsideOrEqual } from './util.js';

// A safe scan never follows symlinks, so circular links and paths outside selected roots are not traversed.
export async function scanTree(rootInput, { exclude = [], dataDir } = {}) {
  const root = path.resolve(rootInput);
  const rootStat = await fs.lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('Root must be an existing, non-symlink directory');
  const entries = [];
  const errors = [];
  let bytes = 0;
  let files = 0;
  let directories = 0;
  let symlinks = 0;
  let excluded = 0;
  const stack = [{ absolute: root, relative: '' }];
  // Avoid recording FOWS's own metadata when it is located under the watched tree.
  const resolvedData = dataDir && path.resolve(dataDir);

  while (stack.length) {
    const { absolute, relative } = stack.pop();
    let iterator;
    try { iterator = await fs.opendir(absolute); }
    catch (err) { errors.push({ path: relative || '.', error: err.code || err.message }); continue; }
    try {
      for await (const dirent of iterator) {
        const rel = normalizeRel(path.join(relative, dirent.name));
        const full = path.join(absolute, dirent.name);
        if (resolvedData && isInsideOrEqual(resolvedData, full)) { excluded++; continue; }
        try {
          const stat = await fs.lstat(full);
          if (shouldExclude(rel, exclude) || (stat.isDirectory() && shouldExclude(`${rel}/__fows_dir__`, exclude))) { excluded++; continue; }
          const type = stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? 'dir' : stat.isFile() ? 'file' : 'other';
          entries.push({ path: rel, type, size: type === 'file' ? stat.size : 0, mtimeMs: Math.round(stat.mtimeMs), ext: type === 'file' ? path.extname(dirent.name).toLowerCase() || '[no extension]' : '' });
          if (type === 'file') { files++; bytes += stat.size; }
          if (type === 'dir') { directories++; stack.push({ absolute: full, relative: rel }); }
          if (type === 'symlink') symlinks++;
        } catch (err) { errors.push({ path: rel, error: err.code || err.message }); }
      }
    } catch (err) { errors.push({ path: relative || '.', error: err.code || err.message }); }
  }
  entries.sort((a, b) => a.path.localeCompare(b.path));
  return { root, scannedAt: new Date().toISOString(), exclude, summary: { files, directories, symlinks, totalBytes: bytes, excluded, errors: errors.length }, entries, errors };
}

export function groupTypes(snapshot) {
  const types = new Map();
  for (const entry of snapshot.entries) {
    if (entry.type !== 'file') continue;
    const current = types.get(entry.ext) || { extension: entry.ext, files: 0, bytes: 0 };
    current.files++;
    current.bytes += entry.size;
    types.set(entry.ext, current);
  }
  return [...types.values()].sort((a, b) => b.bytes - a.bytes || a.extension.localeCompare(b.extension));
}
