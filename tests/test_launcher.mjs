import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from '../open-board.mjs';

async function freePort() {
  const server = createServer();
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const port = server.address().port;
  await new Promise(done => server.close(done));
  return port;
}
const pause = milliseconds => new Promise(done => setTimeout(done, milliseconds));
const root = await fs.mkdtemp(join(tmpdir(), 'codex-launcher-test-'));
let foreign = null;
try {
  // Synthetic service tests actual OS child-process ownership without vendor code.
  await fs.writeFile(join(root, 'board-node.mjs'), `
import http from 'node:http'; import fs from 'node:fs'; import crypto from 'node:crypto';
const args=process.argv.slice(3); const value=f=>args[args.indexOf(f)+1];
const root=fs.realpathSync(value('--root'));
const payload={status:'ok',service:'codex-local-board',version:2,pid:process.pid,root_fingerprint:crypto.createHash('sha256').update(root).digest('hex'),instance_id:value('--instance-id')};
http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(payload));}).listen(Number(value('--port')),'127.0.0.1');
`);
  await fs.writeFile(join(root, 'config.example.json'), '{"title":"Demo"}\n');
  await fs.writeFile(join(root, 'state.example.json'), '{"demo":true}\n');
  const port = await freePort();
  const first = await launch({ root, port, noBrowser: true });
  assert.equal(first.reused, false);
  await assert.rejects(fs.access(join(root, 'state.json')), { code: 'ENOENT' });
  const recordPath = join(root, '.runtime/node-server.json');
  const firstRecord = await fs.readFile(recordPath);
  const second = await launch({ root, port, noBrowser: true });
  assert.equal(second.reused, true);
  assert.deepEqual(await fs.readFile(recordPath), firstRecord);
  assert.equal((await launch({ root, action: 'status' })).running, true);
  await assert.rejects(launch({ root, port, noBrowser: true, noObserve: true }), /Observation settings differ/);
  await assert.rejects(launch({ root, port: await freePort(), noBrowser: true }), /another port/);
  assert.equal((await launch({ root, action: 'stop' })).stopped, true);
  assert.equal((await launch({ root, action: 'status' })).running, false);
  assert.equal((await launch({ root, action: 'stop' })).stopped, false);
  // Initialization must preserve active files on subsequent starts.
  await fs.writeFile(join(root, 'config.json'), '{"title":"User configuration"}\n');
  await launch({ root, port, noBrowser: true });
  assert.equal(await fs.readFile(join(root, 'config.json'), 'utf8'), '{"title":"User configuration"}\n');
  await launch({ root, action: 'stop' });

  const foreignPort = await freePort();
  foreign = spawn(process.execPath, ['-e', `require('node:http').createServer((q,s)=>s.end('{}')).listen(${foreignPort},'127.0.0.1')`], { windowsHide: true, stdio: 'ignore' });
  for (let n = 0; n < 30; n++) {
    try { if ((await fetch(`http://127.0.0.1:${foreignPort}/`)).ok) break; } catch {}
    await pause(50);
  }
  await assert.rejects(launch({ root, port: foreignPort, noBrowser: true }), /could not start|did not confirm/);
  assert.equal((await fetch(`http://127.0.0.1:${foreignPort}/`)).status, 200);
  const canonical = await fs.realpath(root);
  await fs.writeFile(recordPath, JSON.stringify({version:2,pid:foreign.pid,port:foreignPort,
    root_fingerprint:createHash('sha256').update(canonical).digest('hex'),instance_id:randomUUID(),script:join(canonical,'board-node.mjs'),observe:true,codex_home:resolve(tmpdir())}));
  await assert.rejects(launch({ root, action: 'stop' }), /ownership was not confirmed/);
  assert.equal((await fetch(`http://127.0.0.1:${foreignPort}/`)).status, 200);
  await fs.unlink(recordPath); // Remove only the forged fixture created above.
  await fs.writeFile(join(root,'.runtime/node-launcher.lock'), 'owned fixture');
  await assert.rejects(launch({root,port,noBrowser:true}), /Another launcher/);
  await fs.unlink(join(root,'.runtime/node-launcher.lock'));
  // An actual new backend must show no sample conversations without an explicit
  // legacy state file; this test disables real Codex observation entirely.
  const emptyRoot = join(root, 'empty real board');
  await fs.mkdir(emptyRoot);
  const packageRoot = fileURLToPath(new URL('../', import.meta.url));
  for (const name of ['board-node.mjs','agent_report.mjs','codex-observer.mjs',
    'config.example.json','state.example.json','web/index.html','web/app.js','web/styles.css','web/plan-handoff.js']) {
    await fs.mkdir(join(emptyRoot, name, '..'), { recursive: true });
    await fs.copyFile(join(packageRoot, name), join(emptyRoot, name));
  }
  const emptyPort = await freePort();
  try {
    await launch({root:emptyRoot,port:emptyPort,noBrowser:true,noObserve:true});
    const empty = await (await fetch(`http://127.0.0.1:${emptyPort}/state.json`)).json();
    assert.deepEqual(empty.projects, []);
    const handoff = await fetch(`http://127.0.0.1:${emptyPort}/plan-handoff.js`);
    assert.equal(handoff.status, 200);
    assert.equal(handoff.headers.get('content-type'), 'text/javascript; charset=utf-8');
    assert.equal(await handoff.text(), await fs.readFile(join(emptyRoot, 'web/plan-handoff.js'), 'utf8'));
    await assert.rejects(fs.access(join(emptyRoot, 'state.json')), { code: 'ENOENT' });
    assert.ok((await fs.stat(join(emptyRoot, 'state.example.json'))).isFile());
  } finally { await launch({root:emptyRoot,action:'stop'}); }
  console.log('PASS: real hidden child start/reuse/status/stop, preserved configuration, occupied port, forged foreign PID/lock refusal, and fresh real backend with zero sample cards; no browser opened.');
} finally {
  await launch({ root, action: 'stop' }).catch(() => {});
  if (foreign) foreign.kill();
  const absolute = resolve(root);
  assert.ok(absolute.startsWith(resolve(tmpdir()) + '\\codex-launcher-test-') || absolute.startsWith(resolve(tmpdir()) + '/codex-launcher-test-'));
  // Windows can retain a just-stopped child's working-directory handle briefly.
  // Retry only this verified, newly-created fixture; persistent leaks still fail.
  await fs.rm(absolute, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
}
