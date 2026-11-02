"use strict";
const STATUS_LABELS={pending:"待完成",not_started:"尚未開始",in_progress:"進行中",source_ready:"已備妥，待驗收",passed:"驗收通過",done:"已完成",frozen:"已驗證並凍結",blocked:"需要處理",waiting:"正在等待"};
const DEFAULT_CONFIG={title:"Codex 對話進度看板",subtitle:"每個對話的需求、目前工作、下一步與成果。",poll_seconds:5,complete_statuses:["done","passed","frozen"],show_agents:true,show_events:true};
const COMPLETE_STATUSES=new Set(["done","passed","frozen"]);
const query=id=>document.getElementById(id),text=value=>typeof value==="string"?value.trim():"",rows=value=>Array.isArray(value)?value:[];
const element=(tag,value,className)=>{const node=document.createElement(tag);if(value!==undefined)node.textContent=String(value);if(className)node.className=className;return node;};
function evidenceRows(value){return rows(value).map(item=>typeof item==="string"?{label:text(item)}:item&&typeof item==="object"?{label:text(item.label||item.summary||item.text),url:text(item.url||item.reference),verified:item.verified}:{label:""}).filter(item=>item.label&&item.verified!==false);}
function taskComplete(task,statuses,requireEvidence=false){return COMPLETE_STATUSES.has(task.status)&&statuses.includes(task.status)&&(!requireEvidence||evidenceRows(task.evidence).length>0);}
function progress(tasks,statuses=["done","passed","frozen"],requireEvidence=false){const valid=rows(tasks).filter(task=>task&&typeof task==="object"),done=valid.filter(task=>taskComplete(task,statuses,requireEvidence)).length;return{done,total:valid.length,percent:valid.length?Math.floor(done*100/valid.length):null};}
function formattedTime(value){if(!value)return"尚未同步";const date=new Date(value);return Number.isNaN(date.getTime())?"未提供有效更新時間":new Intl.DateTimeFormat("zh-TW",{dateStyle:"short",timeStyle:"short",hour12:false}).format(date);}
function formattedReadTime(value){const date=new Date(value);return!value||Number.isNaN(date.getTime())?"尚未成功讀取":new Intl.DateTimeFormat("zh-TW",{dateStyle:"short",timeStyle:"medium",hour12:false}).format(date);}
function statusBadge(status,awaitingEvidence=false){return element("span",awaitingEvidence?"已回報，待驗證":STATUS_LABELS[status]||"待同步","status "+(awaitingEvidence?"waiting":Object.hasOwn(STATUS_LABELS,status)?status:"pending"));}
function normalizeProject(project,state={}){
  const modern=Number(state.schema_version)>=2||Boolean(project.session_id)||project.semantic_version===2;
  const nativeTitle=typeof project.conversation_title==="string"&&project.conversation_title.trim()?project.conversation_title:null;
  const completed=rows(project.completed||project.outcomes).map(item=>typeof item==="string"?{title:item}:item||{}).filter(item=>text(item.title||item.text));
  return{...project,id:text(project.id||project.session_id),title:nativeTitle??(text(project.title)||"尚未命名的對話"),modern,goal:text(project.goal),current:text(project.current),next:text(project.next),phase:text(project.phase),summary:text(project.summary),groups:rows(project.groups),tasks:rows(project.tasks),agents:rows(project.agents),events:rows(project.events||project.timeline),completed,metrics:rows(project.metrics),updated_at:project.updated_at||project.reported_at||project.sync?.reported_at||(!modern?state.updated_at:null)};
}
function conversationGroups(projects,state={}){
  const native=projects.filter(project=>project.conversation_title_source==="codex_session_index"&&typeof project.conversation_title==="string"&&project.conversation_title.trim());
  const nativeMode=state.conversation_titles?.available===true&&native.length>0,nativeIds=new Set(native.map(project=>project.id));
  return{nativeMode,main:nativeMode?native:projects,other:nativeMode?projects.filter(project=>!nativeIds.has(project.id)):[]};
}
function executionInfo(project,unavailable=false){
  const value=project.execution,status=unavailable?"unknown":["running","idle","unknown"].includes(value?.status)?value.status:"unknown";
  return{status,label:status==="running"?"執行中":status==="idle"?"目前未執行":unavailable?"暫時無法取得執行狀態":"未取得執行狀態",source:unavailable?"connection_unavailable":text(value?.source)||"unknown",updated_at:!unavailable&&typeof value?.updated_at==="string"&&Number.isFinite(Date.parse(value.updated_at))?value.updated_at:null};
}
function executionMark(status){const mark=element("i",undefined,"execution-mark "+status);mark.setAttribute("aria-hidden","true");return mark;}
function renderExecutionBadge(id,execution){
  const host=query(id);host.className="execution-badge "+execution.status;
  // Replacing identical live-region children every poll would cause repeated
  // announcements. Only a meaningful displayed status change rebuilds it.
  if(host.getAttribute("data-execution-status")!==execution.status||host.getAttribute("data-execution-label")!==execution.label){host.setAttribute("data-execution-status",execution.status);host.setAttribute("data-execution-label",execution.label);host.replaceChildren(executionMark(execution.status),element("span",execution.label,"execution-label"));}
}
function taskProgress(task,execution){
  if(task.status!=="in_progress")return null;
  const label=execution.status==="running"?"進行中・尚無細部百分比":"已登記進行中・"+execution.label;
  const box=element("div",undefined,"task-progress execution-"+execution.status),bar=element("div",undefined,"task-progress-track"),band=element("i",undefined,"task-progress-sweep");
  bar.setAttribute("role","progressbar");bar.setAttribute("aria-label",(task.title||"關卡")+"進度");bar.setAttribute("aria-valuetext",label);band.setAttribute("aria-hidden","true");bar.append(band);box.append(bar,element("p",label,"task-progress-label"));return box;
}
function syncInfo(project,now=Date.now(),pollSeconds=5){
  const status=text(project.sync?.status||project.sync_status),time=project.updated_at?new Date(project.updated_at).getTime():NaN;
  if(project.source==="observed_public_messages"||status==="observed")return{label:"已讀取公開對話・待關卡同步",tone:"observed",note:"這是公開訊息的簡短摘要；下一步、驗收關卡與分工仍等待此對話明確回報。"};
  if(project.source==="conversation_summary")return{label:"已整理原對話",tone:"synced",note:"由 Codex 依公開對話整理；已回報成果不代表本輪重新驗證。後續工作代理回報會優先更新。"};
  if(status==="waiting")return{label:"正在等待",tone:"waiting",note:text(project.sync?.detail)||"代理已回報正在等待，尚無新的完成關卡。"};
  if(status==="not_reported"||(!project.goal&&!project.current&&!project.next&&!Number.isFinite(time)))return{label:"工作摘要待同步",tone:"pending",note:"尚未收到這個對話的需求、目前工作與下一步。"};
  if(status==="stale"||(Number.isFinite(time)&&now-time>10*60*1000))return{label:"最後摘要較早",tone:"waiting",note:"最後工作摘要已超過10分鐘；頁面每"+pollSeconds+"秒讀取，需由此對話的 Codex 回報新摘要。執行狀態另依即時訊號顯示。"};
  if(!Number.isFinite(time))return{label:"已載入回報 · 時間待同步",tone:"waiting",note:"已顯示明確回報的內容，尚未提供更新時間。"};
  return{label:project.modern?"工作摘要已同步":"已載入手動檢查點",tone:"synced",note:project.modern?"內容來自該對話代理的結構化回報。":"這是舊版手動檢查點；未補入的需求與下一步會標示待同步。"};
}
function safeEvidenceURL(value){if(!text(value))return"";try{const url=new URL(value);return["https:","http:"].includes(url.protocol)&&!url.username&&!url.password?url.href:"";}catch(_){return"";}}
function appendEvidence(host,evidence){const list=evidenceRows(evidence);if(!list.length)return;const strip=element("div",undefined,"evidence-list");for(const item of list){const url=safeEvidenceURL(item.url),node=element(url?"a":"span",item.label,"evidence");if(url){node.href=url;node.target="_blank";node.rel="noopener noreferrer";}strip.append(node);}host.append(strip);}
function progressCard(title,tasks,statuses,requireEvidence=false){
  const value=progress(tasks,statuses,requireEvidence),card=element("article",undefined,"progress-card"),head=element("div",undefined,"progress-head");head.append(element("h3",title),element("strong",value.percent===null?"待建立":value.percent+"%","percentage"));
  const bar=element("progress");bar.max=100;bar.value=value.percent??0;bar.hidden=value.percent===null;bar.setAttribute("aria-label",title+"已完成關卡比例");
  card.append(head,bar,element("p",value.percent===null?"尚未建立驗收關卡，暫不顯示完成比例。":`${value.done} / ${value.total} 個關卡完成${requireEvidence?"並附驗證紀錄":"（明確登記）"}。`));return card;
}
function render(configValue,state,preferredId,options={}){
  const focusedConversation=document.activeElement?.getAttribute?.("data-project-id");let restoreFocus=null;
  const config={...DEFAULT_CONFIG,...configValue},statuses=rows(config.complete_statuses).filter(status=>COMPLETE_STATUSES.has(status)),projects=rows(state.projects||state.sessions).map(project=>normalizeProject(project,state)),navigation=conversationGroups(projects,state),selected=projects.find(project=>project.id===preferredId)||navigation.main[0]||projects[0],current=selected||normalizeProject({id:"",title:"尚未同步任何對話",groups:[],tasks:[],agents:[],events:[]},state),sync=syncInfo(current,Date.now(),Math.min(60,Math.max(1,Number(config.poll_seconds)||5))),execution=executionInfo(current,options.runtimeUnavailable===true),filter=text(options.search).toLowerCase();
  document.title=config.title;query("title").textContent=config.title;query("subtitle").textContent=config.subtitle;query("demo").textContent=state.demo?"合成範例 · 非真實工作":"本機 · 對話工作摘要";query("conversation-count").textContent=String(navigation.main.length);
  const select=query("project");select.replaceChildren(...projects.map(project=>{const option=element("option",project.title);option.value=project.id;return option;}));select.disabled=!selected;select.value=selected?.id||"";
  function renderConversations(id,projectRows){
    const visible=projectRows.filter(project=>project.title.toLowerCase().includes(filter)),host=query(id);
    host.className="conversation-list"+(filter?" filtered":"");
    host.replaceChildren(...(visible.length?visible.map(project=>{const button=element("button",undefined,"conversation"+(project.id===current.id?" selected":"")),activity=executionInfo(project,options.runtimeUnavailable===true);button.type="button";button.title=project.title+" — "+activity.label;button.setAttribute("data-project-id",project.id);button.setAttribute("aria-current",project.id===current.id?"page":"false");button.setAttribute("data-execution-status",activity.status);button.setAttribute("aria-label",project.title+"，"+activity.label);button.append(element("strong",project.title),executionMark(activity.status));button.onclick=()=>options.onSelect?.(project.id);if(project.id===focusedConversation)restoreFocus=button;return button;}):[element("p",projectRows.length?"沒有符合的對話，請換個關鍵字。":"還沒有對話回報。開始工作後，代理會同步摘要。","empty")]));
  }
  renderConversations("conversations",navigation.main);renderConversations("other-conversations",navigation.other);
  query("other-tasks").hidden=navigation.other.length===0;query("other-task-count").textContent=String(navigation.other.length);
  query("selection-kind").hidden=!navigation.other.some(project=>project.id===current.id);
  restoreFocus?.focus({preventScroll:true});
  query("sync-state").textContent=sync.label;query("sync-state").className="sync-status "+sync.tone;query("updated").textContent="最後回報："+formattedTime(current.updated_at);query("phase").textContent=current.phase||(current.current?"工作安排":"等待對話同步");query("project-title").textContent=current.title;query("goal").textContent=current.goal||"需求目標尚未同步。";
  query("read-at").textContent="頁面讀取："+formattedReadTime(options.readAt);
  renderExecutionBadge("project-execution",execution);renderExecutionBadge("current-execution",execution);
  query("task-runtime-note").textContent=execution.status==="running"?"對話執行中；下列為已登記的關卡狀態，不代表每項關卡同時執行。":execution.label+"；進行中條只表示已登記的關卡狀態，不推測細部百分比。";
  if(current.source==="observed_public_messages")query("updated").textContent="公開摘要時間："+formattedTime(current.updated_at);
  if(current.source==="conversation_summary")query("updated").textContent="整理時間："+formattedTime(current.updated_at);
  const observation=state.observation||{};query("observation-notice").hidden=!observation.limited;
  query("observation-notice").textContent=observation.limited?"已達既有對話的讀取上限；另有 "+(observation.omitted||0)+" 個對話尚未載入。此限制不會刪除任何對話。":"";
  query("summary").textContent=current.summary?"原有摘要："+current.summary:"";query("summary").hidden=!current.summary||current.summary===current.goal;query("current").textContent=current.current||"等待代理回報目前工作。";query("current-note").textContent=sync.note;query("next").textContent=current.next||"下一步尚未同步，不從工具活動猜測。";
  query("progress").replaceChildren(progressCard("整體任務",current.tasks,statuses,current.modern),...current.groups.map(group=>progressCard(group.title||"未命名群組",current.tasks.filter(task=>task.group===group.id),statuses,current.modern)));query("completion-policy").textContent=current.modern?"完成狀態且附驗證紀錄才計入；已備妥不等於驗收通過。":"依舊版明確登記的完成狀態計算；未推測對話內容。";
  if(current.source==="observed_public_messages")query("completion-policy").textContent="尚未同步驗收關卡；公開訊息不會自動轉成完成比例。";
  const outcomes=current.completed.length?current.completed:current.tasks.filter(task=>taskComplete(task,statuses,current.modern)).map(task=>({title:task.title,detail:task.detail,evidence:task.evidence}));query("outcome-count").textContent=String(outcomes.length);
  query("outcomes").replaceChildren(...(outcomes.length?outcomes.map(item=>{const article=element("article",undefined,"outcome"),body=element("div");body.append(element("h3",item.title||item.text));if(item.detail)body.append(element("p",item.detail));appendEvidence(body,item.evidence);article.append(element("span","已回報","outcome-marker"),body);return article;}):[element("p","尚未同步已完成成果；驗證後再登記，不會把工具執行當成完成。","empty")]));
  query("metrics").hidden=!current.metrics.length;query("metrics").replaceChildren(...current.metrics.map(metric=>{const card=element("article",undefined,"metric");card.append(element("strong",visualMetric(metric)),element("span",metric.label||"回報指標"));return card;}));
  query("tasks").replaceChildren(...(current.tasks.length?current.tasks.map((task,index)=>{const row=element("article",undefined,"task"),body=element("div"),unverified=current.modern&&COMPLETE_STATUSES.has(task.status)&&!evidenceRows(task.evidence).length;body.append(element("h3",task.title||"尚未命名的關卡"));if(task.detail)body.append(element("p",task.detail));if(task.group){const group=current.groups.find(group=>group.id===task.group);if(group)body.append(element("span",group.title,"task-group"));}appendEvidence(body,task.evidence);const activity=taskProgress(task,execution);if(activity)body.append(activity);row.append(element("span",String(index+1).padStart(2,"0"),"index"),body,statusBadge(task.status,unverified));return row;}):[element("p","任務關卡待建立。沒有可驗收的步驟時，不顯示 0% 或 100%。","empty")]));
  query("agents-panel").hidden=config.show_agents===false;query("events-panel").hidden=config.show_events===false;query("sidebar").hidden=config.show_agents===false&&config.show_events===false;query("layout").className="project-grid"+(query("sidebar").hidden?" no-sidebar":"");
  query("agents").replaceChildren(...(current.agents.length?current.agents.map(agent=>{const row=element("article",undefined,"agent"),head=element("div",undefined,"agent-head"),body=element("div");head.append(element("h3",agent.role||agent.label||"角色待同步"),statusBadge(agent.status));body.append(element("p",text(agent.assignment)||"實際指派尚未同步。","assignment"),element("p",text(agent.current)?"目前："+agent.current:"目前工作待同步。"));if(agent.detail)body.append(element("p",agent.detail,"agent-note"));row.append(head,body);return row;}):[element("p","尚未提供可確認的工作分工；不推測主代理或子代理的指派。","empty")]));
  query("events").replaceChildren(...(current.events.length?current.events.slice(-10).reverse().map(event=>{const row=element("article",undefined,"event");row.append(element("p",event.text||event.title||"工作更新內容待同步"),element("time",formattedTime(event.at)));return row;}):[element("p","尚無重要進展回報，不重建未曾同步的歷史。","empty")]));
  query("technical").textContent=JSON.stringify({schema_version:state.schema_version,project_id:current.id,session_id:current.session_id||null,updated_at:current.updated_at||null,sync:current.sync||null,execution:{status:execution.status,source:execution.source,updated_at:execution.updated_at},agents:current.agents.map(agent=>({id:agent.id,session_id:agent.session_id||null,updated_at:agent.updated_at||null})),capacity:state.capacity||null,history_dropped:current.history_dropped||0},null,2);return selected?.id||"";
}
function visualMetric(metric){return(typeof metric.value==="number"||typeof metric.value==="string"?metric.value:"待同步")+(text(metric.unit)?" "+metric.unit:"");}
async function start(){
  let selected="",last=null,timer=null,busy=false,delay=5000,runtimeUnavailable=false,lastReadAt=null;
  const display=()=>{if(last)selected=render(last.config,last.state,selected,{search:query("chat-search").value,runtimeUnavailable,readAt:lastReadAt,onSelect:id=>{selected=id;display();}});};
  async function refresh(){if(busy)return;busy=true;clearTimeout(timer);query("refresh").disabled=true;const abort=new AbortController(),deadline=setTimeout(()=>abort.abort(),5000);
    try{const responses=await Promise.all([fetch("/config.json",{cache:"no-store",signal:abort.signal}),fetch("/state.json",{cache:"no-store",signal:abort.signal})]);if(responses.some(response=>!response.ok))throw Error("本機讀取暫時不可用");const[config,state]=await Promise.all(responses.map(response=>response.json()));if(!state||(!Array.isArray(state.projects)&&!Array.isArray(state.sessions)))throw Error("工作摘要格式無法辨識");last={config,state};runtimeUnavailable=false;lastReadAt=new Date().toISOString();display();delay=Math.min(60,Math.max(1,Number(config.poll_seconds)||5))*1000;query("connection").textContent="已讀取本機資料 · 每 "+delay/1000+" 秒檢查更新";query("connection").className="";}
    catch(_error){runtimeUnavailable=true;if(last)display();query("connection").textContent=last?"同步暫時失敗，保留上次回報；正在等待重試。":"尚無有效工作摘要，正在等待本機同步。";query("connection").className="error";query("sync-state").textContent=last?"保留上次回報 · 等待同步":"工作摘要待同步";query("sync-state").className="sync-status waiting";}
    finally{clearTimeout(deadline);busy=false;query("refresh").disabled=false;timer=setTimeout(refresh,delay);}}
  for(const id of["conversations","other-conversations"])query(id).addEventListener("keydown",event=>{if(!["ArrowDown","ArrowUp","Home","End"].includes(event.key))return;const buttons=[...query(id).querySelectorAll(".conversation")],index=buttons.indexOf(event.target.closest(".conversation"));if(index<0)return;event.preventDefault();const next=event.key==="Home"?0:event.key==="End"?buttons.length-1:event.key==="ArrowDown"?Math.min(index+1,buttons.length-1):Math.max(0,index-1);buttons[next]?.focus();});
  query("refresh").addEventListener("click",refresh);query("project").addEventListener("change",()=>{selected=query("project").value;display();});query("chat-search").addEventListener("input",display);await refresh();
}
if(typeof module!=="undefined"&&module.exports)module.exports={progress,render,taskComplete,normalizeProject,conversationGroups,executionInfo,syncInfo,safeEvidenceURL};
if(typeof document!=="undefined")document.addEventListener("DOMContentLoaded",start);
