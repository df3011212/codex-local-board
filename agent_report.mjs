/** Short semantic progress mirror. Canonical work state remains claude-mem. */
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ROOT,LIMITS,SOURCE,uuid,identity,text,keys,groups,tasks,completed,metrics,agent,evidence,list,now,emptyProject,lockedUpdate,argumentsFor,readJSON,parseShortJSON} from './board-node.mjs';

export const EXAMPLE={title:'範例：以名稱選擇物品',goal:'請換成這個聊天室的實際目標',current:'請描述目前正在做的事，不抄工具名稱',next:'請描述下一個可驗證步驟',summary:'這是格式範例，不代表任何工作已完成。',phase:'建立檢查點',groups:[{id:'delivery',title:'交付關卡'}],tasks:[{id:'verify',title:'完成並核對實際驗證',group:'delivery',status:'pending',detail:'真正完成後才提供證據並改為passed或done。'}],agents:[],metrics:[]};

function mergeAgents(previous,updates,at){
 const rows=previous.map(v=>structuredClone(v));
 for(const update of list(updates,LIMITS.agents)){
  keys(update,['id','session_id','role','assignment','current','next','status','detail','evidence'],['id','role']);const index=rows.findIndex(v=>v.id===update.id);
  const merged={...(index<0?{id:update.id,role:update.role,status:'pending'}:rows[index]),...update,updated_at:at};
  const normalized=agent(merged,true);if(index<0)rows.push(normalized);else rows[index]=normalized;
 }
 if(rows.length>LIMITS.agents)throw Error('Agent capacity reached; explicitly retire an assignment instead of hiding it');return rows;
}

export async function report({statePath,sessionId,parentSessionId,agentId,role,payload}){
 const session=uuid(sessionId),parent=parentSessionId?uuid(parentSessionId):null;
 if(!path.isAbsolute(statePath))throw Error('Use one absolute shared semantic state path');
 if(path.extname(statePath).toLowerCase()!=='.json')throw Error('Semantic state must be a JSON file');
 keys(payload,parent?['status','assignment','current','next','detail','evidence']:['title','goal','current','next','summary','phase','groups','tasks','completed','agents','metrics'],parent?['status']:['title','goal','current','next']);
 if(parent){identity(agentId);text(role,120);}
 return lockedUpdate(statePath,state=>{
  const at=now(),target=parent??session;let index=state.projects.findIndex(p=>p.id===target);
  if(index<0){if(state.projects.length>=LIMITS.sessions)throw Error('Session capacity500 reached; explicitly archive data, never silently drop chats');state.projects.push(emptyProject(target));index=state.projects.length-1;}
  const project=state.projects[index];
  if(parent){
   const old=project.agents.find(a=>a.id===agentId);
   if(old?.owner_session_id&&session!==old.owner_session_id&&session!==parent)throw Error('This agent slot belongs to another reporting session');
   // Tools may inherit the root thread UUID. A distinct child UUID is never
   // invented from a task name; explicit agentID still identifies its assignment.
   const next=agent({...old,id:agentId,session_id:session===parent?null:session,role,...payload,evidence:payload.evidence===undefined?(old?.evidence??[]):evidence(payload.evidence),updated_at:at,...(session===parent?{}:{owner_session_id:session})},true);
   if(old)project.agents[project.agents.indexOf(old)]=next;else{if(project.agents.length>=LIMITS.agents)throw Error('Agent capacity reached');project.agents.push(next);}
  }else{
   const previousMeaning=JSON.stringify([project.goal,project.current,project.next,project.summary,project.phase,project.tasks,project.completed,project.metrics]);
   for(const key of ['title','goal','current','next','summary','phase'])if(payload[key]!==undefined)project[key]=text(payload[key],key==='title'||key==='phase'?120:1200);
   if(payload.groups!==undefined)project.groups=groups(payload.groups);
   if(payload.tasks!==undefined)project.tasks=tasks(payload.tasks,project.groups);
   if(payload.completed!==undefined)project.completed=completed(payload.completed);
   if(payload.metrics!==undefined)project.metrics=metrics(payload.metrics);
   if(payload.agents!==undefined)project.agents=mergeAgents(project.agents,payload.agents,at);
   project.updated_at=at;project.sync={status:'synced',reported_at:at};
   const nextMeaning=JSON.stringify([project.goal,project.current,project.next,project.summary,project.phase,project.tasks,project.completed,project.metrics]);
   if(previousMeaning!==nextMeaning){project.events.push({at,text:project.summary||project.current||project.goal,kind:'semantic'});if(project.events.length>LIMITS.events){const excess=project.events.length-LIMITS.events;project.events.splice(0,excess);project.history_dropped+=excess;}}
  }
  state.updated_at=at;state.source=SOURCE;return state;
 });
}

async function stdinJSON(){const chunks=[];let bytes=0;for await(const chunk of process.stdin){bytes+=chunk.length;if(bytes>LIMITS.payloadBytes)throw Error('Short report exceeds64KiB');chunks.push(chunk);}return parseShortJSON(Buffer.concat(chunks).toString('utf8'));}
export async function main(argv=process.argv.slice(2),environment=process.env){
 const a=argumentsFor(argv,['--state','--json-file','--json-stdin','--session-id','--parent-session-id','--agent-id','--role','--example'],['--json-stdin','--example']);
 // The installed guidance includes --state in its fixed command. Example
 // mode accepts that option for composition only: never resolve, validate,
 // read or create the state target, and never require a session identity.
 if(a['--example']){if(Object.keys(a).some(key=>key!=='--example'&&key!=='--state'))throw Error('Example accepts only --example and optional --state; reporting options are not allowed');console.log(JSON.stringify(EXAMPLE,null,2));return;}
 if(Boolean(a['--json-file'])===Boolean(a['--json-stdin']))throw Error('Choose exactly one --json-file or --json-stdin');
 const sessionId=uuid(a['--session-id']??environment.CODEX_THREAD_ID);
 const parentSessionId=a['--parent-session-id']??environment.CODEX_LOCAL_BOARD_PARENT_ID;
 const agentId=a['--agent-id']??environment.CODEX_LOCAL_BOARD_AGENT_ID;
 let payload;
 if(a['--json-file']){const filename=path.resolve(a['--json-file']);if(path.extname(filename).toLowerCase()!=='.json'||/(?:^|[\\/])\.codex[\\/]sessions(?:[\\/]|$)|(?:^|[\\/])rollout[^\\/]*\.jsonl$/i.test(filename))throw Error('Only an explicitly authored short JSON payload is accepted; never raw transcripts');payload=await readJSON(filename,LIMITS.payloadBytes);}
 else payload=await stdinJSON();
 const state=await report({statePath:a['--state']??path.join(ROOT,'state-v2.json'),sessionId,parentSessionId,agentId,role:a['--role'],payload});
 console.log(JSON.stringify({status:'saved',source:'semantic_mirror_not_canonical',session_id:sessionId,parent_session_id:parentSessionId??null,sessions:state.projects.length}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(`Semantic report rejected: ${error.message}`);process.exitCode=1;});
