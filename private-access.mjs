/** Private Tailscale HTTPS entry. No public Funnel, shell commands or LAN bind.
 * Official CLI: https://tailscale.com/docs/reference/tailscale-cli/serve
 * ServeConfig: https://github.com/tailscale/tailscale/blob/main/ipn/serve.go
 */
import * as fs from 'node:fs/promises';
import {constants} from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {createHash,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath,pathToFileURL} from 'node:url';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const execute=promisify(execFile);
const MAX_BODY=32*1024*1024;
export const PHONE_ROUTES=Object.freeze(['/','/app.js','/styles.css','/plan-handoff.js','/state.json','/config.json']);
const INTERNAL='/__codex_phone_control';
const fingerprint=root=>createHash('sha256').update(root).digest('hex');
const equal=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const wait=ms=>new Promise(done=>setTimeout(done,ms));
export class PhoneAccessError extends Error{}
function requireValue(ok,message){if(!ok)throw new PhoneAccessError(message);}
function object(v){return v!==null&&typeof v==='object'&&!Array.isArray(v);}
function canonical(v){if(Array.isArray(v))return v.map(canonical);if(object(v))return Object.fromEntries(Object.keys(v).sort().filter(k=>!(object(v[k])&&Object.keys(v[k]).length===0)).map(k=>[k,canonical(v[k])]));return v;}
function port(value){const n=Number(value);requireValue(/^\d+$/.test(String(value))&&Number.isInteger(n)&&n>=1024&&n<=65535,'連接埠必須介於1024至65535。');return n;}
function headerCount(req,name){return req.rawHeaders.filter((v,i)=>i%2===0&&v.toLowerCase()===name).length;}
function safeSecret(a,b){if(typeof a!=='string'||typeof b!=='string')return false;const left=Buffer.from(a),right=Buffer.from(b);return left.length===right.length&&timingSafeEqual(left,right);}
export function tailnetName(status){
 requireValue(object(status)&&status.BackendState==='Running','請先在 Windows Tailscale 完成登入並連線，再重新啟用手機入口。');
 const name=String(status.Self?.DNSName??'').toLowerCase().replace(/\.$/,'');
 requireValue(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.[a-z0-9](?:[a-z0-9.-]{0,180}[a-z0-9])?\.ts\.net$/.test(name),'尚未取得有效的 Tailscale 私人網域；請檢查登入、MagicDNS 與 HTTPS 設定。');
 return name;
}
export function serveConfig(value){requireValue(value===null||object(value),'Tailscale Serve JSON格式無法辨識，未更動設定。');return value??{};}
function trees(config){const rows=[config];if(config.Foreground!==undefined){requireValue(object(config.Foreground),'未知的前景Serve設定，未更動。');for(const v of Object.values(config.Foreground)){requireValue(object(v),'未知的前景Serve設定，未更動。');rows.push(...trees(v));}}return rows;}
function authority(record){return `${record.dns_name}:${record.https_port}`;}
function origin(record){return `https://${record.dns_name}${record.https_port===443?'':`:${record.https_port}`}`;}
function target(record){return `http://127.0.0.1:${record.bridge_port}`;}
export function funnelConflict(config,httpsPort){return trees(serveConfig(config)).some(c=>Object.entries(c.AllowFunnel??{}).some(([key,v])=>key.endsWith(`:${httpsPort}`)&&v===true));}
export function portClaimed(config,httpsPort){return trees(serveConfig(config)).some(c=>Object.hasOwn(c.TCP??{},String(httpsPort))||Object.keys(c.Web??{}).some(h=>h.endsWith(`:${httpsPort}`))||Object.keys(c.AllowFunnel??{}).some(h=>h.endsWith(`:${httpsPort}`)));}
export function ownsServe(config,record){
 config=serveConfig(config);
 if(funnelConflict(config,record.https_port))return false;
 if(trees(config).slice(1).some(c=>portClaimed(c,record.https_port)))return false;
 const tcp=config.TCP?.[record.https_port],web=config.Web?.[authority(record)];
 return equal(tcp,{HTTPS:true})&&equal(web,{Handlers:{'/':{Proxy:target(record)}}})
   &&Object.keys(config.Web??{}).filter(k=>k.endsWith(`:${record.https_port}`)).every(k=>k===authority(record));
}
export function withoutOwned(config,record){
 const next=structuredClone(serveConfig(config));
 if(object(next.TCP))delete next.TCP[record.https_port];
 if(object(next.Web))delete next.Web[authority(record)];
 if(object(next.AllowFunnel)&&next.AllowFunnel[authority(record)]===false)delete next.AllowFunnel[authority(record)];
 return canonical(next);
}
async function readDocument(filename,limit=16384){
 const stat=await fs.lstat(filename);requireValue(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=limit,'私人入口記錄不是有效的一般檔案。');
 return JSON.parse(await fs.readFile(filename,'utf8'));
}
function validateRecord(r,root){
 requireValue(object(r)&&r.version===1&&r.root_fingerprint===fingerprint(root)&&/^[a-f0-9]{64}$/.test(r.control_secret??'')&&/^[a-f0-9-]{36}$/.test(r.instance_id??'')&&path.isAbsolute(r.tailscale_bin??''),'私人入口所有權記錄不符；未接管或停止其他服務。');
 for(const p of [r.board_port,r.bridge_port,r.https_port])port(p);
 requireValue(Number.isSafeInteger(r.board_pid)&&r.board_pid>0&&/^[a-f0-9-]{36}$/.test(r.board_instance_id??''),'原看板實例綁定缺失，請重新核對私人入口。');
 requireValue(r.board_port!==r.bridge_port&&r.https_port!==r.bridge_port,'入口連接埠設定相衝突。');
 tailnetName({BackendState:'Running',Self:{DNSName:r.dns_name}});
 return r;
}
async function runtime(root,create){
 const dir=path.join(root,'.runtime');
 if(create)await fs.mkdir(dir,{recursive:true,mode:0o700});
 try{const stat=await fs.lstat(dir);requireValue(stat.isDirectory()&&!stat.isSymbolicLink(),'私人入口.runtime不可為連結。');return dir;}catch(e){if(e.code==='ENOENT'&&!create)return null;throw e;}
}
async function readRecord(root){const dir=await runtime(root,false);if(!dir)return null;try{return validateRecord(await readDocument(path.join(dir,'phone-access.json')),root);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function writeRecord(root,record){const dir=await runtime(root,true),temp=path.join(dir,`.phone-access.${randomUUID()}.tmp`);await fs.writeFile(temp,JSON.stringify(record,null,2)+'\n',{flag:'wx',mode:0o600});try{await fs.rename(temp,path.join(dir,'phone-access.json'));}finally{await fs.unlink(temp).catch(()=>{});}}
async function withLock(root,fn){const dir=await runtime(root,true),filename=path.join(dir,'phone-access.lock');let lock;try{lock=await fs.open(filename,'wx',0o600);}catch(e){if(e.code==='EEXIST')throw Error('另一個手機入口操作仍在進行；未更動設定。');throw e;}try{await lock.writeFile(JSON.stringify({pid:process.pid,at:new Date().toISOString()}));return await fn();}finally{await lock.close();await fs.unlink(filename);}}
export function tailscaleServiceBinary(command){
 const match=typeof command==='string'&&command.match(/^\s*(?:"([^"]+\.exe)"|([A-Za-z]:\\.*?\.exe))(?:\s|$)/i);
 const executable=match&&(match[1]??match[2]);
 if(!executable||path.win32.basename(executable).toLowerCase()!=='tailscaled.exe')return null;
 return path.win32.join(path.win32.dirname(executable),'tailscale.exe');
}
export async function findTailscale(explicit){
 const names=explicit?[path.resolve(explicit)]:[...(process.platform==='win32'?[path.join(process.env.ProgramFiles??'C:\\Program Files','Tailscale','tailscale.exe')]:[]),...(process.env.PATH??'').split(path.delimiter).filter(Boolean).map(p=>path.join(p,process.platform==='win32'?'tailscale.exe':'tailscale'))];
 if(explicit)requireValue(path.isAbsolute(explicit),'--tailscale-bin必須使用絕對執行檔路徑。');
 for(const name of names){try{const stat=await fs.stat(name);if(stat.isFile()){await fs.access(name,constants.X_OK);return await fs.realpath(name);}}catch{}}
 if(!explicit&&process.platform==='win32'){
  try{
   const result=await execute('powershell.exe',['-NoProfile','-Command',"$s=Get-CimInstance Win32_Service -Filter \"Name='Tailscale'\";if($s){$s.PathName|ConvertTo-Json -Compress}"],{encoding:'utf8',windowsHide:true,shell:false,timeout:5000,maxBuffer:16384});
   const name=tailscaleServiceBinary(JSON.parse(result.stdout));
   if(name){const stat=await fs.stat(name);if(stat.isFile()){await fs.access(name,constants.X_OK);return await fs.realpath(name);}}
  }catch{}
 }
 throw new PhoneAccessError('尚未找到 Tailscale；請先從 https://tailscale.com/download/windows 安裝並完成本人登入，或用--tailscale-bin指定既有執行檔。');
}
export async function runTailscale(binary,args){
 try{const r=await execute(binary,args,{encoding:'utf8',windowsHide:true,shell:false,timeout:20000,maxBuffer:1024*1024});return r.stdout;}
 catch(error){const output=String(error.stderr??'')+String(error.stdout??'');if(/https|certificate|cert|enable|login|consent/i.test(output)){
   const candidate=output.match(/https:\/\/login\.tailscale\.com\/[^\s<>"']+/)?.[0];let guidance='';
   if(candidate){try{const url=new URL(candidate);if(url.protocol==='https:'&&url.hostname==='login.tailscale.com'&&!url.username&&!url.password)guidance=`\n請由本人開啟原生授權連結：${url.href}`;}catch{}}
   throw new PhoneAccessError('Tailscale尚待登入或HTTPS授權；請在原生Tailscale介面完成本人同意後重試，程式未代為登入。'+guidance);
  }throw new PhoneAccessError('Tailscale指令未完成；請確認Tailscale服務、登入及Serve權限，再使用Check-Phone-Board.cmd。');}
}
async function cliJSON(run,binary,args){let raw=await run(binary,args);requireValue(typeof raw==='string'&&Buffer.byteLength(raw)<=1024*1024,'Tailscale狀態回覆過大。');try{return JSON.parse(raw);}catch{throw Error('Tailscale狀態不是有效JSON，未更動設定。');}}
async function rawRequest({port,path:route,headers={},method='GET',limit=MAX_BODY}){
 return await new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port,path:route,method,headers:{Host:`127.0.0.1:${port}`,...headers},agent:false},res=>{const chunks=[];let size=0;res.on('data',chunk=>{size+=chunk.length;if(size>limit)res.destroy(Error('Response limit'));else chunks.push(chunk);});res.on('error',reject);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));});req.setTimeout(7000,()=>req.destroy(Error('Timeout')));req.on('error',reject);req.end();});
}
async function boardHealth(root,boardPort){
 const record=await readDocument(path.join(root,'.runtime','node-server.json'));
 requireValue(record.version===2&&record.port===boardPort&&record.root_fingerprint===fingerprint(root),'請先使用本資料夾的Open-Board.cmd開啟本機看板。');
 const response=await rawRequest({port:boardPort,path:'/healthz',limit:4096});
 const h=JSON.parse(response.body.toString('utf8'));
 requireValue(response.status===200&&h.service==='codex-local-board'&&h.version===2&&h.pid===record.pid&&h.instance_id===record.instance_id&&h.root_fingerprint===record.root_fingerprint,'本機看板所有權無法核對；未代理其他服務。');
 return h;
}
export async function authorizePrivateRequest({root,record,run=runTailscale}){
 try{
  if(!ownsServe(serveConfig(await cliJSON(run,record.tailscale_bin,['serve','status','--json'])),record))return false;
  const board=await boardHealth(root,record.board_port);
  return board.pid===record.board_pid&&board.instance_id===record.board_instance_id&&board.root_fingerprint===record.root_fingerprint;
 }catch{return false;}
}
async function bridgeHealth(record){try{const response=await rawRequest({port:record.bridge_port,path:INTERNAL,headers:{'X-Codex-Phone-Control':record.control_secret},limit:4096});const h=JSON.parse(response.body.toString('utf8'));return response.status===200&&h.service==='codex-board-phone-bridge'&&h.instance_id===record.instance_id&&h.root_fingerprint===record.root_fingerprint&&h.pid===record.pid;}catch{return false;}}
async function stopBridge(record){if(!await bridgeHealth(record))return false;await rawRequest({port:record.bridge_port,path:INTERNAL+'/stop',method:'POST',headers:{'X-Codex-Phone-Control':record.control_secret},limit:4096});for(let n=0;n<30;n++){if(!await bridgeHealth(record))return true;await wait(100);}throw Error('私人橋接尚未關閉；未強制終止任何程序。');}
async function startBridge(root,record){
 const dir=await runtime(root,true),log=await fs.open(path.join(dir,'phone-access.log'),'a',0o600);
 try{const child=spawn(process.execPath,[path.join(root,'private-access.mjs'),'bridge','--root',root,'--instance-id',record.instance_id],{cwd:root,detached:true,windowsHide:true,shell:false,stdio:['ignore',log.fd,log.fd]});let failure;child.on('error',e=>{failure=e;});child.unref();record.pid=child.pid;await writeRecord(root,record);for(let n=0;n<40;n++){if(failure)throw failure;if(await bridgeHealth(record))return;await wait(100);}throw Error('私人橋接未能啟動，請檢查專用連接埠是否已使用。');}finally{await log.close();}
}

/** A deliberately tiny proxy. The primary board never accepts a remote Host.
 * authorize is rechecked before each data request, not inferred from headers.
 */
export async function createPrivateBridge({record,authorize,upstreamPort=record.board_port,port:listenPort=record.bridge_port}){
 let closed=false;
 const server=http.createServer(async(req,res)=>{
  const finish=(status,text)=>{res.writeHead(status,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Connection':'close'});res.end(text);};
  if(req.socket.remoteAddress!=='127.0.0.1'||headerCount(req,'host')!==1)return finish(403,'入口主機不符。');
  const host=String(req.headers.host??'').toLowerCase();
  const internalHost=`127.0.0.1:${server.address()?.port}`;
  if(req.url===INTERNAL||req.url===INTERNAL+'/stop'){
   if(host!==internalHost||headerCount(req,'x-codex-phone-control')!==1||!safeSecret(req.headers['x-codex-phone-control'],record.control_secret)||headerCount(req,'origin')!==0)return finish(403,'未授權的本機控制。');
   if(req.url===INTERNAL&&req.method==='GET'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store','Connection':'close'});return res.end(JSON.stringify({service:'codex-board-phone-bridge',pid:process.pid,instance_id:record.instance_id,root_fingerprint:record.root_fingerprint}));}
   if(req.url===INTERNAL+'/stop'&&req.method==='POST'){finish(200,'已關閉私人橋接。');closed=true;server.close();return;}
   return finish(405,'不支援的控制方法。');
  }
  const expected=record.https_port===443?record.dns_name:authority(record);
  if(host!==expected)return finish(403,'入口主機不符。');
  if(headerCount(req,'origin')>1||(req.headers.origin!==undefined&&req.headers.origin!==origin(record)))return finish(403,'請從私人HTTPS入口開啟看板。');
  if(req.method!=='GET')return finish(405,'手機入口只接受GET。');
  if((req.url??'').length>2048)return finish(414,'路徑過長。');
  if(!PHONE_ROUTES.includes(req.url))return finish(404,'找不到固定看板路由。');
  if(req.headers['transfer-encoding']!==undefined||(req.headers['content-length']!==undefined&&req.headers['content-length']!=='0'))return finish(400,'GET不可帶入資料。');
  try{
   requireValue(await authorize(),'私人Serve設定已變更。');
   const upstream=await rawRequest({port:upstreamPort,path:req.url});
   requireValue(upstream.status===200&&!upstream.headers.location,'上游狀態無效。');
   const wanted=req.url==='/'?'text/html':req.url.endsWith('.js')?'text/javascript':req.url.endsWith('.css')?'text/css':'application/json';
   requireValue(String(upstream.headers['content-type']??'').split(';')[0]===wanted,'上游內容格式不符。');
   // Nothing is streamed before the final binding check. A board restart or
   // Serve/Funnel change during the upstream read must not release old data.
   requireValue(await authorize(),'讀取期間私人入口或原看板實例已變更。');
   const headers={'Cache-Control':'no-store','Connection':'close','Content-Length':upstream.body.length};
   for(const name of ['content-type','content-security-policy','x-content-type-options','referrer-policy','x-frame-options','permissions-policy'])if(upstream.headers[name]!==undefined)headers[name]=upstream.headers[name];
   res.writeHead(200,headers);res.end(upstream.body);
  }catch{return finish(503,'私人入口暫時無法核對安全設定或本機看板；未提供資料。');}
 });
 server.requestTimeout=10000;server.headersTimeout=5000;server.maxHeadersCount=32;server.maxConnections=8;
 server.on('connection',socket=>socket.setTimeout(10000,()=>socket.destroy()));
 server.on('upgrade',(_,socket)=>socket.destroy());server.on('connect',(_,socket)=>{socket.end('HTTP/1.1 405 Method Not Allowed\r\nConnection: close\r\n\r\n');});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen({host:'127.0.0.1',port:listenPort,exclusive:true},resolve);});
 return server;
}

export async function privateAccess(options,dependencies={}){
 const root=await fs.realpath(path.resolve(options.root??HERE)),action=options.action??'status';
 requireValue(['enable','disable','status'].includes(action),'請使用enable、disable或status。');
 const run=dependencies.run??runTailscale,checkBoard=dependencies.boardHealth??boardHealth,health=dependencies.bridgeHealth??bridgeHealth,start=dependencies.startBridge??startBridge,stop=dependencies.stopBridge??stopBridge;
 const work=async()=>{
  let record=await readRecord(root);
  if(action==='disable'&&!record)return {status:'not_owned',message:'此資料夾沒有持有手機入口，未更動其他服務。'};
  let binary,dns,config;
  try{
   binary=record?.tailscale_bin??await findTailscale(options.tailscaleBin);
   dns=tailnetName(await cliJSON(run,binary,['status','--json']));
   config=serveConfig(await cliJSON(run,binary,['serve','status','--json']));
  }catch(error){
   if(action==='disable'&&record){const owned=await health(record);if(owned)await stop(record);return {status:owned?'bridge_stopped_cleanup_pending':'unverified_cleanup_pending',message:owned?'本工具橋接已關閉；Tailscale暫不可用，Serve設定尚待確認，記錄已保留。恢復Tailscale後請再次執行Close-Phone-Board.cmd。':'無法核對Tailscale與橋接，未停止其他程序。請恢復Tailscale後再次執行Close-Phone-Board.cmd。'};}
   throw error;
  }
  if(action==='status'){
   let main=false;if(record){try{const h=await checkBoard(root,record.board_port);main=h.pid===record.board_pid&&h.instance_id===record.board_instance_id&&dns===record.dns_name;}catch{}}
   const ready=Boolean(record&&main&&ownsServe(config,record)&&await health(record));
   return {status:ready?'enabled':'disabled_or_unverified',url:ready?origin(record)+'/':null,message:'手機須已連入獲准的Tailscale網路；本命令未修改Serve設定。'};
  }
  if(action==='disable'){
   if(!record)return {status:'not_owned',message:'此資料夾沒有持有手機入口，未更動其他服務。'};
   if(!portClaimed(config,record.https_port)){await stop(record);await fs.unlink(path.join(root,'.runtime','phone-access.json'));return {status:'disabled',message:'本入口的Serve設定已不存在；已關閉可驗證的橋接並移除本工具記錄。'};}
   if(!ownsServe(config,record)){if(await health(record))await stop(record);throw new PhoneAccessError('入口設定已由其他操作變更或開啟Funnel；已停止可驗證的本工具橋接，未修改他人的Serve設定。');}
   const others=withoutOwned(config,record);
   await run(binary,['serve','--bg',`--https=${record.https_port}`,'--set-path=/','off']);
   const after=serveConfig(await cliJSON(run,binary,['serve','status','--json']));
   requireValue(!portClaimed(after,record.https_port)&&equal(canonical(after),others),'Serve停用後設定不符，未接管其他服務。');
   await stop(record);await fs.unlink(path.join(root,'.runtime','phone-access.json'));
   return {status:'disabled',message:'已停用本看板的手機私人入口；本機看板仍保留。'};
  }
  const boardPort=port(options.boardPort??record?.board_port??8787),bridgePort=port(options.bridgePort??record?.bridge_port??8788),httpsPort=port(options.httpsPort??record?.https_port??8443);
  requireValue(new Set([boardPort,bridgePort,httpsPort]).size===3,'本機、橋接與HTTPS連接埠必須不同。');
  const mainBoard=await checkBoard(root,boardPort);
  if(record){
   requireValue(record.dns_name===dns&&record.board_port===boardPort&&record.bridge_port===bridgePort&&record.https_port===httpsPort,'既有入口參數不同，請先停用並核對，未覆寫。');
   if(funnelConflict(config,httpsPort)){if(await health(record))await stop(record);throw Error('此HTTPS連接埠已允許公開Funnel；私人橋接已停用，請先人工核對設定。');}
   requireValue(ownsServe(config,record)||!portClaimed(config,httpsPort),'既有Serve設定已變更，未接管。');
   const changedBoard=record.board_pid!==mainBoard.pid||record.board_instance_id!==mainBoard.instance_id;
   if(changedBoard&&await health(record))await stop(record);
   record.board_pid=mainBoard.pid;record.board_instance_id=mainBoard.instance_id;
   if(!changedBoard&&ownsServe(config,record)&&await health(record))return {status:'enabled',reused:true,url:origin(record)+'/'};
  }else{
   requireValue(!portClaimed(config,httpsPort),'此HTTPS連接埠已有其他Serve或Funnel服務；請改用--https-port，未覆寫。');
   record={version:1,pid:null,root_fingerprint:fingerprint(root),instance_id:randomUUID(),control_secret:randomBytes(32).toString('hex'),dns_name:dns,tailscale_bin:binary,board_port:boardPort,bridge_port:bridgePort,https_port:httpsPort,board_pid:mainBoard.pid,board_instance_id:mainBoard.instance_id};
  }
  const others=withoutOwned(config,record);
  await writeRecord(root,record);
  if(!await health(record)){record.instance_id=randomUUID();record.control_secret=randomBytes(32).toString('hex');await writeRecord(root,record);await start(root,record);}
  if(!ownsServe(config,record)){
   try{await run(binary,['serve','--bg',`--https=${httpsPort}`,'--set-path=/',target(record)]);}catch(error){await stop(record).catch(()=>{});throw error;}
  }
  const after=serveConfig(await cliJSON(run,binary,['serve','status','--json']));
  if(!ownsServe(after,record)||!equal(withoutOwned(after,record),others)){await stop(record).catch(()=>{});throw new PhoneAccessError('Serve結果或其他服務設定不符，已停止私人橋接，未接管其他設定。');}
  return {status:'enabled',url:origin(record)+'/',message:'僅供獲准的Tailscale成員查看；手機開啟Tailscale後使用此HTTPS網址。'};
 };
 return action==='status'?await work():await withLock(root,work);
}

export async function main(argv=process.argv.slice(2)){
 const action=argv.shift()??'status',values={};
 const allowed=new Set(['--root','--board-port','--bridge-port','--https-port','--tailscale-bin','--instance-id']);
 for(let i=0;i<argv.length;i+=2){requireValue(allowed.has(argv[i])&&!Object.hasOwn(values,argv[i])&&typeof argv[i+1]==='string'&&!argv[i+1].startsWith('--'),'未知、重複或缺少的指令參數。');values[argv[i]]=argv[i+1];}
 const root=await fs.realpath(path.resolve(values['--root']??HERE));
 if(action==='bridge'){
  const record=await readRecord(root);requireValue(record&&record.instance_id===values['--instance-id'],'私人橋接授權已失效。');
  const authorize=()=>authorizePrivateRequest({root,record});
  const server=await createPrivateBridge({record,authorize});
  for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>server.close());
  return server;
 }
 requireValue(!values['--instance-id'],'此參數僅供內部橋接啟動。');
 const result=await privateAccess({action,root,boardPort:values['--board-port'],bridgePort:values['--bridge-port'],httpsPort:values['--https-port'],tailscaleBin:values['--tailscale-bin']});
 console.log(JSON.stringify(result,null,2));return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(error=>{console.error(error instanceof PhoneAccessError?error.message:'手機私人入口未完成；請確認本資料夾Open-Board、Tailscale狀態與私人入口記錄，未接管或強制關閉其他服務。');process.exitCode=1;});
