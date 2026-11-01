/** Read-only, bounded public-message view. Never a plan or completion detector.
 * SQLite API verified against official Node v24.22.2 documentation:
 * https://github.com/nodejs/node/blob/v24.22.2/doc/api/sqlite.md
 */
import * as fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {redact,uuid} from './board-node.mjs';
import {readCodexTitles} from './codex-titles.mjs';

export const OBSERVER_LIMITS=Object.freeze({sessions:500,windowBytes:262144,headBytes:131072,tailBytes:131072,cacheHomes:4,maxDepth:20});
// Only an explicitly named native app-created root is admitted. UUIDs are
// bound as JSON data, never interpolated into SQL or treated as SQL fragments.
const ROOT_FILTER="(thread_source = 'user' OR (thread_source = 'agent_created_thread' AND lower(id) IN (SELECT value FROM json_each(?)))) AND (agent_path IS NULL OR agent_path = '') AND attached_thread_parent_id IS NULL";
const COLUMNS='id, title, rollout_path, updated_at, source, thread_source, agent_path, attached_thread_parent_id';
const QUERY=`SELECT ${COLUMNS} FROM threads WHERE ${ROOT_FILTER} ORDER BY updated_at DESC, id LIMIT ?`;
const QUERY_ONE=`SELECT ${COLUMNS} FROM threads WHERE ${ROOT_FILTER} AND id = ? ORDER BY updated_at DESC, id LIMIT ?`;
const COUNTS=`SELECT COUNT(*) AS total, SUM(CASE WHEN ${ROOT_FILTER} THEN 1 ELSE 0 END) AS roots, SUM(CASE WHEN thread_source = 'subagent' OR (agent_path IS NOT NULL AND agent_path <> '') OR attached_thread_parent_id IS NOT NULL THEN 1 ELSE 0 END) AS children FROM threads`;
const caches=new Map();
const sensitive=/(?:password|passwd|api[_ -]?key|authorization|access[_ -]?token|refresh[_ -]?token|secret|cookie|\btoken\b|密碼|密码|暗碼|暗码|帳密|账密|金鑰|密钥|令牌|私鑰|私钥)/i;
// Codex stores Windows rollout paths in extended-length drive form. Remove
// only that spelling prefix; UNC/device namespaces are never reinterpreted.
function ordinaryPath(value){return process.platform==='win32'?value.replace(/^\\\\\?\\([A-Za-z]:\\)/,'$1'):value;}

function diagnostic(){return{available:false,status:'database_missing',discovered:0,scanned:0,returned:0,omitted:0,excluded_subagents:0,excluded_unknown:0,invalid_paths:0,unreadable_rollouts:0,malformed_lines:0,cache_hits:0,bytes_read:0,max_sessions:OBSERVER_LIMITS.sessions,window_bytes:OBSERVER_LIMITS.windowBytes,limited:false};}
function inside(base,target){const rel=path.relative(base,target);return rel!==''&&!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel);}
async function plainFile(base,target){
  if(!inside(base,target))throw Error('untrusted_path');
  const parts=path.relative(base,target).split(path.sep);if(parts.length>OBSERVER_LIMITS.maxDepth)throw Error('untrusted_path');
  let cursor=base,stat;
  for(let i=0;i<parts.length;i++){
    cursor=path.join(cursor,parts[i]);stat=await fs.lstat(cursor);
    if(stat.isSymbolicLink()||(i===parts.length-1?!stat.isFile():!stat.isDirectory()))throw Error('untrusted_path');
  }
  return stat;
}
function stamp(value){
  if(typeof value==='number'&&Number.isFinite(value)){const time=value>1e12?value:value*1000;return Number.isFinite(new Date(time).getTime())?new Date(time).toISOString():null;}
  if(typeof value==='string'&&value.trim()){const numeric=Number(value);if(Number.isFinite(numeric))return stamp(numeric);const time=Date.parse(value);if(Number.isFinite(time))return new Date(time).toISOString();}
  return null;
}
/** Only short sanitized display text survives; never retain raw lines or objects. */
export function publicSummary(value,maximum=280){
  if(typeof value!=='string')return'';
  // Multiline credentials can spill a value onto an unlabelled next line.
  // Drop the entire message instead of attempting to reconstruct its meaning.
  const redacted=redact(value);
  if(/[\r\n]/.test(value)&&(sensitive.test(value)||redacted!==value))return'';
  // Unstructured labels such as "password is ..." have no reliably parsed
  // value boundary. Omit the short message rather than guessing the secret.
  if(sensitive.test(value)&&redacted===value)return'';
  if(/(?:密碼|密码|暗碼|暗码|金鑰|密钥|令牌)\s*[A-Za-z0-9!@#$%^&*_.-]{3,}/.test(value))return'';
  let clean=redacted
    .replace(/<(environment_context|in-app-context|in-app-browser-context|send_user_reply|send_user_message_question_reply)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi,' ')
    .replace(/# Files mentioned by the user:[\s\S]*?(?=## My request:|$)/gi,' ')
    .replace(/<image\b[^>]*(?:\/>|>[\s\S]*?<\/image>)/gi,' ')
    .replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/g,' ')
    .replace(/`[^`]*`/g,' ')
    .split(/\r?\n/).filter(line=>!/(?:[A-Za-z]:[\\/]|\\\\|file:\/\/)/.test(line)).join(' ')
    .replace(/(^|\s)\/(?:Users|home|tmp|private|mnt|etc)\/\S+/g,' ')
    .replace(/## My request:|Image attachment:\s*(?:true|false)/gi,' ')
    .replace(/<[^>]{0,1000}>/g,' ')
    .replace(/[\x00-\x1f\x7f]/g,' ').replace(/\s+/g,' ').trim();
  if(!clean)return'';
  if(clean.length>maximum)clean=clean.slice(0,maximum-1).trimEnd()+'…';
  return clean;
}
function contentText(item,allowed){
  if(!Array.isArray(item.content))return'';
  return item.content.filter(block=>block&&block.type===allowed&&typeof block.text==='string').map(block=>block.text).join('\n');
}
export function extractPublicMessages(lines){
  let firstUser='',lastAssistant='',lastAt=null,malformed=0,recognized=0;
  for(const line of lines){
    if(!line.trim())continue;let record;try{record=JSON.parse(line);}catch{malformed++;continue;}
    // Inspect discriminators BEFORE any content. Reasoning, analysis,
    // response_item assistants and opaque tool inputs are never traversed.
    let kind='',raw='';
    if(record?.type==='response_item'&&record.payload?.type==='message'&&record.payload.role==='user'){
      kind='user';raw=contentText(record.payload,'input_text');
    }else if(record?.type==='event_msg'&&record.payload?.type==='item_completed'){
      const item=record.payload.item;
      if(item?.type==='UserMessage'){kind='user';raw=contentText(item,'text');}
      else if(item?.type==='AgentMessage'&&(item.phase==='commentary'||item.phase==='final')){kind='assistant';raw=contentText(item,'Text');}
    }
    if(!kind)continue;const summary=publicSummary(raw,kind==='user'?260:280);if(!summary)continue;
    recognized++;if(kind==='user'&&!firstUser)firstUser=summary;
    if(kind==='assistant'){lastAssistant=summary;lastAt=stamp(record.timestamp);}
  }
  return{firstUser,lastAssistant,lastAt,malformed,recognized};
}
async function boundedLines(home,filename,headBytes,tailBytes){
  filename=ordinaryPath(filename);
  const file=path.isAbsolute(filename)?path.resolve(filename):path.resolve(home,filename);
  const roots=['sessions','archived_sessions'].map(name=>path.join(home,name));
  const allowed=roots.find(root=>inside(root,file));
  if(!allowed||path.extname(file).toLowerCase()!=='.jsonl')throw Error('untrusted_path');
  const expected=await plainFile(home,file);
  const handle=await fs.open(file,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
  try{
    const stat=await handle.stat(),after=await fs.lstat(file);
    if(!stat.isFile()||after.isSymbolicLink()||stat.ino!==expected.ino||stat.dev!==expected.dev||stat.ino!==after.ino||stat.dev!==after.dev)throw Error('untrusted_path');
    const signature=[stat.size,stat.mtimeMs,stat.ino,stat.dev].join(':');
    return{file,signature,stat,async read(){
      const cap=headBytes+tailBytes,parts=[];let bytes=0;
      const read=async(start,length)=>{const buffer=Buffer.alloc(length);let done=0;while(done<length){const r=await handle.read(buffer,done,length-done,start+done);if(!r.bytesRead)break;done+=r.bytesRead;}bytes+=done;return buffer.subarray(0,done).toString('utf8');};
      if(stat.size<=cap){parts.push(...(await read(0,stat.size)).replace(/^\uFEFF/,'').split('\n'));}
      else{
        const head=await read(0,headBytes),headEnd=head.lastIndexOf('\n');if(headEnd>=0)parts.push(...head.slice(0,headEnd).replace(/^\uFEFF/,'').split('\n'));
        const tail=await read(stat.size-tailBytes,tailBytes),tailStart=tail.indexOf('\n');if(tailStart>=0)parts.push(...tail.slice(tailStart+1).split('\n'));
      }
      return{lines:parts,bytes};
    },close:()=>handle.close()};
  }catch(error){await handle.close();throw error;}
}
export function createCodexObserver(options={},dependencies={}){
  const configuredHome=path.resolve(ordinaryPath(options.codexHome||process.env.CODEX_HOME||path.join(os.homedir(),'.codex')));
  const maxSessions=options.maxSessions??OBSERVER_LIMITS.sessions,headBytes=options.headBytes??OBSERVER_LIMITS.headBytes,tailBytes=options.tailBytes??OBSERVER_LIMITS.tailBytes;
  for(const value of[maxSessions,headBytes,tailBytes])if(!Number.isSafeInteger(value)||value<=0)throw Error('Invalid observer bound');
  if(maxSessions>OBSERVER_LIMITS.sessions||headBytes+tailBytes>OBSERVER_LIMITS.windowBytes)throw Error('Observer capacity exceeded');
  const onlySession=options.sessionId?uuid(options.sessionId):null,cache=new Map(),loadSQLite=dependencies.loadSQLite||(()=>import('node:sqlite'));
  return{async read(){
    const d=diagnostic();d.max_sessions=maxSessions;d.window_bytes=headBytes+tailBytes;const projects=[];let home,db;
    try{const stat=await fs.lstat(configuredHome);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error();home=await fs.realpath(configuredHome);}catch{d.status='codex_home_missing';return{projects,diagnostics:d};}
    let DatabaseSync;try{({DatabaseSync}=await loadSQLite());if(typeof DatabaseSync!=='function')throw Error();}catch{d.status='sqlite_unavailable';return{projects,diagnostics:d};}
    let candidates;try{candidates=(await fs.readdir(home)).filter(name=>/^state_\d+\.sqlite$/.test(name)).sort((a,b)=>{const x=BigInt(a.match(/\d+/)[0]),y=BigInt(b.match(/\d+/)[0]);return x>y?-1:x<y?1:0;});}catch{d.status='database_unreadable';return{projects,diagnostics:d};}
    if(!candidates.length)return{projects,diagnostics:d};const filename=path.join(home,candidates[0]);
    try{await plainFile(home,filename);}catch{d.status='database_untrusted';return{projects,diagnostics:d};}
    const nativeTitles=await readCodexTitles({codexHome:home}),namedIDs=JSON.stringify([...nativeTitles.titles.keys()]);
    let entries;
    try{
      db=new DatabaseSync(filename,{readOnly:true,allowExtension:false,defensive:true,timeout:100});db.exec('PRAGMA query_only = ON');
      const counts=db.prepare(COUNTS).get(namedIDs);d.discovered=Number(counts.roots||0);d.excluded_subagents=Number(counts.children||0);d.excluded_unknown=Math.max(0,Number(counts.total)-d.discovered-d.excluded_subagents);
      const statement=db.prepare(onlySession?QUERY_ONE:QUERY);entries=onlySession?statement.all(namedIDs,onlySession,maxSessions+1):statement.all(namedIDs,maxSessions+1);
      if(onlySession)d.discovered=entries.length;
      d.available=true;d.status=d.discovered>maxSessions?'capacity_exceeded':'ok';d.limited=d.discovered>maxSessions;
    }catch{d.status=db?'schema_unsupported':'database_unreadable';return{projects,diagnostics:d};}
    finally{db?.close();}
    for(const row of entries.slice(0,maxSessions)){
      d.scanned++;let id;try{id=uuid(row.id);}catch{d.excluded_unknown++;continue;}
      if(typeof row.rollout_path!=='string'){d.invalid_paths++;continue;}
      let opened;
      try{
        opened=await boundedLines(home,row.rollout_path,headBytes,tailBytes);let parsed;
        const previous=cache.get(opened.file);
        if(previous?.signature===opened.signature){d.cache_hits++;parsed=previous.parsed;}
        else{const read=await opened.read();d.bytes_read+=read.bytes;parsed=extractPublicMessages(read.lines);cache.set(opened.file,{signature:opened.signature,parsed});if(cache.size>maxSessions)cache.delete(cache.keys().next().value);}
        d.malformed_lines+=parsed.malformed;const title=publicSummary(row.title,120)||publicSummary(parsed.firstUser,120)||'既有對話 · 需求待同步',updated=parsed.lastAt||stamp(row.updated_at)||opened.stat.mtime.toISOString();
        projects.push({id,session_id:id,semantic_version:2,source:'observed_public_messages',title,goal:parsed.firstUser||'需求細節等待此對話同步。',current:parsed.lastAssistant||'尚未讀取到可辨識的公開進度，等待此對話同步。',next:'等待此對話的 Codex 同步明確下一步。',summary:'僅摘要既有公開訊息；任務關卡、驗收成果與子代理分工等待明確同步。',phase:'公開對話摘要 · 尚非驗收狀態',updated_at:updated,sync:{status:'observed',reported_at:updated},groups:[],tasks:[],completed:[],agents:[],events:[],metrics:[],progress:{completed:0,total:0,percent:null,kind:'unavailable'}});
      }catch(error){if(error.message==='untrusted_path')d.invalid_paths++;else d.unreadable_rollouts++;}
      finally{await opened?.close();}
    }
    d.returned=projects.length;d.omitted=Math.max(0,d.discovered-d.returned);return{projects,diagnostics:d};
  }};
}
export async function observeCodex(options={}){
  const key=JSON.stringify([options.codexHome||process.env.CODEX_HOME||path.join(os.homedir(),'.codex'),options.maxSessions,options.headBytes,options.tailBytes,options.sessionId]);
  let observer=caches.get(key);if(!observer){observer=createCodexObserver(options);caches.set(key,observer);if(caches.size>OBSERVER_LIMITS.cacheHomes)caches.delete(caches.keys().next().value);}
  return observer.read();
}
