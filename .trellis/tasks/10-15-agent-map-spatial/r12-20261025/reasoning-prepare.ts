/** Freeze six answer-time inputs; never contact a provider or execute a tool. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,join,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const root=fileURLToPath(new URL('.',import.meta.url));
export const repo=resolve(root,'../../../..');
export const endpoint='https://ark.cn-beijing.volces.com/api/plan/v3';
export const requestModel='deepseek-v4.1-flash';
export const responseModel='deepseek-v4-1-flash-261017';
export const maxTokens=32768;
export const limits={requests:12,input:400_000,output:400_000} as const;
export type Group='C0'|'C1';
export interface Message {role:string;content?:unknown;[key:string]:unknown}
export interface Payload {model:string;messages:Message[];tools?:unknown[];thinking?:{type:string};reasoning_effort?:string;max_tokens?:number;top_p?:number;temperature?:number;stream?:boolean;[key:string]:unknown}
export const digest=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
export const read=<T>(path:string)=>JSON.parse(readFileSync(path,'utf8')) as T;
export const saveNew=(path:string,value:unknown)=>writeFileSync(path,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
export const additions={C05:'请同时说明你采用的判断方法和依据。'} as const;
export const materials=[
 {id:'C01',family:'Q02',source:'Q02-2-S0-N/provider-0134-wire-input.json',topic:'查询失败后改条件成功',review:'成功调用只有query=西区，没有按返回区域ID重新查询；点数1、availableCount=4。'},
 {id:'C02',family:'Q04',source:'Q04-2-S1-N/provider-0168-wire-input.json',topic:'第一次500米固定范围筛选为空',review:'固定500米结果未重新生成，命中0；不要凭空添加距离排名，边界点实际不是第二近。'},
 {id:'C03',family:'Q05',source:'Q05-1-S0-P/provider-0073-wire-input.json',topic:'读取多个图层，仅resources参与计算',review:'读取范围与计算候选分开；nearest输入仅resources，不能说整个草稿都参加最近排序。'},
 {id:'C04',family:'Q06',source:'Q06-1-S1-P/provider-0096-wire-input.json',topic:'先预览、后精确保存',review:'先前预览没有保存；本轮实际保存回执revision=2，派生图层临时范围。未发布、未设当前。'},
 {id:'C05',family:'Q01',source:'Q01-1-S1-P/provider-0012-wire-input.json',topic:'明确要求判断方法与依据',review:'构造的解释要求必须回答；真实classify_points返回内部2、边界2、外部1，包含边界共4。'},
 {id:'C06',family:'Q05',source:'Q05-2-S1-P/provider-0194-wire-input.json',topic:'明确要求名称及直线距离',review:'按真实nearest回执给两点名称和距离；不可漏答距离以躲避事实检查。与C03同家族，不算独立场景。'},
] as const;
export interface MaterialRecord {id:string;family:string;kind:'historical'|'constructed';sourcePath:string;sourceSha256:string;sourceMetaPath:string;sourceMetaSha256:string;sourceMessageCount:number;sourceInputTokens:number;inputReservation:number;userMessageIndex:number;construction:null|{kind:'append_to_existing_user_text';text:string};basePath:string;baseSha256:string;evidenceSha256:string;review:string}
export interface Slot {id:string;caseId:string;group:Group;bodyPath:string;bodySha256:string;inputReservation:number}
export interface Freeze {schemaVersion:1;scope:'answer_generation_only';sourceCode:Record<string,string>;configuration:{endpoint:string;requestModel:string;responseModel:string;maxTokens:number;topP:1;temperature:'absent'};limits:typeof limits;materials:MaterialRecord[];schedule:Slot[];plannedRequests:12;automaticRetries:false;executeTools:false}
const sourceNames=['reasoning-prepare.ts','reasoning-live.ts','../r7-20261023/environment.ts','../../10-17-map-query-native-evaluation/run.ts'];
export function sourceHashes(){return Object.fromEntries(sourceNames.map(name=>{const path=resolve(root,name);return [relative(repo,path),digest(readFileSync(path))];}));}
function appendRequirement(messages:Message[],index:number,text:string){
 const message=messages[index];assert.equal(message.role,'user');
 if(typeof message.content==='string')message.content+='\n'+text;
 else {assert.ok(Array.isArray(message.content));const parts=message.content as Array<Record<string,unknown>>;const last=parts.findLast(p=>p.type==='text'&&typeof p.text==='string');assert.ok(last);last.text=String(last.text)+'\n'+text;}
}
export function prepareBase(original:Payload,id:string){
 assert.equal(original.model,requestModel);assert.deepEqual(original.thinking,{type:'disabled'});assert.equal(original.reasoning_effort,undefined);assert.equal(original.temperature,undefined);assert.equal(original.top_p,undefined);assert.equal(original.max_tokens,8192);
 assert.equal(original.messages.at(-1)?.role,'tool','Snapshot must precede the actual answer after real tool evidence');assert.ok(Array.isArray(original.tools)&&original.tools.length>0);assert.equal(original.stream,true);
 const base=structuredClone(original),userMessageIndex=base.messages.findLastIndex(m=>m.role==='user');assert.ok(userMessageIndex>=0);
 if(id==='C05'){
  const content=base.messages.at(-1)!.content;assert.equal(typeof content,'string');
  const result=JSON.parse(content as string) as {data:{operation:string;values:unknown}};assert.equal(result.data.operation,'classify_points');assert.deepEqual(result.data.values,{total:5,interior:2,boundary:2,exterior:1},'C05 source classification facts changed');
  appendRequirement(base.messages,userMessageIndex,additions.C05);
 }
 return {base,userMessageIndex};
}
export function bodyFor(base:Payload,group:Group):Payload{
 const body=structuredClone(base);body.model=requestModel;body.max_tokens=maxTokens;body.top_p=1;body.thinking={type:group==='C0'?'disabled':'enabled'};delete body.reasoning_effort;delete body.temperature;
 if(group==='C1')body.reasoning_effort='high';return body;
}
export function assertPair(a:Payload,b:Payload){
 const left=structuredClone(a),right=structuredClone(b);assert.deepEqual(left.thinking,{type:'disabled'});assert.equal(left.reasoning_effort,undefined);assert.deepEqual(right.thinking,{type:'enabled'});assert.equal(right.reasoning_effort,'high');
 delete left.thinking;delete right.thinking;delete right.reasoning_effort;assert.deepEqual(left,right,'Evidence or unrelated parameters differ across C groups');
 for(const value of [a,b]){assert.equal(value.max_tokens,maxTokens);assert.equal(value.top_p,1);assert.equal(value.temperature,undefined);assert.equal(value.stream,true);}
}
export function prepare(directory:string):Freeze{
 directory=resolve(directory);assert.ok(directory.startsWith(join(repo,'.local/spatial-r12')+'/'),'Use isolated R12 .local output');assert.ok(!existsSync(directory),'Refuse to overwrite a prepared batch');
 const records:MaterialRecord[]=[],schedule:Slot[]=[],pending:Array<{path:string;value:unknown}>=[];
 for(const [i,spec] of materials.entries()){
  const path=join(repo,'.local/spatial-r11/batch-20261025',spec.source),metaPath=path.replace('-wire-input.json','-meta.json');
  const bytes=readFileSync(path),original=JSON.parse(bytes.toString('utf8')) as Payload;
  const meta=read<{completed:boolean;status:number;actualModels:string[];wirePayloadHash:string;usage:{prompt_tokens:number}}>(metaPath);
  assert.equal(meta.completed,true);assert.equal(meta.status,200);assert.deepEqual(meta.actualModels,[responseModel]);assert.equal(meta.wirePayloadHash,digest(JSON.stringify(original)),'Historical wire metadata mismatch');
  assert.ok(Number.isSafeInteger(meta.usage.prompt_tokens)&&meta.usage.prompt_tokens>0);
  const {base,userMessageIndex}=prepareBase(original,spec.id),basePath=`${spec.id}-base.json`,inputReservation=meta.usage.prompt_tokens+2048+(spec.id==='C05'?Buffer.byteLength(additions.C05):0);
  const record:MaterialRecord={id:spec.id,family:spec.family,kind:spec.id==='C05'?'constructed':'historical',sourcePath:relative(repo,path),sourceSha256:digest(bytes),sourceMetaPath:relative(repo,metaPath),sourceMetaSha256:digest(readFileSync(metaPath)),sourceMessageCount:original.messages.length,sourceInputTokens:meta.usage.prompt_tokens,inputReservation,userMessageIndex,construction:spec.id==='C05'?{kind:'append_to_existing_user_text',text:additions.C05}:null,basePath,baseSha256:digest(JSON.stringify(base)),evidenceSha256:digest(JSON.stringify({messages:base.messages,tools:base.tools})),review:spec.review};
  records.push(record);pending.push({path:basePath,value:base});const pair={C0:bodyFor(base,'C0'),C1:bodyFor(base,'C1')};assertPair(pair.C0,pair.C1);
  const groups:Group[]=i%2===0?['C0','C1']:['C1','C0'];
  for(const group of groups){const id=`${spec.id}-${group}`,bodyPath=`${id}-request.json`;schedule.push({id,caseId:spec.id,group,bodyPath,bodySha256:digest(JSON.stringify(pair[group])),inputReservation});pending.push({path:bodyPath,value:pair[group]});}
 }
 assert.equal(schedule.length,limits.requests);assert.ok(schedule.reduce((n,s)=>n+s.inputReservation,0)<=limits.input,'Full inputs exceed approved C reservation; do not trim');assert.ok(schedule.length*maxTokens<=limits.output);
 const frozen:Freeze={schemaVersion:1,scope:'answer_generation_only',sourceCode:sourceHashes(),configuration:{endpoint,requestModel,responseModel,maxTokens,topP:1,temperature:'absent'},limits,materials:records,schedule,plannedRequests:12,automaticRetries:false,executeTools:false};
 mkdirSync(dirname(directory),{recursive:true,mode:0o700});mkdirSync(directory,{mode:0o700});for(const p of pending)saveNew(join(directory,p.path),p.value);saveNew(join(directory,'freeze.json'),frozen);return frozen;
}
export function verifyFrozen(directory:string,frozen:Freeze){
 assert.deepEqual(frozen.sourceCode,sourceHashes(),'C driver source drift');assert.deepEqual(frozen.limits,limits);assert.deepEqual(frozen.configuration,{endpoint,requestModel,responseModel,maxTokens,topP:1,temperature:'absent'});assert.equal(frozen.schedule.length,12);assert.deepEqual(frozen.materials.map(r=>r.id),materials.map(r=>r.id));
 for(const material of frozen.materials){
  assert.equal(digest(readFileSync(join(repo,material.sourcePath))),material.sourceSha256,'Original historical request changed');assert.equal(digest(readFileSync(join(repo,material.sourceMetaPath))),material.sourceMetaSha256,'Historical metadata changed');
  const original=read<Payload>(join(repo,material.sourcePath)),base=read<Payload>(join(directory,material.basePath));assert.deepEqual(base,prepareBase(original,material.id).base,'Base differs beyond declared construction');assert.equal(digest(JSON.stringify(base)),material.baseSha256);
  const slots=frozen.schedule.filter(s=>s.caseId===material.id);assert.equal(slots.length,2);const bodies=Object.fromEntries(slots.map(slot=>{const b=read<Payload>(join(directory,slot.bodyPath));assert.equal(digest(JSON.stringify(b)),slot.bodySha256);assert.deepEqual(b,bodyFor(base,slot.group));return [slot.group,b];}));assertPair(bodies.C0,bodies.C1);
 }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 assert.equal(process.argv.length,3,'reasoning-prepare.ts NEW_PREPARED_DIRECTORY');const frozen=prepare(process.argv[2]);console.info(JSON.stringify({prepared:process.argv[2],requests:frozen.schedule.length,inputReservation:frozen.schedule.reduce((n,s)=>n+s.inputReservation,0),providerRequests:0}));
}
