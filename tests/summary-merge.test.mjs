import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {report} from '../agent_report.mjs';
import {mergedState,createBoardServer} from '../board-node.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333'];
const payload=current=>({title:'合成對話',goal:'核對來源優先順序',current,next:'等待下一個明確關卡',groups:[],tasks:[],agents:[],completed:[]});
const observation=(id,current)=>({id,session_id:id,semantic_version:2,source:'observed_public_messages',title:'合成公開摘要',goal:'需求摘要',current,next:'等待結構化回報',updated_at:new Date().toISOString(),sync:{status:'observed',reported_at:new Date().toISOString()},tasks:[],groups:[],agents:[],completed:[],events:[],metrics:[]});
async function setup(t){
 const parent=await fs.realpath(os.tmpdir()),folder=await fs.mkdtemp(path.join(parent,'board-summary-test-'));
 t.after(async()=>{assert.equal(path.dirname(folder),parent);assert.ok(path.basename(folder).startsWith('board-summary-test-'));await fs.rm(folder,{recursive:true,force:true});});
 return{folder,state:path.join(folder,'live.json'),summary:path.join(folder,'summaries.json')};
}
test('live reports take precedence over summaries, which take precedence over observations without mutating stores',async t=>{
 const f=await setup(t);
 await report({statePath:f.state,sessionId:ids[0],payload:payload('原工作代理的最新回報')});
 await report({statePath:f.summary,sessionId:ids[0],payload:payload('舊的對話整理')});
 await report({statePath:f.summary,sessionId:ids[1],payload:payload('依公開對話明確整理')});
 const before=await Promise.all([fs.readFile(f.state),fs.readFile(f.summary)]);
 const result=await mergedState(f.state,null,{projects:ids.map(id=>observation(id,'純公開摘要')),diagnostics:{status:'ok'}},f.summary);
 assert.equal(result.projects.length,3);
 assert.equal(result.projects.find(p=>p.id===ids[0]).current,'原工作代理的最新回報');
 assert.notEqual(result.projects.find(p=>p.id===ids[0]).source,'conversation_summary');
 assert.equal(result.projects.find(p=>p.id===ids[1]).source,'conversation_summary');
 assert.equal(result.projects.find(p=>p.id===ids[1]).current,'依公開對話明確整理');
 assert.equal(result.projects.find(p=>p.id===ids[1]).progress.percent,null);
 assert.equal(result.projects.find(p=>p.id===ids[2]).source,'observed_public_messages');
 assert.equal(result.summary_sync.sessions,1);
 const after=await Promise.all([fs.readFile(f.state),fs.readFile(f.summary)]);
 assert.deepEqual(after,before);
});
test('missing or malformed summaries cannot erase live progress; stores must be separate',async t=>{
 const f=await setup(t);await report({statePath:f.state,sessionId:ids[0],payload:payload('保留已確認的工作')});
 let result=await mergedState(f.state,null,undefined,f.summary);
 assert.equal(result.projects[0].current,'保留已確認的工作');assert.equal(result.summary_sync.status,'waiting');
 await fs.writeFile(f.summary,'not valid JSON');result=await mergedState(f.state,null,undefined,f.summary);
 assert.equal(result.projects[0].current,'保留已確認的工作');assert.equal(result.summary_sync.status,'invalid');
 await assert.rejects(()=>mergedState(f.state,null,undefined,f.state),/separate/);
 if(process.platform==='win32')await assert.rejects(()=>mergedState(f.state,null,undefined,f.state.toUpperCase()),/separate/);
});
test('running HTTP server receives changed summaries and later live reports while keeping private files off HTTP',async t=>{
 const f=await setup(t),server=await createBoardServer({root,state:f.state,summaryState:f.summary,legacyState:path.join(f.folder,'legacy.json'),config:path.join(f.folder,'config.json'),port:0,observeCodex:false,codexHome:path.join(f.folder,'absent-home')});
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const url=`http://127.0.0.1:${server.address().port}`;
 await report({statePath:f.summary,sessionId:ids[1],payload:payload('整理版本一')});
 let value=await(await fetch(url+'/state.json')).json();assert.equal(value.projects[0].current,'整理版本一');
 await report({statePath:f.summary,sessionId:ids[1],payload:payload('整理版本二')});
 value=await(await fetch(url+'/state.json')).json();assert.equal(value.projects[0].current,'整理版本二');
 await report({statePath:f.state,sessionId:ids[1],payload:payload('工作代理接續後的真實回報')});
 value=await(await fetch(url+'/state.json')).json();assert.equal(value.projects.length,1);assert.equal(value.projects[0].current,'工作代理接續後的真實回報');assert.equal(value.summary_sync.sessions,0);
 assert.equal((await fetch(url+'/conversation-summaries.json')).status,404);
 assert.equal((await fetch(url+'/state.json',{method:'POST'})).status,405);
});
