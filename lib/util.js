import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';

export function parseArgs(argv) {
  const options = { _: [], exclude: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) { options._.push(token); continue; }
    const eq = token.indexOf('=');
    const key = (eq === -1 ? token.slice(2) : token.slice(2, eq)).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (key === 'exclude') {
      const value = eq === -1 ? argv[++i] : token.slice(eq + 1);
      if (!value || value.startsWith('--')) throw new Error('--exclude requires a glob pattern');
      options.exclude.push(value);
      continue;
    }
    if (['json', 'help', 'yes'].includes(key)) { options[key] = true; continue; }
    const value = eq === -1 ? argv[++i] : token.slice(eq + 1);
    if (value === undefined || value.startsWith('--')) throw new Error(`--${key} requires a value`);
    options[key] = value;
  }
  return options;
}

export function asPositiveInt(value, defaultValue, label, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === undefined) return defaultValue;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`${label} must be an integer between ${min} and ${max}`);
  return n;
}

export const prettyBytes = (n) => {
  const negative = n < 0 ? '-' : '';
  let amount = Math.abs(n);
  const suffixes = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  let i = 0;
  while (amount >= 1024 && i < suffixes.length - 1) { amount /= 1024; i++; }
  return `${negative}${i ? amount.toFixed(2) : amount.toFixed(0)} ${suffixes[i]}`;
};

export const shaPath = (root) => crypto.createHash('sha256').update(root).digest('hex').slice(0, 20);
export const sessionId = () => `FOWS-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

export function dataDirectory(explicit) {
  return path.resolve(explicit || process.env.FOWS_DATA_DIR || path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'data'));
}
export function normalizeRel(input) { return input.split(path.sep).join('/'); }
export function isInsideOrEqual(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}
export async function writeJsonAtomic(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(value, null, 2), { encoding: 'utf8', flag: 'wx' });
    await fs.rename(tmp, file);
  } finally { await fs.rm(tmp, { force: true }).catch(() => {}); }
}
export async function readJson(file) { return JSON.parse(await fs.readFile(file, 'utf8')); }
export function sanitizeId(id) {
  if (!/^[A-Za-z0-9_-]{4,100}$/.test(id || '')) throw new Error('Invalid session / inventory ID');
  return id;
}

// Gitignore-like glob matching; supports *, **, ?, and trailing / directory patterns.
export function globRegex(rawPattern) {
  let input = rawPattern.replaceAll('\\', '/');
  if (input.startsWith('./')) input = input.slice(2);
  if (input.startsWith('/')) input = input.slice(1);
  const dirOnly = input.endsWith('/');
  if (dirOnly) input += '**';
  let out = '^';
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '*' && input[i + 1] === '*') {
      i++;
      if (input[i + 1] === '/') { out += '(?:.*/)?'; i++; }
      else out += '.*';
    } else if (c === '*') out += '[^/]*';
    else if (c === '?') out += '[^/]';
    else out += c.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
  }
  return new RegExp(out + '$');
}
export function shouldExclude(rel, patterns) {
  return patterns.some((pattern) => {
    const r = globRegex(pattern);
    const basenameMatch = !pattern.includes('/') && !pattern.includes('**') && !pattern.includes('*') && !pattern.includes('?');
    return r.test(rel) || (basenameMatch && rel.split('/').includes(pattern));
  });
}
