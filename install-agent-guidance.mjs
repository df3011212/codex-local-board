#!/usr/bin/env node
/** Install a reversible semantic-reporting AGENTS block, never native hook trust. */
import * as fs from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const START = '<!-- codex-local-board:managed:v2';
const END = '<!-- /codex-local-board:managed:v2 -->';
const MAX_BYTES = 1024 * 1024;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

export function codexHome(env = process.env) {
  return resolve(env.CODEX_HOME || join(homedir(), '.codex'));
}

async function entry(path) {
  try {
    const stat = await fs.lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink()) return { exists: true, regular: false };
    if (stat.size > MAX_BYTES) throw new Error('Global instructions exceed the safe read limit');
    const bytes = await fs.readFile(path);
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { exists: true, regular: true, bytes, sha256: sha(bytes), mode: stat.mode };
  } catch (error) {
    if (error.code === 'ENOENT') return { exists: false, regular: true, bytes: Buffer.alloc(0) };
    throw error;
  }
}

export async function inspect(root) {
  try {
    const stat = await fs.lstat(root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('CODEX_HOME must be an ordinary directory');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const files = {};
  for (const name of ['AGENTS.md', 'AGENTS.override.md']) files[name] = await entry(join(root, name));
  // Writing an existing override makes this block part of the file Codex prefers.
  const active = files['AGENTS.override.md'].exists ? 'AGENTS.override.md' : 'AGENTS.md';
  if (!files[active].regular) throw new Error('Active global instructions are a link or non-regular file; no changes made');
  return { active, files };
}

export function locate(bytes) {
  const text = bytes.toString('utf8');
  const starts = [...text.matchAll(/<!-- codex-local-board:managed:v2/g)];
  const ends = [...text.matchAll(/<!-- \/codex-local-board:managed:v2 -->/g)];
  if (!starts.length && !ends.length) return null;
  if (starts.length !== 1 || ends.length !== 1) throw new Error('Ambiguous managed block; existing instructions preserved');
  const start = bytes.indexOf(Buffer.from(START));
  const endMarker = bytes.indexOf(Buffer.from(END), start);
  const headerEnd = bytes.indexOf(Buffer.from(' -->'), start);
  if (endMarker < start || headerEnd < start || headerEnd > endMarker) throw new Error('Incomplete managed block');
  const header = bytes.subarray(start, headerEnd + 4).toString('utf8');
  const match = /^<!-- codex-local-board:managed:v2 prefix=([A-Za-z0-9+/]*={0,2}) -->$/.exec(header);
  if (!match) throw new Error('Unknown managed-block format; no changes made');
  const prefix = Buffer.from(match[1], 'base64');
  if (!['', '\n', '\n\n', '\r\n', '\r\n\r\n'].includes(prefix.toString())) throw new Error('Invalid managed-block prefix');
  if (!bytes.subarray(start - prefix.length, start).equals(prefix)) throw new Error('Managed-block boundary was edited');
  let end = endMarker + Buffer.byteLength(END);
  if (bytes.subarray(end, end + 2).toString() === '\r\n') end += 2;
  else if (bytes[end] === 10) end += 1;
  return { start: start - prefix.length, end, prefix };
}

export function replaceBlock(before, body, uninstall = false) {
  const old = locate(before);
  if (uninstall) return old ? Buffer.concat([before.subarray(0, old.start), before.subarray(old.end)]) : before;
  const newline = before.includes(Buffer.from('\r\n')) ? '\r\n' : '\n';
  const prefix = old ? old.prefix : Buffer.from(before.length ? (before.at(-1) === 10 ? newline : newline + newline) : '');
  const header = `${START} prefix=${prefix.toString('base64')} -->`;
  const block = Buffer.concat([prefix, Buffer.from(`${header}${newline}${body.trim().replace(/\r?\n/g, newline)}${newline}${END}${newline}`)]);
  return old ? Buffer.concat([before.subarray(0, old.start), block, before.subarray(old.end)]) : Buffer.concat([before, block]);
}

function shellQuote(value) {
  if (/[\x00-\x1f\x7f]/.test(value)) throw new Error('Command paths must not contain control characters');
  return "'" + value.replaceAll("'", process.platform === 'win32' ? "''" : "'\"'\"'") + "'";
}

export async function render(root, node) {
  const source = await fs.readFile(join(HERE, 'docs', 'agent-guidance.template.md'), 'utf8');
  const reporter = join(root, 'agent_report.mjs');
  for (const path of [node, reporter]) {
    const stat = await fs.lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Node and reporter must be ordinary files');
  }
  // The contract owns these flags; use the platform's normal shell quoting.
  const command = `${process.platform === 'win32' ? '& ' : ''}${shellQuote(node)} ${shellQuote(reporter)} --state ${shellQuote(join(root, 'state-v2.json'))}`;
  return source.replaceAll('{{REPORT_COMMAND}}', command);
}

export async function change({ root, boardRoot = HERE, node = process.execPath, action = 'install', apply = false }) {
  root = resolve(root); boardRoot = resolve(boardRoot); node = resolve(node);
  const audit = await inspect(root);
  const target = join(root, audit.active);
  const original = audit.files[audit.active];
  const body = action === 'uninstall' ? '' : await render(boardRoot, node);
  const after = replaceBlock(original.bytes, body, action === 'uninstall');
  const result = { action, target, active_file: audit.active, apply, changed: !after.equals(original.bytes),
    original_bytes: original.bytes.length, original_sha256: original.sha256 ?? null,
    resulting_bytes: after.length, managed_block_present: Boolean(locate(after)),
    audit: Object.fromEntries(Object.entries(audit.files).map(([name, value]) => [name,
      { exists: value.exists, regular: value.regular, bytes: value.bytes?.length ?? null, sha256: value.sha256 ?? null }])) };
  if (!apply || !result.changed) return result;
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const lockPath = join(root, '.codex-local-board-guidance.lock');
  const lock = await fs.open(lockPath, 'wx', 0o600).catch(error => {
    if (error.code === 'EEXIST') throw new Error('Another guidance update owns the lock; no change made');
    throw error;
  });
  let temporary;
  try {
    const current = await inspect(root);
    if (current.active !== audit.active || !current.files[audit.active].bytes.equals(original.bytes)) throw new Error('Global instructions changed during review; retry without editing them');
    const backupDir = join(root, '.codex-local-board-guidance-backups');
    await fs.mkdir(backupDir, { recursive: true, mode: 0o700 });
    const backupStat = await fs.lstat(backupDir);
    if (!backupStat.isDirectory() || backupStat.isSymbolicLink()) throw new Error('Backup directory is not an ordinary directory');
    const suffix = `${new Date().toISOString().replaceAll(':', '-')}-${randomBytes(6).toString('hex')}`;
    const backup = join(backupDir, `${audit.active}.${suffix}.before`);
    await fs.writeFile(backup, original.bytes, { flag: 'wx', mode: 0o600 });
    temporary = join(root, `.codex-local-board-guidance-${suffix}.tmp`);
    const handle = await fs.open(temporary, 'wx', original.mode ? original.mode & 0o777 : 0o600);
    try { await handle.writeFile(after); await handle.sync(); } finally { await handle.close(); }
    const finalCheck = await entry(target);
    if (!finalCheck.regular || finalCheck.exists !== original.exists || !finalCheck.bytes.equals(original.bytes)) throw new Error('Global instructions changed before replacement; no overwrite performed');
    await fs.rename(temporary, target); temporary = null;
    result.backup = backup;
    return result;
  } finally {
    if (temporary) await fs.unlink(temporary).catch(() => {});
    await lock.close();
    await fs.unlink(lockPath);
  }
}

async function main(args) {
  const action = args.shift() || 'audit';
  if (!['audit', 'install', 'uninstall'].includes(action)) throw new Error('Use audit, install or uninstall');
  const options = { root: codexHome(), action, apply: false };
  let printBlock = false;
  while (args.length) {
    const flag = args.shift();
    if (flag === '--apply') options.apply = true;
    else if (flag === '--render') printBlock = true;
    else if (['--codex-home', '--board-root', '--node'].includes(flag)) {
      if (!args.length) throw new Error(`Missing value for ${flag}`);
      options[flag === '--codex-home' ? 'root' : flag === '--board-root' ? 'boardRoot' : 'node'] = args.shift();
    } else throw new Error(`Unknown argument: ${flag}`);
  }
  if (action === 'audit') {
    const audit = await inspect(options.root);
    console.log(JSON.stringify({ active_file: audit.active, files: Object.fromEntries(Object.entries(audit.files).map(([name, value]) => [name,
      { exists: value.exists, regular: value.regular, bytes: value.bytes?.length ?? null, sha256: value.sha256 ?? null }])) }, null, 2));
  } else {
    const result = await change(options);
    console.log(JSON.stringify(result, null, 2));
    if (printBlock && action === 'install') console.log(await render(resolve(options.boardRoot || HERE), resolve(options.node || process.execPath)));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => { console.error(`Guidance update refused: ${error.message}`); process.exitCode = 1; });
}
