import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createBoardServer} from '../board-node.mjs';
import {report} from '../agent_report.mjs';
import {importChatgptIndex} from '../chatgpt-pilot.mjs';
import {writeProjectPlan} from '../project-plan.mjs';

const ROUTE = '/chatgpt-plan.json';
const CHAT = {id: '02345999-7890-4abc-8def-1234567890bc', title: 'ChatGPT 對話', archived: false};
const ARCHIVED = {id: '02345999-7890-4abc-8def-1234567890bd', title: '封存對話', archived: true};
const UNKNOWN = '02345999-7890-4abc-8def-1234567890bf';
const PLAN = {
  title: 'ChatGPT 對話架構',
  goal: '確認兩個實際關卡',
  summary: '',
  source: {kind: 'generated', label: '使用者手動建立', references: []},
  nodes: [
    {id: 'phase', parent_id: null, title: '第一階段', kind: 'phase', status: 'in_progress'},
    {id: 'module', parent_id: 'phase', title: '第一模組', kind: 'module', status: 'pending'},
    {id: 'checked', parent_id: 'module', title: '已查核', kind: 'task', status: 'passed', evidence: ['原始驗收紀錄']},
    {id: 'pending', parent_id: 'module', title: '未查核', kind: 'task', status: 'pending', depends_on: ['checked']},
  ],
};

async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'board-chatgpt-plan-')));
  const index = path.join(root, '.runtime', 'chatgpt-pilot.json');
  const planDir = path.join(root, '.runtime', 'chatgpt-plans');
  const codexState = path.join(root, 'state-v2.json');
  const codexPlans = path.join(root, 'project-plans.json');
  const servers = [];
  t.after(async () => {
    await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
    await fs.rm(root, {recursive: true, force: true});
  });
  async function start() {
    const server = await createBoardServer({root, port: 0, observeCodex: false, chatgptPlanDirectory: planDir});
    servers.push(server);
    return 'http://127.0.0.1:' + server.address().port;
  }
  await importChatgptIndex(index, {chats: [CHAT, ARCHIVED]});
  return {origin: await start(), start, index, planDir, codexState, codexPlans};
}

function read(origin, id = CHAT.id, options) {
  return fetch(origin + ROUTE + '?id=' + id, options);
}

function save(origin, options = {}, headers = {Origin: origin}) {
  return fetch(origin + ROUTE, {
    method: 'PUT',
    headers: {'Content-Type': 'application/json', ...headers},
    body: JSON.stringify({id: CHAT.id, expected_updated_at: null, plan: PLAN, ...options}),
  });
}

test('ChatGPT plans have separate per-chat storage and preserve the Codex plan for the same ID', async t => {
  const {origin, start, index, planDir, codexState, codexPlans} = await fixture(t);
  await report({
    statePath: codexState,
    sessionId: CHAT.id,
    payload: {title: 'Codex fixture', goal: '獨立的 Codex 對話', current: '處理中', next: '驗證'},
  });
  await writeProjectPlan(codexPlans, CHAT.id, {...PLAN, title: '原 Codex 架構'});
  const indexBefore = await fs.readFile(index);
  const codexBefore = await fs.readFile(codexPlans);
  const empty = await read(origin);
  assert.equal(empty.status, 200);
  assert.equal(empty.headers.get('cache-control'), 'no-store');
  assert.equal(empty.headers.get('cross-origin-resource-policy'), 'same-origin');
  assert.deepEqual(await empty.json(), {plan: null});
  assert.deepEqual(await (await read(origin, ARCHIVED.id)).json(), {plan: null});
  await assert.rejects(fs.stat(planDir), {code: 'ENOENT'});

  const another = await start();
  const [first, second, archiveResponse] = await Promise.all([
    save(origin),
    save(another),
    save(another, {id: ARCHIVED.id, plan: {...PLAN, title: '封存對話自己的架構'}}),
  ]);
  const creates = [first, second];
  assert.deepEqual(creates.map(response => response.status).sort(), [200, 409]);
  assert.equal(archiveResponse.status, 200);
  const {plan: archived} = await archiveResponse.json();
  assert.equal(archived.session_id, ARCHIVED.id);
  assert.equal(archived.title, '封存對話自己的架構');
  const {plan: created} = await creates.find(response => response.ok).json();
  assert.equal(created.session_id, CHAT.id);
  assert.deepEqual(created.progress, {completed: 1, total: 2, percent: 50, kind: 'evidenced_leaf_tasks'});
  assert.deepEqual(created.nodes[0].progress, created.progress);
  assert.deepEqual(created.nodes[3].depends_on, ['checked']);
  assert.deepEqual(await (await read(another, ARCHIVED.id)).json(), {plan: archived});

  const updated = await save(another, {expected_updated_at: created.updated_at, plan: {...PLAN, title: '已更新架構'}});
  assert.equal(updated.status, 200);
  const {plan: current} = await updated.json();
  assert.ok(current.updated_at > created.updated_at);
  const stale = await save(origin, {expected_updated_at: created.updated_at});
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).code, 'PLAN_CONFLICT');
  assert.deepEqual(await (await read(origin)).json(), {plan: current});
  assert.deepEqual(await (await read(origin, ARCHIVED.id)).json(), {plan: archived});

  assert.deepEqual(await fs.readFile(index), indexBefore);
  assert.deepEqual(await fs.readFile(codexPlans), codexBefore);
  const codex = await (await fetch(origin + '/state.json')).json();
  assert.equal(codex.projects[0].plan.title, '原 Codex 架構');
  assert.equal(codex.projects.some(project => project.plan?.title === current.title), false);

  await importChatgptIndex(index, {chats: [ARCHIVED]});
  assert.equal((await read(origin)).status, 404);
  await importChatgptIndex(index, {chats: [CHAT, ARCHIVED]});
  assert.deepEqual(await (await read(origin)).json(), {plan: current});
});

test('ChatGPT plan API requires a known ID, same-origin JSON, and evidence for completed tasks', async t => {
  const {origin, planDir} = await fixture(t);
  assert.equal((await read(origin, UNKNOWN)).status, 404);
  assert.equal((await read(origin, CHAT.id + '&id=' + CHAT.id)).status, 400);
  assert.equal((await read(origin, CHAT.id, {headers: {Origin: 'https://example.test'}})).status, 403);
  assert.equal((await save(origin, {}, {})).status, 403);
  assert.equal((await save(origin, {}, {Origin: 'https://example.test'})).status, 403);
  assert.equal((await save(origin, {}, {Origin: origin, 'Content-Type': 'text/plain'})).status, 400);
  assert.equal((await save(origin, {id: UNKNOWN})).status, 404);
  assert.equal((await save(origin, {expected_updated_at: 'unparseable'})).status, 400);
  const denied = await save(origin, {
    plan: {...PLAN, nodes: PLAN.nodes.map(node => node.id === 'checked' ? {...node, evidence: []} : node)},
  });
  assert.equal(denied.status, 400);
  assert.equal((await denied.json()).code, 'COMPLETION_EVIDENCE');
  assert.equal((await save(origin, {plan: {...PLAN, progress: {percent: 100}}})).status, 400);
  assert.equal((await save(origin, {plan: {...PLAN, summary: 'x'.repeat(530000)}})).status, 400);
  assert.deepEqual(await (await read(origin)).json(), {plan: null});
  await assert.rejects(fs.stat(planDir), {code: 'ENOENT'});
});

test('automatic creation uses the imported ChatGPT title and preserves existing plans', async t => {
  const {origin} = await fixture(t);
  assert.equal((await save(origin, {use_original_title: 'true'})).status, 400);
  const response = await save(origin, {use_original_title: true, plan: {...PLAN, title: '建立對話本機看板架構'}});
  assert.equal(response.status, 200);
  const {plan: created} = await response.json();
  assert.equal(created.title, CHAT.title);
  assert.deepEqual(await (await read(origin)).json(), {plan: created});

  const autoAgain = await save(origin, {use_original_title: true});
  assert.equal(autoAgain.status, 409);
  assert.equal((await autoAgain.json()).code, 'PLAN_CONFLICT');
  const autoEdit = await save(origin, {use_original_title: true, expected_updated_at: created.updated_at});
  assert.equal(autoEdit.status, 409);
  assert.deepEqual(await (await read(origin)).json(), {plan: created});

  const manual = await save(origin, {expected_updated_at: created.updated_at, plan: {...PLAN, title: '手動調整名稱'}});
  assert.equal(manual.status, 200);
  assert.equal((await manual.json()).plan.title, '手動調整名稱');
});
