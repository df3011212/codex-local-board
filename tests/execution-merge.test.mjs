import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {report} from '../agent_report.mjs';
import {createBoardServer} from '../board-node.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const A='11111111-1111-4111-8111-111111111111', B='22222222-2222-4222-8222-222222222222';
async function setup(t,options={}){
 const parent=await fs.realpath(os.tmpdir()),dir=await fs.mkdtemp(path.join(parent,'board-execution-merge-'));
 const state=path.join(dir,'state-v2.json');
 t.after(async()=>{assert.equal(path.dirname(dir),parent);assert.ok(path.basename(dir).startsWith('board-execution-merge-'));await fs.rm(dir,{recursive:true,force:true,maxRetries:20,retryDelay:50});});
 await report({statePath:state,sessionId:A,payload:{title:'原生工作甲',goal:'保持原始進度',current:'目前工作',next:'下一步',groups:[{id:'verify',title:'驗證'}],tasks:[{id:'task',title:'尚未完成的關卡',group:'verify',status:'in_progress'}]}});
 await report({statePath:state,sessionId:B,payload:{title:'原生工作乙',goal:'已完成目標',current:'等待新指派',next:'等待使用者',groups:[{id:'verify',title:'驗證'}],tasks:[{id:'task',title:'已驗收關卡',group:'verify',status:'passed',evidence:['已通過實際檢查']}]}});
 const before=await fs.readFile(state);
 const server=await createBoardServer({root,state,summaryState:path.join(dir,'summaries.json'),legacyState:path.join(dir,'legacy.json'),config:path.join(dir,'config.json'),port:0,codexHome:path.join(dir,'missing'),observationProvider:async()=>({projects:[],diagnostics:{status:'database_missing'}}),...options});
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 return{state,before,url:`http://127.0.0.1:${server.address().port}`};
}

test('running, idle and unavailable execution update on GET without altering semantic progress or state',async t=>{
 let mode='running',calls=0;
 const f=await setup(t,{executionProvider:async({sessionIds})=>{calls++;assert.deepEqual(new Set(sessionIds),new Set([A,B]));if(mode==='failed')throw Error('PRIVATE_SECRET_PATH');return{sessions:new Map([[A,{status:mode,source:'codex_agent_view',updated_at:'2026-11-02T01:00:00Z',tools:'PRIVATE_TOOL_SENTINEL'}]]),diagnostics:{available:true,status:'ok'}};}});
 const get=async()=>{const response=await fetch(f.url+'/state.json');assert.equal(response.status,200);return response.json();};
 let value=await get();assert.equal(value.projects.find(p=>p.id===A).execution.status,'running');assert.equal(value.projects.find(p=>p.id===B).execution.status,'unknown');
 assert.equal(value.projects.find(p=>p.id===A).progress.percent,0);assert.equal(value.projects.find(p=>p.id===B).progress.percent,100);
 assert.ok(!JSON.stringify(value).includes('SENTINEL'));
 mode='idle';value=await get();assert.equal(value.projects.find(p=>p.id===A).execution.status,'idle');
 mode='failed';value=await get();assert.equal(value.execution.available,false);assert.ok(value.projects.every(p=>p.execution.status==='unknown'));assert.ok(!JSON.stringify(value).includes('PRIVATE'));
 assert.equal(value.projects.find(p=>p.id===A).current,'目前工作');assert.equal(value.projects.find(p=>p.id===B).progress.percent,100);
 assert.equal(calls,3);assert.deepEqual(await fs.readFile(f.state),f.before);
});

test('execution source disabled with observations; task status is never treated as active execution',async t=>{
 let invoked=false;const f=await setup(t,{observeCodex:false,executionProvider:async()=>{invoked=true;throw Error('must not execute');}});
 const value=await(await fetch(f.url+'/state.json')).json();assert.equal(invoked,false);assert.equal(value.execution.status,'disabled');assert.ok(value.projects.every(p=>p.execution.status==='unknown'));
 assert.deepEqual(await fs.readFile(f.state),f.before);
});

test('only small safe runtime fields survive and malformed providers cannot break semantic reading',async t=>{
 let bad=false;const f=await setup(t,{executionProvider:async()=>bad?{sessions:'invalid',diagnostics:{available:true}}:{sessions:new Map([[A,{status:'running',source:'C:/PRIVATE_SOURCE',updated_at:'bad',secret:'SENTINEL'}],[B,{status:'IN_PROGRESS',source:'codex_agent_view'}]]),diagnostics:{available:true,path:'PRIVATE'}}});
 let value=await(await fetch(f.url+'/state.json')).json();let item=value.projects.find(p=>p.id===A).execution;
 assert.equal(item.status,'unknown');assert.equal(item.source,'unavailable');assert.equal(item.updated_at,null);assert.ok(!JSON.stringify(value).includes('PRIVATE'));assert.ok(!JSON.stringify(value).includes('SENTINEL'));
 assert.equal(value.projects.find(p=>p.id===B).execution.status,'unknown');
 bad=true;value=await(await fetch(f.url+'/state.json')).json();assert.ok(value.projects.every(p=>p.execution.status==='unknown'));assert.equal(value.execution.available,false);
});

test('legacy non-UUID cards cannot disable execution lookup for native conversations',async t=>{
 const f=await setup(t,{executionProvider:async({sessionIds})=>{
  assert.deepEqual(new Set(sessionIds),new Set([A,B]));
  return{sessions:new Map([[A,{status:'running',source:'codex_agent_view',updated_at:'2026-11-02T01:00:00Z'}]]),diagnostics:{available:true}};
 }});
 const legacy=path.join(path.dirname(f.state),'legacy.json');
 await fs.writeFile(legacy,JSON.stringify({schema_version:1,projects:[{id:'legacy-work',title:'原有手動檢查點',groups:[],tasks:[],agents:[],events:[]}]}));
 const before=await fs.readFile(legacy),response=await fetch(f.url+'/state.json');assert.equal(response.status,200);
 const value=await response.json();assert.equal(value.projects.length,3);assert.equal(value.projects.find(p=>p.id===A).execution.status,'running');assert.equal(value.projects.find(p=>p.id==='legacy-work').execution.status,'unknown');
 assert.deepEqual(await fs.readFile(legacy),before);assert.deepEqual(await fs.readFile(f.state),f.before);
});
