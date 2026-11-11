/** Bounded loopback board and semantic checkpoint mirror. Node standard library only. */
import * as fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import {createHash, randomUUID, randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const ROOT=path.dirname(fileURLToPath(import.meta.url));
export const LIMITS=Object.freeze({stateBytes:8*1024*1024,payloadBytes:64*1024,configBytes:16384,legacyBytes:262144,sessions:500,tasks:200,agents:32,events:30,groups:12,evidence:8,metrics:20});
export const STATUSES=['not_started','pending','in_progress','source_ready','passed','done','frozen','blocked'];
export const FINISHED=new Set(['passed','done','frozen']);
export const SOURCE='agent_semantic_reports';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
export const now=()=>new Date().toISOString();
export function uuid(value){if(typeof value!=='string'||!UUID.test(value))throw Error('A real session UUID is required');return value.toLowerCase();}
export function identity(value){if(typeof value!=='string'||!ID.test(value))throw Error('Invalid stable identifier');return value;}
export function keys(value,allowed,required=[]){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k))||required.some(k=>!Object.hasOwn(value,k)))throw Error('Unexpected or missing structured fields');}
export function redact(value){return value
 .replace(/-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\r\n]*PRIVATE KEY-----/g,'[REDACTED PRIVATE KEY]')
 .replace(/\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{15,}|github_pat_[A-Za-z0-9_]{15,}|AKIA[A-Z0-9]{16})\b/g,'[REDACTED]')
 .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi,'Bearer [REDACTED]')
 .replace(/((?:password|passwd|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|secret|cookie|token)["']?[ \t]*[=:][ \t]*(?:\r?\n[ \t]*)?)[^\r\n]*/gi,'$1[REDACTED]')
 .replace(/((?:密碼|密码|暗碼|暗码|API\s*金鑰|API\s*密钥|管理令牌|存取令牌|訪問令牌|访问令牌|認證令牌|认证令牌)["']?[ \t]*(?:[:：=]|為|为|是)[ \t]*(?:\r?\n[ \t]*)?)[^\r\n]*/gi,'$1[REDACTED]')
 .replace(/((?:^|\n)[ \t]*(?:password|passwd|密碼|密码|暗碼|暗码|API\s*金鑰|API\s*密钥|管理令牌|存取令牌|訪問令牌|访问令牌|認證令牌|认证令牌)[ \t]*\r?\n[ \t]*)[^\r\n]*/gi,'$1[REDACTED]')
 .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi,'$1[REDACTED]@')
 .replace(/([?&](?:token|key|api_key|password|secret|auth|access_token|code)=)[^&#\s]+/gi,'$1[REDACTED]');}
export function text(value,max=1200){if(typeof value!=='string'||value.length>max||/[\x00-\x08\x0b-\x1f]/.test(value))throw Error('Invalid or oversized short text');return redact(value);}
function stamp(value,nullable=true){if(value===null&&nullable)return null;if(typeof value!=='string'||value.length>40||!Number.isFinite(Date.parse(value)))throw Error('Invalid report timestamp');return value;}
export function list(value,max){if(!Array.isArray(value)||value.length>max)throw Error('Structured collection capacity exceeded');return value;}
export function evidence(value=[]){return list(value,LIMITS.evidence).map(raw=>{
 if(typeof raw==='string')raw={label:raw};keys(raw,['label','url','path'],['label']);const result={label:text(raw.label,300)};
 if(!result.label.trim())throw Error('Evidence needs a clear label');
 if(raw.url!==undefined){const url=new URL(text(raw.url,2000));if(!['http:','https:'].includes(url.protocol))throw Error('Only HTTP evidence links are allowed');url.username='';url.password='';for(const key of url.searchParams.keys())if(/token|password|secret|auth|api.?key|^key$|^code$/i.test(key))url.searchParams.set(key,'[REDACTED]');result.url=url.href;}
 if(raw.path!==undefined)result.path=text(raw.path,1000);return result;
});}
function status(value,proof){if(!STATUSES.includes(value))throw Error('Unknown reported status');if(FINISHED.has(value)&&!proof.length)throw Error('Completion requires nonempty evidence');return value;}
function unique(rows){const ids=new Set();for(const row of rows){if(ids.has(row.id))throw Error('Duplicate stable identifier');ids.add(row.id);}return rows;}
export function groups(value=[]){return unique(list(value,LIMITS.groups).map(v=>{keys(v,['id','title'],['id','title']);return {id:identity(v.id),title:text(v.title,120)};}));}
export function tasks(value=[],groupRows=[]){const ids=new Set(groupRows.map(g=>g.id));return unique(list(value,LIMITS.tasks).map(v=>{
 keys(v,['id','title','group','status','detail','evidence'],['id','title','group','status']);const proof=evidence(v.evidence);
 if(!ids.has(v.group))throw Error('Task refers to an unknown group');return {id:identity(v.id),title:text(v.title,180),group:v.group,status:status(v.status,proof),detail:text(v.detail??''),evidence:proof};
}));}
export function agent(value,stored=false){
 keys(value,['id','session_id','role','assignment','current','next','status','detail','updated_at','evidence',...(stored?['owner_session_id']:[])],['id','role','status']);const proof=evidence(value.evidence);
 const out={id:identity(value.id),session_id:value.session_id==null?null:uuid(value.session_id),role:text(value.role,120),assignment:text(value.assignment??''),current:text(value.current??''),next:text(value.next??''),status:status(value.status,proof),detail:text(value.detail??''),updated_at:stamp(value.updated_at??null),evidence:proof};
 if(stored&&value.owner_session_id)out.owner_session_id=uuid(value.owner_session_id);return out;
}
export function completed(value=[]){return list(value,LIMITS.tasks).map(v=>{keys(v,['title','detail','evidence'],['title','evidence']);const proof=evidence(v.evidence);if(!proof.length)throw Error('Completed summary requires evidence');return {title:text(v.title,180),detail:text(v.detail??''),evidence:proof};});}
export function suggestions(value=[]){return unique(list(value,8).map(v=>{keys(v,['id','title','detail'],['id','title']);const title=text(v.title,180);if(!title.trim())throw Error('Suggestion needs a clear title');return{id:identity(v.id),title,detail:text(v.detail??'')};}));}
export function metrics(value=[]){return list(value,LIMITS.metrics).map(v=>{
 keys(v,['label','value','unit'],['label','value']);const label=text(v.label,120),unit=text(v.unit??'',40);
 if(unit.includes('%')||label.includes('%')||typeof v.value==='string'&&v.value.includes('%')||/百分比|完成率|進度比例/i.test(label))throw Error('Report measured counts; milestone percentages are derived, never supplied');
 if(typeof v.value!=='string'&&(typeof v.value!=='number'||!Number.isFinite(v.value)||Math.abs(v.value)>1e12))throw Error('Invalid measured metric');
 return {label,value:typeof v.value==='string'?text(v.value,120):v.value,unit};
});}
export function emptyProject(session){return {id:uuid(session),semantic_version:2,session_id:uuid(session),title:'對話標題待同步',goal:'',current:'',next:'',summary:'',phase:'',groups:[],tasks:[],completed:[],suggestions:[],agents:[],events:[],metrics:[],updated_at:null,sync:{status:'waiting',reported_at:null},history_dropped:0};}
export function validateProject(value){
 keys(value,['id','semantic_version','session_id','title','goal','current','next','summary','phase','groups','tasks','completed','suggestions','agents','events','metrics','updated_at','sync','history_dropped'],['id','semantic_version','session_id','title','goal','current','next','groups','tasks','agents','events','sync']);
 if(value.semantic_version!==2||uuid(value.id)!==uuid(value.session_id))throw Error('Semantic project identity mismatch');
 const result={...emptyProject(value.id),title:text(value.title,120),goal:text(value.goal),current:text(value.current),next:text(value.next),summary:text(value.summary??''),phase:text(value.phase??'',120),groups:groups(value.groups),completed:completed(value.completed),agents:unique(list(value.agents,LIMITS.agents).map(a=>agent(a,true))),metrics:metrics(value.metrics),updated_at:stamp(value.updated_at??null)};
 result.suggestions=suggestions(value.suggestions??[]);
 result.tasks=tasks(value.tasks,result.groups);result.events=list(value.events,LIMITS.events).map(v=>{keys(v,['at','text','kind'],['at','text']);if(v.kind!==undefined&&v.kind!=='semantic')throw Error('Raw tool events are not accepted');return {at:stamp(v.at,false),text:text(v.text),kind:'semantic'};});
 keys(value.sync,['status','reported_at'],['status','reported_at']);if(!['waiting','synced'].includes(value.sync.status))throw Error('Unknown semantic synchronization status');result.sync={status:value.sync.status,reported_at:stamp(value.sync.reported_at)};
 if(!Number.isSafeInteger(value.history_dropped??0)||(value.history_dropped??0)<0)throw Error('Invalid history counter');result.history_dropped=value.history_dropped??0;return result;
}
export function validateSemanticState(state){if(state?.schema_version!==1||state?.source!==SOURCE)throw Error('This is not the semantic mirror; legacy files must remain separate');keys(state,['schema_version','source','updated_at','demo','projects'],['schema_version','source','projects']);return {schema_version:1,source:SOURCE,updated_at:stamp(state.updated_at??null),demo:false,projects:unique(list(state.projects,LIMITS.sessions).map(validateProject))};}
export const emptyState=()=>({schema_version:1,source:SOURCE,updated_at:null,demo:false,projects:[]});
export function parseShortJSON(raw){try{return JSON.parse(raw.replace(/^\uFEFF/,''));}catch{throw Error('Invalid local JSON document; input contents are not shown');}}
export async function readJSON(filename,limit,missing){let handle;try{handle=await fs.open(filename,'r');const stat=await handle.stat();if(!stat.isFile()||stat.size>limit)throw Error('Local document exceeds bounded size');const buffer=Buffer.alloc(limit+1);let count=0;while(count<buffer.length){const {bytesRead}=await handle.read(buffer,count,buffer.length-count,count);if(!bytesRead)break;count+=bytesRead;}if(count>limit)throw Error('Local document exceeds bounded size');return parseShortJSON(buffer.subarray(0,count).toString('utf8'));}catch(error){if(error.code==='ENOENT'&&missing!==undefined)return structuredClone(missing);throw error;}finally{await handle?.close();}}
export async function readSemantic(filename){return validateSemanticState(await readJSON(filename,LIMITS.stateBytes,emptyState()));}
const sleep=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));
function alive(pid){try{process.kill(pid,0);return true;}catch(error){return error.code==='EPERM';}}
export function lockedUpdate(filename,update,{timeoutMs=10000}={}){
 return lockedJsonUpdate(filename,update,{
  timeoutMs,read:readSemantic,validate:validateSemanticState,maxBytes:LIMITS.stateBytes,
  tooLarge:'Semantic store full (8MiB); explicitly archive it instead of dropping conversations',
 });
}
export async function lockedJsonUpdate(filename,update,{timeoutMs,read,validate,maxBytes,tooLarge}){
 filename=path.resolve(filename);await fs.mkdir(path.dirname(filename),{recursive:true});const lock=path.join(path.dirname(filename),`.${path.basename(filename)}.node.lock`),nonce=randomUUID(),deadline=Date.now()+timeoutMs;let handle;
 while(!handle){try{handle=await fs.open(lock,'wx',0o600);await handle.writeFile(JSON.stringify({pid:process.pid,nonce,at:now()}));await handle.sync();}catch(error){if(error.code!=='EEXIST')throw error;
   // Serialize stale-lock recovery separately: two recovering writers must
   // never unlink a newly acquired live lock after observing the same dead PID.
   let recovery;try{recovery=await fs.open(lock+'.recovery','wx',0o600);const previous=await readJSON(lock,1024);if(Number.isSafeInteger(previous.pid)&&previous.pid>0&&!alive(previous.pid)){await fs.unlink(lock);continue;}}catch{}finally{if(recovery){await recovery.close();await fs.unlink(lock+'.recovery').catch(()=>{});}}
   if(Date.now()>=deadline)throw Error('Semantic writer busy; no update was discarded or written');await sleep(25);
 }}
 let temporary;
 try{const current=await read(filename),next=validate(await update(current));const raw=Buffer.from(JSON.stringify(next,null,2)+'\n');if(raw.length>maxBytes)throw Error(tooLarge);temporary=path.join(path.dirname(filename),`.${path.basename(filename)}.${randomUUID()}.tmp`);const output=await fs.open(temporary,'wx',0o600);try{await output.writeFile(raw);await output.sync();}finally{await output.close();}await fs.rename(temporary,filename);temporary=null;return next;
 }finally{await handle.close();if(temporary)await fs.unlink(temporary).catch(()=>{});const owner=await readJSON(lock,1024).catch(()=>null);if(owner?.nonce===nonce)await fs.unlink(lock);}
}
function legacyState(value){
 keys(value,['schema_version','updated_at','demo','projects'],['schema_version','projects']);if(value.schema_version!==1)throw Error('Unsupported legacy schema');list(value.projects,20);
 for(const p of value.projects){keys(p,['id','title','phase','summary','groups','tasks','agents','events'],['id','title','groups','tasks','agents','events']);identity(p.id);text(p.title,120);text(p.phase??'',120);text(p.summary??'');groups(p.groups);list(p.tasks,200);list(p.agents,32);list(p.events,30);
  for(const t of p.tasks){keys(t,['id','title','group','status','detail'],['id','title','group','status']);identity(t.id);text(t.title,180);text(t.detail??'');if(!STATUSES.includes(t.status))throw Error('Unknown legacy status');}
  for(const a of p.agents){keys(a,['id','role','status','detail'],['id','role','status']);identity(a.id);text(a.role,120);text(a.detail??'');if(!STATUSES.includes(a.status))throw Error('Unknown legacy agent status');}
  for(const e of p.events){keys(e,['at','text'],['at','text']);stamp(e.at);text(e.text,1000);}
 }
 const clean=v=>typeof v==='string'?redact(v):Array.isArray(v)?v.map(clean):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,clean(x)])):v;
 return clean(value);
}
function observedProject(p){
 if(p?.source!=='observed_public_messages'||p.semantic_version!==2||uuid(p.id)!==uuid(p.session_id)||p.sync?.status!=='observed')throw Error('Invalid public-message observation');
 for(const name of ['tasks','groups','completed','agents','events','metrics'])if(p[name]!==undefined&&(!Array.isArray(p[name])||p[name].length))throw Error('Observations must not infer milestones or agent assignments');
 return {...emptyProject(p.id),title:text(p.title,120),goal:text(p.goal??''),current:text(p.current??''),next:text(p.next??'等待 Codex 明確同步下一步。'),summary:text(p.summary??''),phase:text(p.phase??'',120),updated_at:stamp(p.updated_at??null),source:'observed_public_messages',sync:{status:'observed',reported_at:stamp(p.sync.reported_at??null)},progress:{completed:0,total:0,percent:null,kind:'not_reported'}};
}
export async function mergedState(statePath,legacyPath,observations={projects:[],diagnostics:{}},summaryPath){
 const semantic=await readSemantic(statePath),legacy=legacyPath?legacyState(await readJSON(legacyPath,LIMITS.legacyBytes,{schema_version:1,updated_at:null,demo:false,projects:[]})):{projects:[]};const ids=new Set(legacy.projects.map(p=>p.id));for(const p of semantic.projects)if(ids.has(p.id))throw Error('Legacy and session identities conflict; no conversation was hidden');
 const projects=semantic.projects.map(p=>({...p,progress:{completed:p.tasks.filter(t=>FINISHED.has(t.status)&&t.evidence.length).length,total:p.tasks.length,percent:p.tasks.length?Math.floor(p.tasks.filter(t=>FINISHED.has(t.status)&&t.evidence.length).length*100/p.tasks.length):null,kind:'explicit_milestones'}}));
 const typedIDs=new Set(projects.map(p=>p.id));let summaries=emptyState(),summaryStatus='waiting';
 if(summaryPath){
  const pathKey=value=>process.platform==='win32'?path.resolve(value).toLowerCase():path.resolve(value);
  if(pathKey(summaryPath)===pathKey(statePath))throw Error('Conversation summaries must remain separate from live reports');
  try{summaries=await readSemantic(summaryPath);summaryStatus=summaries.projects.length?'loaded':'waiting';}catch{summaryStatus='invalid';}
 }
 const summarized=summaries.projects.filter(p=>!typedIDs.has(p.id)).map(p=>{
  if(ids.has(p.id))throw Error('Legacy and summary identities conflict; no conversation was hidden');
  const done=p.tasks.filter(t=>FINISHED.has(t.status)&&t.evidence.length).length;
  return {...p,source:'conversation_summary',progress:{completed:done,total:p.tasks.length,percent:p.tasks.length?Math.floor(done*100/p.tasks.length):null,kind:'reported_milestones'}};
 });
 projects.push(...summarized);const structuredIDs=new Set(projects.map(p=>p.id));
 const observed=unique(list(observations.projects??[],LIMITS.sessions).map(observedProject)).filter(p=>!structuredIDs.has(p.id)&&!ids.has(p.id));
 const diagnostics={},counts=new Set(['discovered','scanned','returned','omitted','excluded_subagents','excluded_unknown','invalid_paths','unreadable_rollouts','malformed_lines','cache_hits','bytes_read','max_sessions','window_bytes']),observationStatuses=new Set(['ok','codex_home_missing','sqlite_unavailable','database_missing','database_untrusted','database_unreadable','schema_unsupported','capacity_exceeded','disabled','unavailable']);
 for(const [key,value]of Object.entries(observations.diagnostics??{}))if((key==='available'||key==='limited')&&typeof value==='boolean'||counts.has(key)&&Number.isSafeInteger(value)&&value>=0&&value<=1e12||key==='status'&&observationStatuses.has(value))diagnostics[key]=value;
 projects.push(...observed);projects.sort((a,b)=>(b.updated_at??'').localeCompare(a.updated_at??''));return {schema_version:1,updated_at:semantic.updated_at??summaries.updated_at??legacy.updated_at??null,demo:projects.length?false:Boolean(legacy.demo),projects:[...projects,...legacy.projects],capacity:{max_sessions:LIMITS.sessions,sessions:semantic.projects.length,max_bytes:LIMITS.stateBytes,full:semantic.projects.length>=LIMITS.sessions,summary_sessions:summarized.length,observed_sessions:observed.length,observed_max_sessions:LIMITS.sessions},summary_sync:{status:summaryStatus,sessions:summarized.length},observation:diagnostics};
}
const defaultConfig={schema_version:1,title:'每個聊天室的工作看板',subtitle:'每個對話的需求、目前工作、下一步與成果。',poll_seconds:5,complete_statuses:['done','passed','frozen'],show_agents:true,show_events:true};
export function validateConfig(v){keys(v,Object.keys(defaultConfig),Object.keys(defaultConfig));if(v.schema_version!==1||!Number.isInteger(v.poll_seconds)||v.poll_seconds<1||v.poll_seconds>60||typeof v.show_agents!=='boolean'||typeof v.show_events!=='boolean')throw Error('Invalid board display configuration');list(v.complete_statuses,8);if(v.complete_statuses.some(s=>!['done','passed','frozen'].includes(s)))throw Error('Source readiness is not completion');return {...v,title:text(v.title,120),subtitle:text(v.subtitle,300)};}
export async function createBoardServer({root=ROOT,state=path.join(root,'state-v2.json'),summaryState=path.join(root,'conversation-summaries.json'),planState=path.join(root,'project-plans.json'),legacyState:legacy=path.join(root,'state.json'),config=path.join(root,'config.json'),chatgptPilotState=path.join(root,'.runtime','chatgpt-pilot.json'),chatgptPlanDirectory=path.join(path.dirname(chatgptPilotState),'chatgpt-plans'),port=8787,instanceId=randomUUID(),observeCodex=true,codexHome=process.env.CODEX_HOME??path.join(os.homedir(),'.codex'),observationProvider,executionProvider}={}){
 root=await fs.realpath(root);instanceId=uuid(instanceId);const fingerprint=createHash('sha256').update(root).digest('hex');
 const pathKey=p=>process.platform==='win32'?path.resolve(p).toLowerCase():path.resolve(p);
 if([state,summaryState,legacy].filter(Boolean).some(p=>pathKey(p)===pathKey(planState)))throw Error('Project plans must remain separate from work reports');
 if([state,summaryState,legacy,planState,config].filter(Boolean).some(p=>pathKey(p)===pathKey(chatgptPilotState)))throw Error('ChatGPT pilot data must use a separate local file');
 const chatgptPlans=path.resolve(chatgptPlanDirectory);
 if([state,summaryState,legacy,planState,config,chatgptPilotState].filter(Boolean).some(p=>pathKey(path.dirname(p))===pathKey(chatgptPlans)))throw Error('ChatGPT plans must have a separate local directory');
 if(typeof observeCodex!=='boolean'||typeof codexHome!=='string'||observationProvider!==undefined&&typeof observationProvider!=='function'||executionProvider!==undefined&&typeof executionProvider!=='function')throw Error('Invalid read-only observation configuration');
 let provider=observationProvider;
 async function observations(){if(!observeCodex)return {projects:[],diagnostics:{status:'disabled'}};try{provider??=(await import('./codex-observer.mjs')).observeCodex;const value=await provider({codexHome,maxSessions:LIMITS.sessions,headBytes:131072,tailBytes:131072});return {projects:unique(list(value.projects,LIMITS.sessions).map(observedProject)),diagnostics:value.diagnostics??{}};}catch{return {projects:[],diagnostics:{status:'unavailable'}};}}
 async function presentedState(){
  const value=await mergedState(state,legacy,await observations(),summaryState);let labels={titles:new Map(),diagnostics:{available:false,status:observeCodex?'unavailable':'disabled'}};
  if(observeCodex)try{labels=await(await import('./codex-titles.mjs')).readCodexTitles({codexHome});}catch{}
  let execution={sessions:new Map(),diagnostics:{available:false,status:observeCodex?'unavailable':'disabled',checked_at:now()}};
  if(observeCodex)try{executionProvider??=(await import('./codex-execution.mjs')).readCodexExecution;const sessionIds=value.projects.map(project=>{try{return uuid(project.session_id??project.id);}catch{return null;}}).filter(Boolean);execution=await executionProvider({codexHome,sessionIds});}catch{}
  const checked=now(),available=execution?.diagnostics?.available===true&&execution?.sessions instanceof Map;
  value.execution={available,status:available?'ok':observeCodex?'unavailable':'disabled',checked_at:checked};
  const plans=new Map();let planStatus='waiting';
  try{const model=await import('./project-plan.mjs'),store=await model.readProjectPlans(planState);for(const plan of store.projects)plans.set(plan.session_id,model.presentPlan(plan));planStatus=plans.size?'loaded':'waiting';}catch{plans.clear();planStatus='invalid';}
  value.plan_sync={status:planStatus,sessions:plans.size};
  value.projects=value.projects.map(project=>{
   const id=project.session_id??project.id,live=execution?.sessions instanceof Map?execution.sessions.get(id):null;
   let status=available&&['running','idle'].includes(live?.status)&&live.source==='codex_agent_view'?live.status:'unknown',updated=null;
   if(status!=='unknown')try{updated=stamp(live.updated_at??null);}catch{}
   if(!updated)status='unknown';
   return {...project,plan:plans.get(id)??null,conversation_title:labels.titles.get(id)??null,conversation_title_source:labels.titles.has(id)?'codex_session_index':'unavailable',execution:{status,source:status==='unknown'?'unavailable':'codex_agent_view',updated_at:status==='unknown'?null:updated,checked_at:checked}};
  });
  value.conversation_titles=labels.diagnostics;return value;
 }
 const server=http.createServer(async(req,res)=>{
  const count=req.rawHeaders.filter((_,i)=>i%2===0&&req.rawHeaders[i].toLowerCase()==='host').length;const host=(req.headers.host??'').toLowerCase();const realPort=server.address()?.port;
  const finish=(status,message)=>{res.writeHead(status,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','Connection':'close'});res.end(message);};
  if(count!==1||![`127.0.0.1:${realPort}`,`localhost:${realPort}`].includes(host))return finish(403,'Untrusted local Host');
  const pilotRoute=req.url==='/chatgpt-pilot.json';
  const chatgptPlanRoute=req.url==='/chatgpt-plan.json'||req.url?.startsWith('/chatgpt-plan.json?');
  if(req.method!=='GET'&&!pilotRoute&&!chatgptPlanRoute)return finish(405,'GET only');if((req.url??'').length>2048)return finish(414,'Request path too long');
  const routes={'/':'index.html','/app.js':'app.js','/styles.css':'styles.css','/plan-handoff.js':'plan-handoff.js'};let data,type,statusCode=200;const nonce=randomBytes(18).toString('base64url'),extraHeaders={};
  try{
   if(pilotRoute||chatgptPlanRoute){
    const {handleChatgptPilot,handleChatgptPlan}=await import('./chatgpt-pilot.mjs');
    const localOrigin=`http://${host}`;
    const result=pilotRoute
     ?await handleChatgptPilot(req,chatgptPilotState,localOrigin)
     :await handleChatgptPlan(req,chatgptPilotState,chatgptPlans,localOrigin);
    statusCode=result.status;data=JSON.stringify(result.body);type='application/json; charset=utf-8';
    extraHeaders['Cross-Origin-Resource-Policy']='same-origin';
    if(result.allow)extraHeaders.Allow=result.allow;
   }
   else if(req.url==='/healthz'){data=JSON.stringify({status:'ok',service:'codex-local-board',version:2,pid:process.pid,root_fingerprint:fingerprint,instance_id:instanceId});type='application/json; charset=utf-8';}
   else if(req.url==='/state.json'){data=JSON.stringify(await presentedState());type='application/json; charset=utf-8';}
   else if(req.url==='/config.json'){data=JSON.stringify(validateConfig(await readJSON(config,LIMITS.configBytes,defaultConfig)));type='application/json; charset=utf-8';}
   else if(Object.hasOwn(routes,req.url)){const target=await fs.realpath(path.join(root,'web',routes[req.url]));if(!target.startsWith(root+path.sep))throw Error('Static source escaped root');const stat=await fs.stat(target);if(stat.size>512*1024)throw Error('Static source too large');data=await fs.readFile(target);type=req.url==='/'?'text/html; charset=utf-8':['/app.js','/plan-handoff.js'].includes(req.url)?'text/javascript; charset=utf-8':'text/css; charset=utf-8';if(req.url==='/')data=Buffer.from(data.toString('utf8').replaceAll('__BOARD_NONCE__',nonce));}
   else return finish(404,'Fixed route not found');
   res.writeHead(statusCode,{'Content-Type':type,'Content-Length':Buffer.byteLength(data),'Cache-Control':'no-store','Connection':'close','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'self'; connect-src 'self'; img-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,...extraHeaders});res.end(data);
  }catch{return finish(503,'Short local checkpoint temporarily unavailable');}
 });server.requestTimeout=5000;server.headersTimeout=5000;server.maxHeadersCount=32;server.maxConnections=32;server.on('connection',socket=>socket.setTimeout(5000,()=>socket.destroy()));await new Promise((resolve,reject)=>{server.once('error',reject);server.listen({host:'127.0.0.1',port,exclusive:true},resolve);});return server;
}
export function argumentsFor(argv,allowed,booleans=[]){const out={};for(let i=0;i<argv.length;i++){const key=argv[i];if(!allowed.includes(key)||Object.hasOwn(out,key))throw Error('Unknown or duplicate command option');if(booleans.includes(key))out[key]=true;else{if(i+1>=argv.length||argv[i+1].startsWith('--'))throw Error('Missing command option value');out[key]=argv[++i];}}return out;}
export async function main(argv=process.argv.slice(2)){
 if(argv[0]!=='serve')throw Error('Usage: board-node.mjs serve --root <source> --state <semantic.json> [--summary-state <summaries.json>] [--plan-state <project-plans.json>] --legacy-state <legacy.json> --config <config.json> --port 8787 [--instance-id UUID] [--codex-home path] [--no-observe] [--open]');const a=argumentsFor(argv.slice(1),['--root','--state','--summary-state','--plan-state','--legacy-state','--config','--port','--instance-id','--open','--no-observe','--codex-home'],['--open','--no-observe']);const root=path.resolve(a['--root']??ROOT),port=Number(a['--port']??8787);if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Port must be1024–65535');const server=await createBoardServer({root,state:a['--state']?path.resolve(a['--state']):path.join(root,'state-v2.json'),summaryState:a['--summary-state']?path.resolve(a['--summary-state']):path.join(root,'conversation-summaries.json'),planState:a['--plan-state']?path.resolve(a['--plan-state']):path.join(root,'project-plans.json'),legacyState:a['--legacy-state']?path.resolve(a['--legacy-state']):path.join(root,'state.json'),config:a['--config']?path.resolve(a['--config']):path.join(root,'config.json'),port,instanceId:a['--instance-id'],observeCodex:!a['--no-observe'],codexHome:a['--codex-home']?path.resolve(a['--codex-home']):undefined});const url=`http://127.0.0.1:${port}`;console.log(`Semantic board: ${url}`);
 if(a['--open']){const command=process.platform==='win32'?'rundll32.exe':process.platform==='darwin'?'open':'xdg-open';const args=process.platform==='win32'?['url.dll,FileProtocolHandler',url]:[url];const child=spawn(command,args,{detached:true,stdio:'ignore',windowsHide:true});child.on('error',()=>console.error('Browser could not open; use the printed loopback URL'));child.unref();}
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('Board could not start; check local paths, schema, port and options.');process.exitCode=1;});
