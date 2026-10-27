import { diffSnapshots } from './diff.js';
import { sanitizeId } from './util.js';

export async function compareSessions(store, leftId, rightId, { limit = 100 } = {}) {
  sanitizeId(leftId); sanitizeId(rightId);
  if (leftId === rightId) throw new Error('Choose two different sessions');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error('limit must be 1..1000');
  const [leftSession, rightSession, left, right] = await Promise.all([
    store.loadSession(leftId), store.loadSession(rightId),
    store.loadSnapshot(leftId, 'latest'), store.loadSnapshot(rightId, 'latest')
  ]);
  if (left.root !== right.root || leftSession.root !== rightSession.root) {
    const err = new Error('Session roots differ. File-path comparison requires the same root directory.');
    err.code = 'ROOT_MISMATCH'; throw err;
  }
  const diff = diffSnapshots(left, right);
  return {
    left: { id: leftId, status: leftSession.status, scannedAt: left.scannedAt, files: left.summary.files, bytes: left.summary.totalBytes },
    right: { id: rightId, status: rightSession.status, scannedAt: right.scannedAt, files: right.summary.files, bytes: right.summary.totalBytes },
    root: left.root,
    comparison: { counts: diff.counts, netBytes: diff.netBytes, totalChanges: diff.events.length, events: diff.events.slice(0,limit), truncated: diff.events.length > limit },
    note: 'Compares last recorded snapshots, not actual disk I/O. Source sessions are not changed.'
  };
}
