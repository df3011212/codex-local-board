import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {report} from '../agent_report.mjs';
import {ROOT,LIMITS,SOURCE,redact,readSemantic,mergedState,emptyState,emptyProject,createBoardServer,validateSemanticState,lockedUpdate} from '../board-node.mjs';

const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',C='33333333-3333-4333-8333-333333333333';
const base=(title='明確需求')=>({title,goal:'達成這個聊天室的實際需求',current:'正在驗證已完成的程式',next:'整理驗證結果'});
async function fixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'codex-board-node-test-'));assert.equal(path.dirname(dir),await fs.realpath(os.tmpdir()));assert.ok(path.basename(dir).startsWith('codex-board-node-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return {dir,state:path.join(dir,'state-v2.json'),legacy:path.join(dir,'state.json')};}
async function cli(args,input,env={},script=path.join(ROOT,'agent_report.mjs')){return new Promise((resolve,reject)=>{const p=spawn(process.execPath,[script,...args],{env:{...process.env,...env},stdio:['pipe','pipe','pipe'],windowsHide:true});let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.on('error',reject);p.on('close',code=>resolve({code,out,err}));p.stdin.end(input??'');});}
async function wire(port,target,{method='GET',host=`127.0.0.1:${port}`}={}){return new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port,path:target,method,headers:{Host:host,Connection:'close'}},res=>{let body='';res.on('data',b=>body+=b);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body}));});req.on('error',reject);req.end();});}

test('separate true UUID conversations never overwrite one another; completion is evidenced',async t=>{
 const f=await fixture(t);await report({statePath:f.state,sessionId:A,payload:{...base('聊天室甲'),groups:[{id:'delivery',title:'交付'}],tasks:[{id:'code',title:'備妥程式',group:'delivery',status:'source_ready'},{id:'test',title:'測試',group:'delivery',status:'passed',evidence:[{label:'已通過測試',path:'test-results.json'}]}]}});
 await report({statePath:f.state,sessionId:B,payload:base('聊天室乙')});const before=await fs.readFile(f.state,'utf8');
 await assert.rejects(()=>report({statePath:f.state,sessionId:'made-up-id',payload:base()}));
 await assert.rejects(()=>report({statePath:f.state,sessionId:A,payload:{...base(),groups:[{id:'x',title:'交付'}],tasks:[{id:'bad',title:'沒有證據',group:'x',status:'done'}]}}));
 assert.equal(await fs.readFile(f.state,'utf8'),before);const view=await mergedState(f.state);
 assert.equal(view.projects.length,2);assert.equal(view.projects.find(p=>p.id===A).title,'聊天室甲');
 assert.deepEqual(view.projects.find(p=>p.id===A).progress,{completed:1,total:2,percent:50,kind:'explicit_milestones'});
 assert.equal(view.projects.find(p=>p.id===B).progress.percent,null);
});

test('child-first placeholder and parent/agent ownership never rewrite the parent plan',async t=>{
 const f=await fixture(t);await report({statePath:f.state,sessionId:B,parentSessionId:A,agentId:'backend',role:'後端協作者',payload:{status:'in_progress',assignment:'完成搜尋介面',current:'驗證名稱搜尋'}});
 let s=await readSemantic(f.state);assert.equal(s.projects[0].sync.status,'waiting');assert.equal(s.projects[0].tasks.length,0);assert.equal(s.projects[0].agents[0].session_id,B);
 await report({statePath:f.state,sessionId:A,payload:{...base('真主對話'),agents:[{id:'ui',role:'介面協作者',assignment:'整理表單',status:'pending'}]}});
 s=await readSemantic(f.state);const before=structuredClone(s.projects[0]);
 await report({statePath:f.state,sessionId:B,parentSessionId:A,agentId:'backend',role:'後端協作者',payload:{status:'passed',current:'測試已通過',evidence:['實際測試報告']}});
 s=await readSemantic(f.state);const after=s.projects[0];for(const key of ['title','goal','current','next','summary','phase','tasks','completed','metrics','events','sync','updated_at'])assert.deepEqual(after[key],before[key],key);
 assert.equal(after.agents.length,2);assert.equal(after.agents.find(a=>a.id==='backend').status,'passed');
 const bytes=await fs.readFile(f.state,'utf8');await assert.rejects(()=>report({statePath:f.state,sessionId:C,parentSessionId:A,agentId:'backend',role:'別的協作者',payload:{status:'in_progress',current:'錯誤覆寫'}}));
 await assert.rejects(()=>report({statePath:f.state,sessionId:B,parentSessionId:A,agentId:'backend',role:'後端',payload:{status:'in_progress',goal:'不能覆寫父目標'}}));assert.equal(await fs.readFile(f.state,'utf8'),bytes);
 await report({statePath:f.state,sessionId:A,parentSessionId:A,agentId:'shared-env-child',role:'已明確指派的協作者',payload:{status:'in_progress'}});s=await readSemantic(f.state);assert.equal(s.projects[0].agents.find(a=>a.id==='shared-env-child').session_id,null);
});

test('concurrent real CLI writers retain all sessions and all child assignments',async t=>{
 const f=await fixture(t);const writers=Array.from({length:8},(_,i)=>({id:randomUUID(),title:`聊天室${i}`}));
 const results=await Promise.all(writers.map(v=>cli(['--state',f.state,'--json-stdin'],JSON.stringify(base(v.title)),{CODEX_THREAD_ID:v.id,CODEX_LOCAL_BOARD_PARENT_ID:'',CODEX_LOCAL_BOARD_AGENT_ID:''})));
 assert.ok(results.every(r=>r.code===0),JSON.stringify(results));let state=await readSemantic(f.state);assert.equal(state.projects.length,8);assert.equal(new Set(state.projects.map(p=>p.id)).size,8);
 const children=await Promise.all(Array.from({length:8},(_,i)=>cli(['--state',f.state,'--json-stdin','--session-id',randomUUID(),'--parent-session-id',writers[0].id,'--agent-id',`child-${i}`,'--role',`實際分工${i}`],JSON.stringify({status:'in_progress',current:`工作${i}`}))));
 assert.ok(children.every(r=>r.code===0),JSON.stringify(children));state=await readSemantic(f.state);assert.equal(state.projects.find(p=>p.id===writers[0].id).agents.length,8);
 assert.equal((await fs.readdir(f.dir)).filter(name=>name.endsWith('.node.lock')||name.endsWith('.recovery')||name.endsWith('.tmp')).length,0);
});

test('dead-owner lock recovery is serialized, while active owner timeout preserves bytes',async t=>{
 const f=await fixture(t);await report({statePath:f.state,sessionId:A,payload:base()});const lock=path.join(f.dir,'.state-v2.json.node.lock');
 await fs.writeFile(lock,JSON.stringify({pid:2147483647,nonce:randomUUID()}));
 const values=await Promise.all(Array.from({length:4},(_,i)=>cli(['--state',f.state,'--json-stdin','--session-id',randomUUID()],JSON.stringify(base(`復原${i}`)))));assert.ok(values.every(v=>v.code===0),JSON.stringify(values));
 assert.equal((await readSemantic(f.state)).projects.length,5);
 const bytes=await fs.readFile(f.state,'utf8');const owner=JSON.stringify({pid:process.pid,nonce:randomUUID()});await fs.writeFile(lock,owner);
 await assert.rejects(()=>lockedUpdate(f.state,()=>{throw Error('must not run');},{timeoutMs:30}),/writer busy/);
 assert.equal(await fs.readFile(f.state,'utf8'),bytes);assert.equal(await fs.readFile(lock,'utf8'),owner);await fs.unlink(lock);
});

const observation=(id,title='既有公開對話')=>({...emptyProject(id),title,goal:'已提出的公開需求',current:'最新公開進度：密碼=不應保存',next:'等待 Codex 明確同步下一步。',source:'observed_public_messages',updated_at:'2026-11-02T01:00:00Z',sync:{status:'observed',reported_at:'2026-11-02T01:00:00Z'}});
test('read-only observations have no inferred progress, and semantic reports take priority by UUID',async t=>{
 const f=await fixture(t);await report({statePath:f.state,sessionId:A,payload:base('明確回報優先')});const before=await fs.readFile(f.state,'utf8');
 const merged=await mergedState(f.state,undefined,{projects:[observation(A,'不能覆蓋明確回報'),observation(B)],diagnostics:{available:true,status:'ok',returned:2,omitted:7,path:'C:\\private\\sessions',error:'leaked123'}});
 assert.equal(merged.projects.length,2);assert.equal(merged.projects.find(p=>p.id===A).title,'明確回報優先');const old=merged.projects.find(p=>p.id===B);
 assert.equal(old.source,'observed_public_messages');assert.equal(old.sync.status,'observed');assert.equal(old.progress.percent,null);for(const name of ['tasks','groups','completed','agents','events','metrics'])assert.deepEqual(old[name],[]);
 assert.ok(!old.current.includes('不應保存'));assert.equal(merged.observation.omitted,7);assert.ok(!JSON.stringify(merged.observation).includes('private'));assert.ok(!Object.hasOwn(merged.observation,'error'));assert.equal(await fs.readFile(f.state,'utf8'),before);
 await assert.rejects(()=>mergedState(f.state,undefined,{projects:[{...observation(B),tasks:[{id:'invented'}]}]}),/must not infer/);
});
test('observer provider is bounded, optional and fails independently of real checkpoint state',async t=>{
 const f=await fixture(t);await report({statePath:f.state,sessionId:A,payload:base()});let calls=0,mode='ok';const provider=async options=>{calls++;assert.equal(options.maxSessions,500);assert.equal(options.headBytes+options.tailBytes,262144);assert.equal(options.codexHome,f.dir);if(mode==='throw')throw Error('private path');if(mode==='invalid')return {projects:[{...observation(B),source:'reasoning'}],diagnostics:{}};return {projects:[observation(B)],diagnostics:{available:true,status:'ok'}};};
 const server=await createBoardServer({root:f.dir,state:f.state,legacyState:f.legacy,port:0,codexHome:f.dir,observationProvider:provider});t.after(()=>new Promise(resolve=>server.close(resolve)));let view=JSON.parse((await wire(server.address().port,'/state.json')).body);assert.equal(view.projects.length,2);assert.equal(calls,1);
 for(mode of ['throw','invalid']){const response=await wire(server.address().port,'/state.json');assert.equal(response.status,200);view=JSON.parse(response.body);assert.equal(view.projects.length,1);assert.equal(view.observation.status,'unavailable');assert.ok(!response.body.includes('private path'));}
 const disabled=await createBoardServer({root:f.dir,state:f.state,legacyState:f.legacy,port:0,codexHome:f.dir,observeCodex:false,observationProvider:()=>{throw Error('disabled provider was called');}});t.after(()=>new Promise(resolve=>disabled.close(resolve)));view=JSON.parse((await wire(disabled.address().port,'/state.json')).body);assert.equal(view.projects.length,1);assert.equal(view.observation.status,'disabled');
});
test('real read-only SQLite observer is dynamically integrated with HTTP and leaves source bytes intact',async t=>{
 let DatabaseSync;try{({DatabaseSync}=await import('node:sqlite'));}catch{t.skip('Optional node:sqlite is unavailable on this runtime');return;}
 const f=await fixture(t),home=path.join(f.dir,'codex-home');await fs.mkdir(path.join(home,'sessions'),{recursive:true});const file=path.join(home,'sessions','root.jsonl');
 const lines=[{type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'請完成活動頁面更新'}]}},{type:'response_item',payload:{type:'reasoning',summary:[{text:'private-analysis-never-display'}]}},{type:'event_msg',timestamp:'2026-11-02T01:00:00Z',payload:{type:'item_completed',item:{type:'AgentMessage',phase:'commentary',content:[{type:'Text',text:'正在確認活動資料與頁面顯示。'}]}}}];await fs.writeFile(file,lines.map(v=>JSON.stringify(v)).join('\n')+'\n');
 const database=path.join(home,'state_5.sqlite'),db=new DatabaseSync(database);try{db.exec('CREATE TABLE threads(id TEXT,title TEXT,rollout_path TEXT,updated_at INTEGER,source TEXT,thread_source TEXT,agent_path TEXT,attached_thread_parent_id TEXT)');const insert=db.prepare('INSERT INTO threads VALUES(?,?,?,?,?,?,?,?)');insert.run(B,'活動頁面',file,1793570400,'cli','user',null,null);insert.run(C,'子代理必須排除',file,1793570400,'cli','subagent','child',B);}finally{db.close();}
 const beforeDB=await fs.readFile(database),beforeFile=await fs.readFile(file);await report({statePath:f.state,sessionId:A,payload:base('明確回報主對話')});const server=await createBoardServer({root:f.dir,state:f.state,legacyState:f.legacy,port:0,codexHome:home});t.after(()=>new Promise(resolve=>server.close(resolve)));
 let response=await wire(server.address().port,'/state.json');assert.equal(response.status,200);let data=JSON.parse(response.body);assert.equal(data.projects.length,2);const old=data.projects.find(p=>p.id===B);assert.equal(old.goal,'請完成活動頁面更新');assert.equal(old.current,'正在確認活動資料與頁面顯示。');assert.equal(old.sync.status,'observed');assert.equal(old.progress.percent,null);assert.equal(data.observation.excluded_subagents,1);assert.ok(!response.body.includes('private-analysis'));assert.ok(!data.projects.some(p=>p.id===C));
 await report({statePath:f.state,sessionId:B,payload:base('此對話已明確同步')});response=await wire(server.address().port,'/state.json');data=JSON.parse(response.body);assert.equal(data.projects.length,2);assert.equal(data.projects.find(p=>p.id===B).title,'此對話已明確同步');assert.equal(data.observation.cache_hits,1);assert.deepEqual(await fs.readFile(database),beforeDB);assert.deepEqual(await fs.readFile(file),beforeFile);
});

test('English and Chinese credentials including following lines never enter saved state',async t=>{
 const f=await fixture(t);const dangerous=['密碼=plainSecret甲','暗碼\n87654321','API金鑰：abcdefghijklmnopqrstuv','管理令牌\n7788990011','password: words with spaces','{"password":"quotedSecret"}','Bearer abcdefghijklmnop','sk-proj-abcdefghijklmnopqrstuv','https://someone:privatepass@example.com/?token=hidden'];
 const payload={...base(),goal:dangerous.join('\n'),summary:'僅保留簡短進度，不儲存原始對話',groups:[{id:'delivery',title:'交付'}],tasks:[{id:'evidence',title:'遮蔽敏感資訊',group:'delivery',status:'passed',evidence:[{label:'安全檢查',url:'https://someone:privatepass@example.com/?token=hidden'}]}]};
 await report({statePath:f.state,sessionId:A,payload});const saved=await fs.readFile(f.state,'utf8');
 for(const secret of ['plainSecret甲','87654321','abcdefghijklmnopqrstuv','7788990011','words with spaces','quotedSecret','abcdefghijklmnop','privatepass','someone','hidden'])assert.ok(!saved.includes(secret),secret);
 assert.ok(saved.includes('REDACTED'));const bytes=saved;
 for(const invalid of [{...base(),analysis:'不應儲存'},{...base(),raw_transcript:'不應儲存'},{...base(),metrics:[{label:'進度',value:'99%'}]}])await assert.rejects(()=>report({statePath:f.state,sessionId:A,payload:invalid}));
 assert.equal(await fs.readFile(f.state,'utf8'),bytes);
 assert.ok(!redact('密碼：\n12345678').includes('12345678'));
});

test('explicit session/file/stdin rules and short-input bounds',async t=>{
 const f=await fixture(t);const filename=path.join(f.dir,'short.json');await fs.writeFile(filename,JSON.stringify(base()));
 let result=await cli(['--state',f.state,'--json-file',filename],null,{CODEX_THREAD_ID:A,CODEX_LOCAL_BOARD_PARENT_ID:''});assert.equal(result.code,0,result.err);
 result=await cli(['--state',f.state,'--json-stdin'],JSON.stringify(base()),{CODEX_THREAD_ID:'',CODEX_LOCAL_BOARD_PARENT_ID:''});assert.notEqual(result.code,0);
 result=await cli(['--state',f.state,'--json-stdin','--session-id',A],JSON.stringify({ ...base(),current:'x'.repeat(70000)}));assert.notEqual(result.code,0);
 result=await cli(['--state',f.state,'--json-file',path.join(f.dir,'rollout-raw.jsonl'),'--session-id',A]);assert.notEqual(result.code,0);assert.match(result.err,/never raw transcripts/);
 result=await cli(['--state',f.state,'--json-file',filename,'--session-id',B,'--parent-session-id',A,'--agent-id','/root/name','--role','協作者']);assert.notEqual(result.code,0);
 const malformed='{"password":"mustNeverEchoThisSecret"';await fs.writeFile(filename,malformed);
 for(const mode of ['file','stdin']){result=await cli(['--state',f.state,...(mode==='file'?['--json-file',filename]:['--json-stdin']),'--session-id',A],mode==='stdin'?malformed:undefined);assert.notEqual(result.code,0);assert.match(result.err,/Invalid local JSON/);assert.ok(!(result.err+result.out).includes('mustNeverEchoThisSecret'));}
 result=await cli(['--example']);assert.equal(result.code,0);assert.equal(JSON.parse(result.out).tasks[0].status,'pending');
});

test('example composes with fixed --state commands without identity or state access',async t=>{
 const f=await fixture(t),installed=path.join(f.dir,'portable install with spaces');await fs.mkdir(installed);
 for(const name of ['agent_report.mjs','board-node.mjs'])await fs.copyFile(path.join(ROOT,name),path.join(installed,name));
 const scripts=[path.join(ROOT,'agent_report.mjs'),path.join(installed,'agent_report.mjs')];
 const absent=path.join(f.dir,'never-created','shared state.json'),existing=path.join(f.dir,'existing state.json');
 const original=Buffer.from('\uFEFFnot valid JSON\r\nEXAMPLE_STATE_MUST_NOT_BE_READ\r\n');await fs.writeFile(existing,original);const beforeStat=await fs.stat(existing);
 const environment={CODEX_THREAD_ID:'',CODEX_LOCAL_BOARD_PARENT_ID:'not-a-session-id',CODEX_LOCAL_BOARD_AGENT_ID:'not/an/agent'};
 for(const script of scripts){
  for(const args of [['--example'],['--state',absent,'--example'],['--example','--state',existing],['--state',installed,'--example']]){
   const result=await cli(args,'not JSON and must not be consumed',environment,script);assert.equal(result.code,0,result.err);assert.equal(result.err,'');
   const example=JSON.parse(result.out);assert.equal(example.tasks[0].status,'pending');assert.ok(example.goal);assert.ok(!result.out.includes('EXAMPLE_STATE_MUST_NOT_BE_READ'));
  }
 }
 await assert.rejects(()=>fs.stat(path.dirname(absent)),{code:'ENOENT'});assert.deepEqual(await fs.readFile(existing),original);
 const afterStat=await fs.stat(existing);assert.equal(afterStat.mtimeMs,beforeStat.mtimeMs);assert.equal(afterStat.ino,beforeStat.ino);
 assert.deepEqual((await fs.readdir(f.dir)).sort(),['existing state.json','portable install with spaces']);
});

test('example rejects reporting options even when a fixed --state is supplied',async t=>{
 const f=await fixture(t),original=Buffer.from('unchanged example target\r\n');await fs.writeFile(f.state,original);
 const forbidden=[['--json-file',path.join(f.dir,'unreadable.json')],['--json-stdin'],['--session-id',A],['--parent-session-id',A],['--agent-id','worker'],['--role','reviewer']];
 for(const option of forbidden)for(const prefix of [[],['--state',f.state]]){
  const result=await cli([...prefix,'--example',...option],'not a report',{CODEX_THREAD_ID:''});assert.notEqual(result.code,0);assert.match(result.err,/only --example and optional --state/);assert.equal(result.out,'');
 }
 assert.deepEqual(await fs.readFile(f.state),original);assert.deepEqual(await fs.readdir(f.dir),['state-v2.json']);
});

test('session capacity and state size never silently drop earlier conversations',async t=>{
 const f=await fixture(t);const initial=emptyState();initial.projects=Array.from({length:LIMITS.sessions},()=>emptyProject(randomUUID()));await fs.writeFile(f.state,JSON.stringify(initial));const before=await fs.readFile(f.state,'utf8');
 await assert.rejects(()=>report({statePath:f.state,sessionId:A,payload:base()}),/capacity500/);assert.equal(await fs.readFile(f.state,'utf8'),before);assert.equal((await mergedState(f.state)).capacity.full,true);
 await fs.writeFile(f.state,'x'.repeat(LIMITS.stateBytes+1));await assert.rejects(()=>readSemantic(f.state),/bounded size/);
});

test('fixed GET routes, Host and bounded reads; native health ownership and v1 remain usable',async t=>{
 const f=await fixture(t);await fs.mkdir(path.join(f.dir,'web'));for(const [name,data]of Object.entries({'index.html':'<script nonce="__BOARD_NONCE__" src="/plan-handoff.js"></script><script nonce="__BOARD_NONCE__" src="/app.js"></script>','app.js':'document.title="看板";','plan-handoff.js':'globalThis.BoardPlanHandoff={version:1};','styles.css':'body{color:black}'}))await fs.writeFile(path.join(f.dir,'web',name),data);
 const legacy={schema_version:1,updated_at:null,demo:true,projects:[{id:'manual-demo',title:'舊版明確關卡',groups:[{id:'delivery',title:'交付'}],tasks:[],agents:[],events:[]}]};await fs.writeFile(f.legacy,JSON.stringify(legacy));const original=await fs.readFile(f.legacy,'utf8');
 await report({statePath:f.state,sessionId:A,payload:base('真聊天室')});const instance=randomUUID();const server=await createBoardServer({root:f.dir,state:f.state,legacyState:f.legacy,port:0,instanceId:instance,observeCodex:false});t.after(()=>new Promise(resolve=>server.close(resolve)));const port=server.address().port;
 const health=await wire(port,'/healthz');assert.equal(health.status,200);const h=JSON.parse(health.body);assert.equal(h.service,'codex-local-board');assert.equal(h.version,2);assert.equal(h.pid,process.pid);assert.equal(h.instance_id,instance);assert.match(h.root_fingerprint,/^[a-f0-9]{64}$/);assert.ok(!health.body.includes(f.dir));
 const state=await wire(port,'/state.json');assert.equal(state.status,200);const data=JSON.parse(state.body);assert.equal(data.projects.length,2);assert.equal(data.projects.find(p=>p.id===A).goal,base().goal);assert.equal(await fs.readFile(f.legacy,'utf8'),original);
 const html=await wire(port,'/');assert.equal(html.status,200);assert.ok(!html.body.includes('__BOARD_NONCE__'));assert.match(html.headers['content-security-policy'],/nonce-/);assert.equal(html.headers['x-content-type-options'],'nosniff');const scriptNonces=[...html.body.matchAll(/nonce="([^"]+)"/g)].map(match=>match[1]);assert.equal(scriptNonces.length,2);assert.equal(new Set(scriptNonces).size,1);
 const handoff=await wire(port,'/plan-handoff.js');assert.equal(handoff.status,200);assert.equal(handoff.headers['content-type'],'text/javascript; charset=utf-8');assert.equal(handoff.headers['x-content-type-options'],'nosniff');assert.equal(handoff.body,'globalThis.BoardPlanHandoff={version:1};');
 for(const target of ['/../state.json','/%2e%2e/board.py','/state.json?file=secret','/agent_report.mjs','/config.example.json','/web/plan-handoff.js','/plan-handoff.js?raw=1'])assert.equal((await wire(port,target)).status,404,target);
 assert.equal((await wire(port,'/state.json',{host:`foreign.invalid:${port}`})).status,403);
 for(const method of ['POST','PUT','PATCH','DELETE','OPTIONS','HEAD'])for(const target of ['/state.json','/plan-handoff.js'])assert.equal((await wire(port,target,{method})).status,405,method+' '+target);
 await fs.writeFile(path.join(f.dir,'web','plan-handoff.js'),'x'.repeat(512*1024+1));assert.equal((await wire(port,'/plan-handoff.js')).status,503);
 await fs.writeFile(f.state,JSON.stringify({schema_version:1,source:SOURCE,projects:[],unexpected:true}));assert.equal((await wire(port,'/state.json')).status,503);
});

test('legacy storage is never converted in place and history truncation is disclosed',async t=>{
 const f=await fixture(t);await fs.writeFile(f.state,JSON.stringify({schema_version:1,projects:[]}));const before=await fs.readFile(f.state,'utf8');await assert.rejects(()=>report({statePath:f.state,sessionId:A,payload:base()}),/legacy files must remain separate/);assert.equal(await fs.readFile(f.state,'utf8'),before);await fs.unlink(f.state);
 for(let i=0;i<35;i++)await report({statePath:f.state,sessionId:A,payload:{...base(),current:`明確工作步驟${i}`}});
 const p=(await readSemantic(f.state)).projects[0];assert.equal(p.events.length,30);assert.equal(p.history_dropped,5);assert.equal(p.current,'明確工作步驟34');assert.ok(p.events.every(e=>e.kind==='semantic'));
});
