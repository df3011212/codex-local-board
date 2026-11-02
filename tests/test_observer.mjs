import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {createCodexObserver,extractPublicMessages,publicSummary,OBSERVER_LIMITS} from '../codex-observer.mjs';

const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444'];
const user=text=>({type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text}]}});
const user2=text=>({type:'event_msg',payload:{type:'item_completed',item:{type:'UserMessage',content:[{type:'text',text}]}}});
const assistant=(text,phase='commentary')=>({type:'event_msg',timestamp:'2026-01-01T12:00:00Z',payload:{type:'item_completed',item:{type:'AgentMessage',phase,content:[{type:'Text',text}]}}});
const encode=values=>values.map(v=>typeof v==='string'?v:JSON.stringify(v)).join('\n')+'\n';
async function fixture(t){
 const parent=await fs.realpath(os.tmpdir()),home=await fs.mkdtemp(path.join(parent,'codex-observer-test-'));assert.equal(path.dirname(home),parent);
 await fs.mkdir(path.join(home,'sessions'));await fs.mkdir(path.join(home,'archived_sessions'));
 const filename=path.join(home,'state_5.sqlite'),db=new DatabaseSync(filename);
 db.exec('CREATE TABLE threads (id TEXT PRIMARY KEY,title TEXT,rollout_path TEXT,updated_at INTEGER,source TEXT,thread_source TEXT,agent_path TEXT,attached_thread_parent_id TEXT)');db.close();
 t.after(async()=>{assert.equal(path.dirname(path.resolve(home)),parent);assert.ok(path.basename(home).startsWith('codex-observer-test-'));await fs.rm(home,{recursive:true,force:true});});
 return{home,filename,async add(id,title,records,{source='user',agentPath=null,parentId=null,archived=false,rolloutPath}={}){
  const file=rolloutPath||path.join(home,archived?'archived_sessions':'sessions',id+'.jsonl');if(!rolloutPath)await fs.writeFile(file,encode(records));
  const handle=new DatabaseSync(filename);handle.prepare('INSERT INTO threads VALUES (?,?,?,?,?,?,?,?)').run(id,title,file,1760000000,'vscode',source,agentPath,parentId);handle.close();return file;
 }};
}
test('strict public shapes only; reasoning, unknown phases and opaque JS never escape or run',()=>{
 globalThis.__observerExecuted=false;
 const lines=encode([
  {type:'response_item',payload:{type:'reasoning',summary:'REASONING_SENTINEL',raw_content:'SECRET_SENTINEL'}},
  user('請製作易讀的報表。'),assistant('分析秘密：ANALYSIS_SENTINEL','analysis'),assistant('未知階段：UNKNOWN_SENTINEL','other'),
  {type:'custom_tool_call',name:'exec',input:'globalThis.__observerExecuted=true; TOOL_SECRET_SENTINEL'},
  {type:'response_item',payload:{type:'message',role:'assistant',content:[{type:'output_text',text:'UNPROVEN_ASSISTANT_SENTINEL'}]}},
  assistant('正在核對輸入欄位。'),user2('請保留原資料。'),assistant('公開交付回報。','final')
 ]).split('\n');
 const result=extractPublicMessages(lines);assert.equal(result.firstUser,'請製作易讀的報表。');assert.equal(result.lastAssistant,'公開交付回報。');assert.equal(globalThis.__observerExecuted,false);assert.ok(!JSON.stringify(result).includes('SENTINEL'));delete globalThis.__observerExecuted;
});
test('multiline credentials are skipped; labels, XML, attachments and fenced code are stripped',()=>{
 assert.equal(publicSummary('帳號：測試\n密碼：\n2468\n請協助登入'), '');
 assert.equal(publicSummary('使用金鑰\nsk-proj-ABCDEFGHIJKLMNOPQRSTUVW'), '');
 assert.ok(!publicSummary('密碼：SECRET_SENTINEL').includes('SECRET_SENTINEL'));
 assert.ok(!publicSummary('密碼SECRET_SENTINEL').includes('SECRET_SENTINEL'));
 assert.equal(publicSummary('password is PASSWORD_SENTINEL'),'');
 assert.equal(publicSummary('API key APIKEY_SENTINEL'),'');
 assert.equal(publicSummary('管理令牌 TOKEN_SENTINEL'),'');
 const clean=publicSummary('<environment_context>ENV_SENTINEL</environment_context>\n請完成摘要。\n```js\nCODE_SENTINEL\n```\nC:\\private\\ATTACHMENT_SENTINEL.png\n<send_user_reply>REPLY_SENTINEL</send_user_reply>');
 assert.equal(clean,'請完成摘要。');assert.equal(publicSummary('<in-app-context>UNTERMINATED_SENTINEL'),'');
 assert.equal(publicSummary('<in-app-browser-context>AMBIENT_SENTINEL</in-app-browser-context>\n請核對結果。'),'請核對結果。');
});
test('multiple explicit user roots and archives, not subagents or unknown sources; no invented milestones',async t=>{
 const f=await fixture(t);await f.add(ids[0],'第一個對話',[user('整理清單。'),assistant('正在核對清單。')]);await f.add(ids[1],'第二個對話',[user2('製作圖表。')],{archived:true});
 await f.add(ids[2],'',[assistant('SUBAGENT_SENTINEL')],{source:'subagent',agentPath:'/root/child'});await f.add(ids[3],'UNKNOWN_SENTINEL',[],{source:'voice_chat'});
 const before=await fs.readFile(f.filename),r=await createCodexObserver({codexHome:f.home}).read();assert.equal(r.projects.length,2);assert.equal(r.diagnostics.excluded_subagents,1);assert.equal(r.diagnostics.excluded_unknown,1);assert.ok(!JSON.stringify(r).includes('SENTINEL'));
 for(const project of r.projects){assert.equal(project.source,'observed_public_messages');assert.equal(project.sync.status,'observed');assert.deepEqual(project.tasks,[]);assert.deepEqual(project.agents,[]);assert.deepEqual(project.completed,[]);assert.equal(project.progress.percent,null);}assert.deepEqual(await fs.readFile(f.filename),before);
});
test('only natively named app-created roots are added, never unnamed or unknown sources or named children',async t=>{
 const f=await fixture(t),child='55555555-5555-4555-8555-555555555555';
 await f.add(ids[0],'原有使用者',[user('原有需求。')]);await f.add(ids[1],'過時資料庫名稱',[user('驗證工具啟用。')],{source:'agent_created_thread'});await f.add(ids[2],'無原生名稱的app',[user('UNNAMED_SENTINEL')],{source:'agent_created_thread'});await f.add(ids[3],'其他來源',[user('UNKNOWN_SENTINEL')],{source:'voice_chat'});await f.add(child,'真的子代理',[user('CHILD_SENTINEL')],{source:'agent_created_thread',parentId:ids[0]});
 const entry=(id,name)=>JSON.stringify({id,thread_name:name,updated_at:'2026-11-02T01:00:00Z'})+'\n';
 const index=path.join(f.home,'session_index.jsonl');await fs.writeFile(index,entry(ids[1],'工具啟用的合成對話')+entry(ids[3],'別的來源也有名字')+entry(child,'子代理也有名字'));
 const observer=createCodexObserver({codexHome:f.home});let r=await observer.read();assert.deepEqual(r.projects.map(p=>p.id),[ids[0],ids[1]]);assert.equal(r.diagnostics.discovered,2);assert.equal(r.diagnostics.excluded_unknown,2);assert.equal(r.diagnostics.excluded_subagents,1);assert.ok(!JSON.stringify(r).includes('SENTINEL'));
 await fs.appendFile(index,entry(ids[2],'已由Codex正式命名'));r=await observer.read();assert.equal(r.projects.length,3);assert.equal(r.diagnostics.excluded_unknown,1);
 await fs.unlink(index);r=await observer.read();assert.equal(r.projects.length,1);assert.equal(r.projects[0].id,ids[0]);
});
test('head/tail are byte bounded, malformed and partial lines ignored, unchanged mtime cached',async t=>{
 const f=await fixture(t);const records=[user('首個需求。')];for(let i=0;i<200;i++)records.push({type:'response_item',payload:{type:'reasoning',raw_content:'REASONING_SENTINEL'+'.'.repeat(2000)}});records.push('{malformed JSON',assistant('最新公開進度。'));
 const file=await f.add(ids[0],'有界對話',records),observer=createCodexObserver({codexHome:f.home,headBytes:4096,tailBytes:4096}),r=await observer.read();assert.equal(r.projects[0].goal,'首個需求。');assert.equal(r.projects[0].current,'最新公開進度。');assert.ok(r.diagnostics.bytes_read<=8192);assert.ok(r.diagnostics.malformed_lines>=1);assert.ok(!JSON.stringify(r).includes('REASONING_SENTINEL'));
 const cached=await observer.read();assert.equal(cached.diagnostics.cache_hits,1);assert.equal(cached.diagnostics.bytes_read,0);
 await fs.appendFile(file,encode([assistant('檔案變更後的新公開進度。')]));const changed=await observer.read();assert.equal(changed.projects[0].current,'檔案變更後的新公開進度。');assert.equal(changed.diagnostics.cache_hits,0);assert.ok(changed.diagnostics.bytes_read<=8192);
});
test('outside paths, symlink escapes and untrusted highest database are rejected',async t=>{
 const f=await fixture(t),outside=path.join(f.home,'private.jsonl');await fs.writeFile(outside,encode([user('OUTSIDE_SENTINEL')]));await f.add(ids[0],'不可信路徑',[],{rolloutPath:outside});
 const r=await createCodexObserver({codexHome:f.home}).read();assert.equal(r.projects.length,0);assert.equal(r.diagnostics.invalid_paths,1);assert.ok(!JSON.stringify(r).includes('OUTSIDE_SENTINEL'));
 try{await fs.symlink(outside,path.join(f.home,'sessions','linked.jsonl'));}catch(error){if(['EPERM','EACCES'].includes(error.code)){t.diagnostic('Windows symlink privilege unavailable; lexical outside-path case still verified');return;}throw error;}
 await f.add(ids[1],'連結逃脫',[],{rolloutPath:path.join(f.home,'sessions','linked.jsonl')});const link=await createCodexObserver({codexHome:f.home}).read();assert.equal(link.projects.length,0);assert.equal(link.diagnostics.invalid_paths,2);
 await fs.symlink(f.filename,path.join(f.home,'state_999.sqlite'));const db=await createCodexObserver({codexHome:f.home}).read();assert.equal(db.diagnostics.status,'database_untrusted');
});
test('highest numeric state only, missing/unavailable SQLite gracefully diagnosed without paths',async t=>{
 const f=await fixture(t);await f.add(ids[0],'舊資料',[user('舊需求。')]);await fs.writeFile(path.join(f.home,'state_12.sqlite'),'not a SQLite file');const r=await createCodexObserver({codexHome:f.home}).read();assert.equal(r.projects.length,0);assert.ok(['schema_unsupported','database_unreadable'].includes(r.diagnostics.status));assert.ok(!JSON.stringify(r).includes(f.home));
 const unavailable=await createCodexObserver({codexHome:f.home},{loadSQLite:async()=>{throw Error('SECRET_SENTINEL');}}).read();assert.equal(unavailable.diagnostics.status,'sqlite_unavailable');assert.ok(!JSON.stringify(unavailable).includes('SENTINEL'));
 const missing=await createCodexObserver({codexHome:path.join(f.home,'missing')}).read();assert.equal(missing.diagnostics.status,'codex_home_missing');
});
test('capacity truncation is explicit, selected root can be probed without other body reads',async t=>{
 const f=await fixture(t);for(let i=0;i<3;i++)await f.add(ids[i],'對話 '+i,[user('公開需求 '+i)]);const bounded=await createCodexObserver({codexHome:f.home,maxSessions:2}).read();assert.equal(bounded.projects.length,2);assert.equal(bounded.diagnostics.status,'capacity_exceeded');assert.equal(bounded.diagnostics.limited,true);assert.equal(bounded.diagnostics.omitted,1);
 const selected=await createCodexObserver({codexHome:f.home,sessionId:ids[1]}).read();assert.equal(selected.projects.length,1);assert.equal(selected.projects[0].id,ids[1]);assert.equal(selected.diagnostics.scanned,1);assert.throws(()=>createCodexObserver({codexHome:f.home,headBytes:OBSERVER_LIMITS.windowBytes,tailBytes:1}));
});
test('Windows extended-length drive path resolves to the same allowed session file',async t=>{
 if(process.platform!=='win32'){t.skip('Windows namespace spelling only');return;}
 const f=await fixture(t),file=await f.add(ids[0],'命名空間對話',[user('保留既有路徑語意。'),assistant('已讀取公開進度。')]);
 const db=new DatabaseSync(f.filename);db.prepare('UPDATE threads SET rollout_path = ? WHERE id = ?').run(path.toNamespacedPath(file),ids[0]);db.close();
 const r=await createCodexObserver({codexHome:f.home}).read();assert.equal(r.projects.length,1);assert.equal(r.projects[0].current,'已讀取公開進度。');assert.equal(r.diagnostics.invalid_paths,0);
});
test('directory junction/symlink under sessions cannot expose an unrelated directory',async t=>{
 const f=await fixture(t),hidden=path.join(f.home,'unrelated'),link=path.join(f.home,'sessions','escape');await fs.mkdir(hidden);await fs.writeFile(path.join(hidden,'outside.jsonl'),encode([user('JUNCTION_SECRET_SENTINEL')]));
 try{await fs.symlink(hidden,link,process.platform==='win32'?'junction':'dir');}catch(error){if(['EPERM','EACCES'].includes(error.code)){t.skip('OS forbids creating a directory link');return;}throw error;}
 await f.add(ids[0],'逃脫測試',[],{rolloutPath:path.join(link,'outside.jsonl')});const r=await createCodexObserver({codexHome:f.home}).read();assert.equal(r.projects.length,0);assert.equal(r.diagnostics.invalid_paths,1);assert.ok(!JSON.stringify(r).includes('JUNCTION_SECRET_SENTINEL'));
});
