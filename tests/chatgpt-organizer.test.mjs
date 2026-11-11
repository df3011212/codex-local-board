import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createBoardServer} from '../board-node.mjs';
import {report} from '../agent_report.mjs';
import {importChatgptIndex} from '../chatgpt-pilot.mjs';
import {writeProjectPlan} from '../project-plan.mjs';

const ROUTE = '/chatgpt-organizer.json';
const id = suffix => '02345999-7890-4abc-8def-1234567890' + suffix;
const SOURCE = {id: id('01'), title: 'ChatGPT 原對話', archived: false};
const OTHER_SOURCE = {id: id('02'), title: '另一則 ChatGPT 原對話', archived: true};
const REPORTED = id('03');
const OBSERVED = id('04');
const SUMMARY = id('05');
const LEGACY = id('06');
const WORK = id('07');
const OTHER_WORK = id('08');
const UNKNOWN = id('09');
const TIME = '2026-10-30T01:02:03.004Z';

function observation(id, title) {
  return {id, session_id: id, semantic_version: 2, source: 'observed_public_messages',
    sync: {status: 'observed'}, title, goal: '', current: '', updated_at: TIME};
}

async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'board-chatgpt-organizer-')));
  const registry = path.join(root, '.runtime', 'fixture-organizers.json');
  const index = path.join(root, '.runtime', 'chatgpt-pilot.json');
  const state = path.join(root, 'state-v2.json');
  const summaryState = path.join(root, 'conversation-summaries.json');
  const planState = path.join(root, 'project-plans.json');
  const legacyState = path.join(root, 'state.json');
  const names = path.join(root, 'session_index.jsonl');
  const servers = [];
  const executionCalls = [];
  t.after(async () => {
    await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
    await fs.rm(root, {recursive: true, force: true});
  });
  const payload = title => ({title, goal: '保存資料', current: '核對需求', next: '繼續'});
  await importChatgptIndex(index, {chats: [SOURCE, OTHER_SOURCE]});
  await report({statePath: state, sessionId: REPORTED, payload: payload('整理對話的工作回報')});
  await report({statePath: state, sessionId: WORK, payload: payload('實作工作回報')});
  await report({statePath: summaryState, sessionId: SUMMARY, payload: payload('整理對話的候補摘要')});
  const projects = [{id: LEGACY.toUpperCase(), title: '整理對話的舊候補', groups: [], tasks: [], agents: [], events: []}];
  await fs.writeFile(legacyState, JSON.stringify({schema_version: 1, projects}));
  await fs.writeFile(names, [REPORTED, OBSERVED, WORK].map(thread =>
    JSON.stringify({id: thread, thread_name: '原生名稱 ' + thread.slice(-2), updated_at: TIME})).join('\n'));
  await writeProjectPlan(planState, REPORTED, {
    title: '整理對話原有規劃',
    goal: '此原始資料不可變更',
    source: {kind: 'generated', label: '測試資料', references: []},
    nodes: [{id: 'check', parent_id: null, title: '驗收', kind: 'task', status: 'pending'}],
  });

  async function start() {
    const server = await createBoardServer({root, state, summaryState, planState, legacyState,
      chatgptPilotState: index, chatgptOrganizerState: registry, codexHome: root, port: 0,
      observationProvider: () => ({
        projects: [observation(OBSERVED, '整理對話的觀察'), observation(OTHER_WORK, '一般工作觀察')],
        diagnostics: {available: true, status: 'ok', returned: 2},
      }),
      executionProvider: ({sessionIds}) => {
        executionCalls.push(sessionIds);
        return {diagnostics: {available: true}, sessions: new Map([[WORK, {
          status: 'running', source: 'codex_agent_view', updated_at: TIME,
        }]])};
      },
    });
    servers.push(server);
    return 'http://127.0.0.1:' + server.address().port;
  }
  return {origin: await start(), start, registry, index, state, summaryState, planState, legacyState, names, executionCalls};
}

function register(origin, thread, source = SOURCE.id, headers = {Origin: origin}, extras = {}) {
  return fetch(origin + ROUTE, {
    method: 'PUT',
    headers: {'Content-Type': 'application/json', ...headers},
    body: JSON.stringify({id: source, codex_thread_id: thread, ...extras}),
  });
}

async function view(origin) {
  const response = await fetch(origin + '/state.json');
  assert.equal(response.status, 200);
  return response.json();
}

test('registered organizers are absent from reported, observed, named, summary and legacy Codex rows', async t => {
  const f = await fixture(t);
  const sourceFiles = [f.index, f.state, f.summaryState, f.planState, f.legacyState, f.names];
  const before = await Promise.all(sourceFiles.map(filename => fs.readFile(filename)));
  const initial = await view(f.origin);
  assert.equal(initial.projects.length, 6);
  assert.equal(initial.conversation_titles.accepted, 3);
  assert.equal(initial.summary_sync.sessions, 1);
  assert.equal(initial.plan_sync.sessions, 1);
  assert.equal(initial.observation.returned, 2);
  await assert.rejects(fs.stat(f.registry), {code: 'ENOENT'});

  for (const thread of [REPORTED, OBSERVED, SUMMARY, LEGACY]) {
    const saved = await register(f.origin, thread);
    assert.equal(saved.status, 200);
    assert.equal(saved.headers.get('cache-control'), 'no-store');
    assert.equal(saved.headers.get('cross-origin-resource-policy'), 'same-origin');
    assert.deepEqual(await saved.json(), {registered: true});
  }

  const otherInstance = await f.start();
  const filtered = await view(otherInstance);
  assert.deepEqual(filtered.projects.map(p => p.id).sort(), [WORK, OTHER_WORK].sort());
  assert.equal(filtered.projects.find(p => p.id === WORK).execution.status, 'running');
  assert.deepEqual(f.executionCalls.at(-1).sort(), [WORK, OTHER_WORK].sort());
  assert.equal(filtered.conversation_titles.accepted, 1);
  assert.equal(filtered.summary_sync.sessions, 0);
  assert.equal(filtered.plan_sync.sessions, 0);
  assert.equal(filtered.observation.returned, 1);
  for (const hidden of [SOURCE.id, REPORTED, OBSERVED, SUMMARY, LEGACY]) {
    assert.equal(JSON.stringify(filtered).toLowerCase().includes(hidden), false);
  }
  assert.deepEqual(await Promise.all(sourceFiles.map(filename => fs.readFile(filename))), before);
  const {cards} = await (await fetch(f.origin + '/chatgpt-pilot.json')).json();
  assert.deepEqual(cards.map(card => card.id), [SOURCE.id, OTHER_SOURCE.id]);

  const registryBefore = await fs.readFile(f.registry);
  assert.equal(JSON.parse(registryBefore).registrations.length, 4);
  assert.equal((await register(f.origin, REPORTED)).status, 200);
  assert.equal((await register(f.origin, REPORTED, OTHER_SOURCE.id)).status, 409);
  assert.deepEqual(await fs.readFile(f.registry), registryBefore);

  await fs.writeFile(f.registry, '{corrupt');
  assert.deepEqual((await view(otherInstance)).projects.map(p => p.id).sort(), [WORK, OTHER_WORK].sort());
  assert.equal((await register(otherInstance, REPORTED)).status, 503);
  assert.equal(await fs.readFile(f.registry, 'utf8'), '{corrupt');
});

test('organizer registration accepts only a same-origin PUT with two distinct UUIDs and a known ChatGPT source', async t => {
  const {origin, registry} = await fixture(t);
  const get = await fetch(origin + ROUTE);
  assert.equal(get.status, 405);
  assert.equal(get.headers.get('allow'), 'PUT');
  assert.equal((await register(origin, REPORTED, SOURCE.id, {})).status, 403);
  assert.equal((await register(origin, REPORTED, SOURCE.id, {Origin: 'https://elsewhere.invalid'})).status, 403);
  assert.equal((await register(origin, REPORTED, SOURCE.id, {Origin: origin, 'Content-Type': 'text/plain'})).status, 400);
  assert.equal((await register(origin, REPORTED, UNKNOWN)).status, 404);
  assert.equal((await register(origin, SOURCE.id)).status, 400);
  assert.equal((await register(origin, 'invented')).status, 400);
  assert.equal((await register(origin, REPORTED, SOURCE.id, {Origin: origin}, {title: '資料不可寫入'})).status, 400);
  assert.equal((await fetch(origin + ROUTE + '?id=' + SOURCE.id)).status, 404);
  await assert.rejects(fs.stat(registry), {code: 'ENOENT'});
  assert.equal((await view(origin)).projects.length, 6);
});
