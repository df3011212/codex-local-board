import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createBoardServer} from '../board-node.mjs';
import {writeProjectPlan} from '../project-plan.mjs';

const ROUTE = '/architecture-package.json';
const UNKNOWN = '02345999-7890-4abc-8def-1234567890ee';
const ORIGINAL_CODEX = '02345999-7890-4abc-8def-1234567890ef';
const PLAN = {
  title: '可攜架構',
  goal: '核對兩個關卡',
  summary: '由範例整理',
  source: {kind: 'generated', label: '手動整理', references: []},
  nodes: [
    {id: 'phase', parent_id: null, kind: 'phase', title: '階段', status: 'in_progress'},
    {id: 'checked', parent_id: 'phase', kind: 'task', title: '已核對', status: 'passed', evidence: ['驗收紀錄']},
    {id: 'review', parent_id: 'phase', kind: 'task', title: '待核對', status: 'pending', depends_on: ['checked']},
  ],
};
const PACKAGE = {format: 'codex-local-board.plan-package', version: 1, plan: PLAN};
const COMPLETION = {id: 'review', status: 'passed', detail: '第二台也可使用', evidence: ['已取得可查證結果']};

async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'board-architecture-package-')));
  const directory = path.join(root, '.runtime', 'package-fixture');
  const packages = path.join(directory, 'plans.json');
  const codex = path.join(root, 'project-plans.json');
  const index = path.join(root, '.runtime', 'chatgpt-pilot.json');
  const servers = [];
  t.after(async () => {
    await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
    await fs.rm(root, {recursive: true, force: true});
  });
  async function start() {
    const server = await createBoardServer({root, architecturePackageDirectory: directory, observeCodex: false, port: 0});
    servers.push(server);
    return 'http://127.0.0.1:' + server.address().port;
  }
  return {origin: await start(), start, packages, directory, codex, index};
}

function request(origin, method, body, headers = {Origin: origin}, route = ROUTE) {
  return fetch(origin + route, {
    method,
    headers: {'Content-Type': 'application/json', ...headers},
    body: JSON.stringify(body),
  });
}

function read(origin, id, options) {
  return fetch(origin + ROUTE + '?id=' + id, options);
}

async function created(origin, body = PACKAGE) {
  const response = await request(origin, 'POST', body);
  assert.equal(response.status, 200);
  return response.json();
}

function portable(plan) {
  const {title, goal, summary, source, nodes} = plan;
  return {...PACKAGE, plan: {title, goal, summary, source, nodes: nodes.map(({progress, ...node}) => node)}};
}

test('architecture packages can resume on a second board without a ChatGPT index or changes to the original Codex plan', async t => {
  const first = await fixture(t);
  const second = await fixture(t);
  await writeProjectPlan(first.codex, ORIGINAL_CODEX, {...PLAN, title: '原 Codex 架構'});
  const original = await fs.readFile(first.codex);
  assert.equal((await read(first.origin, UNKNOWN)).status, 404);
  await assert.rejects(fs.stat(first.directory), {code: 'ENOENT'});

  const sameStore = await first.start();
  const [imported, concurrent] = await Promise.all([created(first.origin), created(sameStore)]);
  assert.deepEqual(imported, concurrent);
  assert.match(imported.id, /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(imported.id, imported.plan.session_id);
  assert.deepEqual(imported.plan.progress, {completed: 1, total: 2, percent: 50, kind: 'evidenced_leaf_tasks'});
  assert.deepEqual(imported.plan.nodes[2].depends_on, ['checked']);

  const update = {id: imported.id, expected_updated_at: imported.plan.updated_at, task: COMPLETION};
  const writes = await Promise.all([request(first.origin, 'PUT', update), request(sameStore, 'PUT', update)]);
  assert.deepEqual(writes.map(value => value.status).sort(), [200, 409]);
  const current = await writes.find(value => value.ok).json();
  assert.ok(current.plan.updated_at > imported.plan.updated_at);
  assert.equal(current.plan.progress.percent, 100);
  assert.deepEqual(current.plan.nodes[1], imported.plan.nodes[1]);
  assert.deepEqual(current.plan.nodes[2].depends_on, ['checked']);
  assert.deepEqual(current.plan.source, imported.plan.source);

  const beforeRepeat = await fs.readFile(first.packages);
  const equivalentPackage = {...PACKAGE, plan: {...PLAN, nodes: PLAN.nodes.map(node =>
    node.id === 'checked' ? {...node, evidence: [{label: '驗收紀錄'}]} : node)}};
  assert.deepEqual(await created(sameStore, equivalentPackage), current);
  assert.deepEqual(await fs.readFile(first.packages), beforeRepeat);
  assert.deepEqual(await (await read(sameStore, imported.id)).json(), current);
  assert.deepEqual(await fs.readFile(first.codex), original);

  const continued = await created(second.origin, portable(current.plan));
  assert.notEqual(continued.id, imported.id);
  assert.equal(continued.plan.progress.percent, 100);
  assert.equal(continued.plan.nodes[2].detail, COMPLETION.detail);
  const untouched = await created(second.origin);
  assert.equal(untouched.id, imported.id);
  assert.deepEqual({...untouched.plan, updated_at: imported.plan.updated_at}, imported.plan);
  for (const board of [first, second]) {
    await assert.rejects(fs.stat(board.index), {code: 'ENOENT'});
    const state = await (await fetch(board.origin + '/state.json')).json();
    assert.equal(state.projects.length, 0);
  }
});

test('architecture package endpoints reject wrong versions, private identifiers, cross-origin writes and invalid task edits', async t => {
  const {origin, packages} = await fixture(t);
  assert.equal((await request(origin, 'POST', PACKAGE, {})).status, 403);
  assert.equal((await request(origin, 'POST', PACKAGE, {Origin: 'https://elsewhere.invalid'})).status, 403);
  assert.equal((await request(origin, 'POST', PACKAGE, {Origin: origin, 'Content-Type': 'text/plain'})).status, 400);
  assert.equal((await request(origin, 'POST', PACKAGE, {Origin: origin}, ROUTE + '?id=' + UNKNOWN)).status, 400);
  const bad = [
    {...PACKAGE, version: 2},
    {...PACKAGE, format: 'other'},
    {...PACKAGE, thread_id: UNKNOWN},
    {...PACKAGE, plan: {...PLAN, session_id: UNKNOWN}},
    {...PACKAGE, plan: {...PLAN, nodes: PLAN.nodes.map(node => ({...node, progress: {percent: 100}}))}},
    {...PACKAGE, plan: {...PLAN, nodes: PLAN.nodes.map(node => node.id === 'checked' ? {...node, evidence: []} : node)}},
  ];
  for (const candidate of bad) assert.equal((await request(origin, 'POST', candidate)).status, 400);
  await assert.rejects(fs.stat(packages), {code: 'ENOENT'});
  const options = await fetch(origin + ROUTE, {method: 'OPTIONS'});
  assert.equal(options.status, 405);
  assert.equal(options.headers.get('allow'), 'GET, POST, PUT');

  const imported = await created(origin);
  const before = await fs.readFile(packages);
  const body = {id: imported.id, expected_updated_at: imported.plan.updated_at, task: COMPLETION};
  assert.equal((await read(origin, imported.id, {headers: {Origin: 'https://elsewhere.invalid'}})).status, 403);
  assert.equal((await read(origin, imported.id + '&id=' + UNKNOWN)).status, 400);
  assert.equal((await request(origin, 'PUT', body, {Origin: 'https://elsewhere.invalid'})).status, 403);
  assert.equal((await request(origin, 'PUT', {...body, id: UNKNOWN})).status, 404);
  assert.equal((await request(origin, 'PUT', {...body, task: {...COMPLETION, id: 'nonexistent'}})).status, 404);
  assert.equal((await request(origin, 'PUT', {...body, task: {...COMPLETION, id: 'phase'}})).status, 400);
  assert.equal((await request(origin, 'PUT', {...body, task: {...COMPLETION, title: '未允許的編輯'}})).status, 400);
  const noEvidence = await request(origin, 'PUT', {...body, task: {...COMPLETION, evidence: []}});
  assert.equal(noEvidence.status, 400);
  assert.equal((await noEvidence.json()).code, 'COMPLETION_EVIDENCE');
  const response = await read(origin, imported.id);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('cross-origin-resource-policy'), 'same-origin');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.deepEqual(await response.json(), imported);
  assert.deepEqual(await fs.readFile(packages), before);
});
