import { diffSnapshots, summarizeEvents } from './diff.js';
import { sanitizeId } from './util.js';

/** Report is deliberately metadata-only. Never reads the bytes of user files. */
export async function buildSessionReport(store, id, { top = 20 } = {}) {
  sanitizeId(id);
  if (!Number.isSafeInteger(top) || top < 1 || top > 1000) throw new Error('top must be between 1 and 1000');
  const [session, before, after, events] = await Promise.all([
    store.loadSession(id), store.loadSnapshot(id, 'baseline'),
    store.loadSnapshot(id, 'latest'), store.readEvents(id)
  ]);
  const diff = diffSnapshots(before, after);
  const churn = new Map();
  let observedBytes = 0;
  const eventCounts = { CREATE: 0, MODIFY: 0, DELETE: 0 };
  for (const e of events) {
    if (!Object.hasOwn(eventCounts, e.type)) continue;
    eventCounts[e.type]++;
    const bytes = Math.max(0, Number(e.beforeSize) || 0, Number(e.afterSize) || 0);
    observedBytes += bytes;
    const record = churn.get(e.path) || { path: e.path, events: 0, observedBytes: 0, netBytes: 0 };
    record.events++;
    record.observedBytes += bytes;
    record.netBytes += Number(e.deltaBytes) || 0;
    churn.set(e.path, record);
  }
  const topChanged = [...churn.values()].sort((a,b) => b.observedBytes - a.observedBytes || b.events-a.events || a.path.localeCompare(b.path)).slice(0, top);
  const started = Date.parse(session.startedAt);
  const ended = Date.parse(session.stoppedAt || new Date().toISOString());
  return {
    schemaVersion: 1,
    appVersion: '0.4.0-node',
    session: {
      id, status: session.status, root: session.root, startedAt: session.startedAt,
      stoppedAt: session.stoppedAt || null,
      durationSeconds: Number.isFinite(started) && Number.isFinite(ended) ? Math.max(0,Math.round((ended-started)/1000)) : null,
      strategy: session.strategy || 'poll', watcherMode: session.watcherMode || 'poll',
      polls: session.polls || 0, scanWarnings: session.scanWarnings || 0,
      warnings: session.warnings || []
    },
    baseline: { scannedAt: before.scannedAt, files: before.summary.files, directories: before.summary.directories, totalBytes: before.summary.totalBytes },
    latest: { scannedAt: after.scannedAt, files: after.summary.files, directories: after.summary.directories, totalBytes: after.summary.totalBytes },
    diff: { counts: diff.counts, netBytes: diff.netBytes, changedPaths: diff.events.length, changes: diff.events },
    activity: { recordedEvents: events.length, eventCounts, observedBytes, topChanged },
    timeline: { '1s': summarizeEvents(events,1), '1m': summarizeEvents(events,60), '1h': summarizeEvents(events,3600) },
    notes: [
      'Observed bytes estimate file-size activity; not actual physical disk reads/writes.',
      'Brief changes between scans may be missed; final diff compares stored snapshots.',
      'A report is not proof of file ownership and cannot authorize cleanup.'
    ]
  };
}

function csvCell(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return `"${value}"`;
  const str = String(value ?? '');
  // Prevent spreadsheet formula injection when users open CSV in Excel/Sheets.
  const safe = /^[\s]*[=+@\-\t\r]/u.test(str) ? `'${str}` : str;
  return `"${safe.replaceAll('"','""')}"`;
}
export function eventsToCsv(report) {
  const columns = ['session_id','kind','path','entry_type','before_bytes','after_bytes','delta_bytes'];
  const rows = report.diff.changes.map(e => [report.session.id,e.type,e.path,e.entryType,e.beforeSize,e.afterSize,e.deltaBytes]);
  return '\uFEFF' + [columns,...rows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function reportAsText(report, prettyBytes, top = 10) {
  const r = report;
  return [
    `Session ${r.session.id} (${r.session.status})`,
    `Root: ${r.session.root}`,
    `Duration: ${r.session.durationSeconds ?? '-'}s, watcher: ${r.session.watcherMode}, scans: ${r.session.polls}, scan warnings: ${r.session.scanWarnings}`,
    `Baseline: ${r.baseline.files} files / ${prettyBytes(r.baseline.totalBytes)}`,
    `Latest: ${r.latest.files} files / ${prettyBytes(r.latest.totalBytes)}`,
    `Diff: +${r.diff.counts.CREATE} created, ${r.diff.counts.MODIFY} modified, -${r.diff.counts.DELETE} deleted, net ${prettyBytes(r.diff.netBytes)}`,
    `Activity: ${r.activity.recordedEvents} journal events; ${prettyBytes(r.activity.observedBytes)} observed (estimate; not physical I/O)`,
    ...r.activity.topChanged.slice(0,top).map(e => `  ${String(e.events).padStart(4)} event(s) ${prettyBytes(e.observedBytes).padStart(13)} ${e.path}`),
    'Note: Metadata tracking only; transient changes may be missed.'
  ].join('\n');
}
