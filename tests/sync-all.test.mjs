import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {ROOT,readSemantic} from '../board-node.mjs';
import {report} from '../agent_report.mjs';
import {SYNC_LIMITS,SOURCE_EVIDENCE,sanitizePublic,publicMessages,exportConversations,runSync,validateResults,resolveCodex,syncPrompt} from '../sync-all.mjs';

const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',C='33333333-3333-4333-8333-333333333333',D='44444444-4444-4444-8444-444444444444';
const user=text=>({type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text}]}});
const assistant=(text,phase='commentary')=>({type:'event_msg',timestamp:'2026-01-01T12:00:00Z',payload:{type:'item_completed',item:{type:'AgentMessage',phase,content:[{type:'Text',text}]}}});
const base=(title='合成對話')=>({title,goal:'建立易讀的合成資訊頁面',current:'正在核對頁面顯示',next:'完成公開交付檢查'});
async function fixture(t){
 const parent=await fs.realpath(os.tmpdir()),dir=await fs.mkdtemp(path.join(parent,'codex-sync-all-test-'));assert.equal(path.dirname(dir),parent);
 t.after(async()=>{assert.equal(path.dirname(path.resolve(dir)),parent);assert.ok(path.basename(dir).startsWith('codex-sync-all-test-'));await fs.rm(dir,{recursive:true,force:true});});
 const root=path.join(dir,'board'),home=path.join(dir,'codex');await fs.mkdir(root);await fs.mkdir(path.join(home,'sessions'),{recursive:true});
 for(const filename of ['agent_report.mjs','board-node.mjs','codex-titles.mjs','codex-observer.mjs'])await fs.copyFile(path.join(ROOT,filename),path.join(root,filename));
 const database=path.join(home,'state_5.sqlite'),db=new DatabaseSync(database);db.exec('CREATE TABLE threads(id TEXT,title TEXT,rollout_path TEXT,updated_at INTEGER,source TEXT,thread_source TEXT,agent_path TEXT,attached_thread_parent_id TEXT)');db.close();
 const native=[];await fs.writeFile(path.join(home,'session_index.jsonl'),'');
 return{root,home,codexHome:home,database,state:path.join(root,'state-v2.json'),summaries:path.join(root,'conversation-summaries.json'),async add(id,title,values,{source='user',agentPath=null,parentId=null,named=true,rolloutPath}={}){
  const file=rolloutPath||path.join(home,'sessions',id+'.jsonl');if(!rolloutPath)await fs.writeFile(file,values.map(v=>typeof v==='string'?v:JSON.stringify(v)).join('\n')+'\n');
  const db=new DatabaseSync(database);try{db.prepare('INSERT INTO threads VALUES(?,?,?,?,?,?,?,?)').run(id,title,file,1760000000,'cli',source,agentPath,parentId);}finally{db.close();}
  if(named){native.push({id,thread_name:title,updated_at:'2026-01-01T12:00:00Z'});await fs.writeFile(path.join(home,'session_index.jsonl'),native.map(v=>JSON.stringify(v)).join('\n')+'\n');}return file;
 }};
}
function cli(args){return new Promise((resolve,reject)=>{const p=spawn(process.execPath,[path.join(ROOT,'sync-all.mjs'),...args],{windowsHide:true,stdio:['ignore','pipe','pipe']});let out='',err='';p.stdout.on('data',v=>out+=v);p.stderr.on('data',v=>err+=v);p.once('error',reject);p.once('close',code=>resolve({code,out,err}));});}
async function mock(f,mode='complete'){
 const file=path.join(f.root,`mock-${mode}.mjs`);
 const code=`import * as fs from 'node:fs/promises';import path from 'node:path';import {pathToFileURL} from 'node:url';
 let prompt='';for await(const b of process.stdin)prompt+=b;
 const run=process.cwd(),root=path.resolve(run,'../../..');
 await fs.writeFile(path.join(run,'protocol.json'),JSON.stringify({args:process.argv.slice(2),prompt,threadCleared:!process.env.CODEX_THREAD_ID,parentCleared:!process.env.CODEX_LOCAL_BOARD_PARENT_ID,agentCleared:!process.env.CODEX_LOCAL_BOARD_AGENT_ID}));
 if(${JSON.stringify(mode)}==='timeout'){setInterval(()=>{},1000);}else{
 const input=JSON.parse(await fs.readFile(path.join(run,'public-context.private.json'),'utf8'));
 const {report}=await import(pathToFileURL(path.join(root,'agent_report.mjs')));
 for(const target of (${JSON.stringify(mode)}==='incomplete'?input.conversations.slice(0,1):input.conversations))await report({statePath:path.join(run,'staged-summaries.json'),sessionId:target.id,payload:{title:target.title.slice(0,100),goal:'合成需求',current:'已整理公開回報',next:'等待原工作確認',summary:'公開對話整理，本輪未重測',completed:[{title:'已回報的交付',evidence:['${SOURCE_EVIDENCE}']}],agents:[{id:'main',role:'原對話主代理',assignment:'完成原需求',current:'已回報結果',next:'等待後續確認',status:'pending'}]}});
 console.log(JSON.stringify({type:'synthetic-opaque-event',private_data:'PRIVATE_EVENT_SENTINEL'}));}
 `;
 await fs.writeFile(file,code);return file;
}

test('sanitizer and explicit public shapes omit reasoning, tools, secrets, paths and ambient data',()=>{
 assert.equal(sanitizePublic('TokenEconomizer 啟用驗證'),'TokenEconomizer 啟用驗證');
 for(const text of ['password is SECRET_SENTINEL','密碼：\nSECRET_SENTINEL','API key APIKEY_SENTINEL','請協助登入\n12345678','sk-proj-ABCDEFGHIJKLMNOPQRSTUVW'])assert.equal(sanitizePublic(text),'');
 const clean=sanitizePublic('<in-app-browser-context>AMBIENT_SENTINEL</in-app-browser-context>\n請檢查頁面。\n```\nCODE_SENTINEL\n```\nC:\\private\\PATH_SENTINEL\n/home/private/PATH_SENTINEL\n');assert.equal(clean,'請檢查頁面。');
 globalThis.__syncExecuted=false;
 const result=publicMessages([
  user('原始公開需求'),assistant('完成舊版','final'),user('最新需求尚未完成'),assistant('正在處理最新需求','final_answer'),
  {type:'response_item',payload:{type:'reasoning',summary:'REASONING_SENTINEL',raw_content:'SECRET_SENTINEL'}},
  {type:'event_msg',payload:{type:'item_completed',item:{type:'AgentMessage',phase:'analysis',content:[{type:'Text',text:'ANALYSIS_SENTINEL'}]}}},
  {type:'custom_tool_call',name:'exec',input:'globalThis.__syncExecuted=true; TOOL_SENTINEL'},
  {type:'response_item',payload:{type:'message',role:'assistant',phase:'other',content:[{type:'output_text',text:'UNKNOWN_SENTINEL'}]}},
  {type:'response_item',payload:{type:'message',role:'assistant',phase:'final',content:[{type:'output_text',text:'明確公開最終回覆'}]}},
  'broken JSON'
 ].map(v=>typeof v==='string'?v:JSON.stringify(v)));
 assert.equal(result.messages.length,5);assert.equal(result.malformed,1);assert.ok(!JSON.stringify(result).includes('SENTINEL'));assert.equal(globalThis.__syncExecuted,false);delete globalThis.__syncExecuted;
});

test('export uses only named roots, skips complete direct reports, and leaves original bytes intact',async t=>{
 const f=await fixture(t),file=await f.add(A,'原生名稱甲',[user('請建立頁面'),assistant('正在檢查功能')]);
 await f.add(B,'原生名稱乙',[user('第二個需求')],{source:'agent_created_thread'});await f.add(C,'已直接同步',[user('直接資料')]);await f.add(D,'真正子代理',[user('不可混入')],{source:'subagent',agentPath:'child',parentId:A});
 await report({statePath:f.state,sessionId:C,payload:base()});const before=await fs.readFile(f.state),db=await fs.readFile(f.database),raw=await fs.readFile(file);
 const result=await exportConversations(f);assert.deepEqual(result.conversations.map(v=>v.id),[A,B]);assert.equal(result.conversations[0].title,'原生名稱甲');assert.equal(result.diagnostics.skipped_direct,1);
 assert.deepEqual(await fs.readFile(f.state),before);assert.deepEqual(await fs.readFile(f.database),db);assert.deepEqual(await fs.readFile(file),raw);assert.ok(!JSON.stringify(result).includes(f.home));
});

test('bounded head and tail retain latest unresolved request; context and total payload stay limited',async t=>{
 const f=await fixture(t);const file=await f.add(A,'大型對話',[user('原始公開目標'),assistant('已完成較早版本','final')]);
 await fs.appendFile(file,JSON.stringify({type:'response_item',payload:{type:'reasoning',raw_content:'REASONING_SENTINEL'.repeat(200000)}})+'\n');await fs.appendFile(file,[user('最新使用者要求仍需處理'),assistant('公開狀態說明。'.repeat(3000))].map(v=>JSON.stringify(v)).join('\n')+'\n');
 const result=await exportConversations(f),body=JSON.stringify(result),chat=JSON.stringify(result.conversations[0]);assert.ok(Buffer.byteLength(chat)<=SYNC_LIMITS.chatBytes);assert.ok(Buffer.byteLength(body)+1<=SYNC_LIMITS.payloadBytes);assert.equal(result.diagnostics.bytes_read,SYNC_LIMITS.headBytes+SYNC_LIMITS.tailBytes);assert.ok(body.includes('原始公開目標'));assert.ok(body.includes('最新使用者要求仍需處理'));assert.ok(!body.includes('REASONING_SENTINEL'));
 const prompt=syncPrompt({input:'input.json',stage:'stage.json',reporter:'agent_report.mjs',node:'node',targets:[A]});assert.match(prompt,/最後一筆使用者新要求/);assert.match(prompt,/不得改state-v2.json/);assert.match(prompt,/原對話公開回報，本輪未重測/);
});

test('dry-run and export CLI never start a model or create direct/summary state',async t=>{
 const f=await fixture(t);await f.add(A,'合成需求',[user('請建立報表')]);
 const dry=await runSync({...f,dryRun:true},{invoke:()=>{throw Error('must not start');}});assert.equal(dry.model_started,false);assert.equal(dry.targets,1);await assert.rejects(()=>fs.stat(path.join(f.root,'.runtime')),{code:'ENOENT'});
 const output=path.join(f.root,'exports','public.json'),result=await cli(['export','--root',f.root,'--codex-home',f.home,'--output',output]);assert.equal(result.code,0,result.err);assert.equal(JSON.parse(result.out).model_started,false);assert.ok((await fs.stat(output)).size<=SYNC_LIMITS.payloadBytes);assert.equal(JSON.parse(await fs.readFile(output,'utf8')).conversations.length,1);
 for(const file of[f.state,f.summaries])await assert.rejects(()=>fs.stat(file),{code:'ENOENT'});
});

test('real mock CLI protocol stages all targets, merges atomically and preserves direct/other summaries',async t=>{
 const f=await fixture(t);await f.add(A,'合成甲',[user('甲需求')]);await f.add(B,'合成乙',[user('乙需求')]);await report({statePath:f.state,sessionId:C,payload:base('直接工作')});await report({statePath:f.summaries,sessionId:D,payload:base('既有其他摘要')});const direct=await fs.readFile(f.state),prior=(await readSemantic(f.summaries)).projects[0];
 const executable=await mock(f);const result=await runSync({...f,codexBin:executable,timeoutSeconds:10});assert.equal(result.status,'synced');assert.equal(result.targets,2);assert.equal(result.total_summaries,3);assert.deepEqual(await fs.readFile(f.state),direct);
 const merged=await readSemantic(f.summaries);assert.deepEqual(merged.projects.find(p=>p.id===D),prior);assert.deepEqual(new Set(merged.projects.map(p=>p.id)),new Set([A,B,D]));
 const run=path.join(f.root,'.runtime','sync-runs',result.run_id),protocol=JSON.parse(await fs.readFile(path.join(run,'protocol.json'),'utf8'));assert.equal(protocol.threadCleared,true);assert.equal(protocol.parentCleared,true);assert.equal(protocol.agentCleared,true);assert.ok(protocol.args.includes('--sandbox'));assert.ok(protocol.args.includes('workspace-write'));assert.ok(protocol.args.includes('--add-dir'));assert.ok(!protocol.args.some(v=>v==='--model'||v==='-m'||v.includes('bypass')));assert.equal(protocol.args.at(-1),'-');assert.ok(!JSON.stringify(result).includes('PRIVATE_EVENT_SENTINEL'));assert.ok((await fs.stat(path.join(run,'codex-events.private.jsonl'))).size>0);await assert.rejects(()=>fs.stat(path.join(f.root,'.runtime','sync-all.lock')),{code:'ENOENT'});
});

test('invalid or incomplete staged results keep existing summaries unchanged',async t=>{
 const f=await fixture(t);await f.add(A,'合成甲',[user('需求甲')]);await f.add(B,'合成乙',[user('需求乙')]);await report({statePath:f.summaries,sessionId:D,payload:base('原有摘要')});const before=await fs.readFile(f.summaries);
 const executable=await mock(f,'incomplete');await assert.rejects(()=>runSync({...f,codexBin:executable,timeoutSeconds:10}),e=>e.publicCode==='INVALID_RESULT');assert.deepEqual(await fs.readFile(f.summaries),before);
 const state=await readSemantic(f.summaries);assert.throws(()=>validateResults(state,[A]),e=>e.publicCode==='INVALID_RESULT');await assert.rejects(()=>runSync({...f,state:f.summaries,summaries:f.summaries}),e=>e.publicCode==='INVALID_OPTIONS');
});

test('unsafe rollout path is not read, missing executable fails safely, and complete direct work skips a model',async t=>{
 const f=await fixture(t),outside=path.join(path.dirname(f.root),'outside.jsonl');await fs.writeFile(outside,JSON.stringify(user('OUTSIDE_SENTINEL'))+'\n');await f.add(A,'有界來源',[],{rolloutPath:outside});const data=await exportConversations(f);assert.equal(data.diagnostics.unreadable,1);assert.equal(data.conversations[0].messages.length,0);assert.ok(!JSON.stringify(data).includes('OUTSIDE_SENTINEL'));
 await assert.rejects(()=>resolveCodex(path.join(f.root,'missing.exe'),{}),e=>e.publicCode==='NO_CODEX');await report({statePath:f.state,sessionId:A,payload:base()});const result=await runSync(f,{invoke:()=>{throw Error('must not start');}});assert.equal(result.status,'up_to_date');assert.equal(result.model_started,false);
});

test('50-conversation and 512KiB bounds are explicit without losing the latest request',async t=>{
 const f=await fixture(t),text='公開需求的細節與驗收條件。'.repeat(1500);for(let i=0;i<51;i++)await f.add(randomUUID(),`合成對話${i}`,[user(text),assistant('較早工作已回報','final'),user('最新要求還在等待驗收。'+text),assistant('正在處理最新要求。'+text)]);
 const result=await exportConversations(f);assert.equal(result.conversations.length,50);assert.equal(result.diagnostics.omitted_capacity,1);assert.ok(Buffer.byteLength(JSON.stringify(result))+1<=SYNC_LIMITS.payloadBytes);for(const c of result.conversations){assert.ok(Buffer.byteLength(JSON.stringify(c))<=SYNC_LIMITS.chatBytes);assert.ok(c.messages.some(m=>m.role==='user'&&m.text.startsWith('最新要求')));}
});

test('timeout and active lock never replace summaries or start duplicate models',async t=>{
 const f=await fixture(t);await f.add(A,'逾時合成',[user('請整理公開摘要')]);await report({statePath:f.summaries,sessionId:D,payload:base('保留摘要')});const before=await fs.readFile(f.summaries),executable=await mock(f,'timeout');
 await assert.rejects(()=>runSync({...f,codexBin:executable,timeoutSeconds:1}),e=>e.publicCode==='SYNC_TIMEOUT');assert.deepEqual(await fs.readFile(f.summaries),before);await assert.rejects(()=>fs.stat(path.join(f.root,'.runtime','sync-all.lock')),{code:'ENOENT'});
 const lock=path.join(f.root,'.runtime','sync-all.lock');await fs.writeFile(lock,JSON.stringify({pid:process.pid,run_id:'active-owner'}));let invoked=false;await assert.rejects(()=>runSync(f,{invoke:()=>{invoked=true;}}),e=>e.publicCode==='SYNC_BUSY');assert.equal(invoked,false);assert.equal(JSON.parse(await fs.readFile(lock,'utf8')).run_id,'active-owner');
});

test('completed summary evidence must disclose that original public claims were not retested',async t=>{
 const f=await fixture(t);await report({statePath:f.summaries,sessionId:A,payload:{...base(),completed:[{title:'交付回報',evidence:['不夠明確的證據']}],agents:[{id:'main',role:'原對話主代理',assignment:'工作',current:'狀態',next:'下一步',status:'pending'}]}});
 const staged=await readSemantic(f.summaries);assert.throws(()=>validateResults(staged,[A]),e=>e.publicCode==='INVALID_RESULT');staged.projects[0].completed[0].evidence[0].label=SOURCE_EVIDENCE;assert.equal(validateResults(staged,[A]).projects.length,1);
});

test('Windows case aliases reject direct/summary identity before creating output or invoking a model',async t=>{
 const f=await fixture(t),direct=path.join(f.root,'live.json'),alias=path.join(f.root,'LIVE.json');await f.add(A,'同檔護欄',[user('不應覆寫直接回報')]);await report({statePath:direct,sessionId:A,payload:base()});
 const before=await fs.readFile(direct),stat=await fs.stat(direct);let invoked=false;const invoke=()=>{invoked=true;throw Error('must not run');};
 if(process.platform==='win32'){
  await assert.rejects(()=>runSync({...f,state:direct,summaries:alias},{invoke}),e=>e.publicCode==='INVALID_OPTIONS');
  const missing=path.join(f.root,'not-created','live.json'),missingAlias=path.join(f.root,'NOT-CREATED','LIVE.json');await assert.rejects(()=>runSync({...f,state:missing,summaries:missingAlias},{invoke}),e=>e.publicCode==='INVALID_OPTIONS');await assert.rejects(()=>fs.stat(path.dirname(missing)),{code:'ENOENT'});
  await assert.rejects(()=>runSync({...f,root:f.home,codexHome:f.home.toUpperCase(),dryRun:true},{invoke}),e=>e.publicCode==='UNTRUSTED_PATH');
 }else{const preview=await runSync({...f,state:direct,summaries:alias,dryRun:true},{invoke});assert.equal(preview.status,'preview');}
 assert.equal(invoked,false);assert.deepEqual(await fs.readFile(direct),before);const after=await fs.stat(direct);assert.equal(after.mtimeMs,stat.mtimeMs);assert.equal(after.ino,stat.ino);await assert.rejects(()=>fs.stat(path.join(f.root,'.runtime')),{code:'ENOENT'});
});

test('export refuses direct and summary store targets including Windows case aliases',async t=>{
 const f=await fixture(t);await f.add(A,'匯出目標護欄',[user('只匯出新檔案')]);await report({statePath:f.state,sessionId:A,payload:base()});const before=await fs.readFile(f.state),stat=await fs.stat(f.state);
 const targets=[f.state,f.summaries];if(process.platform==='win32')targets.push(path.join(f.root,'STATE-V2.JSON'),path.join(f.root,'CONVERSATION-SUMMARIES.JSON'));
 for(const output of targets){const result=await cli(['export','--root',f.root,'--codex-home',f.home,'--output',output]);assert.notEqual(result.code,0);assert.equal(JSON.parse(result.err).code,'INVALID_OPTIONS');}
 assert.deepEqual(await fs.readFile(f.state),before);assert.equal((await fs.stat(f.state)).mtimeMs,stat.mtimeMs);await assert.rejects(()=>fs.stat(f.summaries),{code:'ENOENT'});
});
