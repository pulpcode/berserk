/** Bounded result-expression experiment; no tool execution, retries or production state. */
import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {mkdir,readFile,writeFile,rmdir,readdir} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {sha,endpoint,parseSSE,readStream,redact,classify,verify as verifyOriginal} from '../10-15-map-query-scope/model-comparison/replay.mjs';
import {describeAnnotationRead} from '../../../experiments/harness-lab/src/pi/annotation-results.ts';
import {prepareFixtures} from './fixtures.mjs';
const here=dirname(fileURLToPath(import.meta.url));
export const ROOT=resolve(here,'../../..');
const json=value=>JSON.stringify(value,null,2)+'\n';
const save=(file,value)=>writeFile(file,json(value),{flag:'wx',mode:0o600});
export const limits={timeoutMs:60000,maxTokens:2048,maxInput:2000000,maxOutput:60000,maxCalls:96};
export function schedule(stage='S1'){
 assert.ok(['S1','S2'].includes(stage));
 const cases=stage==='S1'?['C1','C2','C4']:['N1','N2','N3'];
 return [1,2,3,4,5].flatMap(repeat=>cases.flatMap(caseId=>(repeat%2?['A','B']:['B','A']).map(condition=>({stage,caseId,repeat,condition})))).map((e,i)=>({...e,index:i+1}));
}
export function pair(captured){
 assert.equal(captured.model,'deepseek-flash'); assert.equal(captured.thinking.type,'disabled');
 const A={...structuredClone(captured),max_tokens:limits.maxTokens},B=structuredClone(A);
 let start=A.messages.length-1;while(start>=0&&A.messages[start].role==='tool')start--;
 const calls=A.messages[start]?.tool_calls;assert.ok(calls?.length,'missing final tool batch');
 for(let i=start+1;i<A.messages.length;i++){
  const message=A.messages[i],call=calls.find(c=>c.id===message.tool_call_id);
  assert.equal(call?.function.name,'annotation_read');
  const params=JSON.parse(call.function.arguments),decoded=JSON.parse(message.content);
  assert.ok(['draft','read'].includes(params.mode)); assert.equal(decoded.format,'annotation.model-result.v1');
  const query=Object.fromEntries(['objectIds','layerIds','fields'].filter(k=>params[k]!==undefined).map(k=>[k,params[k]]));
  assert.deepEqual(decoded.data.query,query,'execution selectors and result query diverge');
  assert.ok(!('readSummary' in decoded.data));
  const readSummary=describeAnnotationRead(decoded.data,params); assert.equal(typeof readSummary,'string');
  assert.ok(Buffer.byteLength(readSummary)<=1024);
  B.messages[i].content=JSON.stringify({...decoded,data:{readSummary,...decoded.data}});
 }
 assertPair(A,B); return {A,B};
}
export function assertPair(A,B){
 const stripped=structuredClone(B);let changed=0;
 for(let i=0;i<A.messages.length;i++)if(!isDeepStrictEqual(A.messages[i].content,B.messages[i].content)){
  assert.equal(A.messages[i].role,'tool');const data=JSON.parse(stripped.messages[i].content);
  assert.equal(typeof data.data.readSummary,'string');delete data.data.readSummary;
  assert.deepEqual(data,JSON.parse(A.messages[i].content));
  stripped.messages[i].content=A.messages[i].content;changed++;
 }
 assert.ok(changed>0);assert.deepEqual(stripped,A,'unapproved A/B difference');
}
const productSources=['src/pi/annotation-results.ts','src/pi/annotation-tools.ts','src/pi/lab.ts','src/pi/annotation-state.ts','src/pi/composer-input.ts','src/contracts/annotation-results.ts','src/annotations/service.ts','src/annotations/validation.ts','package-lock.json'];
export async function prepare(output){
 await verifyOriginal();
 await mkdir(dirname(output),{recursive:true});await mkdir(output,{mode:0o700});await mkdir(join(output,'inputs'));
 const files={};
 const write=async(name,value)=>{const bytes=json(value);await writeFile(join(output,name),bytes,{flag:'wx',mode:0o600});files[name]=sha(bytes);};
 const captured={};
 for(const c of ['C1','C2','C4'])captured[c]=JSON.parse(await readFile(join(ROOT,`.local/map-model-comparison/inputs/${c}.captured.json`),'utf8'));
 const fixtures=await prepareFixtures(output,captured.C2);
 for(const [c,item] of Object.entries(fixtures)){captured[c]=item.payload;await write(`inputs/${c}.evaluator.json`,item.evaluator);}
 for(const [c,input] of Object.entries(captured))for(const [condition,payload] of Object.entries(pair(input)))await write(`inputs/${c}.${condition}.json`,payload);
 await write('scoring.json',{text:await readFile(join(here,'scoring.md'),'utf8'),stage1:schedule(),stage2:schedule('S2')});
 const sourcePaths=[...productSources.map(p=>'experiments/harness-lab/'+p),...['replay.mjs','fixtures.mjs','replay.test.mjs','scoring.md','design.md'].map(p=>'.trellis/tasks/10-16-agent-map-evidence-audit/'+p)];
 const sources={};for(const path of sourcePaths)sources[path]=sha(await readFile(join(ROOT,path)));
 const patch=execFileSync('git',['diff','HEAD','--','experiments/harness-lab'],{cwd:ROOT,encoding:'utf8'});
 await writeFile(join(output,'candidate.patch'),patch,{flag:'wx',mode:0o600});files['candidate.patch']=sha(patch);
 const manifest={version:1,preparedAt:new Date().toISOString(),gitHead:execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim(),limits,sources,files,toolsSha256:sha(JSON.stringify(captured.C2.tools)),schedule:[...schedule(),...schedule('S2')],driverIssuedNewCases:true,model:'deepseek-flash',providerCallsDuringPrepare:0};
 await save(join(output,'manifest.json'),manifest);await writeFile(join(output,'manifest.sha256'),sha(json(manifest))+'\n',{flag:'wx'});
 return {prepared:true,output,manifestSha256:sha(json(manifest)),frozenRequests:12};
}
export async function verify(output){
 const bytes=await readFile(join(output,'manifest.json'));assert.equal(sha(bytes),(await readFile(join(output,'manifest.sha256'),'utf8')).trim());
 const manifest=JSON.parse(bytes);assert.deepEqual(manifest.limits,limits);
 for(const [path,hash] of Object.entries(manifest.sources))assert.equal(sha(await readFile(join(ROOT,path))),hash,`source changed: ${path}`);
 for(const [path,hash] of Object.entries(manifest.files))assert.equal(sha(await readFile(join(output,path))),hash,`input changed: ${path}`);
 await verifyOriginal();return manifest;
}
export function checkBudget(records){
 assert.ok(records.length<limits.maxCalls,'call budget exhausted');
 let input=0,output=0;
 for(const r of records){assert.ok(Number.isFinite(r.usage?.prompt_tokens)&&Number.isFinite(r.usage?.completion_tokens),'unknown usage; stop');input+=r.usage.prompt_tokens;output+=r.usage.completion_tokens;}
 assert.ok(input<limits.maxInput,'input budget exhausted');assert.ok(output+limits.maxTokens<=limits.maxOutput,'output reservation exhausted');return {input,output,calls:records.length};
}
export async function runEntry(output,stage,index,{env=process.env,fetchImpl=fetch}={}){
 await verify(output);
 if(stage==='S2'){const gate=JSON.parse(await readFile(join(output,'S1-gate.json'),'utf8'));assert.equal(gate.accepted,true,'S1 not accepted');}
 const entry=schedule(stage)[index-1];assert.equal(entry?.index,index,'invalid index');
 const apiKey=env.LLM_API_KEY?.trim();assert.ok(apiKey,'missing api key');
 const url=endpoint(env.LLM_BASE_URL??'https://api.deepseek.com');
 const lock=join(output,'.run-lock');await mkdir(lock);
 try{
  const runs=join(output,'runs');await mkdir(runs,{recursive:true});
  const records=[];for(const id of await readdir(runs))records.push(JSON.parse(await readFile(join(runs,id,'result.json'),'utf8')));
  checkBudget(records);
  const stageRecords=records.filter(r=>r.stage===stage);assert.equal(stageRecords.length,index-1,'out of order or duplicate');
  for(let i=1;i<index;i++)assert.ok(stageRecords.some(r=>r.index===i),'prior entry missing');
  const dir=join(runs,`${stage}-${String(index).padStart(2,'0')}`);await mkdir(dir,{mode:0o700});
  const body=await readFile(join(output,`inputs/${entry.caseId}.${entry.condition}.json`),'utf8');assert.equal(redact(body,apiKey),body,'credential in body');
  await writeFile(join(dir,'request.json'),body,{flag:'wx',mode:0o600});
  const startedAt=new Date().toISOString(),start=performance.now(),controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),limits.timeoutMs);let raw='',httpStatus=null,transport=null;
  try{
   const response=await fetchImpl(url,{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body,signal:controller.signal,redirect:'error'});
   httpStatus=response.status;await readStream(response.body,text=>{raw+=text;});
  }catch{transport=controller.signal.aborted?'timeout':'transport_error';}finally{clearTimeout(timeout);}
  const {events,result}=parseSSE(raw);
  const record={...entry,startedAt,elapsedMs:Math.round(performance.now()-start),httpStatus,status:classify(result,transport,httpStatus),endpoint:url,requestSha256:sha(body),...result};
  for(const [name,bytes] of Object.entries({'response.sse':raw,'events.json':json(events),'result.json':json(record)}))await writeFile(join(dir,name),redact(bytes,apiKey),{flag:'wx',mode:0o600});
  return {stage,index,caseId:entry.caseId,condition:entry.condition,status:record.status,usage:record.usage};
 }finally{await rmdir(lock);}
}
async function main(){
 const [command,...args]=process.argv.slice(2);const option=args.indexOf('--output');assert.ok(option>=0&&args[option+1],'--output required');const output=resolve(args[option+1]);args.splice(option,2);
 if(command==='prepare'){assert.equal(args.length,0);console.log(JSON.stringify(await prepare(output)));}
 else if(command==='verify'){console.log(JSON.stringify({verified:!!await verify(output)}));}
 else if(command==='run'){const [stage,target]=args;assert.ok(['S1','S2'].includes(stage));for(const index of target==='all'?schedule(stage).map(e=>e.index):[Number(target)])console.log(JSON.stringify(await runEntry(output,stage,index)));}
 else throw new Error('usage: prepare|verify --output DIR; run S1|S2 all|INDEX --output DIR');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error('Stopped without retry:',error instanceof assert.AssertionError?error.message:'preparation/transport unavailable; inspect artifacts');process.exitCode=1;});
