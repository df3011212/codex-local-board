import * as fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ROOT, argumentsFor, keys, list, lockedJsonUpdate, parseShortJSON, readJSON, redact, text, uuid} from './board-node.mjs';
import {PLAN_LIMITS, presentPlan, readProjectPlans, writeProjectPlan} from './project-plan.mjs';

const REQUEST_BYTES = 16384;
const IMPORT_BYTES = 12 * 1024 * 1024;
const STORE_BYTES = 24 * 1024 * 1024;
const MAX_CARDS = 10000;
const DEFAULT_STORE = path.join(ROOT, '.runtime', 'chatgpt-pilot.json');
const STATUSES = new Set(['not_started', 'in_progress', 'done', 'paused']);
const CHAT_FIELDS = ['id', 'title', 'archived'];
const PROGRESS_FIELDS = ['id', 'status', 'summary', 'next'];
const EMPTY_PROGRESS = {status: 'not_started', summary: '', next: '', updated_at: null};

function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    throw Error('Invalid update timestamp');
  }
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) throw Error('Invalid update timestamp');
  return value;
}

function shortText(value, max) {
  if (typeof value !== 'string') throw Error('Invalid progress text');
  const result = text(value.trim(), max);
  if (result.length > max) throw Error('Progress text exceeds field limit');
  return result;
}

function chatMetadata(value) {
  keys(value, CHAT_FIELDS, CHAT_FIELDS);
  if (typeof value.title !== 'string' || value.title.length > 10000 || typeof value.archived !== 'boolean') {
    throw Error('Invalid ChatGPT conversation metadata');
  }
  const title = redact(value.title.replace(/[\x00-\x1f\x7f]/g, ' ').trim())
    .slice(0, 180).replace(/[\uD800-\uDBFF]$/, '').trim();
  return {id: uuid(value.id), title: title || '未命名 ChatGPT 對話', archived: value.archived};
}

function manualProgress(value) {
  if (!STATUSES.has(value.status)) throw Error('Invalid progress status');
  return {
    id: uuid(value.id),
    status: value.status,
    summary: shortText(value.summary, 1800),
    next: shortText(value.next, 800),
  };
}

function uniqueCards(value, normalize) {
  const seen = new Set();
  return list(value, MAX_CARDS).map(item => {
    const card = normalize(item);
    if (seen.has(card.id)) throw Error('Duplicate ChatGPT conversation ID');
    seen.add(card.id);
    return card;
  });
}

function validateStore(value) {
  keys(value, ['chats', 'progress'], ['chats', 'progress']);
  const required = [...PROGRESS_FIELDS, 'updated_at'];
  return {
    chats: uniqueCards(value.chats, chatMetadata),
    progress: uniqueCards(value.progress, item => {
      keys(item, required, required);
      return {...manualProgress(item), updated_at: timestamp(item.updated_at)};
    }),
  };
}

async function readStore(filename) {
  return validateStore(await readJSON(filename, STORE_BYTES, {chats: [], progress: []}));
}

function updateStore(filename, update) {
  return lockedJsonUpdate(filename, update, {
    timeoutMs: 3500,
    read: readStore,
    validate: validateStore,
    maxBytes: STORE_BYTES,
    tooLarge: 'ChatGPT pilot file exceeds its local size limit',
  });
}

function asCard(chat, progress = EMPTY_PROGRESS) {
  return {...chat, ...progress, url: 'https://chatgpt.com/c/' + chat.id};
}

export async function importChatgptIndex(filename, value) {
  keys(value, ['chats'], ['chats']);
  const chats = uniqueCards(value.chats, chatMetadata);
  // The supplied index is a complete snapshot. Missing chats become invisible, but their manual progress remains.
  const result = await updateStore(filename, current => ({chats, progress: current.progress}));
  return {
    imported: result.chats.length,
    archived: result.chats.filter(chat => chat.archived).length,
    saved_progress: result.progress.length,
  };
}

async function readJSONStream(stream, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream.iterator({destroyOnReturn: false})) {
    size += chunk.length;
    if (size > limit) throw Error('Request is too large');
    chunks.push(chunk);
  }
  return parseShortJSON(new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks)));
}

async function readRequestJSON(req, limit) {
  const type = req.headers['content-type'] ?? '';
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(type)) throw Error('JSON content type is required');
  if (Number(req.headers['content-length']) > limit) throw Error('Request is too large');
  return readJSONStream(req, limit);
}

function expectedTimestamp(value) {
  return value === null ? null : timestamp(value);
}

async function readUpdate(req) {
  const payload = await readRequestJSON(req, REQUEST_BYTES);
  const required = [...PROGRESS_FIELDS, 'expected_updated_at'];
  keys(payload, required, required);
  return {
    fields: manualProgress(payload),
    expected: expectedTimestamp(payload.expected_updated_at),
  };
}

class UpdateConflict extends Error {}
class MissingChat extends Error {}

function errorResponse(status, error, allow) {
  return {status, body: {error}, allow};
}

function requestError(req, localOrigin, resource) {
  if (req.method !== 'GET' && req.method !== 'PUT') {
    return errorResponse(405, '只接受讀取及儲存' + resource + '。', 'GET, PUT');
  }
  const origin = req.headers.origin;
  if ((origin !== undefined && origin !== localOrigin) || req.headers['sec-fetch-site'] === 'cross-site') {
    return errorResponse(403, '請從本機看板開啟' + resource + '。');
  }
  if (req.method === 'PUT' && origin !== localOrigin) {
    return errorResponse(403, '請從本機看板儲存' + resource + '。');
  }
  return null;
}

export async function handleChatgptPilot(req, filename, localOrigin) {
  const error = requestError(req, localOrigin, '卡片');
  if (error) return error;
  if (req.method === 'GET') {
    const store = await readStore(filename);
    const progress = new Map(store.progress.map(item => [item.id, item]));
    return {status: 200, body: {cards: store.chats.map(chat => asCard(chat, progress.get(chat.id)))}};
  }
  let update;
  try {
    update = await readUpdate(req);
  } catch {
    return errorResponse(400, '請檢查手動進度欄位。');
  }

  try {
    const {id} = update.fields;
    const result = await updateStore(filename, current => {
      if (!current.chats.some(chat => chat.id === id)) throw new MissingChat();
      const index = current.progress.findIndex(item => item.id === id);
      const previous = current.progress[index]?.updated_at ?? null;
      if (update.expected !== previous) throw new UpdateConflict();
      const updated_at = new Date(Math.max(Date.now(), previous ? Date.parse(previous) + 1 : 0)).toISOString();
      const progress = {...update.fields, updated_at};
      if (index === -1) current.progress.push(progress);
      else current.progress[index] = progress;
      return current;
    });
    const card = asCard(result.chats.find(chat => chat.id === id), result.progress.find(item => item.id === id));
    return {status: 200, body: {card}};
  } catch (error) {
    if (error instanceof UpdateConflict) return errorResponse(409, '這張卡片已在另一個頁面更新。');
    if (error instanceof MissingChat) return errorResponse(404, '找不到這則已匯入的對話。');
    throw error;
  }
}

const planErrors = new Map([
  ['TEXT', '請檢查必填欄位、字數與格式。'],
  ['FIELDS', '架構資料含有無法辨識的欄位。'],
  ['SOURCE_KIND', '請選擇可辨識的計畫來源。'],
  ['DOCUMENT_REFERENCE', '文件來源至少要有一項可查核的引用。'],
  ['REFERENCE_TARGET', '文件引用要有可查核的檔案路徑或網址。'],
  ['REFERENCE_URL', '證據或引用網址必須是有效的 HTTP 或 HTTPS 網址。'],
  ['NODE_KIND', '請選擇階段、模組或驗收項目。'],
  ['STATUS', '請選擇可辨識的關卡狀態。'],
  ['EMPTY_PLAN', '請至少加入一個驗收項目。'],
  ['LEAF_KIND', '階段和模組下方要有子項，驗收項目不能包含子項。'],
  ['NODE_ID', '架構節點的識別碼不合法。'],
  ['DUPLICATE_NODE', '有重複的架構節點。'],
  ['MISSING_PARENT', '有節點的上層已不存在。'],
  ['MISSING_DEPENDENCY', '有前置依賴已不存在。'],
  ['DUPLICATE_DEPENDENCY', '有重複的前置依賴。'],
  ['CYCLE', '階層或前置依賴形成了循環。'],
  ['DEPTH', '架構不能超過八層。'],
  ['CAPACITY', '架構節點或引用數量超過上限。'],
  ['PAYLOAD_FULL', '架構資料超過大小上限。'],
  ['COMPLETION_EVIDENCE', '請先補上可驗證的證據，再標記完成。'],
]);

function planResponse(plan) {
  return {status: 200, body: {plan: plan ? presentPlan(plan) : null}};
}

async function loadChatPlan(directory, id) {
  // Do not follow a redirected plan directory when serving private files.
  let resolved;
  try {
    resolved = await fs.realpath(directory);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (path.relative(directory, resolved)) throw Error('Unexpected ChatGPT plan storage directory');
  const store = await readProjectPlans(path.join(directory, id + '.json'));
  return store.projects.find(plan => plan.session_id === id);
}

export async function handleChatgptPlan(req, index, directory, localOrigin) {
  const error = requestError(req, localOrigin, '架構');
  if (error) return error;

  let id, expected, plan, useOriginalTitle;
  try {
    if (req.method === 'GET') {
      id = uuid(/^\/chatgpt-plan\.json\?id=([0-9a-f-]+)$/i.exec(req.url)?.[1]);
    } else {
      if (req.url !== '/chatgpt-plan.json') throw Error('Unexpected query');
      const input = await readRequestJSON(req, PLAN_LIMITS.payloadBytes + 1024);
      const fields = ['id', 'expected_updated_at', 'plan'];
      keys(input, [...fields, 'use_original_title'], fields);
      id = uuid(input.id);
      expected = expectedTimestamp(input.expected_updated_at);
      plan = input.plan;
      if (Object.hasOwn(input, 'use_original_title') && typeof input.use_original_title !== 'boolean') {
        throw Error('Invalid original title option');
      }
      useOriginalTitle = input.use_original_title;
    }
  } catch {
    return errorResponse(400, '請檢查架構資料與所選對話。');
  }

  const {chats} = await readStore(index);
  const chat = chats.find(item => item.id === id);
  if (!chat) {
    return errorResponse(404, '找不到這則已匯入的對話。');
  }
  if (req.method === 'GET') return planResponse(await loadChatPlan(directory, id));
  if (useOriginalTitle && expected !== null) {
    return {status: 409, body: {error: '沿用對話名稱只適用於首次建立架構。', code: 'PLAN_CONFLICT'}};
  }
  if (useOriginalTitle && plan && typeof plan === 'object' && !Array.isArray(plan)) {
    plan = {...plan, title: chat.title};
  }

  try {
    const filename = path.join(directory, id + '.json');
    const store = await writeProjectPlan(filename, id, plan, {timeoutMs: 3500, expectedUpdatedAt: expected});
    return planResponse(store.projects.find(item => item.session_id === id));
  } catch (failure) {
    const code = failure.planCode;
    if (code === 'PLAN_CONFLICT') {
      return {status: 409, body: {error: '此架構已更新。請先讀取最新版本再儲存。', code}};
    }
    if (planErrors.has(code)) return {status: 400, body: {error: planErrors.get(code), code}};
    throw failure;
  }
}

async function main(argv) {
  if (argv[0] !== 'import') throw Error('Unknown command');
  const args = argumentsFor(argv.slice(1), ['--file', '--stdin', '--state'], ['--stdin']);
  if (Boolean(args['--file']) === Boolean(args['--stdin'])) throw Error('Choose --file or --stdin');
  const value = args['--stdin']
    ? await readJSONStream(process.stdin, IMPORT_BYTES)
    : await readJSON(path.resolve(args['--file']), IMPORT_BYTES);
  const filename = args['--state'] ? path.resolve(args['--state']) : DEFAULT_STORE;
  console.log(JSON.stringify(await importChatgptIndex(filename, value)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(() => {
    console.error('ChatGPT conversation index import failed. Use import --file PATH or import --stdin, with optional --state PATH.');
    process.exitCode = 1;
    process.stdin.pause();
  });
}
