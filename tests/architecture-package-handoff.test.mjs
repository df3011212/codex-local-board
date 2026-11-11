import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {normalizeProjectPlan} from '../project-plan.mjs';

const require = createRequire(import.meta.url);
const {buildArchitecturePackage, buildArchitecturePackageCodexLink} = require('../web/plan-handoff.js');
const originalId = '00000000-0000-4000-8000-000000000001';
const packageId = '00000000-0000-8000-8000-000000000002';
const origin = 'http://127.0.0.1:8787';
const planVersion = '2026-11-11T00:00:00.000Z';

test('a downloaded architecture preserves work scope and evidence without requiring the source machine', () => {
  const workspacePath = 'C:\\Projects\\來源專案';
  const plan = {
    session_id: originalId,
    updated_at: planVersion,
    title: '合成跨機架構',
    goal: '交接兩個驗收項目',
    summary: '已檢查第一項。',
    progress: {percent: 50},
    source: {
      kind: 'document', label: '原始計畫',
      references: [
        {label: '來源機檔案', path: workspacePath + '\\design.md'},
        {label: '原對話', url: 'https://chatgpt.com/c/' + originalId},
        {label: '公開規格', url: 'https://example.test/spec?token=private#intro'},
      ],
    },
    nodes: [
      {id: 'build', parent_id: null, kind: 'phase', title: '開發', status: 'pending'},
      {id: 'first', parent_id: 'build', kind: 'task', title: '驗收資料', status: 'passed',
        detail: '樣本對照通過。', evidence: [{label: '樣本一致', path: workspacePath + '\\output.txt'}], progress: {percent: 100}},
      {id: 'next', parent_id: 'build', kind: 'task', title: '驗收入口', status: 'pending',
        detail: '使用新資料載入入口。', evidence: [{label: '既有可攜參考', path: 'docs/guide.md'}], depends_on: ['first']},
    ],
  };
  const exported = buildArchitecturePackage(plan);
  assert.equal(exported.format, 'codex-local-board.plan-package');
  assert.equal(exported.version, 1);
  const serialized = JSON.stringify(exported);
  assert.doesNotMatch(serialized, /session_id|updated_at|"progress"|token=|chatgpt\.com|來源專案/);
  assert.ok(!serialized.includes(originalId));
  const normalized = normalizeProjectPlan({...exported.plan, session_id: packageId, updated_at: planVersion});
  assert.equal(normalized.title, plan.title);
  assert.deepEqual(normalized.source.references, [{label: '公開規格', url: 'https://example.test/spec'}]);
  assert.deepEqual(normalized.nodes[1].evidence, [{label: '樣本一致'}]);
  assert.deepEqual(normalized.nodes[2].depends_on, ['first']);
  assert.equal(normalized.nodes[2].evidence[0].path, 'docs/guide.md');

  const localOnly = buildArchitecturePackage({...plan, source: {...plan.source, references: plan.source.references.slice(0, 2)}});
  assert.match(localOnly.plan.source.label, /原架構依文件整理/);
  assert.doesNotThrow(() => normalizeProjectPlan({...localOnly.plan, session_id: packageId, updated_at: planVersion}));
});

test('the recipient opens the specified workspace and selected package task independently of ChatGPT', () => {
  const workspacePath = 'D:\\接手專案 & 工作區';
  const args = {origin, packageId, workspacePath, taskId: 'next', planVersion};
  const handoff = new URL(buildArchitecturePackageCodexLink(args));
  assert.equal(handoff.protocol, 'codex:');
  assert.equal(handoff.hostname, 'new');
  assert.equal(handoff.searchParams.get('path'), workspacePath);
  const prompt = handoff.searchParams.get('prompt');
  assert.ok(prompt.includes('GET ' + origin + '/architecture-package.json?id=' + packageId));
  assert.ok(prompt.includes(JSON.stringify({id: packageId, workspacePath, taskId: 'next', planVersion})));
  assert.ok(prompt.includes('PUT ' + origin + '/architecture-package.json'));
  assert.match(prompt, /expected_updated_at: planVersion/);
  assert.doesNotMatch(prompt, /chatgpt-plan\.json|read_thread/);
  assert.ok(!prompt.includes(originalId));
  for (const invalid of [{origin: 'https://example.test'}, {packageId: originalId}, {workspacePath: './work'}, {taskId: ''}, {planVersion: 'today'}]) {
    assert.throws(() => buildArchitecturePackageCodexLink({...args, ...invalid}));
  }
});
