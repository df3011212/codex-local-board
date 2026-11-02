/** Read-only execution metadata from an already installed Agent View monitor.
 * This is separate from task progress. No hooks, processes or credentials are
 * created; only explicit root-turn lifecycle states can mean "running".
 */
import * as fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const EXECUTION_LIMITS=Object.freeze({metadataBytes:16384,responseBytes:2*1024*1024,sessions:50,requestedSessions:500,timeoutMs:1200,freshMs:5*60*1000,futureSkewMs:5000});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN=/^[A-Za-z0-9_-]{43}$/;
const SOURCE='codex_agent_view';
function ordinary(value){return process.platform==='win32'?value.replace(/^\\\\\?\\([A-Za-z]:\\)/,'$1'):value;}
function milliseconds(value){return Number.isSafeInteger(value)&&value>=0;}
function iso(value){return milliseconds(value)&&Number.isFinite(new Date(value).getTime())?new Date(value).toISOString():null;}
function issue(code){const error=new Error('Execution metadata unavailable');error.executionCode=code;throw error;}
function unknown(reason='not_observed',updated=null){return{status:'unknown',source:SOURCE,updated_at:updated,reason};}
function signature(stat){return[stat.size,stat.mtimeMs,stat.ino,stat.dev].join(':');}

/** Deliberately never inspect agents, tools, recent_activities or task text. */
export function executionFromSession(session,checkedAtMs){
 const last=session?.last_seen_at_ms,updated=iso(last),turn=session?.root_turn,permission=session?.permission;
 if(!updated||!milliseconds(checkedAtMs)||last>checkedAtMs+EXECUTION_LIMITS.futureSkewMs)return unknown('invalid_timing');
 if(checkedAtMs-last>EXECUTION_LIMITS.freshMs||session.status==='completion_not_observed')return unknown('stale',updated);
 if(!turn||typeof turn!=='object'||turn.has_out_of_order_events!==false)return unknown('out_of_order',updated);
 if(session.status==='waiting_for_user'||permission?.status==='waiting_for_user')return unknown('waiting_for_user',updated);
 if(permission?.status!=='idle')return unknown('unrecognized_permission',updated);
 const started=turn.started_at_ms,stopped=turn.stopped_at_ms;
 if(!milliseconds(started)||started>last+EXECUTION_LIMITS.futureSkewMs)return unknown('invalid_timing',updated);
 if(turn.status==='running'&&session.status==='running'&&stopped===null)return{status:'running',source:SOURCE,updated_at:updated,reason:'root_turn_running'};
 if(turn.status==='completed'&&session.status==='completed'&&milliseconds(stopped)&&stopped>=started&&stopped<=last+EXECUTION_LIMITS.futureSkewMs)return{status:'idle',source:SOURCE,updated_at:updated,reason:'turn_stopped'};
 return unknown('root_turn_not_confirmed',updated);
}

async function runtimeMetadata(directory){
 const configured=path.resolve(ordinary(directory));let stat;
 try{stat=await fs.lstat(configured);}catch(e){if(e.code==='ENOENT')issue('runtime_missing');throw e;}
 if(!stat.isDirectory()||stat.isSymbolicLink())issue('runtime_untrusted');
 const root=await fs.realpath(configured),file=path.join(root,'runtime.json');
 let expected;try{expected=await fs.lstat(file);}catch(e){if(e.code==='ENOENT')issue('runtime_missing');throw e;}
 if(!expected.isFile()||expected.isSymbolicLink()||expected.size>EXECUTION_LIMITS.metadataBytes)issue('runtime_untrusted');
 const handle=await fs.open(file,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
 try{
  const opened=await handle.stat(),after=await fs.lstat(file);if(after.isSymbolicLink()||signature(opened)!==signature(expected)||signature(after)!==signature(opened))issue('runtime_untrusted');
  const buffer=Buffer.alloc(EXECUTION_LIMITS.metadataBytes+1);let count=0;while(count<buffer.length){const read=await handle.read(buffer,count,buffer.length-count,count);if(!read.bytesRead)break;count+=read.bytesRead;}
  if(count>EXECUTION_LIMITS.metadataBytes)issue('runtime_untrusted');
  const final=await handle.stat(),finalPath=await fs.lstat(file);if(finalPath.isSymbolicLink()||signature(final)!==signature(opened)||signature(finalPath)!==signature(opened))issue('runtime_untrusted');
  let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,count)));}catch{issue('invalid_runtime');}
  if(value?.schema_version!==1||value.host!=='127.0.0.1'||!Number.isInteger(value.port)||value.port<1||value.port>65535||typeof value.token!=='string'||!TOKEN.test(value.token))issue('invalid_runtime');
  // Keep only the fields needed for this one local request. Never return them.
  return{port:value.port,token:value.token};
 }finally{await handle.close();}
}

async function stateMetadata(runtime,{fetch:fetcher,timeoutMs}){
 let response;
 try{response=await fetcher(`http://127.0.0.1:${runtime.port}/api/state`,{method:'GET',headers:{Authorization:`Bearer ${runtime.token}`,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(timeoutMs)});}
 catch(e){issue(e?.name==='TimeoutError'||e?.name==='AbortError'?'request_timeout':'request_failed');}
 if(response.status===401||response.status===403)issue('unauthorized');if(!response.ok)issue('request_failed');
 const length=Number(response.headers.get('content-length'));if(Number.isFinite(length)&&length>EXECUTION_LIMITS.responseBytes){await response.body?.cancel().catch(()=>{});issue('response_capacity_exceeded');}
 const chunks=[];let size=0;
 try{for await(const chunk of response.body){size+=chunk.byteLength;if(size>EXECUTION_LIMITS.responseBytes)issue('response_capacity_exceeded');chunks.push(chunk);}}
 catch(e){if(e.executionCode)throw e;issue(e?.name==='TimeoutError'||e?.name==='AbortError'?'request_timeout':'response_invalid');}
 let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{issue('response_invalid');}
 if(value?.schema_version!==1||value.source_of_truth!=='hook'||!Array.isArray(value.sessions))issue('response_invalid');
 if(value.sessions.length>EXECUTION_LIMITS.sessions)issue('response_capacity_exceeded');
 return value.sessions;
}

/** The monitor directory follows Agent View's env/default, not CODEX_HOME.
 * No running-state cache is retained, so a failed poll immediately becomes
 * unknown rather than preserving a spinner from an earlier successful poll.
 */
export async function readCodexExecution(options={},dependencies={}){
 const checked=(dependencies.now||Date.now)(),checkedISO=iso(checked),sessions=new Map(),diagnostics={available:false,status:'unavailable',checked_at:checkedISO,observed_sessions:0,matched_sessions:0};
 const requested=options.sessionIds;
 if(!checkedISO||!Array.isArray(requested)||requested.length>EXECUTION_LIMITS.requestedSessions||requested.some(id=>typeof id!=='string'||!UUID.test(id)))return{sessions,diagnostics:{...diagnostics,status:'invalid_request'}};
 for(const id of requested)sessions.set(id.toLowerCase(),unknown());
 const directory=options.runtimeDirectory||process.env.CODEX_AGENT_VIEW_RUNTIME_DIR||path.join(os.homedir(),'.codex-agent-view'),timeoutMs=dependencies.timeoutMs??EXECUTION_LIMITS.timeoutMs;
 if(typeof directory!=='string'||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>EXECUTION_LIMITS.timeoutMs)return{sessions,diagnostics:{...diagnostics,status:'invalid_request'}};
 try{
  const runtime=await runtimeMetadata(directory),rows=await stateMetadata(runtime,{fetch:dependencies.fetch||globalThis.fetch,timeoutMs}),seen=new Set();
  const collected=new Map();for(const row of rows){const id=row?.session_id;if(typeof id!=='string'||!UUID.test(id)||seen.has(id.toLowerCase()))issue('response_invalid');seen.add(id.toLowerCase());if(sessions.has(id.toLowerCase()))collected.set(id.toLowerCase(),executionFromSession(row,checked));}
  for(const[id,value]of collected)sessions.set(id,value);diagnostics.available=true;diagnostics.status='ok';diagnostics.observed_sessions=rows.length;diagnostics.matched_sessions=collected.size;
 }catch(e){diagnostics.status=e.executionCode||'unavailable';for(const id of sessions.keys())sessions.set(id,unknown('source_unavailable'));}
 return{sessions,diagnostics};
}
