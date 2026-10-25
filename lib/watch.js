import { watch as nativeWatch } from 'node:fs';
import path from 'node:path';
import { scanTree } from './scan.js';
import { diffSnapshots } from './diff.js';
import { sessionId, isInsideOrEqual } from './util.js';

/** Hybrid mode: native directory notifications trigger a debounced rescan.
 * Periodic rescans are ALWAYS retained to reconcile lost notifications.
 * Node's fs.watch is advisory; we never mistake its events for a full journal.
 */
export async function runWatch(store, {
  root, exclude = [], intervalMs = 1000, seconds = 0, strategy = 'hybrid', debounceMs = 200,
  onTick = () => {}, onReady = () => {}
}) {
  if (!['hybrid', 'poll'].includes(strategy)) throw new Error('watch strategy must be hybrid or poll');
  if (!Number.isInteger(debounceMs) || debounceMs < 50 || debounceMs > 60000) throw new Error('Invalid debounceMs');
  const baseline = await scanTree(root, { exclude, dataDir: store.dataDir });
  if (baseline.errors.length) throw new Error(`Cannot start a reliable baseline: ${baseline.errors.length} scan errors (e.g. ${baseline.errors[0].path}: ${baseline.errors[0].error})`);
  const id = sessionId();
  const startedAt = new Date().toISOString();
  let native = null;
  let watcherMode = 'poll';
  let watcherWarning = null;
  let wake = null;
  let pendingSignal = false;
  const signal = () => { pendingSignal = true; if (wake) wake(); };
  if (strategy === 'hybrid') {
    try {
      native = nativeWatch(baseline.root, { recursive: true, persistent: false }, (_event, filename) => {
        // Ignore our own journal writes when data/ is located inside the watched root.
        // Otherwise each persisted snapshot could trigger another immediate scan.
        if (filename && isInsideOrEqual(store.dataDir, path.resolve(baseline.root, String(filename)))) return;
        signal();
      });
      native.on('error', err => {
        watcherWarning = `Native watcher stopped (${err.code || err.message}); periodic reconciliation remains active.`;
        watcherMode = 'poll';
        try { native?.close(); } catch { /* no-op */ }
        native = null;
        signal();
      });
      watcherMode = 'hybrid';
    } catch (error) {
      watcherWarning = `Native watcher unavailable (${error.code || error.message}); using polling fallback.`;
    }
  }
  try {
    await store.beginSession(id, {
      id, root: baseline.root, exclude, startedAt, intervalMs, debounceMs, strategy,
      watcherMode, status: 'running', warnings: watcherWarning ? [watcherWarning] : [],
      polls: 0, eventCount: 0
    }, baseline);
  } catch (error) { native?.close(); throw error; }
  onReady({ id, baseline, watcherMode, watcherWarning });
  let last = baseline;
  let stopRequested = false;
  let polls = 0;
  let eventCount = 0;
  let errors = 0;
  const endAt = seconds > 0 ? Date.now() + seconds * 1000 : Infinity;
  const shutdown = () => { stopRequested = true; signal(); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  async function waitSignalOrTimeout(ms) {
    if (pendingSignal) { pendingSignal = false; return; }
    await new Promise(resolve => {
      let resolved = false;
      const done = () => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        wake = null;
        resolve();
      };
      const timer = setTimeout(done, Math.max(0, ms));
      wake = done;
      if (pendingSignal) done();
    });
    pendingSignal = false;
  }

  const pollOnce = async () => {
    const now = await scanTree(root, { exclude, dataDir: store.dataDir });
    if (now.errors.length) {
      errors++;
      onTick({ warning: `Skipped partial scan (${now.errors.length} errors). Not interpreting missing entries as deletions.` });
      return;
    }
    const result = diffSnapshots(last, now);
    const events = result.events.map(event => ({ ...event, at: now.scannedAt, sessionId: id }));
    await store.appendEvents(id, events);
    await store.saveLatest(id, now);
    last = now;
    polls++;
    eventCount += events.length;
    onTick({ events, polls, summary: result });
  };

  try {
    while (!stopRequested && Date.now() < endAt) {
      const waitMs = Math.max(0, Math.min(intervalMs, endAt - Date.now()));
      await waitSignalOrTimeout(waitMs);
      if (stopRequested || Date.now() >= endAt) break;
      // Native notifications may arrive in bursts. A debounce collapses bursts;
      // periodic rescans remain bounded by intervalMs during quiet periods.
      if (watcherMode === 'hybrid' && waitMs > debounceMs) {
        await new Promise(resolve => setTimeout(resolve, debounceMs));
      }
      await pollOnce();
    }
    await pollOnce(); // final reconciliation
    await store.updateSession(id, {
      status: 'stopped', stoppedAt: new Date().toISOString(), watcherMode,
      polls, eventCount, scanWarnings: errors,
      ...(watcherWarning ? { warnings: [watcherWarning] } : {})
    });
    return { id, eventCount, polls, scanWarnings: errors, watcherMode };
  } catch (error) {
    await store.updateSession(id, { status: 'error', stoppedAt: new Date().toISOString(), error: error.message, polls, eventCount, scanWarnings: errors });
    throw error;
  } finally {
    native?.close();
    process.off('SIGINT', shutdown);
    process.off('SIGTERM', shutdown);
    if (wake) wake();
  }
}
