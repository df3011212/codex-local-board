import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { change, codexHome, inspect, locate, replaceBlock, render } from '../install-agent-guidance.mjs';

const testRoot = await fs.mkdtemp(join(tmpdir(), 'codex-guidance-test-'));
const board = join(testRoot, "board with spaces and ' quote");
await fs.mkdir(board);
await fs.writeFile(join(board, 'agent_report.mjs'), '// synthetic reporter fixture\n');
const node = process.execPath;
try {
  assert.equal(codexHome({ CODEX_HOME: testRoot }), resolve(testRoot));
  const rendered = await render(board, node);
  assert.ok(rendered.includes(process.platform === 'win32' ? "board with spaces and '' quote" : "board with spaces and '\"'\"' quote"));
  assert.ok(!rendered.includes('{{REPORT_COMMAND}}'));
  for (const before of [Buffer.alloc(0), Buffer.from('# Existing\r\n正文\r\n', 'utf8'),
    Buffer.from('# No newline'), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('原文\n')])]) {
    const after = replaceBlock(before, rendered);
    assert.ok(locate(after));
    assert.deepEqual(replaceBlock(after, rendered), after, 'idempotence');
    assert.deepEqual(replaceBlock(after, '', true), before, 'uninstall byte preservation');
    const suffix = Buffer.from('\n# Added later\n新的使用者文字\n');
    assert.deepEqual(replaceBlock(Buffer.concat([after, suffix]), '', true), Buffer.concat([before, suffix]));
  }
  assert.throws(() => replaceBlock(Buffer.from('<!-- codex-local-board:managed:v2 -->'), rendered), /Ambiguous|Incomplete/);
  const home = join(testRoot, 'private codex home');
  await fs.mkdir(home);
  const original = Buffer.from('# Private rules\r\nKeep every existing byte.\r\n');
  await fs.writeFile(join(home, 'AGENTS.md'), original);
  const preview = await change({ root: home, boardRoot: board, node });
  assert.equal(preview.apply, false);
  assert.deepEqual(await fs.readFile(join(home, 'AGENTS.md')), original);
  const applied = await change({ root: home, boardRoot: board, node, apply: true });
  assert.ok(applied.changed);
  assert.deepEqual(await fs.readFile(applied.backup), original);
  assert.equal((await change({ root: home, boardRoot: board, node, apply: true })).changed, false);
  const beforeUninstall = await fs.readFile(join(home, 'AGENTS.md'));
  const removed = await change({ root: home, action: 'uninstall', apply: true });
  assert.deepEqual(await fs.readFile(removed.backup), beforeUninstall);
  assert.deepEqual(await fs.readFile(join(home, 'AGENTS.md')), original);
  const override = Buffer.from('# Effective override\n');
  await fs.writeFile(join(home, 'AGENTS.override.md'), override);
  const over = await change({ root: home, boardRoot: board, node, apply: true });
  assert.equal(over.active_file, 'AGENTS.override.md');
  assert.deepEqual(await fs.readFile(join(home, 'AGENTS.md')), original);
  await change({ root: home, action: 'uninstall', apply: true });
  assert.deepEqual(await fs.readFile(join(home, 'AGENTS.override.md')), override);
  await fs.writeFile(join(home, '.codex-local-board-guidance.lock'), 'fixture');
  await assert.rejects(change({ root: home, boardRoot: board, node, apply: true }), /owns the lock/);
  assert.deepEqual(await fs.readFile(join(home, 'AGENTS.override.md')), override);
  await fs.unlink(join(home, '.codex-local-board-guidance.lock'));
  // Symlink creation can require a Windows privilege. Test when supported.
  const linked = join(testRoot, 'linked home');
  await fs.mkdir(linked);
  let symlinkSupported = true;
  try { await fs.symlink(join(home, 'AGENTS.md'), join(linked, 'AGENTS.override.md')); }
  catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) symlinkSupported = false; else throw error; }
  if (symlinkSupported) await assert.rejects(inspect(linked), /link or non-regular/);
  console.log('PASS: dry run, CODEX_HOME, override precedence, UTF8/BOM/CRLF byte preservation, backup, idempotence, uninstall, lock, path quoting and supported symlink refusal.');
} finally {
  const absolute = resolve(testRoot);
  assert.ok(absolute.startsWith(resolve(tmpdir()) + '\\codex-guidance-test-') || absolute.startsWith(resolve(tmpdir()) + '/codex-guidance-test-'));
  await fs.rm(absolute, { recursive: true, force: true });
}
