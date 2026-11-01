#!/usr/bin/env node
/** Portable launcher for this board; no npm, PowerShell helper or AppData shim. */
import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const sleep = milliseconds => new Promise(done => setTimeout(done, milliseconds));
const fingerprint = root => createHash('sha256').update(root).digest('hex');

function alive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; if (error.code === 'EPERM') return true; throw error; }
}

export function validRecord(record, root) {
  return record?.version === 2 && Number.isInteger(record.pid) && record.pid > 0 && record.pid <= 0x7fffffff
    && Number.isInteger(record.port) && record.port >= 1024 && record.port <= 65535
    && record.root_fingerprint === fingerprint(root) && UUID.test(record.instance_id || '')
    && record.script === join(root, 'board-node.mjs') && typeof record.observe === 'boolean'
    && typeof record.codex_home === 'string' && isAbsolute(record.codex_home);
}

async function health(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(1000), redirect: 'error' });
    if (!response.ok || Number(response.headers.get('content-length') || 0) > 4096) return null;
    let bytes = 0; const chunks = [];
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > 4096) { await response.body.cancel().catch(() => {}); return null; }
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch { return null; }
}

export function matchesHealth(value, record) {
  return value?.status === 'ok' && value.service === 'codex-local-board' && value.version === 2
    && value.pid === record.pid && value.root_fingerprint === record.root_fingerprint
    && value.instance_id === record.instance_id;
}

async function readRecord(path, root) {
  try {
    const stat = await fs.lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) throw new Error('Invalid runtime record; no process was stopped');
    let record;
    try { record = JSON.parse(await fs.readFile(path, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') throw error; throw new Error('Invalid runtime JSON; no record contents were printed'); }
    if (!validRecord(record, root)) throw new Error('Unrecognized runtime record; no process was stopped');
    return record;
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function browse(port) {
  const url = `http://127.0.0.1:${port}/`;
  const command = process.platform === 'win32'
    ? [join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'rundll32.exe'), ['url.dll,FileProtocolHandler', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  await new Promise((done, fail) => {
    const child = spawn(command[0], command[1], { shell: false, windowsHide: true, stdio: 'ignore' });
    const timer = setTimeout(() => { child.kill(); fail(new Error('Browser did not respond; the local board remains running')); }, 4000);
    child.once('error', error => { clearTimeout(timer); fail(error); });
    child.once('close', code => { clearTimeout(timer); code === 0 ? done() : fail(new Error('Browser launch failed; the local board remains running')); });
  });
}

async function initialize(root) {
  // Legacy examples are reference material, never real conversations on this board.
  // A missing state.json is already an empty optional legacy source in the backend.
  for (const [example, active] of [['config.example.json', 'config.json']]) {
    try { await fs.copyFile(join(root, example), join(root, active), constants.COPYFILE_EXCL); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
}

export async function launch({ root = HERE, port = 8787, action = 'open', noBrowser = false, noObserve = false, codexHome }) {
  root = await fs.realpath(resolve(root));
  codexHome = resolve(codexHome || process.env.CODEX_HOME || join(homedir(), '.codex'));
  if (!['open', 'stop', 'status'].includes(action)) throw new Error('Use open, stop or status');
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Port must be 1024..65535');
  const runtime = join(root, '.runtime');
  await fs.mkdir(runtime, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(runtime);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Runtime directory must not be a link');
  const recordPath = join(runtime, 'node-server.json');
  const lockPath = join(runtime, 'node-launcher.lock');
  const lock = await fs.open(lockPath, 'wx', 0o600).catch(error => {
    if (error.code === 'EEXIST') throw new Error('Another launcher operation owns .runtime/node-launcher.lock');
    throw error;
  });
  let started = null;
  try {
    let record = await readRecord(recordPath, root);
    let owned = record && matchesHealth(await health(record.port), record);
    if (record && !owned) {
      if (alive(record.pid)) throw new Error('Recorded process ownership was not confirmed; nothing was stopped');
      if (action !== 'status') await fs.unlink(recordPath);
      record = null;
    }
    if (action === 'status') return { running: Boolean(owned), port: owned ? record.port : null };
    if (action === 'stop') {
      if (!owned) return { stopped: false, reason: 'not_running' };
      // Re-check immediately before signalling; a forged or stale PID is refused.
      if (!matchesHealth(await health(record.port), record)) throw new Error('Ownership changed; nothing was stopped');
      process.kill(record.pid, 'SIGTERM');
      for (let n = 0; n < 30 && alive(record.pid); n++) await sleep(100);
      if (alive(record.pid)) throw new Error('The owned server has not exited; no forced termination was attempted');
      await fs.unlink(recordPath);
      return { stopped: true, port: record.port };
    }
    if (owned) {
      if (record.port !== port) throw new Error('This folder already runs on another port; close it before changing ports');
      if (record.observe !== !noObserve || record.codex_home !== codexHome) throw new Error('Observation settings differ from the running server; close it before changing them');
      if (!noBrowser) await browse(port);
      return { running: true, reused: true, port };
    }
    await initialize(root);
    const instance = randomUUID();
    const script = join(root, 'board-node.mjs');
    const serverStat = await fs.lstat(script);
    if (!serverStat.isFile() || serverStat.isSymbolicLink()) throw new Error('Board server must be an ordinary file');
    const log = await fs.open(join(runtime, 'node-server.log'), 'a', 0o600);
    const errorLog = await fs.open(join(runtime, 'node-server-error.log'), 'a', 0o600);
    let exited = false, failure = null;
    try {
      started = spawn(process.execPath, [script, 'serve', '--root', root, '--state', join(root, 'state-v2.json'),
        '--legacy-state', join(root, 'state.json'), '--config', join(root, 'config.json'), '--port', String(port), '--instance-id', instance,
        '--codex-home', codexHome, ...(noObserve ? ['--no-observe'] : [])],
      { cwd: root, detached: true, windowsHide: true, shell: false, stdio: ['ignore', log.fd, errorLog.fd] });
      started.once('error', error => { failure = error; });
      started.once('exit', () => { exited = true; });
      started.unref();
    } finally { await log.close(); await errorLog.close(); }
    record = { version: 2, pid: started.pid, port, root_fingerprint: fingerprint(root), instance_id: instance, script,
      observe: !noObserve, codex_home: codexHome };
    let ready = false;
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      if (failure || exited) throw new Error('Board server could not start; inspect .runtime/node-server-error.log or choose another port');
      if (matchesHealth(await health(port), record)) { ready = true; break; }
      await sleep(100);
    }
    if (!ready) throw new Error('The new board did not confirm ownership; an existing service may occupy the port');
    const temporary = join(runtime, `node-server-${instance}.tmp`);
    await fs.writeFile(temporary, JSON.stringify(record) + '\n', { flag: 'wx', mode: 0o600 });
    await fs.rename(temporary, recordPath);
    started = null; // Ownership is persisted; browser errors must not stop it.
    if (!noBrowser) await browse(port);
    return { running: true, reused: false, port };
  } finally {
    if (started) started.kill(); // Only this invocation's newly spawned child.
    await lock.close();
    await fs.unlink(lockPath);
  }
}

async function main(args) {
  const options = { action: args.shift() || 'open' };
  while (args.length) {
    const flag = args.shift();
    if (flag === '--no-browser') options.noBrowser = true;
    else if (flag === '--no-observe') options.noObserve = true;
    else if (['--root', '--port', '--codex-home'].includes(flag)) {
      if (!args.length) throw new Error(`Missing value for ${flag}`);
      options[flag === '--root' ? 'root' : flag === '--codex-home' ? 'codexHome' : 'port'] = flag === '--port' ? Number(args.shift()) : args.shift();
    } else throw new Error(`Unknown argument: ${flag}`);
  }
  console.log(JSON.stringify(await launch(options)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => { console.error(`Board launcher refused: ${error.message}`); process.exitCode = 1; });
}
