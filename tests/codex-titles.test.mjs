import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createCodexTitleReader,parseSessionTitles,TITLE_LIMITS} from '../codex-titles.mjs';
import {createBoardServer} from '../board-node.mjs';
import {report} from '../agent_report.mjs';

const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const entry=(id,name,time='2026-11-02T01:00:00Z')=>JSON.stringify({id,thread_name:name,updated_at:time})+'\n';
async function fixture(t){const parent=await fs.realpath(os.tmpdir()),home=await fs.mkdtemp(path.join(parent,'codex-titles-test-'));assert.equal(path.dirname(home),parent);t.after(async()=>{assert.equal(path.dirname(path.resolve(home)),parent);assert.ok(path.basename(home).startsWith('codex-titles-test-'));await fs.rm(home,{recursive:true,force:true});});return {home,index:path.join(home,'session_index.jsonl')};}
function wire(server){return new Promise((resolve,reject)=>{http.get({host:'127.0.0.1',port:server.address().port,path:'/state.json'},res=>{let raw='';res.on('data',c=>raw+=c);res.on('end',()=>resolve({status:res.statusCode,value:JSON.parse(raw)}));}).on('error',reject);});}

test('exact original title is retained, including spaces, Unicode, punctuation and long labels',()=>{
 const exact='  Cafe\u0301 <活動> &「原名」🧩 '+('繁體中文標題'.repeat(30))+'  ';
 const value=parseSessionTitles(entry(A.toUpperCase(),exact));assert.equal(value.titles.get(A),exact);assert.equal(value.diagnostics.accepted,1);assert.ok(value.titles.get(A).length>120);
});
test('newest valid timestamp wins; ties follow physical append order, not guessed titles',()=>{
 const raw=entry(A,'第一次','2026-11-02T01:00:00Z')+entry(A,'新名稱','2026-11-02T02:00:00Z')+entry(A,'晚到舊名稱','2026-11-02T01:30:00Z')+entry(A,'同時間最後名稱','2026-11-02T02:00:00Z')+entry(B,'另一個對話');
 const value=parseSessionTitles(raw);assert.equal(value.titles.get(A),'同時間最後名稱');assert.equal(value.titles.get(B),'另一個對話');assert.equal(value.diagnostics.records,5);
});
test('invalid UUID, unsafe or empty name, missing time and malformed line are ignored, never rewritten',()=>{
 const rows=[entry('made-up','錯誤ID'),entry(A,''),entry(A,' \t '),entry(A,'換\n行'),entry(A,'方向\u202e控制'),entry(A,'x'.repeat(TITLE_LIMITS.nameLength+1)),entry(A,'缺時間','not-a-timestamp'),JSON.stringify({id:{toString:'invalid'},thread_name:'錯誤型別',updated_at:'2026-11-02T01:00:00Z'})+'\n','{bad json\n'];
 const value=parseSessionTitles(rows.join('')+entry(B,'有效原名'));assert.deepEqual([...value.titles],[[B,'有效原名']]);assert.equal(value.diagnostics.invalid_records,9);assert.throws(()=>parseSessionTitles('x'.repeat(TITLE_LIMITS.bytes+1)),/bound/);
});
test('fixed metadata file is read-only, cache is isolated, and a real rename invalidates mtime cache',async t=>{
 const f=await fixture(t);await fs.writeFile(f.index,entry(A,'原生合成對話標題'));const before=await fs.readFile(f.index),reader=createCodexTitleReader({codexHome:f.home});
 let result=await reader.read();assert.equal(result.diagnostics.cached,false);result.titles.set(A,'不得污染cache');result=await reader.read();assert.equal(result.diagnostics.cached,true);assert.equal(result.titles.get(A),'原生合成對話標題');assert.deepEqual(await fs.readFile(f.index),before);
 await fs.appendFile(f.index,entry(A,'重新命名後的原樣標題','2026-11-02T02:00:00Z'));result=await reader.read();assert.equal(result.diagnostics.cached,false);assert.equal(result.titles.get(A),'重新命名後的原樣標題');
 const replacement=path.join(f.home,'replacement.jsonl');await fs.writeFile(replacement,entry(B,'替換索引的真正名稱'));await fs.rename(replacement,f.index);result=await reader.read();assert.equal(result.diagnostics.cached,false);assert.ok(!result.titles.has(A));assert.equal(result.titles.get(B),'替換索引的真正名稱');
});
test('missing, oversized, invalid UTF-8 and nonregular metadata fail closed without stale names',async t=>{
 const f=await fixture(t),reader=createCodexTitleReader({codexHome:f.home});assert.equal((await reader.read()).diagnostics.status,'missing');
 await fs.writeFile(f.index,entry(A,'先前名稱'));assert.equal((await reader.read()).titles.size,1);await fs.writeFile(f.index,Buffer.from([0xff,0xfe]));let value=await reader.read();assert.equal(value.diagnostics.status,'invalid_utf8');assert.equal(value.titles.size,0);
 await fs.writeFile(f.index,'x'.repeat(TITLE_LIMITS.bytes+1));assert.equal((await reader.read()).diagnostics.status,'size_exceeded');await fs.unlink(f.index);await fs.mkdir(f.index);assert.equal((await reader.read()).diagnostics.status,'index_untrusted');
});
test('linked metadata and linked home are rejected, with ordinary private home kept independent',async t=>{
 const f=await fixture(t),other=path.join(f.home,'other');await fs.mkdir(other);const file=path.join(other,'real.jsonl');await fs.writeFile(file,entry(A,'不應讀取的連結'));
 try{await fs.symlink(file,f.index);}catch(error){if(['EPERM','EACCES'].includes(error.code)){t.diagnostic('OS file-symlink privilege unavailable; junction and fixed-file tests still run');}else throw error;}
 if(await fs.lstat(f.index).catch(()=>null))assert.equal((await createCodexTitleReader({codexHome:f.home}).read()).diagnostics.status,'index_untrusted');
 const linked=path.join(f.home,'linked-home');await fs.symlink(other,linked,process.platform==='win32'?'junction':'dir');assert.equal((await createCodexTitleReader({codexHome:linked}).read()).diagnostics.status,'home_untrusted');
});
test('true HTTP presentation uses exact native rename for typed cards without changing stored plan; no-observe stays private',async t=>{
 const f=await fixture(t),state=path.join(f.home,'state-v2.json'),legacy=path.join(f.home,'state.json');await report({statePath:state,sessionId:A,payload:{title:'模型自訂標題不得覆蓋原生名稱',goal:'原有目標',current:'原有目前工作',next:'原有下一步'}});const stored=await fs.readFile(state);
 await fs.writeFile(f.index,entry(A,'原生合成對話標題'));const server=await createBoardServer({root:f.home,state,legacyState:legacy,codexHome:f.home,port:0});t.after(()=>new Promise(r=>server.close(r)));
 let response=await wire(server),row=response.value.projects.find(p=>p.id===A);assert.equal(response.status,200);assert.equal(row.conversation_title,'原生合成對話標題');assert.equal(row.conversation_title_source,'codex_session_index');assert.equal(row.title,'模型自訂標題不得覆蓋原生名稱');assert.equal(row.goal,'原有目標');assert.equal(row.current,'原有目前工作');assert.deepEqual(row.tasks,[]);
 await fs.appendFile(f.index,entry(A,'  原生新標題，不修剪空白  ','2026-11-02T02:00:00Z'));response=await wire(server);assert.equal(response.value.projects[0].conversation_title,'  原生新標題，不修剪空白  ');assert.deepEqual(await fs.readFile(state),stored);
 const off=await createBoardServer({root:f.home,state,legacyState:legacy,codexHome:f.home,observeCodex:false,port:0});t.after(()=>new Promise(r=>off.close(r)));response=await wire(off);assert.equal(response.value.projects[0].conversation_title,null);assert.equal(response.value.projects[0].conversation_title_source,'unavailable');assert.equal(response.value.conversation_titles.status,'disabled');
 const unknown=await createBoardServer({root:f.home,state,legacyState:legacy,codexHome:path.join(f.home,'missing-private-home'),port:0});t.after(()=>new Promise(r=>unknown.close(r)));response=await wire(unknown);assert.equal(response.value.projects[0].conversation_title,null);assert.equal(response.value.projects[0].title,'模型自訂標題不得覆蓋原生名稱');
});
