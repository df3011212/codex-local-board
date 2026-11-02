import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {PLAN_LIMITS,PLAN_SOURCE,emptyProjectPlans,normalizeProjectPlan,validateProjectPlansStore,readProjectPlans,presentPlan,writeProjectPlan} from '../project-plan.mjs';
import {PLAN_EXAMPLE} from '../plan_report.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const copy=value=>structuredClone(value);
const leaf=(id='verify',parent='delivery',status='pending')=>({id,parent_id:parent,title:'可驗證任務 '+id,kind:'task',status,detail:'依實際驗證更新',evidence:[],depends_on:[]});
const payload=()=>copy(PLAN_EXAMPLE);
const stored=(value=payload(),session=A)=>normalizeProjectPlan({...value,session_id:session,updated_at:'2026-01-01T00:00:00Z'});
async function fixture(t){const parent=await fs.realpath(os.tmpdir()),dir=await fs.mkdtemp(path.join(parent,'codex-project-plan-test-'));assert.equal(path.dirname(dir),parent);t.after(async()=>{assert.equal(path.dirname(path.resolve(dir)),parent);assert.ok(path.basename(dir).startsWith('codex-project-plan-test-'));await fs.rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:50});});return{dir,state:path.join(dir,'project-plans.json')};}
function cli(args,environment={}){return new Promise((resolve,reject)=>{const p=spawn(process.execPath,[path.join(ROOT,'plan_report.mjs'),...args],{windowsHide:true,env:{...process.env,...environment},stdio:['ignore','pipe','pipe']});let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.once('error',reject);p.once('close',code=>resolve({code,out,err}));});}

test('missing storage is empty; replace preserves other chats and never scans reference documents',async t=>{
 const f=await fixture(t);assert.deepEqual(await readProjectPlans(f.state),emptyProjectPlans());
 const doc=payload();doc.source={kind:'document',label:'已提供的規格來源',references:[{label:'規格內容',path:path.join(f.dir,'not-existing-specification.md')}]};await writeProjectPlan(f.state,A,doc);await writeProjectPlan(f.state,B,payload());let state=await readProjectPlans(f.state);assert.equal(state.source,PLAN_SOURCE);assert.equal(state.projects.length,2);const other=copy(state.projects.find(p=>p.session_id===B));
 const replacement=payload();replacement.title='新的完整架構';replacement.nodes.push(leaf('second'));await writeProjectPlan(f.state,A,replacement);state=await readProjectPlans(f.state);assert.deepEqual(state.projects.find(p=>p.session_id===B),other);assert.equal(state.projects.find(p=>p.session_id===A).nodes.length,3);await assert.rejects(()=>fs.stat(path.join(f.dir,'not-existing-specification.md')),{code:'ENOENT'});
});

test('only evidenced task leaves count; parent flags and dependencies cannot inflate progress',()=>{
 const input=payload();input.nodes[0].status='done';input.nodes[0].evidence=['父項的文字證據不等於全部子任務完成'];input.nodes.push(leaf('second'));let view=presentPlan(stored(input));assert.deepEqual(view.progress,{completed:0,total:2,percent:0,kind:'evidenced_leaf_tasks'});assert.equal(view.nodes.find(n=>n.id==='delivery').progress.percent,0);
 input.nodes[1].status='passed';input.nodes[1].evidence=['已測過這一項'];view=presentPlan(stored(input));assert.equal(view.progress.percent,50);assert.equal(view.nodes.find(n=>n.id==='verify').progress.percent,100);assert.equal(view.nodes.find(n=>n.id==='second').progress.percent,0);
 input.nodes[2].status='source_ready';view=presentPlan(stored(input));assert.equal(view.progress.percent,50);input.nodes[2].status='done';input.nodes[2].evidence=[{label:'第二項已驗證'}];assert.equal(presentPlan(stored(input)).progress.percent,100);
});

test('patch only changes existing node status/detail/evidence and preserves all scope and other chats',async t=>{
 const f=await fixture(t);await writeProjectPlan(f.state,A,payload());await writeProjectPlan(f.state,B,payload());const before=await readProjectPlans(f.state),old=copy(before.projects.find(p=>p.session_id===A)),other=copy(before.projects.find(p=>p.session_id===B));
 await writeProjectPlan(f.state,A,{nodes:[{id:'verify',status:'passed',detail:'實際檢查通過',evidence:['測試證據']}]},{patch:true});const after=await readProjectPlans(f.state),changed=after.projects.find(p=>p.session_id===A);for(const k of ['session_id','title','goal','summary','source'])assert.deepEqual(changed[k],old[k]);assert.deepEqual(changed.nodes[0],old.nodes[0]);assert.deepEqual(after.projects.find(p=>p.session_id===B),other);assert.equal(presentPlan(changed).progress.percent,100);
 const bytes=await fs.readFile(f.state);for(const invalid of [{nodes:[{id:'new',status:'pending'}]},{nodes:[{id:'verify',parent_id:null}]},{title:'不能改目標',nodes:[{id:'verify',status:'pending'}]},{nodes:[{id:'verify',evidence:[]}]},{nodes:[]}])await assert.rejects(()=>writeProjectPlan(f.state,A,invalid,{patch:true}));assert.deepEqual(await fs.readFile(f.state),bytes);
 await assert.rejects(()=>writeProjectPlan(f.state,randomUUID(),{nodes:[{id:'verify',status:'pending'}]},{patch:true}),e=>e.planCode==='PLAN_NOT_FOUND');
});

test('invalid tree, dependency cycles, duplicate IDs, leaf kinds and unsupported source claims are rejected',()=>{
 const cases=[];function change(fn){const p=payload();fn(p);cases.push(p);}
 change(p=>p.nodes.push(copy(p.nodes[1])));change(p=>p.nodes[1].parent_id='missing');change(p=>p.nodes[1].depends_on=['missing']);change(p=>p.nodes[1].depends_on=['verify']);change(p=>p.nodes[1].depends_on=['delivery']);change(p=>p.nodes[0].parent_id='verify');change(p=>p.nodes[1].kind='module');change(p=>p.nodes[0].kind='task');change(p=>p.nodes[1].status='done');change(p=>p.source.kind='reported');change(p=>p.source={kind:'document',label:'沒有來源',references:[]});change(p=>p.nodes[1].extra='raw content');change(p=>p.source.references=[{label:'沒有目標'}]);change(p=>p.nodes[1].depends_on=['delivery','delivery']);
 for(const p of cases)assert.throws(()=>stored(p));
 const valid=payload();valid.nodes=[{...valid.nodes[0],id:'phase-a'},leaf('task-a','phase-a'),{...valid.nodes[0],id:'phase-b',depends_on:['phase-a']},leaf('task-b','phase-b')];assert.equal(stored(valid).nodes.length,4);
 const cycle=copy(valid);cycle.nodes[0].depends_on=['phase-b'];assert.throws(()=>stored(cycle),e=>e.planCode==='CYCLE');
});

test('512 nodes, 64 source references and eight tree levels are bounded without truncating scope',()=>{
 const p=payload();p.source={kind:'document',label:'文件依據',references:Array.from({length:64},(_,i)=>({label:'依據'+i,path:`specs/part-${i}.md`}))};p.nodes=[p.nodes[0],...Array.from({length:511},(_,i)=>leaf('task-'+i))];assert.equal(stored(p).nodes.length,512);p.nodes.push(leaf('too-many'));assert.throws(()=>stored(p),e=>e.planCode==='CAPACITY');p.nodes.pop();p.source.references.push({label:'太多來源',path:'overflow.md'});assert.throws(()=>stored(p),e=>e.planCode==='CAPACITY');
 const deep=payload();deep.nodes=Array.from({length:8},(_,i)=>({id:'node-'+i,parent_id:i?'node-'+(i-1):null,title:'階層'+i,kind:i===7?'task':'module',status:'pending',detail:'',evidence:[],depends_on:[]}));assert.equal(stored(deep).nodes.length,8);deep.nodes[7].kind='module';deep.nodes.push(leaf('too-deep','node-7'));assert.throws(()=>stored(deep),e=>e.planCode==='DEPTH');
});

test('true CLI example accepts fixed state without identity or filesystem access; authored reports and patch work',async t=>{
 const f=await fixture(t),missing=path.join(f.dir,'never-created','plan.json');for(const args of [['--example'],['--state',missing,'--example']]){const result=await cli(args,{CODEX_THREAD_ID:''});assert.equal(result.code,0,result.err);assert.equal(JSON.parse(result.out).source.kind,'generated');}await assert.rejects(()=>fs.stat(path.dirname(missing)),{code:'ENOENT'});
 for(const args of [['--example','--patch'],['--state',missing,'--example','--session-id',A]])assert.notEqual((await cli(args)).code,0);
 const file=path.join(f.dir,'authored.json');await fs.writeFile(file,JSON.stringify(payload()));let result=await cli(['--state',f.state,'--session-id',A,'--json-file',file],{CODEX_THREAD_ID:''});assert.equal(result.code,0,result.err);assert.equal(JSON.parse(result.out).mode,'replace');await fs.writeFile(file,JSON.stringify({nodes:[{id:'verify',status:'passed',evidence:['實測結果']}]}));result=await cli(['--state',f.state,'--session-id',A,'--json-file',file,'--patch']);assert.equal(result.code,0,result.err);assert.equal(presentPlan((await readProjectPlans(f.state)).projects[0]).progress.percent,100);
 await fs.writeFile(file,'{"password":"MUST_NOT_ECHO_SENTINEL"');result=await cli(['--state',f.state,'--session-id',A,'--json-file',file]);assert.notEqual(result.code,0);assert.ok(!(result.out+result.err).includes('MUST_NOT_ECHO_SENTINEL'));
});

test('concurrent CLI replace and patch writers retain every session and independent leaf update',async t=>{
 const f=await fixture(t),file=path.join(f.dir,'plan.json'),sessions=Array.from({length:4},()=>randomUUID());const p=payload();p.nodes=[p.nodes[0],...Array.from({length:4},(_,i)=>leaf('task-'+i))];await fs.writeFile(file,JSON.stringify(p));const creates=await Promise.all(sessions.map(session=>cli(['--state',f.state,'--session-id',session,'--json-file',file])));assert.ok(creates.every(r=>r.code===0),JSON.stringify(creates));assert.equal((await readProjectPlans(f.state)).projects.length,4);
 const patches=await Promise.all(Array.from({length:4},async(_,i)=>{const patchFile=path.join(f.dir,`patch-${i}.json`);await fs.writeFile(patchFile,JSON.stringify({nodes:[{id:'task-'+i,status:'done',evidence:['獨立已驗證結果'+i]}]}));return cli(['--state',f.state,'--session-id',sessions[0],'--json-file',patchFile,'--patch']);}));assert.ok(patches.every(r=>r.code===0),JSON.stringify(patches));const state=await readProjectPlans(f.state);assert.equal(state.projects.length,4);assert.equal(presentPlan(state.projects.find(p=>p.session_id===sessions[0])).progress.percent,100);assert.equal((await fs.readdir(f.dir)).filter(n=>n.endsWith('.lock')||n.endsWith('.tmp')||n.endsWith('.recovery')).length,0);
});

test('session and payload capacity failures retain existing store bytes',async t=>{
 const f=await fixture(t),store=emptyProjectPlans();store.projects=Array.from({length:100},()=>stored(payload(),randomUUID()));await fs.writeFile(f.state,JSON.stringify(store));const before=await fs.readFile(f.state);await assert.rejects(()=>writeProjectPlan(f.state,A,payload()),e=>e.planCode==='SESSION_CAPACITY');assert.deepEqual(await fs.readFile(f.state),before);
 await assert.rejects(()=>writeProjectPlan(f.state,store.projects[0].session_id,{...payload(),summary:'x'.repeat(PLAN_LIMITS.payloadBytes)}),e=>e.planCode==='PAYLOAD_FULL');assert.deepEqual(await fs.readFile(f.state),before);await writeProjectPlan(f.state,store.projects[0].session_id,payload());assert.equal((await readProjectPlans(f.state)).projects.length,100);
 await fs.writeFile(f.state,'x'.repeat(PLAN_LIMITS.storeBytes+1));await assert.rejects(()=>readProjectPlans(f.state),e=>e.planCode==='FILE_SIZE_OR_TYPE');
});

test('active lock timeout is safe and dead owner recovery permits a valid update',async t=>{
 const f=await fixture(t);await writeProjectPlan(f.state,A,payload());const lock=path.join(f.dir,'.project-plans.json.plan.lock'),before=await fs.readFile(f.state),active=JSON.stringify({pid:process.pid,nonce:'active-owner'});await fs.writeFile(lock,active);await assert.rejects(()=>writeProjectPlan(f.state,A,payload(),{timeoutMs:30}),e=>e.planCode==='WRITER_BUSY');assert.deepEqual(await fs.readFile(f.state),before);assert.equal(await fs.readFile(lock,'utf8'),active);await fs.unlink(lock);await fs.writeFile(lock,JSON.stringify({pid:2147483647,nonce:'dead-owner'}));await writeProjectPlan(f.state,A,payload());assert.equal((await readProjectPlans(f.state)).projects.length,1);
});

test('credentials are masked, unsafe URL schemes rejected and semantic storage never converted',async t=>{
 const f=await fixture(t),p=payload();p.summary='密碼：\nPRIVATE_CREDENTIAL_SENTINEL';p.nodes[1].detail='Bearer abcdefghijklmnopqrst';p.nodes[1].evidence=[{label:'參考',url:'https://someone:privatepass@example.test/check?token=hidden'}];await writeProjectPlan(f.state,A,p);const body=await fs.readFile(f.state,'utf8');for(const secret of['PRIVATE_CREDENTIAL_SENTINEL','abcdefghijklmnopqrst','privatepass','someone','hidden'])assert.ok(!body.includes(secret));assert.ok(body.includes('REDACTED'));
 const bad=payload();bad.source={kind:'document',label:'禁止協定',references:[{label:'不安全',url:'javascript:alert(1)'}]};await assert.rejects(()=>writeProjectPlan(f.state,A,bad));assert.equal(await fs.readFile(f.state,'utf8'),body);
 const semantic=JSON.stringify({schema_version:1,source:'agent_semantic_reports',updated_at:null,projects:[]});await fs.writeFile(f.state,semantic);await assert.rejects(()=>writeProjectPlan(f.state,A,payload()),e=>e.planCode==='STORE_SOURCE');assert.equal(await fs.readFile(f.state,'utf8'),semantic);
});

test('presentation never accepts fabricated percentages in persisted records',()=>{
 const plan=stored();plan.progress={percent:100};assert.throws(()=>presentPlan(plan),e=>e.planCode==='FIELDS');const state={...emptyProjectPlans(),projects:[stored(),stored()]};assert.throws(()=>validateProjectPlansStore(state),e=>e.planCode==='DUPLICATE_SESSION');
});

test('an oversized combined store is rejected atomically without dropping earlier projects',async t=>{
 const f=await fixture(t),heavy=payload();heavy.nodes=[heavy.nodes[0],...Array.from({length:160},(_,i)=>({...leaf('task-'+i),detail:'公開規劃說明。'.repeat(120)}))];assert.ok(Buffer.byteLength(JSON.stringify(heavy))<PLAN_LIMITS.payloadBytes);
 const store=emptyProjectPlans();while(store.projects.length<PLAN_LIMITS.sessions){store.projects.push(stored(heavy,randomUUID()));if(Buffer.byteLength(JSON.stringify(store,null,2)+'\n')>PLAN_LIMITS.storeBytes){store.projects.pop();break;}}assert.ok(store.projects.length>0&&store.projects.length<PLAN_LIMITS.sessions);await fs.writeFile(f.state,JSON.stringify(store,null,2)+'\n');const before=await fs.readFile(f.state);
 await assert.rejects(()=>writeProjectPlan(f.state,A,heavy),e=>e.planCode==='STORE_FULL');assert.deepEqual(await fs.readFile(f.state),before);assert.equal((await fs.readdir(f.dir)).filter(n=>n.endsWith('.lock')||n.endsWith('.tmp')).length,0);
});

test('linked parent directories are rejected before a plan can overwrite another location',async t=>{
 const f=await fixture(t),actual=path.join(f.dir,'actual'),alias=path.join(f.dir,'linked-parent');await fs.mkdir(actual);const target=path.join(actual,'plans.json');await writeProjectPlan(target,A,payload());const before=await fs.readFile(target);
 await fs.symlink(actual,alias,process.platform==='win32'?'junction':'dir');await assert.rejects(()=>writeProjectPlan(path.join(alias,'plans.json'),B,payload()),e=>e.planCode==='UNTRUSTED_PATH');assert.deepEqual(await fs.readFile(target),before);
});
