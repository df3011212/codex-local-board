import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import net from 'node:net';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createBoardServer,emptyState} from '../board-node.mjs';
import {createPrivateBridge,PHONE_ROUTES,ownsServe,withoutOwned,funnelConflict,portClaimed,tailnetName,tailscaleServiceBinary,privateAccess,authorizePrivateRequest} from '../private-access.mjs';

const hash=root=>createHash('sha256').update(root).digest('hex');
const base=()=>({version:1,pid:process.pid,root_fingerprint:'a'.repeat(64),instance_id:randomUUID(),control_secret:'b'.repeat(64),dns_name:'board.example.ts.net',tailscale_bin:process.execPath,board_port:8787,bridge_port:8788,https_port:8443,board_pid:process.pid,board_instance_id:randomUUID()});
const config=r=>({TCP:{[r.https_port]:{HTTPS:true}},Web:{[`${r.dns_name}:${r.https_port}`]:{Handlers:{'/':{Proxy:`http://127.0.0.1:${r.bridge_port}`}}}}});
async function fixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'codex-phone-test-'));assert.equal(path.dirname(dir),await fs.realpath(os.tmpdir()));assert.ok(path.basename(dir).startsWith('codex-phone-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));await fs.mkdir(path.join(dir,'web'));await fs.mkdir(path.join(dir,'.runtime'));await fs.writeFile(path.join(dir,'state-v2.json'),JSON.stringify(emptyState()));await fs.writeFile(path.join(dir,'web/index.html'),'<script nonce="__BOARD_NONCE__" src="/app.js"></script>');await fs.writeFile(path.join(dir,'web/app.js'),'globalThis.safeFixture=true;');await fs.writeFile(path.join(dir,'web/plan-handoff.js'),'globalThis.BoardPlanHandoff={};');await fs.writeFile(path.join(dir,'web/styles.css'),'body{color:white}');return dir;}
async function close(server){await new Promise(done=>server.close(done));}
async function wire(port,route,{method='GET',headers={}}={}){return await new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port,path:route,method,headers:{Host:'board.example.ts.net:8443',Connection:'close',...headers}},res=>{const b=[];res.on('data',v=>b.push(v));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(b).toString()}));});req.on('error',reject);req.end();});}
async function raw(port,headers){return await new Promise((resolve,reject)=>{let value='';const socket=net.connect(port,'127.0.0.1',()=>socket.end(`GET /state.json HTTP/1.1\r\n${headers}\r\nConnection: close\r\n\r\n`));socket.on('data',chunk=>value+=chunk);socket.on('end',()=>resolve(Number(value.match(/^HTTP\/1\.1 (\d+)/)?.[1])));socket.on('error',reject);});}
async function realPair(t){const root=await fixture(t),instance=randomUUID();const board=await createBoardServer({root,port:0,instanceId:instance,observeCodex:false});t.after(()=>close(board));const r={...base(),root_fingerprint:hash(root),board_port:board.address().port,board_instance_id:instance};const boardRecord={version:2,port:r.board_port,pid:process.pid,root_fingerprint:r.root_fingerprint,instance_id:instance};await fs.writeFile(path.join(root,'.runtime/node-server.json'),JSON.stringify(boardRecord));let current=config(r);const authorize=()=>authorizePrivateRequest({root,record:r,run:async()=>JSON.stringify(current)});const bridge=await createPrivateBridge({record:r,authorize,port:0});t.after(()=>close(bridge));return {root,r,board,bridge,port:bridge.address().port,setConfig:v=>{current=v;}};}

test('real board keeps its Host guard; bridge serves only the six exact GET routes and preserves CSP nonce',async t=>{
 const f=await realPair(t);
 assert.equal((await wire(f.r.board_port,'/state.json')).status,403);
 for(const route of PHONE_ROUTES){const response=await wire(f.port,route);assert.equal(response.status,200,route);assert.equal(response.headers['cache-control'],'no-store');assert.equal(response.headers['x-content-type-options'],'nosniff');if(route==='/'){const nonce=response.body.match(/nonce="([^"]+)"/)[1];assert.ok(response.headers['content-security-policy'].includes(`nonce-${nonce}`));assert.ok(!response.body.includes('__BOARD_NONCE__'));}}
 assert.equal(f.bridge.address().address,'127.0.0.1');assert.equal(f.board.address().address,'127.0.0.1');
});

test('traversal, query, auth, Agent View and private-file routes never reach upstream',async t=>{
 const f=await realPair(t);
 for(const route of ['/healthz','/state-v2.json','/project-plans.json','/conversation-summaries.json','/.runtime/','/vendor/','/agent_report.mjs','/api/state','/api/viewer/exchange','/api/events','/web/','//state.json','/%73tate.json','/../state.json','/state.json?file=secret','http://elsewhere.invalid/state.json'])assert.equal((await wire(f.port,route)).status,404,route);
 for(const method of ['POST','PUT','PATCH','DELETE','OPTIONS','HEAD','TRACE'])assert.equal((await wire(f.port,'/state.json',{method})).status,405,method);
});

test('Host/Origin duplicates, wrong authorities and foreign origins are denied',async t=>{
 const f=await realPair(t);
 for(const host of ['foreign.invalid','127.0.0.1:8788','localhost:8788','board.example.ts.net:443','board.example.ts.net.','[::1]'])assert.equal((await wire(f.port,'/state.json',{headers:{Host:host}})).status,403,host);
 for(const origin of ['https://evil.invalid','null','http://board.example.ts.net:8443'])assert.equal((await wire(f.port,'/state.json',{headers:{Origin:origin}})).status,403,origin);
 assert.equal((await wire(f.port,'/state.json',{headers:{Origin:'https://board.example.ts.net:8443'}})).status,200);
 assert.equal(await raw(f.port,'Host: board.example.ts.net:8443\r\nHost: evil.invalid'),403);
 assert.equal(await raw(f.port,'Host: board.example.ts.net:8443\r\nOrigin: https://board.example.ts.net:8443\r\nOrigin: https://evil.invalid'),403);
});

test('every data request fails closed when Serve becomes public, foreign or unavailable',async t=>{
 const f=await realPair(t);assert.equal((await wire(f.port,'/state.json')).status,200);
 f.setConfig({...config(f.r),AllowFunnel:{'board.example.ts.net:8443':true}});assert.equal((await wire(f.port,'/state.json')).status,503);
 f.setConfig({TCP:{8443:{TCPForward:'localhost:22'}}});assert.equal((await wire(f.port,'/')).status,503);
 f.setConfig(null);assert.equal((await wire(f.port,'/state.json')).status,503);
});

test('replacement upstream with a different board instance never supplies data',async t=>{
 const f=await realPair(t);assert.equal((await wire(f.port,'/state.json')).status,200);
 // New instance on the same live test server is a precise ownership failure,
 // regardless of whether it occupies the same port/PID/root folder.
 const changed={version:2,port:f.r.board_port,pid:process.pid,root_fingerprint:f.r.root_fingerprint,instance_id:randomUUID()};
 await fs.writeFile(path.join(f.root,'.runtime/node-server.json'),JSON.stringify(changed));
 const response=await wire(f.port,'/state.json');assert.equal(response.status,503);assert.ok(!response.body.includes('projects'));
});

test('a foreign application replacing the upstream port is rejected before its state response',async t=>{
 const f=await realPair(t);await close(f.board);let dataRequests=0;
 const foreign=http.createServer((req,res)=>{if(req.url==='/state.json')dataRequests++;res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(req.url==='/healthz'?{status:'ok',service:'other-application',pid:process.pid}:{foreignSecret:'never proxy this'}));});
 await new Promise(done=>foreign.listen(f.r.board_port,'127.0.0.1',done));t.after(()=>close(foreign));
 const response=await wire(f.port,'/state.json');assert.equal(response.status,503);assert.equal(dataRequests,0);assert.ok(!response.body.includes('foreignSecret'));
});

test('non-ASCII control header is rejected without crashing the owned bridge',async t=>{
 const f=await realPair(t),headers={Host:`127.0.0.1:${f.port}`,'X-Codex-Phone-Control':'é'.repeat(64)};
 assert.equal((await wire(f.port,'/__codex_phone_control',{headers})).status,403);
 headers['X-Codex-Phone-Control']=f.r.control_secret;
 assert.equal((await wire(f.port,'/__codex_phone_control',{headers})).status,200);
});

test('an upstream instance replacement during the data read is denied before any payload is returned',async t=>{
 const root=await fixture(t),r={...base(),root_fingerprint:hash(root)};let active=r.board_instance_id,healthReads=0;
 const upstream=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'application/json'});if(req.url==='/healthz'){healthReads++;res.end(JSON.stringify({status:'ok',service:'codex-local-board',version:2,pid:r.board_pid,instance_id:active,root_fingerprint:r.root_fingerprint}));}else{active=randomUUID();res.end('{"FOREIGN_SECRET":"must never be forwarded"}');}});
 await new Promise(done=>upstream.listen(0,'127.0.0.1',done));t.after(()=>close(upstream));r.board_port=upstream.address().port;
 await fs.writeFile(path.join(root,'.runtime/node-server.json'),JSON.stringify({version:2,port:r.board_port,pid:r.board_pid,instance_id:r.board_instance_id,root_fingerprint:r.root_fingerprint}));
 const authorize=()=>authorizePrivateRequest({root,record:r,run:async()=>JSON.stringify(config(r))});const bridge=await createPrivateBridge({record:r,authorize,port:0});t.after(()=>close(bridge));
 const response=await wire(bridge.address().port,'/state.json');assert.equal(response.status,503);assert.ok(healthReads>=2);assert.ok(!response.body.includes('FOREIGN_SECRET'));
});

test('upstream redirects, Set-Cookie and user-supplied authentication/forwarding headers are not proxied',async t=>{
 let seen;let redirect=true;
 const upstream=http.createServer((req,res)=>{seen=req.headers;if(redirect){res.writeHead(302,{Location:'https://evil.invalid/'});res.end('secret redirect');}else{res.writeHead(200,{'Content-Type':'application/json','Set-Cookie':'secret=1'});res.end('{}');}});
 await new Promise(done=>upstream.listen(0,'127.0.0.1',done));t.after(()=>close(upstream));const r=base();const bridge=await createPrivateBridge({record:r,authorize:async()=>true,port:0,upstreamPort:upstream.address().port});t.after(()=>close(bridge));
 let response=await wire(bridge.address().port,'/state.json',{headers:{Authorization:'Bearer injected',Cookie:'private=1','X-Forwarded-Host':'evil.invalid'}});assert.equal(response.status,503);assert.ok(!response.body.includes('secret redirect'));
 assert.equal(seen.host,`127.0.0.1:${upstream.address().port}`);for(const key of ['authorization','cookie','x-forwarded-host'])assert.equal(seen[key],undefined);
 redirect=false;response=await wire(bridge.address().port,'/state.json');assert.equal(response.status,200);assert.equal(response.headers['set-cookie'],undefined);
});

test('Serve ownership is exact, handles foreground Funnel, and preserves unrelated services',()=>{
 const r=base(),own=config(r);assert.equal(ownsServe(own,r),true);const others={TCP:{9443:{HTTPS:true}},Web:{'other.example.ts.net:9443':{Handlers:{'/':{Proxy:'http://127.0.0.1:9900'}}}}};
 const combined={TCP:{...others.TCP,...own.TCP},Web:{...others.Web,...own.Web},Services:{'svc:separate':{TCP:{443:{HTTPS:true}}}}};assert.equal(ownsServe(combined,r),true);assert.deepEqual(withoutOwned(combined,r),{...others,Services:combined.Services});
 assert.equal(ownsServe({...own,AllowFunnel:{'board.example.ts.net:8443':true}},r),false);
 assert.equal(funnelConflict({Foreground:{test:{AllowFunnel:{'board.example.ts.net:8443':true}}}},8443),true);
 assert.equal(portClaimed({Foreground:{test:own}},8443),true);
 const extra=structuredClone(own);extra.Web['board.example.ts.net:8443'].Handlers['/other']={Proxy:'http://127.0.0.1:8000'};assert.equal(ownsServe(extra,r),false);
});

test('Tailscale prerequisites reject unauthenticated/malformed identity and support a non-system-drive official service path',()=>{
 assert.throws(()=>tailnetName({BackendState:'NeedsLogin'}),/登入/);assert.throws(()=>tailnetName({BackendState:'Running',Self:{DNSName:'evil.invalid'}}),/私人網域/);
 assert.equal(tailnetName({BackendState:'Running',Self:{DNSName:'board.example.ts.net.'}}),'board.example.ts.net');
 assert.equal(tailscaleServiceBinary('"A:\\Program Files\\Tailscale\\tailscaled.exe" --state=local'),'A:\\Program Files\\Tailscale\\tailscale.exe');
 assert.equal(tailscaleServiceBinary('"A:\\Program Files\\Other\\evil.exe"'),null);
});

test('enable/reuse/status/disable own only one dedicated endpoint and never reset other Serve settings',async t=>{
 const root=await fixture(t),others={TCP:{9443:{HTTPS:true}},Web:{'other.example.ts.net:9443':{Handlers:{'/':{Proxy:'http://127.0.0.1:9000'}}}}};let current=structuredClone(others),alive=false;
 const commands=[];const run=async(_,args)=>{commands.push(args);if(args[0]==='status')return JSON.stringify({BackendState:'Running',Self:{DNSName:'board.example.ts.net.'}});if(args[1]==='status')return JSON.stringify(current);if(args.at(-1)==='off'){delete current.TCP[8443];delete current.Web['board.example.ts.net:8443'];return '';}current.TCP[8443]={HTTPS:true};current.Web['board.example.ts.net:8443']={Handlers:{'/':{Proxy:'http://127.0.0.1:8788'}}};return '';};
 const instance=randomUUID(),deps={run,boardHealth:async()=>({pid:process.pid,instance_id:instance}),bridgeHealth:async()=>alive,startBridge:async(_,r)=>{alive=true;r.pid=process.pid;await fs.writeFile(path.join(root,'.runtime/phone-access.json'),JSON.stringify(r));},stopBridge:async()=>{alive=false;return true;}};
 const options={root,tailscaleBin:process.execPath};assert.equal((await privateAccess({...options,action:'enable'},deps)).status,'enabled');assert.equal((await privateAccess({...options,action:'enable'},deps)).reused,true);
 const before=await fs.readFile(path.join(root,'.runtime/phone-access.json'),'utf8');assert.equal((await privateAccess({...options,action:'status'},deps)).status,'enabled');assert.equal(await fs.readFile(path.join(root,'.runtime/phone-access.json'),'utf8'),before);
 assert.equal((await privateAccess({...options,action:'disable'},deps)).status,'disabled');assert.deepEqual(current,others);assert.equal(alive,false);assert.ok(commands.every(args=>!args.includes('reset')&&!args.includes('funnel')&&!args.includes('set-config')));
 assert.equal(commands.filter(args=>args[0]==='serve'&&args[1]==='--bg').length,2);
});

test('existing foreign/public endpoint and missing consent never overwrite Serve or expose a bridge',async t=>{
 const root=await fixture(t);let mutations=0,started=0;
 const run=async(_,args)=>{if(args[0]==='status')return JSON.stringify({BackendState:'Running',Self:{DNSName:'board.example.ts.net'}});if(args[1]==='status')return JSON.stringify({TCP:{8443:{HTTPS:true}},AllowFunnel:{'board.example.ts.net:8443':true}});mutations++;return '';};
 await assert.rejects(()=>privateAccess({root,action:'enable',tailscaleBin:process.execPath},{run,boardHealth:async()=>({pid:1,instance_id:randomUUID()}),startBridge:async()=>started++}),/其他Serve或Funnel/);assert.equal(mutations,0);assert.equal(started,0);
 await assert.rejects(()=>privateAccess({root,action:'status',tailscaleBin:process.execPath},{run:async()=>JSON.stringify({BackendState:'NeedsLogin'})}),/登入/);assert.equal(mutations,0);
});

test('unavailable Tailscale still closes only a verified own bridge and retains cleanup state',async t=>{
 for(const own of [true,false]){
  const root=await fixture(t),r={...base(),root_fingerprint:hash(root)};await fs.writeFile(path.join(root,'.runtime/phone-access.json'),JSON.stringify(r));let stopped=0,mutated=0;
  const deps={run:async(_,args)=>{if(args[0]==='status')return JSON.stringify({BackendState:'NeedsLogin'});mutated++;throw Error('unexpected mutation');},bridgeHealth:async()=>own,stopBridge:async()=>{stopped++;return true;}};
  const result=await privateAccess({root,action:'disable'},deps);assert.equal(result.status,own?'bridge_stopped_cleanup_pending':'unverified_cleanup_pending');assert.equal(stopped,own?1:0);assert.equal(mutated,0);assert.ok(await fs.stat(path.join(root,'.runtime/phone-access.json')));
 }
});

test('status never reports ready after the originally bound main board changes',async t=>{
 const root=await fixture(t),r={...base(),root_fingerprint:hash(root)};await fs.writeFile(path.join(root,'.runtime/phone-access.json'),JSON.stringify(r));
 const run=async(_,args)=>JSON.stringify(args[0]==='status'?{BackendState:'Running',Self:{DNSName:r.dns_name}}:config(r));
 const result=await privateAccess({root,action:'status'},{run,bridgeHealth:async()=>true,boardHealth:async()=>({pid:r.board_pid,instance_id:randomUUID()})});
 assert.equal(result.status,'disabled_or_unverified');assert.equal(result.url,null);
});

test('all Windows entry wrappers keep successful output visible and preserve the original exit code',async()=>{
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
 for(const file of ['Open-Phone-Board.cmd','Close-Phone-Board.cmd','Check-Phone-Board.cmd']){
  const source=await fs.readFile(path.join(root,file),'utf8');
  assert.match(source,/set "PHONE_EXIT=%ERRORLEVEL%"\r?\npause\r?\nendlocal & exit \/b %PHONE_EXIT%/);
  assert.ok(source.includes('"%~dp0runtime\\node.exe"'));assert.ok(!source.includes('powershell'));
 }
});
