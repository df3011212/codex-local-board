/** Bounded project architecture store; independent of chat-progress storage. */
import * as fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

export const PLAN_SOURCE='agent_project_plans';
export const PLAN_LIMITS=Object.freeze({storeBytes:8*1024*1024,payloadBytes:512*1024,sessions:100,nodes:512,depth:8,references:64,evidence:8,dependencies:64,title:180,goal:1200,summary:2400,detail:2000,label:300,path:1200,url:2400});
export const PLAN_STATUSES=Object.freeze(['not_started','pending','in_progress','source_ready','passed','done','frozen','blocked']);
const FINISHED=new Set(['passed','done','frozen']),UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const now=()=>new Date().toISOString();
function invalid(code){const e=new Error('專案架構資料不合法：'+code);e.planCode=code;throw e;}
function keys(value,allowed,required=[]){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k))||required.some(k=>!Object.hasOwn(value,k)))invalid('FIELDS');}
function list(value,limit){if(!Array.isArray(value)||value.length>limit)invalid('CAPACITY');return value;}
function redact(value){return value
 .replace(/-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-\r\n]*PRIVATE KEY-----|$)/g,'[REDACTED PRIVATE KEY]')
 .replace(/\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{15,}|github_pat_[A-Za-z0-9_]{15,}|AKIA[A-Z0-9]{16})\b/g,'[REDACTED]')
 .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi,'Bearer [REDACTED]')
 .replace(/((?:password|passwd|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|secret|cookie|token)["']?[ \t]*[=:][ \t]*(?:\r?\n[ \t]*)?)[^\r\n]*/gi,'$1[REDACTED]')
 .replace(/((?:密碼|密码|暗碼|暗码|API\s*金鑰|API\s*密钥|管理令牌|存取令牌|認證令牌)["']?[ \t]*(?:[:：=]|為|为|是)[ \t]*(?:\r?\n[ \t]*)?)[^\r\n]*/gi,'$1[REDACTED]')
 .replace(/((?:^|\n)[ \t]*(?:password|passwd|密碼|密码|暗碼|暗码|API\s*金鑰|API\s*密钥|管理令牌|存取令牌|認證令牌)[ \t]*\r?\n[ \t]*)[^\r\n]*/gi,'$1[REDACTED]')
 .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi,'$1[REDACTED]@')
 .replace(/([?&](?:token|key|api_key|password|secret|auth|access_token|code)=)[^&#\s]+/gi,'$1[REDACTED]');}
function text(value,limit,required=false){if(typeof value!=='string'||value.length>limit||/[\x00-\x08\x0b-\x1f\x7f]/.test(value)||required&&!value.trim())invalid('TEXT');return redact(value);}
function id(value){if(typeof value!=='string'||!ID.test(value)||redact(value)!==value)invalid('NODE_ID');return value;}
export function planSessionId(value){if(typeof value!=='string'||!UUID.test(value))invalid('SESSION_ID');return value.toLowerCase();}
function timestamp(value,nullable=false){if(value===null&&nullable)return null;if(typeof value!=='string'||value.length>40||!Number.isFinite(Date.parse(value)))invalid('TIMESTAMP');return value;}
function evidence(values=[],limit=PLAN_LIMITS.evidence,{reference=false}={}){return list(values,limit).map(raw=>{
 if(typeof raw==='string'&&!reference)raw={label:raw};keys(raw,['label','path','url'],['label']);const out={label:text(raw.label,PLAN_LIMITS.label,true)};
 if(raw.path!==undefined)out.path=text(raw.path,PLAN_LIMITS.path,true);
 if(raw.url!==undefined){let url;try{url=new URL(text(raw.url,PLAN_LIMITS.url,true));}catch{invalid('REFERENCE_URL');}if(!['https:','http:'].includes(url.protocol))invalid('REFERENCE_URL');url.username='';url.password='';for(const key of [...url.searchParams.keys()])if(/token|password|secret|auth|api.?key|^key$|^code$/i.test(key))url.searchParams.set(key,'[REDACTED]');out.url=url.href;}
 if(reference&&!out.path&&!out.url)invalid('REFERENCE_TARGET');return out;
});}
function source(value){keys(value,['kind','label','references'],['kind','label','references']);if(!['document','generated'].includes(value.kind))invalid('SOURCE_KIND');const refs=evidence(value.references,PLAN_LIMITS.references,{reference:true});if(value.kind==='document'&&!refs.length)invalid('DOCUMENT_REFERENCE');return{kind:value.kind,label:text(value.label,PLAN_LIMITS.label,true),references:refs};}
function status(value,proof){if(!PLAN_STATUSES.includes(value))invalid('STATUS');if(FINISHED.has(value)&&!proof.length)invalid('COMPLETION_EVIDENCE');return value;}
function nodes(value){
 const result=list(value,PLAN_LIMITS.nodes).map(raw=>{keys(raw,['id','parent_id','title','kind','status','detail','evidence','depends_on'],['id','parent_id','title','kind','status']);if(!['phase','module','task'].includes(raw.kind))invalid('NODE_KIND');const proof=evidence(raw.evidence),deps=list(raw.depends_on??[],PLAN_LIMITS.dependencies).map(id);if(new Set(deps).size!==deps.length)invalid('DUPLICATE_DEPENDENCY');return{id:id(raw.id),parent_id:raw.parent_id===null?null:id(raw.parent_id),title:text(raw.title,PLAN_LIMITS.title,true),kind:raw.kind,status:status(raw.status,proof),detail:text(raw.detail??'',PLAN_LIMITS.detail),evidence:proof,depends_on:deps};});
 if(!result.length)invalid('EMPTY_PLAN');const byId=new Map(result.map(n=>[n.id,n]));if(byId.size!==result.length)invalid('DUPLICATE_NODE');const children=new Map(result.map(n=>[n.id,[]]));
 for(const node of result){if(node.parent_id!==null){if(!byId.has(node.parent_id))invalid('MISSING_PARENT');children.get(node.parent_id).push(node.id);}for(const dependency of node.depends_on)if(!byId.has(dependency))invalid('MISSING_DEPENDENCY');}
 for(const node of result){const seen=new Set();let current=node;while(current){if(seen.has(current.id))invalid('CYCLE');seen.add(current.id);if(seen.size>PLAN_LIMITS.depth)invalid('DEPTH');current=current.parent_id===null?null:byId.get(current.parent_id);}const count=children.get(node.id).length;if(node.kind==='task'&&count||node.kind!=='task'&&!count)invalid('LEAF_KIND');}
 const visited=new Set(),visiting=new Set();function visit(key){if(visiting.has(key))invalid('CYCLE');if(visited.has(key))return;visiting.add(key);const node=byId.get(key);for(const next of [...children.get(key),...node.depends_on])visit(next);visiting.delete(key);visited.add(key);}for(const node of result)visit(node.id);return result;
}
export function normalizeProjectPlan(value){keys(value,['session_id','title','goal','summary','source','nodes','updated_at'],['session_id','title','goal','source','nodes','updated_at']);return{session_id:planSessionId(value.session_id),title:text(value.title,PLAN_LIMITS.title,true),goal:text(value.goal,PLAN_LIMITS.goal,true),summary:text(value.summary??'',PLAN_LIMITS.summary),source:source(value.source),nodes:nodes(value.nodes),updated_at:timestamp(value.updated_at)};}
export function emptyProjectPlans(){return{schema_version:1,source:PLAN_SOURCE,updated_at:null,projects:[]};}
export function validateProjectPlansStore(value){keys(value,['schema_version','source','updated_at','projects'],['schema_version','source','updated_at','projects']);if(value.schema_version!==1||value.source!==PLAN_SOURCE)invalid('STORE_SOURCE');const projects=list(value.projects,PLAN_LIMITS.sessions).map(normalizeProjectPlan);if(new Set(projects.map(p=>p.session_id)).size!==projects.length)invalid('DUPLICATE_SESSION');return{schema_version:1,source:PLAN_SOURCE,updated_at:timestamp(value.updated_at,true),projects};}
function progress(tasks){const total=tasks.length,completed=tasks.filter(n=>FINISHED.has(n.status)&&n.evidence.length).length;return{completed,total,percent:total?Math.floor(completed*100/total):null,kind:'evidenced_leaf_tasks'};}
export function presentPlan(value){const plan=normalizeProjectPlan(value),children=new Map(plan.nodes.map(n=>[n.id,[]])),byId=new Map(plan.nodes.map(n=>[n.id,n]));for(const n of plan.nodes)if(n.parent_id!==null)children.get(n.parent_id).push(n.id);const descendants=new Map();function leaves(key){if(descendants.has(key))return descendants.get(key);const node=byId.get(key),tasks=node.kind==='task'?[node]:children.get(key).flatMap(leaves);descendants.set(key,tasks);return tasks;}return{...plan,nodes:plan.nodes.map(n=>({...n,progress:progress(leaves(n.id))})),progress:progress(plan.nodes.filter(n=>n.kind==='task'))};}

async function boundedJSON(filename,maximum,{missing}={}){let handle;try{const expected=await fs.lstat(filename);if(!expected.isFile()||expected.isSymbolicLink()||expected.size>maximum)invalid('FILE_SIZE_OR_TYPE');handle=await fs.open(filename,constants.O_RDONLY|(constants.O_NOFOLLOW||0));const stat=await handle.stat(),after=await fs.lstat(filename);if(!stat.isFile()||after.isSymbolicLink()||stat.ino!==expected.ino||stat.dev!==expected.dev||stat.ino!==after.ino||stat.dev!==after.dev)invalid('UNTRUSTED_PATH');const buffer=Buffer.alloc(maximum+1);let count=0;while(count<buffer.length){const r=await handle.read(buffer,count,buffer.length-count,count);if(!r.bytesRead)break;count+=r.bytesRead;}if(count>maximum)invalid('FILE_SIZE_OR_TYPE');try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,count)).replace(/^\uFEFF/,''));}catch{invalid('JSON');}}catch(e){if(e.code==='ENOENT'&&missing!==undefined)return structuredClone(missing);throw e;}finally{await handle?.close();}}
export async function readPlanPayload(filename){return boundedJSON(filename,PLAN_LIMITS.payloadBytes);}
export async function readProjectPlans(filename){return validateProjectPlansStore(await boundedJSON(path.resolve(filename),PLAN_LIMITS.storeBytes,{missing:emptyProjectPlans()}));}
async function directory(target){const absolute=path.resolve(target),root=path.parse(absolute).root;let current=root;for(const segment of path.relative(root,absolute).split(path.sep).filter(Boolean)){current=path.join(current,segment);let stat;try{stat=await fs.lstat(current);}catch(e){if(e.code!=='ENOENT')throw e;await fs.mkdir(current,{mode:0o700});stat=await fs.lstat(current);}if(!stat.isDirectory()||stat.isSymbolicLink())invalid('UNTRUSTED_PATH');}return absolute;}
function alive(pid){try{process.kill(pid,0);return true;}catch(e){return e.code!=='ESRCH';}}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function atomicUpdate(filename,update,{timeoutMs=10000}={}){
 if(!path.isAbsolute(filename)||path.extname(filename).toLowerCase()!=='.json'||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)invalid('STATE_PATH');filename=path.resolve(filename);await directory(path.dirname(filename));
 // Resolve existing aliases before choosing the lock name, while still
 // refusing a linked/nonregular store instead of following it for writing.
 try{const stat=await fs.lstat(filename);if(!stat.isFile()||stat.isSymbolicLink())invalid('UNTRUSTED_PATH');filename=await fs.realpath(filename);}catch(e){if(e.code!=='ENOENT')throw e;filename=path.join(await fs.realpath(path.dirname(filename)),path.basename(filename));}
 const lock=path.join(path.dirname(filename),`.${path.basename(filename)}.plan.lock`),nonce=randomUUID(),deadline=Date.now()+timeoutMs;let handle,temporary;
 while(!handle){try{handle=await fs.open(lock,'wx',0o600);await handle.writeFile(JSON.stringify({pid:process.pid,nonce}));await handle.sync();}catch(e){if(e.code!=='EEXIST')throw e;let recovery;try{recovery=await fs.open(lock+'.recovery','wx',0o600);const owner=await boundedJSON(lock,1024);if(Number.isSafeInteger(owner.pid)&&owner.pid>0&&!alive(owner.pid)){await fs.unlink(lock);continue;}}catch{/* Unknown lock owners fail closed rather than being overwritten. */}finally{if(recovery){await recovery.close();await fs.unlink(lock+'.recovery').catch(()=>{});}}if(Date.now()>=deadline)invalid('WRITER_BUSY');await wait(25);}}
 try{const before=await readProjectPlans(filename),after=validateProjectPlansStore(await update(before)),bytes=Buffer.from(JSON.stringify(after,null,2)+'\n');if(bytes.length>PLAN_LIMITS.storeBytes)invalid('STORE_FULL');temporary=path.join(path.dirname(filename),`.${path.basename(filename)}.${randomUUID()}.tmp`);const output=await fs.open(temporary,'wx',0o600);try{await output.writeFile(bytes);await output.sync();}finally{await output.close();}await fs.rename(temporary,filename);temporary=null;return after;}
 finally{await handle.close();if(temporary)await fs.unlink(temporary).catch(()=>{});const owner=await boundedJSON(lock,1024).catch(()=>null);if(owner?.nonce===nonce)await fs.unlink(lock);}
}
function payloadBytes(value){let encoded;try{encoded=JSON.stringify(value);}catch{invalid('JSON');}if(typeof encoded!=='string'||Buffer.byteLength(encoded)>PLAN_LIMITS.payloadBytes)invalid('PAYLOAD_FULL');}
function patchNodes(value){keys(value,['nodes'],['nodes']);const result=list(value.nodes,PLAN_LIMITS.nodes).map(raw=>{keys(raw,['id','status','detail','evidence'],['id']);if(Object.keys(raw).length<2)invalid('EMPTY_PATCH');id(raw.id);return raw;});if(!result.length)invalid('EMPTY_PATCH');if(new Set(result.map(v=>v.id)).size!==result.length)invalid('DUPLICATE_NODE');return result;}
export async function writeProjectPlan(filename,sessionId,payload,{patch=false,timeoutMs=10000}={}){
 const session=planSessionId(sessionId);payloadBytes(payload);let replacement,updates;
 if(patch)updates=patchNodes(payload);else{keys(payload,['title','goal','summary','source','nodes'],['title','goal','source','nodes']);replacement=normalizeProjectPlan({...payload,session_id:session,updated_at:now()});}
 return atomicUpdate(filename,store=>{const index=store.projects.findIndex(p=>p.session_id===session);let next;
  if(patch){if(index<0)invalid('PLAN_NOT_FOUND');const old=store.projects[index],existing=new Map(old.nodes.map(n=>[n.id,n]));for(const change of updates)if(!existing.has(change.id))invalid('NODE_NOT_FOUND');const map=new Map(updates.map(n=>[n.id,n]));next=normalizeProjectPlan({...old,updated_at:now(),nodes:old.nodes.map(node=>map.has(node.id)?{...node,...map.get(node.id)}:node)});}
  else next=replacement;
  if(index<0){if(store.projects.length>=PLAN_LIMITS.sessions)invalid('SESSION_CAPACITY');store.projects.push(next);}else store.projects[index]=next;store.updated_at=now();return store;
 },{timeoutMs});
}
