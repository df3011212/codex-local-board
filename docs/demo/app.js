"use strict";
const STATUS_LABELS={pending:"待完成",not_started:"尚未開始",in_progress:"進行中",source_ready:"已備妥，待驗收",passed:"驗收通過",done:"已完成",frozen:"已驗證並凍結",blocked:"需要處理",waiting:"正在等待"};
const DEFAULT_CONFIG={title:"Codex 對話進度看板",subtitle:"每個對話的需求、目前工作、下一步與成果。",poll_seconds:5,complete_statuses:["done","passed","frozen"],show_agents:true,show_events:true};
const COMPLETE_STATUSES=new Set(["done","passed","frozen"]);
const query=id=>document.getElementById(id),text=value=>typeof value==="string"?value.trim():"",rows=value=>Array.isArray(value)?value:[];
const element=(tag,value,className)=>{const node=document.createElement(tag);if(value!==undefined)node.textContent=String(value);if(className)node.className=className;return node;};
function evidenceRows(value){return rows(value).map(item=>typeof item==="string"?{label:text(item)}:item&&typeof item==="object"?{label:text(item.label||item.summary||item.text),url:text(item.url||item.reference),verified:item.verified}:{label:""}).filter(item=>item.label&&item.verified!==false);}
function taskComplete(task,statuses,requireEvidence=false){return COMPLETE_STATUSES.has(task.status)&&statuses.includes(task.status)&&(!requireEvidence||evidenceRows(task.evidence).length>0);}
function progress(tasks,statuses=["done","passed","frozen"],requireEvidence=false){const valid=rows(tasks).filter(task=>task&&typeof task==="object"),done=valid.filter(task=>taskComplete(task,statuses,requireEvidence)).length;return{done,total:valid.length,percent:valid.length?Math.floor(done*100/valid.length):null};}
function formattedTime(_value){return"固定示範資料";}
function formattedReadTime(_value){return"固定示範檔（非即時同步）";}
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
  return{status,label:status==="running"?"示範：執行中":status==="idle"?"示範：目前未執行":unavailable?"示範檔暫時無法讀取":"示範：執行狀態未知",source:unavailable?"connection_unavailable":text(value?.source)||"unknown",updated_at:!unavailable&&typeof value?.updated_at==="string"&&Number.isFinite(Date.parse(value.updated_at))?value.updated_at:null};
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
  if(project.demo)return{label:"固定示範資料・非即時工作",tone:"synced",note:"本頁只讀取這個網站的固定示範檔；所有對話、成果、分工與執行狀態均為自創示例，不讀取你的 Codex，也不另呼 AI。"};
  const status=text(project.sync?.status||project.sync_status),time=project.updated_at?new Date(project.updated_at).getTime():NaN;
  if(project.source==="observed_public_messages"||status==="observed")return{label:"已讀取公開對話・待關卡同步",tone:"observed",note:"這是公開訊息的簡短摘要；下一步、驗收關卡與分工仍等待此對話明確回報。"};
  if(project.source==="conversation_summary")return{label:"已整理原對話",tone:"synced",note:"由 Codex 依公開對話整理；已回報成果不代表本輪重新驗證。後續工作代理回報會優先更新。"};
  if(status==="waiting")return{label:"正在等待",tone:"waiting",note:text(project.sync?.detail)||"代理已回報正在等待，尚無新的完成關卡。"};
  if(status==="not_reported"||(!project.goal&&!project.current&&!project.next&&!Number.isFinite(time)))return{label:"示範檔待載入",tone:"pending",note:"尚未收到這個對話的需求、目前工作與下一步。"};
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
const PLAN_KIND_LABELS={phase:"階段",module:"模組／分組",task:"驗收項目"},planUI=new Map();
let planHandoffContext=null,planHandoffRequest=0;
function handoffBuilder(){try{return typeof BoardPlanHandoff!=="undefined"?BoardPlanHandoff:typeof require==="function"?require("./plan-handoff.js"):null;}catch(_){return null;}}
function showPlanHandoff(ui){
  for(const[id,controls]of ui.handoffControls||[]){const value=ui.handoff?.nodeId===id?ui.handoff:null,manual=value?.status==="manual",note=value?.note||"";if(controls.note.textContent!==note)controls.note.textContent=note;controls.label.hidden=!manual;
    if(!manual&&document.activeElement===controls.field)controls.button.focus({preventScroll:true});controls.field.hidden=!manual;const content=manual?value.content:"";if(controls.field.value!==content)controls.field.value=content;
  }
}
function updatePlanHandoffContext(project,plan,key,ui){
  const revision=JSON.stringify([key,project.title,project.goal,project.current,project.next,project.updated_at,plan.full,plan.title,plan.goal,plan.summary,plan.source,plan.nodes,plan.progress,plan.updated_at]);
  if(planHandoffContext?.key!==key||planHandoffContext.revision!==revision){planHandoffRequest++;if(planHandoffContext){planHandoffContext.ui.handoff=null;showPlanHandoff(planHandoffContext.ui);}ui.handoff=null;showPlanHandoff(ui);}
  planHandoffContext={project,plan,key,revision,ui};
}
function planHandoffControls(node,key,ui,restore){
  const box=element("div",undefined,"plan-handoff"),button=element("button","複製給 Codex","plan-handoff-button"),scope=element("p",node.kind==="task"?"只複製這個驗收項目。":"包含這個"+PLAN_KIND_LABELS[node.kind]+"及全部子項，不受搜尋、篩選或收合影響。","plan-handoff-scope"),note=element("p","","plan-handoff-note"),label=element("label","請選取並手動複製交接文字"),field=element("textarea"),fieldId="plan-handoff-copy-"+ui.handoffControls.size;
  button.type="button";button.setAttribute("data-plan-handoff",node.id);button.setAttribute("data-plan-focus","handoff:"+node.id);button.setAttribute("aria-label","複製給 Codex："+node.title+(node.kind==="task"?"（單項）":"（含全部子項）"));restore.set("handoff:"+node.id,button);note.setAttribute("role","status");note.setAttribute("aria-live","polite");note.setAttribute("aria-atomic","true");field.id=fieldId;field.setAttribute("id",fieldId);field.readOnly=true;field.setAttribute("readonly","");field.rows=8;field.setAttribute("data-plan-handoff-field",node.id);field.setAttribute("data-plan-focus","handoff-copy:"+node.id);restore.set("handoff-copy:"+node.id,field);label.setAttribute("for",fieldId);label.hidden=true;field.hidden=true;box.append(button,scope,note,label,field);ui.handoffControls.set(node.id,{button,note,label,field});
  button.onclick=async()=>{
    const context=planHandoffContext;if(!context||context.key!==key||!context.plan.byId.has(node.id))return;const request=++planHandoffRequest,current=()=>planHandoffContext?.key===key&&planHandoffContext.revision===context.revision&&request===planHandoffRequest;
    const publish=value=>{if(!current())return false;ui.handoff={nodeId:node.id,...value};showPlanHandoff(ui);return true;};let payload;
    try{const builder=handoffBuilder();if(typeof builder?.buildPlanHandoff!=="function")throw Error("unavailable");payload=builder.buildPlanHandoff(context.project,context.plan,node.id);if(typeof payload?.text!=="string"||!payload.text.trim()||!Number.isInteger(payload.nodeCount)||payload.nodeCount<1||!Number.isInteger(payload.taskCount)||payload.taskCount<0)throw Error("invalid handoff");}
    catch(error){const sizeMessage="此階段文字過大，尚未複製；請改選較小的模組或驗收項目。",reason=error?.message===sizeMessage?sizeMessage:"目前無法產生交接文字，請重新整理並確認計畫資料；必要時改選較小的模組。";publish({status:"error",note:reason+"尚未傳送或執行。"});return;}
    const scopeText=payload.nodeCount+" 個節點、"+payload.taskCount+" 個驗收項目";publish({status:"pending",note:"正在準備複製文字；尚未傳送或執行。"});
    try{if(typeof navigator==="undefined"||!navigator.clipboard?.writeText)throw Error("clipboard unavailable");await navigator.clipboard.writeText(payload.text);publish({status:"copied",note:"已複製「"+node.title+"」（"+scopeText+"）；尚未傳送給 Codex，也未執行。請貼回原對話確認。"});}
    catch(_){if(publish({status:"manual",content:payload.text,note:"瀏覽器未提供剪貼簿存取；請手動複製下方文字（"+scopeText+"）。尚未傳送或執行。"})){const live=ui.handoffControls.get(node.id);live?.field.focus({preventScroll:true});live?.field.scrollIntoView?.({block:"nearest",inline:"nearest"});live?.field.select?.();}}
  };return box;
}
function planProgress(value){
  if(!value||!Number.isInteger(value.total)||value.total<0||!Number.isInteger(value.completed)||value.completed<0||value.completed>value.total)return{completed:0,total:0,percent:null};
  const percent=value.total>0&&Number.isInteger(value.percent)&&value.percent===Math.floor(value.completed*100/value.total)?value.percent:null;
  return{completed:value.completed,total:value.total,percent};
}
function projectPlan(project){
  const supplied=project.plan,session=text(project.session_id||project.id).toLowerCase(),source=supplied?.source;
  let full=Boolean(supplied&&text(supplied.session_id).toLowerCase()===session&&session&&Array.isArray(supplied.nodes)&&supplied.nodes.length>0&&supplied.nodes.length<=512&&["document","generated","reported"].includes(source?.kind));
  let nodes=full?supplied.nodes.filter(node=>node&&text(node.id)&&text(node.title)&&Object.hasOwn(PLAN_KIND_LABELS,node.kind)).map(node=>({...node,id:text(node.id),title:text(node.title),detail:text(node.detail),depends_on:rows(node.depends_on),evidence:rows(node.evidence),progress:planProgress(node.progress)})):[];
  let byId=new Map(nodes.map(node=>[node.id,node]));
  if(full){
    if(nodes.length!==supplied.nodes.length||byId.size!==nodes.length)full=false;
    for(const node of nodes){let cursor=node,depth=0;const seen=new Set();while(cursor&&full){if(seen.has(cursor.id)||++depth>8){full=false;break;}seen.add(cursor.id);if(cursor.parent_id!==null&&!byId.has(cursor.parent_id)){full=false;break;}cursor=cursor.parent_id===null?null:byId.get(cursor.parent_id);}}
  }
  if(!full){
    nodes=[];const groups=new Map();
    rows(project.groups).slice(0,512).forEach((group,index)=>{if(!group||!text(group.id)||groups.has(group.id))return;const id="group-"+index;groups.set(group.id,id);nodes.push({id,parent_id:null,title:text(group.title)||"已回報關卡群組",kind:"module",status:"pending",detail:"已回報的工作群組，尚未確認為完整專案範圍。",evidence:[],depends_on:[]});});
    rows(project.tasks).slice(0,Math.max(0,512-nodes.length)).forEach((task,index)=>{if(!task)return;nodes.push({...task,id:"task-"+index,parent_id:groups.get(task.group)||null,title:text(task.title)||"已回報驗收關卡",kind:"task",detail:text(task.detail),evidence:rows(task.evidence),depends_on:[]});});
    const used=new Set(nodes.filter(node=>node.parent_id!==null).map(node=>node.parent_id));nodes=nodes.filter(node=>node.kind==="task"||used.has(node.id));
    for(const node of nodes){const tasks=node.kind==="task"?[node]:nodes.filter(task=>task.parent_id===node.id),p=progress(tasks,["done","passed","frozen"],true);node.progress={completed:p.done,total:p.total,percent:p.percent};}
    byId=new Map(nodes.map(node=>[node.id,node]));
  }
  const children=new Map(nodes.map(node=>[node.id,[]])),roots=[];
  for(const node of nodes)if(node.parent_id===null)roots.push(node);else children.get(node.parent_id)?.push(node);
  return{full,title:full?text(supplied.title):"已回報的部分工作範圍",goal:full?text(supplied.goal):text(project.goal),summary:full?text(supplied.summary):"",source:full?source:{kind:"reported",label:"依已回報關卡建立，完整範圍待 Codex 補齊",references:[]},updated_at:full?supplied.updated_at:null,nodes,byId,children,roots,progress:full?planProgress(supplied.progress):{completed:0,total:0,percent:null}};
}
function suggestionText(suggestion){return[text(suggestion.title),text(suggestion.detail)].filter(Boolean).join("\n\n");}
function renderSuggestions(project){
  const host=query("suggestions"),items=rows(project.suggestions).filter(item=>item&&text(item.title)),signature=JSON.stringify([project.id,items]);query("suggestion-count").textContent=String(items.length);
  if(host.getAttribute("data-suggestions-signature")===signature)return;
  const focused=document.activeElement?.getAttribute?.("data-suggestion-id");let restoreFocus=null;
  host.setAttribute("data-suggestions-signature",signature);query("suggestion-copy-note").textContent="";query("suggestion-copy").hidden=true;query("suggestion-copy-label").hidden=true;
  host.replaceChildren(...(items.length?items.map((item,index)=>{const card=element("article",undefined,"suggestion"),body=element("div"),button=element("button","複製建議");body.append(element("h3",item.title));if(text(item.detail))body.append(element("p",item.detail));button.type="button";button.setAttribute("data-suggestion-id",text(item.id)||String(index));button.setAttribute("aria-label","複製建議："+item.title);
    button.onclick=async()=>{const content=suggestionText(item);try{if(typeof navigator==="undefined"||!navigator.clipboard?.writeText)throw Error("clipboard unavailable");await navigator.clipboard.writeText(content);if(host.getAttribute("data-suggestions-signature")===signature)query("suggestion-copy-note").textContent="已複製建議；尚未傳送，也不會自動執行。";}catch(_){if(host.getAttribute("data-suggestions-signature")!==signature)return;const field=query("suggestion-copy");field.value=content;field.hidden=false;query("suggestion-copy-label").hidden=false;query("suggestion-copy-note").textContent="瀏覽器未提供剪貼簿存取，請手動複製下方文字。";field.focus();field.select?.();}};
    if(button.getAttribute("data-suggestion-id")===focused)restoreFocus=button;card.append(body,button);return card;}):[element("p","尚未收到此對話 Codex 明確回報的建議。","empty")]));restoreFocus?.focus({preventScroll:true});
}
function renderProjectPlan(project){
  const plan=projectPlan(project),key=project.id||"empty";
  if(!planUI.has(key))planUI.set(key,{search:"",unfinished:false,open:new Map(),filteredOpen:new Map(),filterKey:"",handoff:null,handoffControls:new Map()});
  const ui=planUI.get(key),host=query("plan-tree"),search=query("plan-search"),unfinished=query("plan-unfinished");
  updatePlanHandoffContext(project,plan,key,ui);
  if(search.value!==ui.search)search.value=ui.search;unfinished.checked=ui.unfinished;
  search.oninput=()=>{ui.search=search.value;renderProjectPlan(project);};unfinished.onchange=()=>{ui.unfinished=unfinished.checked;renderProjectPlan(project);};
  query("plan-title").textContent=plan.title;query("plan-goal").textContent=plan.goal||"完整專案目標尚待同步。";query("plan-summary").textContent=plan.summary;query("plan-summary").hidden=!plan.summary;
  query("plan-source-kind").textContent=plan.full?({document:"依開發文件整理",generated:"公開示範計畫",reported:"已回報計畫"}[plan.source.kind]):"部分範圍";
  query("plan-scope-note").textContent=plan.full?"以下是此對話已列出的專案範圍；與下方目前工作關卡分開計算，單次交付不代表整個專案完成。":"依已回報關卡建立，完整範圍待 Codex 補齊；下列只是目前已知的部分工作，不能視為完整專案架構。";
  query("plan-counts").replaceChildren(...["phase","module","task"].map(kind=>element("span",plan.nodes.filter(node=>node.kind===kind).length+" "+(plan.full?PLAN_KIND_LABELS[kind]:kind==="module"?"關卡群組":PLAN_KIND_LABELS[kind]),"scope-count")));
  const overall=plan.progress;query("plan-percent").textContent=!plan.full?"範圍待補齊":overall.percent===null?"比例未知":overall.percent+"%";const bar=query("plan-progress");bar.hidden=!plan.full||overall.percent===null;bar.value=overall.percent??0;
  query("plan-progress-note").textContent=!plan.full?"完整專案範圍尚待補齊，暫不計算全專案比例。":overall.percent===null?"尚未提供可確認的全專案驗收比例，不以目前工作的比例代替。":overall.completed+" / "+overall.total+" 個驗收項目完成並附證據；階段與模組不重複計數。";
  query("plan-source-label").textContent=text(plan.source.label)||"來源說明尚待同步。";query("plan-updated").textContent=plan.full?"計畫資料："+formattedTime(plan.updated_at):"此檢視由已回報關卡呈現，不會另行呼叫模型。";
  const references=query("plan-references"),referenceSignature=JSON.stringify([key,plan.source.references]);if(references.getAttribute("data-reference-signature")!==referenceSignature){references.setAttribute("data-reference-signature",referenceSignature);references.replaceChildren(...(rows(plan.source.references).length?rows(plan.source.references).slice(0,64).map(ref=>{const row=element("div",undefined,"plan-reference"),url=safeEvidenceURL(ref.url),label=element(url?"a":"span",text(ref.label)||"來源文件");if(url){label.href=url;label.target="_blank";label.rel="noopener noreferrer";}row.append(label);if(text(ref.path))row.append(element("code",ref.path));return row;}):[element("p","尚未附來源文件；請依已回報來源確認範圍。","empty")]));}
  const filter=text(ui.search).toLowerCase(),filterKey=JSON.stringify([filter,ui.unfinished]);if(ui.filterKey!==filterKey){ui.filterKey=filterKey;ui.filteredOpen.clear();}
  const included=new Set(),filtered=Boolean(filter||ui.unfinished);
  function include(node,ancestorMatch=false){const ownMatch=!filter||[node.title,node.detail,node.id].join(" ").toLowerCase().includes(filter),matches=ancestorMatch||ownMatch;let childIncluded=false;for(const child of plan.children.get(node.id)||[])if(include(child,matches))childIncluded=true;const unfinishedLeaf=node.kind==="task"&&!taskComplete(node,["done","passed","frozen"],true),leaf=node.kind==="task"&&matches&&(!ui.unfinished||unfinishedLeaf);if(leaf||childIncluded){included.add(node.id);return true;}return false;}
  for(const root of plan.roots)include(root);
  const countLabel="顯示 "+included.size+" / "+plan.nodes.length+" 個節點";if(query("plan-visible-count").textContent!==countLabel)query("plan-visible-count").textContent=countLabel;
  const signature=JSON.stringify([key,plan.full,plan.nodes,filterKey]);if(host.getAttribute("data-plan-signature")===signature)return;
  const focused=document.activeElement?.getAttribute?.("data-plan-focus"),restore=new Map(),scrollTop=host.scrollTop||0;ui.handoffControls=new Map();
  function branch(node,depth){const box=element("details",undefined,"plan-node kind-"+node.kind),head=element("summary"),title=element("span",node.title,"plan-node-title"),meta=element("span",undefined,"plan-node-meta"),body=element("div",undefined,"plan-node-body"),children=plan.children.get(node.id)||[],unverified=COMPLETE_STATUSES.has(node.status)&&!evidenceRows(node.evidence).length,p=node.progress;box.setAttribute("data-plan-node",node.id);head.setAttribute("data-plan-focus",node.id);restore.set(node.id,head);meta.append(element("span",!plan.full&&node.kind==="module"?"關卡群組":PLAN_KIND_LABELS[node.kind],"plan-kind"));
    if(node.kind==="task")meta.append(statusBadge(node.status,unverified));else{const badge=element("span",p.percent===null?"子項驗收比例未知":"子項已驗收 "+p.completed+" / "+p.total,"status "+(p.percent===100?"passed":p.completed>0?"in_progress":"pending"));meta.append(badge);}
    if(p.percent!==null)meta.append(element("span",node.kind==="task"?"驗收 "+p.completed+" / "+p.total+" · "+p.percent+"%":p.percent+"%","plan-node-progress"));else meta.append(element("span","比例未知","plan-node-progress"));head.append(title,meta);box.append(head);if(node.detail)body.append(element("p",node.detail));
    if(node.depends_on.length){const names=node.depends_on.map(id=>plan.byId.get(id)?.title||"依賴內容待同步");body.append(element("p","前置依賴："+names.join("、"),"plan-dependencies"));}appendEvidence(body,node.evidence);if(!node.detail&&!node.depends_on.length&&!evidenceRows(node.evidence).length)body.append(element("p","尚未補充說明或驗收證據。"));body.append(planHandoffControls(node,key,ui,restore));box.append(body);
    if(children.some(child=>included.has(child.id))){const nested=element("div",undefined,"plan-children");nested.append(...children.filter(child=>included.has(child.id)).map(child=>branch(child,depth+1)));box.append(nested);}
    const openState=filtered?ui.filteredOpen:ui.open;box.open=openState.has(node.id)?openState.get(node.id):filtered||depth===0&&node.kind==="phase";box.ontoggle=()=>{openState.set(node.id,box.open);};return box;
  }
  host.setAttribute("data-plan-signature",signature);host.replaceChildren(...(included.size?plan.roots.filter(node=>included.has(node.id)).map(node=>branch(node,0)):[element("p",!plan.nodes.length?"尚未回報專案計畫或驗收關卡。":filtered?"沒有符合的驗收項目，請調整搜尋或篩選。":"尚未回報可呈現的驗收項目。","empty")]));showPlanHandoff(ui);host.scrollTop=scrollTop;if(focused)restore.get(focused)?.focus({preventScroll:true});
}
function render(configValue,state,preferredId,options={}){
  const focusedConversation=document.activeElement?.getAttribute?.("data-project-id");let restoreFocus=null;
  const config={...DEFAULT_CONFIG,...configValue},statuses=rows(config.complete_statuses).filter(status=>COMPLETE_STATUSES.has(status)),projects=rows(state.projects||state.sessions).map(project=>normalizeProject(project,state)),navigation=conversationGroups(projects,state),selected=projects.find(project=>project.id===preferredId)||navigation.main[0]||projects[0],current=selected||normalizeProject({id:"",title:"尚未同步任何對話",groups:[],tasks:[],agents:[],events:[]},state),sync=syncInfo(current,Date.now(),Math.min(60,Math.max(1,Number(config.poll_seconds)||5))),execution=executionInfo(current,options.runtimeUnavailable===true),filter=text(options.search).toLowerCase();
  document.title=config.title;query("title").textContent=config.title;query("subtitle").textContent=config.subtitle;query("demo").textContent=state.demo?"實際介面・示範資料":"固定示範資料";query("conversation-count").textContent=String(navigation.main.length);
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
  query("sync-state").textContent=sync.label;query("sync-state").className="sync-status "+sync.tone;query("updated").textContent="資料來源："+formattedTime(current.updated_at);query("phase").textContent=current.phase||(current.current?"工作安排":"等待對話同步");query("project-title").textContent=current.title;query("goal").textContent=current.goal||"需求目標尚未同步。";
  query("read-at").textContent="頁面讀取："+formattedReadTime(options.readAt);
  renderExecutionBadge("project-execution",execution);renderExecutionBadge("current-execution",execution);
  query("task-runtime-note").textContent=execution.status==="running"?"固定示範：顯示執行中圖示與不定量關卡條；本頁沒有連接即時代理。":execution.label+"；進行中條只表示已登記的關卡狀態，不推測細部百分比。";
  if(current.source==="observed_public_messages")query("updated").textContent="公開摘要時間："+formattedTime(current.updated_at);
  if(current.source==="conversation_summary")query("updated").textContent="整理時間："+formattedTime(current.updated_at);
  const observation=state.observation||{};query("observation-notice").hidden=!observation.limited;
  query("observation-notice").textContent=observation.limited?"已達既有對話的讀取上限；另有 "+(observation.omitted||0)+" 個對話尚未載入。此限制不會刪除任何對話。":"";
  query("summary").textContent=current.summary?"原有摘要："+current.summary:"";query("summary").hidden=!current.summary||current.summary===current.goal;query("current").textContent=current.current||"等待代理回報目前工作。";query("current-note").textContent=sync.note;query("next").textContent=current.next||"下一步尚未同步，不從工具活動猜測。";
  renderSuggestions(current);renderProjectPlan(current);
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
    try{const responses=await Promise.all([fetch("./config.json",{cache:"no-store",signal:abort.signal}),fetch("./state.json",{cache:"no-store",signal:abort.signal})]);if(responses.some(response=>!response.ok))throw Error("示範檔暫時無法讀取");const[config,state]=await Promise.all(responses.map(response=>response.json()));if(!state||(!Array.isArray(state.projects)&&!Array.isArray(state.sessions)))throw Error("工作摘要格式無法辨識");last={config,state};runtimeUnavailable=false;lastReadAt=new Date().toISOString();display();delay=Math.min(60,Math.max(1,Number(config.poll_seconds)||5))*1000;query("connection").textContent="已載入固定示範檔・不連接本機 Codex・不會呼叫 AI";query("connection").className="";}
    catch(_error){runtimeUnavailable=true;if(last)display();query("connection").textContent=last?"示範檔讀取失敗；保留先前畫面，可按重新讀取。":"示範檔尚未載入，請按重新讀取。";query("connection").className="error";query("sync-state").textContent=last?"保留先前示範・可重新讀取":"示範檔待載入";query("sync-state").className="sync-status waiting";}
    finally{clearTimeout(deadline);busy=false;query("refresh").disabled=false;/* Static demo: load once; refresh only on an explicit click. */}}
  for(const id of["conversations","other-conversations"])query(id).addEventListener("keydown",event=>{if(!["ArrowDown","ArrowUp","Home","End"].includes(event.key))return;const buttons=[...query(id).querySelectorAll(".conversation")],index=buttons.indexOf(event.target.closest(".conversation"));if(index<0)return;event.preventDefault();const next=event.key==="Home"?0:event.key==="End"?buttons.length-1:event.key==="ArrowDown"?Math.min(index+1,buttons.length-1):Math.max(0,index-1);buttons[next]?.focus();});
  query("refresh").addEventListener("click",refresh);query("project").addEventListener("change",()=>{selected=query("project").value;display();});query("chat-search").addEventListener("input",display);await refresh();
}
if(typeof module!=="undefined"&&module.exports)module.exports={progress,render,taskComplete,normalizeProject,conversationGroups,executionInfo,syncInfo,safeEvidenceURL,projectPlan,planProgress,suggestionText};
if(typeof document!=="undefined")document.addEventListener("DOMContentLoaded",start);
