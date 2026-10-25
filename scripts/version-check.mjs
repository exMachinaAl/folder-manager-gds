#!/usr/bin/env node
import { checkInstallation } from '../lib/upgrade-state.js';
try {
  const result = await checkInstallation();
  if (process.argv.includes('--json')) console.log(JSON.stringify(result, null, 2));
  else {
    console.log('==================================================');
    console.log('FOWS - VERSION & UPGRADE CHECKER');
    console.log('==================================================');
    console.log(`Version        : ${result.version}`);
    console.log(`Integrity      : ${result.status}`);
    console.log(`Managed files  : ${result.managedCount}`);
    console.log(`Last upgrade   : ${result.lastUpgrade || '-'}`);
    console.log(`Upgrade count  : ${result.historyCount || 0}`);
    for (const rel of result.drift) console.log(`[CONFLICT] Modified or missing: ${rel}`);
    for (const rel of result.preservedDocs || []) console.log(`[PRESERVED DOC] Locally customized: ${rel}`);
    if (result.status === 'legacy-untracked') console.log('Legacy installation; no installed manifest yet.');
  }
  if (result.status === 'version-mismatch' || result.status === 'drift') process.exitCode = 2;
} catch (error) { console.error(`[ERROR] ${error.message}`); process.exitCode = 1; }
