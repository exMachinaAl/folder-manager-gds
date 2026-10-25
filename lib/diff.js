export function diffSnapshots(before, after) {
  const old = new Map(before.entries.map(e => [e.path, e]));
  const fresh = new Map(after.entries.map(e => [e.path, e]));
  const events = [];
  for (const [rel, entry] of fresh) {
    const previous = old.get(rel);
    if (!previous) events.push({ type: 'CREATE', path: rel, beforeSize: 0, afterSize: entry.size, deltaBytes: entry.size, entryType: entry.type });
    else if (entry.type !== previous.type || entry.size !== previous.size || entry.mtimeMs !== previous.mtimeMs) {
      events.push({ type: 'MODIFY', path: rel, beforeSize: previous.size, afterSize: entry.size, deltaBytes: entry.size - previous.size, entryType: entry.type });
    }
  }
  for (const [rel, entry] of old) {
    if (!fresh.has(rel)) events.push({ type: 'DELETE', path: rel, beforeSize: entry.size, afterSize: 0, deltaBytes: -entry.size, entryType: entry.type });
  }
  events.sort((a, b) => a.path.localeCompare(b.path));
  const counts = { CREATE: 0, MODIFY: 0, DELETE: 0 };
  for (const item of events) counts[item.type]++;
  return { before: before.scannedAt, after: after.scannedAt, counts, netBytes: after.summary.totalBytes - before.summary.totalBytes, beforeBytes: before.summary.totalBytes, afterBytes: after.summary.totalBytes, events };
}

export function summarizeEvents(events, intervalSeconds = 60) {
  if (!events.length) return [];
  const buckets = new Map();
  for (const event of events) {
    const at = new Date(event.at).getTime();
    if (!Number.isFinite(at)) continue;
    const startMs = Math.floor(at / (intervalSeconds * 1000)) * intervalSeconds * 1000;
    const key = new Date(startMs).toISOString();
    const b = buckets.get(key) || { start: key, count: 0, created: 0, modified: 0, deleted: 0, netBytes: 0, observedBytes: 0 };
    b.count++;
    b.netBytes += event.deltaBytes;
    if (event.type === 'CREATE') b.created++;
    if (event.type === 'MODIFY') b.modified++;
    if (event.type === 'DELETE') b.deleted++;
    // Rough logical-change indicator, NOT physical I/O and NOT read byte counts.
    b.observedBytes += Math.max(event.beforeSize || 0, event.afterSize || 0);
    buckets.set(key, b);
  }
  return [...buckets.values()].sort((a, b) => a.start.localeCompare(b.start));
}
