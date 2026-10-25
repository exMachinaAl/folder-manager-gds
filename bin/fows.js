#!/usr/bin/env node
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { parseArgs, dataDirectory, prettyBytes, asPositiveInt } from '../lib/util.js';
import { scanTree, groupTypes } from '../lib/scan.js';
import { Store } from '../lib/store.js';
import { diffSnapshots, summarizeEvents } from '../lib/diff.js';
import { runWatch } from '../lib/watch.js';
import { createFowsServer } from '../lib/server.js';
import { buildSessionReport, eventsToCsv, reportAsText } from '../lib/report.js';

const HELP = `FOWS v0.3.0-node · read-only File Operations & Workspace System

Usage: node bin/fows.js COMMAND [options]

Commands:
  scan      --root PATH [--exclude GLOB ...] [--data PATH] [--json]
  types     --root PATH [--limit N] [--json]
  search    --root PATH --query TEXT [--limit N] [--json]
  watch     --root PATH [--interval MS] [--seconds N] [--strategy hybrid|poll]
            [--debounce MS] [--exclude GLOB ...]
  sessions  [--json]
  diff      --session ID|latest [--limit N] [--json]
  stats     --session ID|latest [--interval 1s|1m|1h|run] [--json]
  report    --session ID|latest [--limit N] [--json]
  export    --session ID|latest [--format json|csv] [--out FILE]
  serve     [--port 8765]  # localhost only, read-only
  doctor    [--json]
  version   [--json]  # installed version + upgrade integrity
  help

Data directory: ./data beside FOWS, override with --data PATH or FOWS_DATA_DIR.
Note: watch uses periodic snapshots, so very short-lived changes may be missed.
      Values describe observed file sizes, not actual disk reads/writes.
`;

function emit(value, json, printer) { if (json) console.log(JSON.stringify(value, null, 2)); else printer(value); }
function needRoot(opts) { if (!opts.root) throw new Error('Missing --root PATH'); return path.resolve(opts.root); }
function line(name, value) { console.log(`  ${name.padEnd(18)} ${value}`); }
async function selectSession(store, wanted) {
  if (!wanted) throw new Error('Missing --session ID (or latest)');
  if (wanted !== 'latest') return wanted;
  const sessions = await store.listSessions();
  if (!sessions.length) throw new Error('No sessions yet');
  return sessions[0].id;
}
const queryLower = (v) => String(v).toLocaleLowerCase();

async function main() {
  const command = process.argv[2] || 'help';
  const opts = parseArgs(process.argv.slice(3));
  if (command === 'help' || opts.help || command === '--help') { console.log(HELP); return; }
  const dataDir = dataDirectory(opts.data);
  const store = new Store(dataDir);
  if (command === 'scan') {
    const snapshot = await scanTree(needRoot(opts), { exclude: opts.exclude, dataDir });
    const outputFile = await store.saveInventory(snapshot);
    emit({ ...snapshot.summary, root: snapshot.root, snapshot: outputFile, errors: snapshot.errors }, opts.json, d => {
      console.log(`FOWS inventory: ${d.root}`);
      line('Files', d.files); line('Directories', d.directories); line('Symlinks', d.symlinks);
      line('Logical size', prettyBytes(d.totalBytes)); line('Excluded', d.excluded); line('Errors', d.errors.length);
      line('Saved at', d.snapshot);
      if (d.errors.length) console.warn('Warning: inaccessible paths were skipped; inventory is incomplete.');
    });
  } else if (command === 'types') {
    const snapshot = await store.loadInventory(needRoot(opts));
    const types = groupTypes(snapshot).slice(0, asPositiveInt(opts.limit, 25, '--limit'));
    emit(types, opts.json, data => { console.log(`Extensions in ${snapshot.root}:`); for (const t of data) console.log(`${t.extension.padEnd(18)} ${String(t.files).padStart(7)} files   ${prettyBytes(t.bytes)}`); });
  } else if (command === 'search') {
    if (!opts.query) throw new Error('Missing --query TEXT');
    const snapshot = await store.loadInventory(needRoot(opts));
    const term = queryLower(opts.query);
    const found = snapshot.entries.filter(e => queryLower(e.path).includes(term)).slice(0, asPositiveInt(opts.limit, 100, '--limit'));
    emit(found, opts.json, data => { console.log(`Matches: ${data.length} (from last scan)`); for (const e of data) console.log(`  ${e.type.padEnd(7)} ${prettyBytes(e.size).padStart(11)} ${e.path}`); });
  } else if (command === 'watch') {
    const intervalMs = asPositiveInt(opts.interval, 1000, '--interval', { min: 250, max: 86_400_000 });
    const seconds = asPositiveInt(opts.seconds, 0, '--seconds', { min: 0, max: 7 * 24 * 3600 });
    const strategy = opts.strategy || 'hybrid';
    const debounceMs = asPositiveInt(opts.debounce, 200, '--debounce', { min: 50, max: 60000 });
    const result = await runWatch(store, { root: needRoot(opts), exclude: opts.exclude, intervalMs, seconds, strategy, debounceMs,
      onReady: ({ id, baseline, watcherMode, watcherWarning }) => { console.log(`Session ${id} started`); console.log(`Root ${baseline.root} · baseline ${baseline.summary.files} files · ${prettyBytes(baseline.summary.totalBytes)}`); console.log(`Watching (${watcherMode} + final reconciliation). Press Ctrl+C to stop.`); if (watcherWarning) console.warn(watcherWarning); },
      onTick: ({ events, warning }) => { if (warning) { console.warn(warning); return; } for (const e of events) console.log(`${new Date().toLocaleTimeString()} ${e.type.padEnd(6)} ${prettyBytes(e.deltaBytes).padStart(12)}  ${e.path}`); }
    });
    console.log(`Stopped ${result.id} · ${result.eventCount} events · ${result.polls} scans · ${result.scanWarnings} incomplete scans · ${result.watcherMode}`);
    console.log(`Inspect: node bin/fows.js diff --session ${result.id}`);
  } else if (command === 'sessions') {
    const sessions = await store.listSessions();
    emit(sessions, opts.json, data => { if (!data.length) console.log('No sessions yet.'); for (const s of data) console.log(`${s.id}   ${s.status.padEnd(8)}  ${s.eventCount || 0} events  ${s.root}`); });
  } else if (command === 'diff') {
    const id = await selectSession(store, opts.session);
    const [before, after] = await Promise.all([store.loadSnapshot(id, 'baseline'), store.loadSnapshot(id, 'latest')]);
    const result = diffSnapshots(before, after);
    emit({ session: id, ...result }, opts.json, d => {
      console.log(`Session ${id}: ${d.events.length} paths changed`);
      line('CREATE', d.counts.CREATE); line('MODIFY', d.counts.MODIFY); line('DELETE', d.counts.DELETE); line('Net change', prettyBytes(d.netBytes));
      for (const e of d.events.slice(0, asPositiveInt(opts.limit, 100, '--limit'))) console.log(`  ${e.type.padEnd(6)} ${prettyBytes(e.deltaBytes).padStart(12)} ${e.path}`);
      if (d.events.length > (opts.limit === undefined ? 100 : Number(opts.limit))) console.log('... additional changes omitted; use --json for all');
    });
  } else if (command === 'stats') {
    const id = await selectSession(store, opts.session);
    const intervals = { '1s': 1, '1m': 60, '1h': 3600 };
    const interval = opts.interval || '1m';
    if (interval !== 'run' && !intervals[interval]) throw new Error('--interval must be 1s, 1m, 1h, or run');
    const series = interval === 'run' ? [await buildSessionReport(store,id)] : summarizeEvents(await store.readEvents(id), intervals[interval]);
    if (interval === 'run') { emit(series[0], opts.json, r => console.log(reportAsText(r, prettyBytes))); return; }
    emit(series, opts.json, data => { console.log(`Observed change events per ${interval} · session ${id}`); if (!data.length) console.log('(no events)'); for (const s of data) console.log(`${s.start} events=${s.count} created=${s.created} modified=${s.modified} deleted=${s.deleted} net=${prettyBytes(s.netBytes)} observed=${prettyBytes(s.observedBytes)}`); });
  } else if (command === 'report') {
    const id = await selectSession(store, opts.session);
    const limit = asPositiveInt(opts.limit, 20, '--limit', {min:1,max:1000});
    const r = await buildSessionReport(store,id,{top:limit});
    emit(r, opts.json, data => console.log(reportAsText(data, prettyBytes, limit)));
  } else if (command === 'export') {
    const id = await selectSession(store, opts.session);
    const format = opts.format || 'json';
    if (!['json','csv'].includes(format)) throw new Error('--format must be json or csv');
    const report = await buildSessionReport(store,id, {top:1000});
    const folder = path.join(dataDir, 'exports');
    const outputPath = path.resolve(opts.out || path.join(folder, `${id}-report.${format}`));
    // Never overwrite existing export or files via symlinks.
    await fs.mkdir(path.dirname(outputPath), {recursive:true});
    const output = format === 'csv' ? eventsToCsv(report) : JSON.stringify(report,null,2)+'\n';
    await fs.writeFile(outputPath, output, {flag:'wx'});
    emit({session:id,format,file:outputPath,bytes:Buffer.byteLength(output)}, opts.json, d => console.log(`Exported ${d.format}: ${d.file} (${prettyBytes(d.bytes)})`));
  } else if (command === 'serve') {
    const port = asPositiveInt(opts.port, 8765, '--port', { min: 1, max: 65535 });
    const server = createFowsServer(store);
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    console.log(`Read-only local dashboard at http://127.0.0.1:${port}`);
    console.log('Network/public access intentionally disabled in this MVP. Ctrl+C to stop.');
  } else if (command === 'version') {
    const { checkInstallation } = await import('../lib/upgrade-state.js');
    const info = await checkInstallation();
    emit(info, opts.json, d => { console.log(`FOWS ${d.version} · ${d.status}`); line('Managed files', d.managedCount); line('Drift', d.drift.length); line('Last upgrade', d.lastUpgrade || '-'); for (const issue of d.drift.slice(0, 20)) console.log(`  [DRIFT] ${issue}`); });
    if (info.status === 'drift' || info.status === 'version-mismatch') process.exitCode = 2;
  } else if (command === 'doctor') {
    const status = { version: '0.3.0-node', node: process.version, os: `${os.platform()}/${os.arch()}`, dataDir, writable: false };
    try { await fs.mkdir(dataDir, { recursive: true }); await fs.access(dataDir, fs.constants.W_OK); status.writable = true; }
    catch (error) { status.error = error.message; }
    emit(status, opts.json, data => { for (const [k, v] of Object.entries(data)) line(k, v); });
    if (!status.writable) process.exitCode = 1;
  } else throw new Error(`Unknown command '${command}'. Run: node bin/fows.js help`);
}

main().catch(error => { console.error(`FOWS error: ${error.message}`); process.exitCode = 1; });
