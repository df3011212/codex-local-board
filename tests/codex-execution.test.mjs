import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {readCodexExecution,executionFromSession,EXECUTION_LIMITS} from '../codex-execution.mjs';

const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',NOW=1760000000000,TOKEN='x'.repeat(43);
const running=(id=A)=>({session_id:id,status:'running',last_seen_at_ms:NOW,root_turn:{status:'running',started_at_ms:NOW-1000,stopped_at_ms:null,has_out_of_order_events:false},permission:{status:'idle'}});
const idle=(id=A)=>({...running(id),status:'completed',root_turn:{status:'completed',started_at_ms:NOW-1000,stopped_at_ms:NOW,has_out_of_order_events:false}});
const payload=rows=>({schema_version:1,source_of_truth:'hook',sessions:rows});
const response=value=>new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});
async function fixture(t){const parent=await fs.realpath(os.tmpdir()),dir=await fs.mkdtemp(path.join(parent,'codex-execution-test-'));assert.equal(path.dirname(dir),parent);t.after(async()=>{assert.equal(path.dirname(path.resolve(dir)),parent);assert.ok(path.basename(dir).startsWith('codex-execution-test-'));await fs.rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:50});});const file=path.join(dir,'runtime.json');await fs.writeFile(file,JSON.stringify({schema_version:1,host:'127.0.0.1',port:43127,token:TOKEN}));return{dir,file,options:{runtimeDirectory:dir,sessionIds:[A,B]},deps:{now:()=>NOW}};}

test('only an explicit fresh root turn means running; a stopped turn means idle, not task success',()=>{
 assert.equal(executionFromSession(running(),NOW).status,'running');const stop={...idle(),stop_reason:'interrupted'};assert.deepEqual(executionFromSession(stop,NOW),{status:'idle',source:'codex_agent_view',updated_at:new Date(NOW).toISOString(),reason:'turn_stopped'});
 for(const row of [{...running(),root_turn:{...running().root_turn,status:'idle'}},{...running(),root_turn:{...running().root_turn,status:'completed',stopped_at_ms:NOW}},{...running(),status:'observed'}])assert.equal(executionFromSession(row,NOW).status,'unknown');
 const toolsOnly={...running(),root_turn:{status:'idle',started_at_ms:null,stopped_at_ms:null,has_out_of_order_events:false},agents:[{status:'running'}],tools:[{status:'running'}]};assert.equal(executionFromSession(toolsOnly,NOW).status,'unknown');
});

test('permission, stale, unknown ordering and invalid times never retain a running indicator',()=>{
 assert.equal(executionFromSession({...running(),permission:{status:'waiting_for_user'}},NOW).reason,'waiting_for_user');
 assert.equal(executionFromSession({...running(),status:'waiting_for_user'},NOW).status,'unknown');
 assert.equal(executionFromSession(running(),NOW+EXECUTION_LIMITS.freshMs+1).reason,'stale');
 assert.equal(executionFromSession(idle(),NOW+EXECUTION_LIMITS.freshMs+1).status,'unknown');
 assert.equal(executionFromSession({...running(),status:'completion_not_observed'},NOW).status,'unknown');
 assert.equal(executionFromSession({...running(),root_turn:{...running().root_turn,has_out_of_order_events:true}},NOW).status,'unknown');
 for(const change of [{last_seen_at_ms:NOW+EXECUTION_LIMITS.futureSkewMs+1},{last_seen_at_ms:'not-time'},{root_turn:{...running().root_turn,started_at_ms:NOW+100000}},{root_turn:{...running().root_turn,status:'aborted'}}])assert.equal(executionFromSession({...running(),...change},NOW).status,'unknown');
});

test('one private loopback request exposes only requested status metadata and never tokens or activities',async t=>{
 const f=await fixture(t),before=await fs.readFile(f.file),stat=await fs.stat(f.file);let calls=0;
 const result=await readCodexExecution(f.options,{...f.deps,fetch:async(url,options)=>{calls++;assert.equal(url,'http://127.0.0.1:43127/api/state');assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Bearer '+TOKEN);return response(payload([{...running(),task_summary:'PRIVATE_TASK_SENTINEL',recent_activities:[{body:'PRIVATE_ACTIVITY_SENTINEL'}],tools:[{arguments:'PRIVATE_TOOL_SENTINEL'}]},idle(B)]));}});
 assert.equal(calls,1);assert.equal(result.sessions.get(A).status,'running');assert.equal(result.sessions.get(B).status,'idle');assert.equal(result.diagnostics.available,true);assert.equal(result.diagnostics.matched_sessions,2);
 const displayed=JSON.stringify({rows:[...result.sessions],diagnostics:result.diagnostics});for(const secret of[TOKEN,'PRIVATE_TASK_SENTINEL','PRIVATE_ACTIVITY_SENTINEL','PRIVATE_TOOL_SENTINEL'])assert.ok(!displayed.includes(secret));assert.deepEqual(await fs.readFile(f.file),before);assert.equal((await fs.stat(f.file)).mtimeMs,stat.mtimeMs);assert.deepEqual(await fs.readdir(f.dir),['runtime.json']);
});

test('running to idle to failed-source transitions do not reuse previous running state',async t=>{
 const f=await fixture(t);let mode='running';const fetch=async()=>{if(mode==='failed')throw Error('PRIVATE_ERROR_SENTINEL');return response(payload([mode==='idle'?idle():running()]));};
 let result=await readCodexExecution(f.options,{...f.deps,fetch});assert.equal(result.sessions.get(A).status,'running');mode='idle';result=await readCodexExecution(f.options,{...f.deps,fetch});assert.equal(result.sessions.get(A).status,'idle');mode='failed';result=await readCodexExecution(f.options,{...f.deps,fetch});assert.equal(result.sessions.get(A).status,'unknown');assert.equal(result.sessions.get(A).updated_at,null);assert.equal(result.diagnostics.available,false);assert.ok(!JSON.stringify(result.diagnostics).includes('PRIVATE_ERROR_SENTINEL'));
});

test('missing, invalid and nonregular runtime metadata never triggers a request',async t=>{
 const f=await fixture(t);let calls=0;const deps={...f.deps,fetch:()=>{calls++;throw Error('must not request');}};
 for(const value of [{schema_version:1,host:'outside.example',port:43127,token:TOKEN},{schema_version:1,host:'127.0.0.1',port:0,token:TOKEN},{schema_version:1,host:'127.0.0.1',port:43127,token:'weak'}]){await fs.writeFile(f.file,JSON.stringify(value));const result=await readCodexExecution(f.options,deps);assert.equal(result.sessions.get(A).status,'unknown');assert.equal(result.diagnostics.available,false);}
 await fs.unlink(f.file);await fs.mkdir(f.file);let result=await readCodexExecution(f.options,deps);assert.equal(result.diagnostics.status,'runtime_untrusted');await fs.rmdir(f.file);result=await readCodexExecution(f.options,deps);assert.equal(result.diagnostics.status,'runtime_missing');assert.equal(calls,0);
});

test('malformed, oversized, duplicate and unauthorized API responses fail closed',async t=>{
 const f=await fixture(t);const cases=[new Response('{bad JSON'),new Response('denied',{status:401}),new Response('x',{headers:{'Content-Length':String(EXECUTION_LIMITS.responseBytes+1)}}),response(payload(Array.from({length:EXECUTION_LIMITS.sessions+1},()=>running()))),response(payload([running(),running()])),response({schema_version:1,source_of_truth:'tool_log',sessions:[running()]})];
 for(const value of cases){const result=await readCodexExecution(f.options,{...f.deps,fetch:async()=>value});assert.equal(result.diagnostics.available,false);assert.ok([...result.sessions.values()].every(v=>v.status==='unknown'));}
});

test('real loopback timeout and redirect cannot leave a spinner or forward credentials',async t=>{
 const f=await fixture(t);let redirected=false;const second=http.createServer((req,res)=>{redirected=true;res.end('must not reach');});await new Promise(resolve=>second.listen(0,'127.0.0.1',resolve));
 let mode='redirect';const server=http.createServer((req,res)=>{if(mode==='timeout')return;res.writeHead(302,{Location:`http://127.0.0.1:${second.address().port}/elsewhere`});res.end();});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{server.closeAllConnections();second.closeAllConnections();await Promise.all([new Promise(r=>server.close(r)),new Promise(r=>second.close(r))]);});await fs.writeFile(f.file,JSON.stringify({schema_version:1,host:'127.0.0.1',port:server.address().port,token:TOKEN}));
 let result=await readCodexExecution(f.options,{...f.deps,timeoutMs:50});assert.equal(result.sessions.get(A).status,'unknown');assert.equal(redirected,false);mode='timeout';result=await readCodexExecution(f.options,{...f.deps,timeoutMs:50});assert.equal(result.diagnostics.status,'request_timeout');assert.equal(result.sessions.get(A).status,'unknown');
});

test('runtime directory follows upstream environment rather than CODEX_HOME; unknown session stays unknown',async t=>{
 const f=await fixture(t),before=process.env.CODEX_AGENT_VIEW_RUNTIME_DIR;process.env.CODEX_AGENT_VIEW_RUNTIME_DIR=f.dir;
 try{const result=await readCodexExecution({codexHome:path.join(f.dir,'unused-codex-home'),sessionIds:[A,B]},{...f.deps,fetch:async()=>response(payload([running()]))});assert.equal(result.sessions.get(A).status,'running');assert.equal(result.sessions.get(B).status,'unknown');assert.equal(result.sessions.get(B).reason,'not_observed');}finally{if(before===undefined)delete process.env.CODEX_AGENT_VIEW_RUNTIME_DIR;else process.env.CODEX_AGENT_VIEW_RUNTIME_DIR=before;}
});
