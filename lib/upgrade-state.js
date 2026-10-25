import path from 'node:path';
import crypto from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const appRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const digest = async file => new Promise((resolve, reject) => {
  const h = crypto.createHash('sha256');
  const s = createReadStream(file);
  s.on('data', part => h.update(part));
  s.on('error', reject);
  s.on('end', () => resolve(h.digest('hex')));
});

export async function checkInstallation(root = appRoot) {
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const stateFile = path.join(root, '.fows', 'install-state.json');
  let state;
  try { state = JSON.parse(await fs.readFile(stateFile, 'utf8')); }
  catch (err) {
    if (err.code === 'ENOENT') return {
      version: pkg.version, status: 'legacy-untracked', managedCount: 0, drift: [], lastUpgrade: null
    };
    throw new Error(`Invalid installation state: ${err.message}`);
  }
  const drift = [];
  for (const [rel, expected] of Object.entries(state.managedFiles || {})) {
    const file = path.join(root, ...rel.split('/'));
    try {
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || (await digest(file)) !== expected) drift.push(rel);
    } catch { drift.push(rel); }
  }
  const versionMismatch = state.appVersion !== pkg.version;
  return {
    version: pkg.version,
    stateVersion: state.appVersion,
    status: versionMismatch ? 'version-mismatch' : drift.length ? 'drift' : 'clean',
    managedCount: Object.keys(state.managedFiles || {}).length,
    drift,
    lastUpgrade: state.lastUpgrade || null,
    historyCount: (state.history || []).length,
    ...(versionMismatch ? { warning: 'package.json does not match install-state.json' } : {})
  };
}
