/** Explicit authored project-plan report; never scans documents or conversations. */
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readPlanPayload,writeProjectPlan} from './project-plan.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url));
export const PLAN_EXAMPLE={title:'範例：待確認的專案架構',goal:'請替換為這個聊天室已知的實際專案目標',summary:'這是格式範例，不代表已完成任何工作。',source:{kind:'generated',label:'Codex 依已知需求提出，範圍待確認',references:[]},nodes:[{id:'delivery',parent_id:null,title:'交付階段',kind:'phase',status:'pending',detail:'請按真實專案拆分模組與任務。',evidence:[],depends_on:[]},{id:'verify',parent_id:'delivery',title:'實際驗證交付內容',kind:'task',status:'pending',detail:'完成後提供可核對的證據。',evidence:[],depends_on:[]}]};
function invalid(code){const e=new Error('架構回報參數不正確');e.planCode=code;throw e;}
function argumentsFor(argv){const values={},allowed=['--state','--session-id','--json-file','--patch','--example'];for(let i=0;i<argv.length;i++){const key=argv[i];if(!allowed.includes(key)||Object.hasOwn(values,key))invalid('ARGUMENTS');if(['--patch','--example'].includes(key))values[key]=true;else{if(i+1>=argv.length||argv[i+1].startsWith('--'))invalid('ARGUMENTS');values[key]=argv[++i];}}return values;}
export async function main(argv=process.argv.slice(2),environment=process.env){
 const a=argumentsFor(argv);if(a['--example']){if(Object.keys(a).some(key=>!['--example','--state'].includes(key)))invalid('EXAMPLE_OPTIONS');console.log(JSON.stringify(PLAN_EXAMPLE,null,2));return;}
 if(!a['--json-file'])invalid('PAYLOAD_REQUIRED');const file=path.resolve(a['--json-file']);if(path.extname(file).toLowerCase()!=='.json'||/(?:^|[\\/])\.codex[\\/]sessions(?:[\\/]|$)/i.test(file))invalid('AUTHORED_JSON_ONLY');
 const state=a['--state']||path.join(HERE,'project-plans.json'),payload=await readPlanPayload(file),stored=await writeProjectPlan(state,a['--session-id']||environment.CODEX_THREAD_ID,payload,{patch:Boolean(a['--patch'])});
 console.log(JSON.stringify({status:'saved',source:'agent_project_plans',session_id:a['--session-id']||environment.CODEX_THREAD_ID,sessions:stored.projects.length,mode:a['--patch']?'patch':'replace'}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(JSON.stringify({status:'failed',code:e.planCode||'IO_ERROR',message:'架構回報失敗，原有資料保持不變；請檢查資料結構、容量與本機檔案。'}));process.exitCode=1;});
