import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {report} from '../agent_report.mjs';
import {createBoardServer} from '../board-node.mjs';
import {writeProjectPlan} from '../project-plan.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const work={title:'已知聊天室',goal:'完成目前工作',current:'本輪已驗收',next:'等待選擇後續工作',groups:[{id:'round',title:'本輪'}],tasks:[{id:'verify',title:'本輪驗收',group:'round',status:'passed',evidence:['本輪實際驗證通過']}]};
const plan=title=>({title,goal:'完整專案包含尚未完成的後續階段',summary:'這是依已知需求建立的待確認計畫',source:{kind:'generated',label:'已知需求草案，尚未完整盤點文件',references:[]},nodes:[{id:'phase',parent_id:null,title:'長期階段',kind:'phase',status:'pending',detail:'',evidence:[],depends_on:[]},{id:'first',parent_id:'phase',title:'第一項',kind:'task',status:'passed',detail:'',evidence:['已通過實際驗證'],depends_on:[]},{id:'second',parent_id:'phase',title:'尚未完成項目',kind:'task',status:'pending',detail:'',evidence:[],depends_on:[]}]});
async function fixture(t){const parent=await fs.realpath(os.tmpdir()),dir=await fs.mkdtemp(path.join(parent,'board-plan-integration-'));t.after(async()=>{assert.equal(path.dirname(dir),parent);assert.ok(path.basename(dir).startsWith('board-plan-integration-'));await fs.rm(dir,{recursive:true,force:true,maxRetries:20,retryDelay:50});});return{dir,state:path.join(dir,'state.json'),plan:path.join(dir,'project-plans.json')};}

test('per-chat plans and next suggestions update on GET while current-round and full-project progress stay separate',async t=>{
 const f=await fixture(t);await report({statePath:f.state,sessionId:A,payload:work});await report({statePath:f.state,sessionId:B,payload:{...work,title:'另一個聊天室'}});
 await writeProjectPlan(f.plan,A,plan('甲的整體計畫'));await writeProjectPlan(f.plan,B,plan('乙的整體計畫'));
 const server=await createBoardServer({root,state:f.state,planState:f.plan,summaryState:path.join(f.dir,'summary.json'),legacyState:path.join(f.dir,'legacy.json'),config:path.join(f.dir,'config.json'),port:0,observeCodex:false});t.after(()=>new Promise(resolve=>server.close(resolve)));const url=`http://127.0.0.1:${server.address().port}`;
 const get=async()=>{const response=await fetch(url+'/state.json');assert.equal(response.status,200);return response.json();};
 let view=await get(),a=view.projects.find(p=>p.id===A),b=view.projects.find(p=>p.id===B);assert.equal(a.progress.percent,100);assert.equal(a.plan.progress.percent,50);assert.equal(b.plan.title,'乙的整體計畫');assert.deepEqual(a.suggestions,[]);
 await report({statePath:f.state,sessionId:A,payload:{...work,suggestions:[{id:'next-phase',title:'建議執行下一個階段',detail:'這是建議，尚未開始'}]}});
 await writeProjectPlan(f.plan,A,{nodes:[{id:'second',status:'passed',evidence:['真實驗收結果']}]},{patch:true});
 view=await get();a=view.projects.find(p=>p.id===A);b=view.projects.find(p=>p.id===B);assert.equal(a.plan.progress.percent,100);assert.equal(a.suggestions[0].title,'建議執行下一個階段');assert.equal(b.plan.progress.percent,50);assert.deepEqual(b.suggestions,[]);
 assert.equal((await fetch(url+'/project-plans.json')).status,404);assert.equal((await fetch(url+'/state.json',{method:'POST'})).status,405);
 const stateBefore=await fs.readFile(f.state);await fs.writeFile(f.plan,'invalid plan file');view=await get();assert.equal(view.plan_sync.status,'invalid');assert.ok(view.projects.every(p=>p.plan===null));assert.equal(view.projects.find(p=>p.id===A).suggestions.length,1);assert.deepEqual(await fs.readFile(f.state),stateBefore);
});

test('missing or broken plan source never erases semantic progress; store aliases are rejected',async t=>{
 const f=await fixture(t);await report({statePath:f.state,sessionId:A,payload:work});
 await assert.rejects(()=>createBoardServer({root,state:f.state,planState:f.state,port:0,observeCodex:false}),/remain separate/);
 if(process.platform==='win32')await assert.rejects(()=>createBoardServer({root,state:f.state,planState:f.state.toUpperCase(),port:0,observeCodex:false}),/remain separate/);
 const server=await createBoardServer({root,state:f.state,planState:f.plan,summaryState:path.join(f.dir,'summary.json'),legacyState:path.join(f.dir,'legacy.json'),config:path.join(f.dir,'config.json'),port:0,observeCodex:false});t.after(()=>new Promise(resolve=>server.close(resolve)));
 const view=await(await fetch(`http://127.0.0.1:${server.address().port}/state.json`)).json();assert.equal(view.plan_sync.status,'waiting');assert.equal(view.projects[0].progress.percent,100);assert.equal(view.projects[0].plan,null);
});

test('suggestions are authored proposals, bounded and redacted; children cannot rewrite parent advice',async t=>{
 const f=await fixture(t);await report({statePath:f.state,sessionId:A,payload:{...work,suggestions:[{id:'safe',title:'核對後續安裝',detail:'token=PRIVATE_SECRET'}]}});
 const before=await fs.readFile(f.state);assert.ok(!before.toString().includes('PRIVATE_SECRET'));
 await assert.rejects(()=>report({statePath:f.state,sessionId:A,payload:{...work,suggestions:Array.from({length:9},(_,i)=>({id:'x'+i,title:'超出容量'}))}}));
 await assert.rejects(()=>report({statePath:f.state,sessionId:A,payload:{...work,suggestions:[{id:'same',title:'甲'},{id:'same',title:'乙'}]}}));
 await assert.rejects(()=>report({statePath:f.state,sessionId:B,parentSessionId:A,agentId:'child',role:'協作者',payload:{status:'in_progress',suggestions:[{id:'fake',title:'越權覆寫'}]}}));
 assert.deepEqual(await fs.readFile(f.state),before);
});
