import path from 'node:path';
import { normalizeRel } from './util.js';

// Read-only proposal based on the most recent inventory; NO file operations.
const CATEGORIES = Object.freeze({
  Documents: ['.pdf','.doc','.docx','.txt','.md','.odt','.rtf'],
  Spreadsheets: ['.xls','.xlsx','.csv','.ods'],
  Presentations: ['.ppt','.pptx','.odp'],
  Images: ['.jpg','.jpeg','.png','.gif','.webp','.svg','.bmp','.heic'],
  Video: ['.mp4','.mkv','.mov','.avi','.webm'],
  Audio: ['.mp3','.wav','.flac','.ogg','.m4a'],
  Archives: ['.zip','.7z','.tar','.gz','.rar'],
  Code: ['.js','.mjs','.cjs','.ts','.tsx','.jsx','.py','.rs','.php','.html','.css','.json','.yml','.yaml']
});
const extensionCategory = ext => Object.entries(CATEGORIES).find(([,extensions]) => extensions.includes(ext))?.[0] || 'Other';
const invalid = rel => rel.startsWith('/') || rel.includes('\\') || rel.split('/').some(p => !p || p === '.' || p === '..');

export function buildSortPreview(snapshot, { limit = 100, target = 'FOWS-Sorted' } = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error('limit must be 1..1000');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(target)) throw new Error('target must be one safe folder name');
  if (!snapshot || !Array.isArray(snapshot.entries)) throw new Error('Invalid inventory');
  const existing = new Set(snapshot.entries.map(e => process.platform === 'win32' ? e.path.toLowerCase() : e.path));
  const collisions = new Set();
  const groups = {};
  const rows = [];
  let skipped = 0, risky = 0;
  for (const entry of snapshot.entries) {
    // Only top-level files, never nested projects, symlinks, directories or unknown types.
    if (entry.type !== 'file' || entry.path.includes('/') || invalid(entry.path)) { skipped++; continue; }
    const category = extensionCategory(path.extname(entry.path).toLowerCase());
    const dest = normalizeRel(path.posix.join(target, category, entry.path));
    const key = process.platform === 'win32' ? dest.toLowerCase() : dest;
    const collision = existing.has(key) || collisions.has(key);
    collisions.add(key);
    if (collision) risky++;
    const row = { source: entry.path, proposal: dest, category, bytes: entry.size, status: collision ? 'COLLISION' : 'PREVIEW_ONLY' };
    groups[category] ||= { files: 0, bytes: 0, collisions: 0 };
    groups[category].files++;
    groups[category].bytes += entry.size;
    if (collision) groups[category].collisions++;
    rows.push(row);
  }
  return {
    root: snapshot.root, inventoryAt: snapshot.scannedAt, target,
    totalCandidates: rows.length, collisions: risky, skipped, groups,
    proposals: rows.slice(0,limit), truncated: rows.length > limit,
    dryRun: true, filesystemModified: false,
    warnings: ['This is a proposal from the last saved scan; filesystem may have changed.', 'Only root-level files are considered; nested projects stay untouched.', 'Collision and ownership checks are not sufficient to authorize actual moves.']
  };
}
