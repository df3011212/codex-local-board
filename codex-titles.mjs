/** Exact Codex conversation labels from bounded metadata only, never transcripts. */
import * as fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const TITLE_LIMITS=Object.freeze({bytes:1024*1024,nameLength:512,records:16384,homes:4});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const UNSAFE=/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/;
const readers=new Map();
function diagnostics(status,extra={}){return {available:status==='ok',status,records:0,accepted:0,invalid_records:0,cached:false,max_bytes:TITLE_LIMITS.bytes,...extra};}
function safeName(value){return typeof value==='string'&&value.length<=TITLE_LIMITS.nameLength&&value.trim().length>0&&!UNSAFE.test(value);}
/** Newest valid timestamp wins; equal timestamps use later physical file order.
 * A late-arriving older timestamp cannot revert an earlier observed rename.
 * Names are returned byte-for-codepoint as authored: no trim, summary or redaction.
 */
export function parseSessionTitles(raw){
 if(typeof raw!=='string'||Buffer.byteLength(raw)>TITLE_LIMITS.bytes)throw Error('Title metadata exceeds bound');
 const selected=new Map();let records=0,invalid=0;
 for(const line of raw.replace(/^\uFEFF/,'').split('\n')){
  if(!line.trim())continue;if(++records>TITLE_LIMITS.records)throw Error('Title metadata record bound exceeded');
  let row;try{row=JSON.parse(line);}catch{invalid++;continue;}
  const valid=row&&typeof row==='object'&&typeof row.id==='string'&&UUID.test(row.id)&&safeName(row.thread_name)&&typeof row.updated_at==='string'&&ISO.test(row.updated_at);
  const at=valid?Date.parse(row.updated_at):NaN;if(!valid||!Number.isFinite(at)){invalid++;continue;}
  const id=row.id.toLowerCase(),previous=selected.get(id);if(!previous||at>=previous.at)selected.set(id,{at,name:row.thread_name});
 }
 return {titles:new Map([...selected].map(([id,row])=>[id,row.name])),diagnostics:diagnostics('ok',{records,accepted:selected.size,invalid_records:invalid})};
}
function signature(stat){return [stat.size,stat.mtimeMs,stat.ctimeMs,stat.ino,stat.dev].join(':');}
function snapshot(value,cached=false){return {titles:new Map(value.titles),diagnostics:{...value.diagnostics,cached}};}
export function createCodexTitleReader({codexHome=process.env.CODEX_HOME||path.join(os.homedir(),'.codex')}={}){
 const configured=path.resolve(codexHome);let cache=null;
 return {async read(){
  let home,handle;
  try{
   const homeStat=await fs.lstat(configured);if(!homeStat.isDirectory()||homeStat.isSymbolicLink())return {titles:new Map(),diagnostics:diagnostics('home_untrusted')};
   home=await fs.realpath(configured);const filename=path.join(home,'session_index.jsonl'),expected=await fs.lstat(filename);
   if(!expected.isFile()||expected.isSymbolicLink()||await fs.realpath(filename)!==filename)return {titles:new Map(),diagnostics:diagnostics('index_untrusted')};
   if(expected.size>TITLE_LIMITS.bytes)return {titles:new Map(),diagnostics:diagnostics('size_exceeded')};
   handle=await fs.open(filename,constants.O_RDONLY|(constants.O_NOFOLLOW||0));const opened=await handle.stat(),after=await fs.lstat(filename);
   if(!opened.isFile()||after.isSymbolicLink()||signature(opened)!==signature(expected)||signature(after)!==signature(opened))return {titles:new Map(),diagnostics:diagnostics('index_changed')};
   const key=signature(opened);if(cache?.key===key)return snapshot(cache.value,true);
   const buffer=Buffer.alloc(TITLE_LIMITS.bytes+1);let size=0;
   while(size<buffer.length){const {bytesRead}=await handle.read(buffer,size,buffer.length-size,size);if(!bytesRead)break;size+=bytesRead;}
   if(size>TITLE_LIMITS.bytes)return {titles:new Map(),diagnostics:diagnostics('size_exceeded')};
   const final=await handle.stat(),finalPath=await fs.lstat(filename);if(finalPath.isSymbolicLink()||signature(final)!==key||signature(finalPath)!==key)return {titles:new Map(),diagnostics:diagnostics('index_changed')};
   let raw;try{raw=new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,size));}catch{return {titles:new Map(),diagnostics:diagnostics('invalid_utf8')};}
   const value=parseSessionTitles(raw);cache={key,value};return snapshot(value);
  }catch(error){cache=null;return {titles:new Map(),diagnostics:diagnostics(error.code==='ENOENT'?'missing':'unavailable')};}
  finally{await handle?.close();}
 }};
}
export async function readCodexTitles(options={}){
 const key=path.resolve(options.codexHome||process.env.CODEX_HOME||path.join(os.homedir(),'.codex'));
 let reader=readers.get(key);if(!reader){reader=createCodexTitleReader({codexHome:key});readers.set(key,reader);if(readers.size>TITLE_LIMITS.homes)readers.delete(readers.keys().next().value);}
 return reader.read();
}
