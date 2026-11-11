import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {request as httpRequest} from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createBoardServer} from '../board-node.mjs';
import {report} from '../agent_report.mjs';
import {importChatgptIndex} from '../chatgpt-pilot.mjs';

const ROUTE = '/chatgpt-pilot.json';
const CHAT = {id: '02345999-7890-4abc-8def-1234567890ab', title: '試做對話', archived: false};
const ARCHIVED_CHAT = {id: '02345999-7890-4abc-8def-1234567890ac', title: '封存對話', archived: true};
const DRAFT = {
  id: CHAT.id,
  status: 'in_progress',
  summary: '首次手動摘要',
  next: '核對原需求',
  expected_updated_at: null,
};

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'board-chatgpt-pilot-'));
  const pilot = path.join(root, '.runtime', 'chatgpt-pilot.json');
  const options = {root, chatgptPilotState: pilot, port: 0, observeCodex: false};
  const servers = [];
  const start = async () => {
    const server = await createBoardServer(options);
    servers.push(server);
    return 'http://127.0.0.1:' + server.address().port;
  };
  t.after(async () => {
    await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
    await fs.rm(root, {recursive: true, force: true});
  });
  return {root, pilot, start, origin: await start()};
}

async function write(origin, body = DRAFT, headers = {Origin: origin}) {
  return fetch(origin + ROUTE, {
    method: 'PUT',
    headers: {'Content-Type': 'application/json', ...headers},
    body: JSON.stringify(body),
  });
}

async function readCards(origin) {
  const response = await fetch(origin + ROUTE);
  assert.equal(response.status, 200);
  return (await response.json()).cards;
}

test('imports a complete ChatGPT index and preserves manual progress by original ID on re-import', async t => {
  const {root, pilot, origin, start} = await fixture(t);
  const statePath = path.join(root, 'state-v2.json');
  await report({
    statePath,
    sessionId: '02345999-7890-4abc-8def-1234567890af',
    payload: {title: 'Codex fixture', goal: 'Codex progress', current: 'Coding', next: 'Review'},
  });
  const codexBefore = await fs.readFile(statePath);
  const empty = await fetch(origin + ROUTE);
  assert.equal(empty.status, 200);
  assert.equal(empty.headers.get('cache-control'), 'no-store');
  assert.equal(empty.headers.get('cross-origin-resource-policy'), 'same-origin');
  assert.equal(empty.headers.get('access-control-allow-origin'), null);
  assert.deepEqual(await empty.json(), {cards: []});
  await assert.rejects(fs.stat(pilot), {code: 'ENOENT'});

  const imported = await importChatgptIndex(pilot, {chats: [CHAT, ARCHIVED_CHAT]});
  assert.deepEqual(imported, {imported: 2, archived: 1, saved_progress: 0});
  const cards = await readCards(origin);
  assert.deepEqual(cards.map(({id, title, archived}) => ({id, title, archived})), [CHAT, ARCHIVED_CHAT]);
  assert.equal(cards[0].url, 'https://chatgpt.com/c/' + CHAT.id);
  assert.equal(cards[1].updated_at, null);
  assert.equal(cards[1].status, 'not_started');
  const created = await write(origin);
  assert.equal(created.status, 200);
  const {card: first} = await created.json();
  assert.equal(first.summary, DRAFT.summary);
  assert.match(first.updated_at, /^\d{4}-\d{2}-\d{2}T/);

  await importChatgptIndex(pilot, {chats: [ARCHIVED_CHAT]});
  assert.deepEqual((await readCards(origin)).map(card => card.id), [ARCHIVED_CHAT.id]);
  assert.equal((await write(origin, {...DRAFT, expected_updated_at: first.updated_at})).status, 404);
  const returned = {...CHAT, title: '對話更新名稱', archived: true};
  await importChatgptIndex(pilot, {chats: [returned, ARCHIVED_CHAT]});
  const otherOrigin = await start();
  assert.deepEqual((await readCards(otherOrigin))[0], {...first, ...returned});

  const saves = await Promise.all([
    write(origin, {...DRAFT, status: 'done', expected_updated_at: first.updated_at}),
    write(otherOrigin, {...DRAFT, status: 'paused', expected_updated_at: first.updated_at}),
  ]);
  assert.deepEqual(saves.map(value => value.status).sort(), [200, 409]);
  const {card: current} = await saves.find(value => value.status === 200).json();
  assert.ok(current.updated_at > first.updated_at);
  assert.deepEqual((await readCards(otherOrigin))[0], current);
  assert.deepEqual(await fs.readFile(statePath), codexBefore);
  const codexResponse = await fetch(origin + '/state.json');
  assert.equal(codexResponse.status, 200);
  const codexState = await codexResponse.json();
  assert.equal(codexState.projects.length, 1);
  assert.equal(codexState.projects[0].title, 'Codex fixture');
  assert.equal(JSON.stringify(codexState).includes(current.url), false);
});

test('pilot rejects cross-origin writes and accepts progress fields only', async t => {
  const {origin, pilot} = await fixture(t);
  await importChatgptIndex(pilot, {chats: [CHAT]});
  const before = await fs.readFile(pilot);
  assert.equal((await write(origin, DRAFT, {})).status, 403);
  assert.equal((await write(origin, DRAFT, {Origin: 'https://example.test'})).status, 403);
  assert.equal((await fetch(origin + ROUTE, {headers: {Origin: 'https://example.test'}})).status, 403);
  assert.equal((await write(origin, DRAFT, {Origin: origin, 'Content-Type': 'text/plain'})).status, 400);
  const preflight = await fetch(origin + ROUTE, {method: 'OPTIONS'});
  assert.equal(preflight.status, 405);
  assert.equal(preflight.headers.get('allow'), 'GET, PUT');
  assert.equal((await fetch(origin + '/state.json', {method: 'PUT'})).status, 405);
  assert.equal((await fetch(origin + ROUTE + '?other')).status, 404);
  for (const overrides of [
    {url: 'https://chatgpt.com/share/synthetic'},
    {title: '不能由 HTTP 寫入'},
    {next: '字'.repeat(801)},
    {status: 'passed'},
    {id: 'not-a-uuid'},
    {expected_updated_at: 'today'},
    {raw_transcript: 'not accepted'},
    {summary: 'x'.repeat(17000)},
  ]) {
    assert.equal((await write(origin, {...DRAFT, ...overrides})).status, 400, Object.keys(overrides)[0]);
  }
  assert.equal((await write(origin, {...DRAFT, id: ARCHIVED_CHAT.id})).status, 404);
  await assert.rejects(() => importChatgptIndex(pilot, {chats: [CHAT, {...CHAT, title: '重複對話'}]}), /Duplicate/);
  assert.deepEqual(await fs.readFile(pilot), before);
});

test('a chunked oversize payload is rejected without writing a card', async t => {
  const {origin, pilot} = await fixture(t);
  const status = await new Promise((resolve, reject) => {
    const req = httpRequest(origin + ROUTE, {
      method: 'PUT',
      headers: {Origin: origin, 'Content-Type': 'application/json'},
    }, res => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.write('x'.repeat(10000));
    req.end('x'.repeat(10000));
  });
  assert.equal(status, 400);
  await assert.rejects(fs.stat(pilot), {code: 'ENOENT'});
});

test('stdin import emits only counts, validates IDs and strips source title control characters', async t => {
  const {origin, pilot} = await fixture(t);
  const script = fileURLToPath(new URL('../chatgpt-pilot.mjs', import.meta.url));
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, 'import', '--stdin', '--state', pilot], {windowsHide: true});
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => resolve({code, stdout, stderr}));
    child.stdin.end(JSON.stringify({chats: [{...CHAT, title: '原對話\n標題' + '字'.repeat(200)}]}));
  });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {imported: 1, archived: 0, saved_progress: 0});
  assert.equal(result.stderr, '');
  const [card] = await readCards(origin);
  assert.ok(card.title.startsWith('原對話 標題'));
  assert.equal(card.title.length, 180);
});
