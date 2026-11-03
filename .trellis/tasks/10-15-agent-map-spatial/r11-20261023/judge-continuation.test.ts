import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {assertOriginalLedger,assertRepairScope,continueJudgments} from './judge-continuation.js';
import {openLedger,formatHalt,type LedgerData,type FormatRecovery} from './budget.js';
import {digest} from './runtime.js';
import type {sourceFreeze} from './live.js';
import type {JudgeConfig,JudgeWork,Judgment,JudgeRecord} from './judge.js';
const model='deepseek-v4-1-flash-261017';
const config:JudgeConfig={schemaVersion:1,baseUrl:'https://ark.cn-beijing.volces.com/api/plan/v3',model:'deepseek-v4.1-flash',responseModel:model,maxTokens:8192,thinking:{type:'disabled'}};
const output:Judgment={schemaVersion:1,id:'task0',unit:'task',verdict:'pass',severity:'none',axes:{completion:'pass',evidence:'pass',processFacts:'pass',finalFacts:'pass',effects:'pass',boundaries:'pass',coverage:'pass'},clarity:'clear',reason:'offline fixture',evidence:[{sourceLine:null,quote:'fixture',interpretation:'offline'}]};
function fixture(){
 const directory=mkdtempSync(join(tmpdir(),'r11-continuation-')),path=join(directory,'ledger.json');
 const data:LedgerData={version:1,freezeHash:'original',halted:formatHalt,requests:Array.from({length:260},(_,i)=>({id:'request'+i,role:i<235?'agent':'judge',trialId:i<235?'agent'+i:i<259?'C'+(i-234):'task0',startedAt:'2026-10-25T00:00:00Z',status:'finished',usage:{inputTokens:1,outputTokens:1,responseModel:model}}))};
 writeFileSync(path,JSON.stringify(data));const backupPath=join(directory,'backup.json');writeFileSync(backupPath,readFileSync(path));
 const recovery:FormatRecovery={authorization:'offline test',originalLedgerSha256:digest(readFileSync(path)),backupPath,repairedFreezeHash:'b'.repeat(64),reusedRequestId:'request259',canonicalOutputSha256:'c'.repeat(64),remainingJudgeTrialIds:Array.from({length:63},(_,i)=>'task'+(i+1))};
 return {directory,path,data,recovery,ledger:openLedger(path,'original'),cleanup:()=>rmSync(directory,{recursive:true,force:true})};
}
test('recovery preserves all 260 records, halt backup and counters; only approved pending inputs may start',()=>{const f=fixture();try{
 assertOriginalLedger(f.data,'task0');f.ledger.recoverFormatHalt(f.recovery);assert.deepEqual(f.ledger.read().requests,f.data.requests);assert.equal(f.ledger.totals().requests,260);assert.equal(f.ledger.read().recoveries?.[0].previousHalt,formatHalt);assert.equal(JSON.parse(readFileSync(f.recovery.backupPath,'utf8')).halted,formatHalt);assert.equal(f.ledger.canStartTrial(),false);
 assert.throws(()=>f.ledger.recoverFormatHalt(f.recovery));assert.throws(()=>f.ledger.beginRequest({id:'repeat',role:'judge',trialId:'task0'}));assert.throws(()=>f.ledger.beginRequest({id:'newAgent',role:'agent',trialId:'task1'}));assert.throws(()=>f.ledger.beginRequest({id:'other',role:'judge',trialId:'task65'}));
}finally{f.cleanup();}});
for(const variant of ['unknown usage','wrong halt','changed backup','changed ledger'] as const)test('recovery blocks '+variant,()=>{const f=fixture();try{
 if(variant==='unknown usage'){f.data.requests[0].status='started';delete f.data.requests[0].usage;writeFileSync(f.path,JSON.stringify(f.data));writeFileSync(f.recovery.backupPath,readFileSync(f.path));f.recovery.originalLedgerSha256=digest(readFileSync(f.path));}
 if(variant==='wrong halt'){f.data.halted='HTTP failure';writeFileSync(f.path,JSON.stringify(f.data));writeFileSync(f.recovery.backupPath,readFileSync(f.path));f.recovery.originalLedgerSha256=digest(readFileSync(f.path));}
 if(variant==='changed backup')writeFileSync(f.recovery.backupPath,'{}');
 if(variant==='changed ledger')writeFileSync(f.path,JSON.stringify({...f.data,other:true}));
 assert.throws(()=>f.ledger.recoverFormatHalt(f.recovery));assert.equal(f.ledger.read().requests.length,260);
}finally{f.cleanup();}});
test('repair scope rejects runtime, calibration and unapproved driver drift',()=>{
 const original={driver:{'judge.ts':'old','live.ts':'same','budget.ts':'old'},calibration:{input:'same'},runtime:{baseline:'same'}} as unknown as Awaited<ReturnType<typeof sourceFreeze>>;
 const current={...original,driver:{...original.driver,'judge.ts':'new','judge-format.ts':'new'}};assert.deepEqual(assertRepairScope(original,current),['judge.ts','judge-format.ts']);
 assert.throws(()=>assertRepairScope(original,{...current,calibration:{input:'changed'}}));assert.throws(()=>assertRepairScope(original,{...current,driver:{...current.driver,'live.ts':'changed'}}));assert.throws(()=>assertRepairScope(original,{...current,driver:{...current.driver,'surprise.ts':'new'}}));
});
test('63 simulated first judgments complete all 64 without requesting the reused slot or resetting budgets',async()=>{const f=fixture();try{
 f.ledger.recoverFormatHalt(f.recovery);const work:JudgeWork[]=Array.from({length:64},(_,i)=>({trial:{id:'run'+i,status:'recorded',group:'S0-N',caseId:'Q01',split:'development'},input:{schemaVersion:1,id:'task'+i,unit:'task',businessContext:'offline',userPrompts:[],visibleTranscript:[],stateEvidence:[],expectedBehavior:{},temporalRule:'evidence first'},criticalEffects:[]}));
 const reusedRecord={id:'task0',requestId:'original-provider-id',requestPath:'original',requestSha256:'x',responsePath:'original',responseSha256:'x',outputPath:'original',outputSha256:'x',startedAt:'a',completedAt:'b',model,usage:{inputTokens:1,outputTokens:1}} satisfies JudgeRecord;
 const requested:string[]=[];const result=await continueJudgments({directory:f.directory,work,reusedRecords:[reusedRecord],reusedOutputs:[output],ledger:f.ledger,config,rubric:'offline',secret:'offline-secret',verify:async()=>{},transport:(async(_url,init)=>{const body=JSON.parse(init?.body as string),input=JSON.parse(body.messages[1].content);requested.push(input.id);return Response.json({id:'provider'+requested.length,model,usage:{prompt_tokens:1,completion_tokens:1},choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify({...output,id:input.id,reviewNotes:'offline extra description'})}}]});}) as typeof fetch});
 assert.deepEqual(requested,f.recovery.remainingJudgeTrialIds);assert.equal(result.records.length,64);assert.equal(result.scores.length,64);assert.equal(f.ledger.totals().requests,323);assert.equal(f.ledger.totals('judge').requests,88);assert.equal(f.ledger.canStartJudge(),false);assert.deepEqual(f.ledger.read().requests.slice(0,260),f.data.requests);
}finally{f.cleanup();}});
test('a malformed core remains judge_error while subsequent first judgments complete without retry',async()=>{const f=fixture();try{
 f.ledger.recoverFormatHalt(f.recovery);let calls=0;const work:JudgeWork[]=Array.from({length:64},(_,i)=>({trial:{id:'run'+i,status:'recorded',group:'S0-N',caseId:'Q01',split:'development'},input:{schemaVersion:1,id:'task'+i,unit:'task',businessContext:'offline',userPrompts:[],visibleTranscript:[],stateEvidence:[],expectedBehavior:{},temporalRule:'evidence first'}}));
 const result=await continueJudgments({directory:f.directory,work,reusedRecords:[{id:'task0'} as JudgeRecord],reusedOutputs:[output],ledger:f.ledger,config,rubric:'offline',secret:'offline-secret',verify:async()=>{},transport:(async()=>{calls++;return Response.json({id:'one',model,usage:{prompt_tokens:2,completion_tokens:3},choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify({...output,id:'task'+calls,axes:{...output.axes,evidence:calls===1?'fail':'pass'}})}}]});}) as typeof fetch});
 assert.equal(calls,63);assert.equal(f.ledger.totals().unknown,0);assert.equal(f.ledger.totals().requests,323);assert.equal(f.ledger.read().halted,undefined);assert.equal(result.records.length,64);assert.equal(result.scores[1].strict,'judge_error');assert.equal(result.scores[2].strict,'pass');assert.deepEqual(result.records[1].judgeError?.validationErrors,['verdict contradicts axes']);assert.equal(JSON.parse(readFileSync(join(f.directory,'progress.json'),'utf8')).records.length,64);
}finally{f.cleanup();}});

test('fixed 262-request repair retains both failures and all three returned responses, then requests only 61',async()=>{const f=fixture();try{
 f.ledger.recoverFormatHalt(f.recovery);
 for(const i of [1,2]){f.ledger.beginRequest({id:'returned'+i,role:'judge',trialId:'task'+i});f.ledger.finishRequest('returned'+i,{inputTokens:2,outputTokens:3,responseModel:model});}
 f.ledger.halt('Unsupported additional judgment field reasonDetail');const original262=f.ledger.read(),backupPath=join(f.directory,'backup262.json');writeFileSync(backupPath,readFileSync(f.path));
 const recovery:FormatRecovery={...f.recovery,authorization:'approved completion of same64',originalLedgerSha256:digest(readFileSync(f.path)),backupPath,repairedFreezeHash:'d'.repeat(64),reusedRequestId:'returned2',remainingJudgeTrialIds:Array.from({length:61},(_,i)=>'task'+(i+3)),parentRecoverySha256:digest(JSON.stringify(original262.recoveries!.at(-1)))};
 assertOriginalLedger(original262,'task0',['task1','task2']);assert.throws(()=>assertOriginalLedger(original262,'task0',['task2','task1']));assert.throws(()=>f.ledger.recoverFormatHalt({...recovery,parentRecoverySha256:'wrong'}));f.ledger.recoverFormatHalt(recovery);assert.deepEqual(f.ledger.read().recoveries?.[0],original262.recoveries![0]);assert.equal(f.ledger.read().recoveries?.[1].previousHalt,'Unsupported additional judgment field reasonDetail');assert.throws(()=>f.ledger.recoverFormatHalt(recovery));
 const work:JudgeWork[]=Array.from({length:64},(_,i)=>({trial:{id:'run'+i,status:'recorded',group:'S0-N',caseId:'Q01',split:'development'},input:{schemaVersion:1,id:'task'+i,unit:'task',businessContext:'offline',userPrompts:[],visibleTranscript:[],stateEvidence:[],expectedBehavior:{},temporalRule:'evidence first'}}));
 const reusedRecords=[0,1,2].map(i=>({id:'task'+i} as JudgeRecord)),reusedOutputs=[0,1,2].map(i=>({...output,id:'task'+i}));const requested:string[]=[];
 const result=await continueJudgments({directory:f.directory,work,reusedRecords,reusedOutputs,ledger:f.ledger,config,rubric:'offline',secret:'offline-secret',verify:async()=>{},transport:(async(_url,init)=>{const id=JSON.parse(JSON.parse(init?.body as string).messages[1].content).id;requested.push(id);return Response.json({id:'provider'+requested.length,model,usage:{prompt_tokens:1,completion_tokens:1},choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify({...output,id,reasonDetail:{completion:'unchanged core'},other:[{reason:'preserved metadata'}]})}}]});}) as typeof fetch});
 assert.deepEqual(requested,recovery.remainingJudgeTrialIds);assert.equal(result.records.length,64);assert.equal(result.scores.length,64);assert.equal(f.ledger.totals().requests,323);assert.equal(f.ledger.totals('judge').requests,88);assert.deepEqual(f.ledger.read().requests.slice(0,262),original262.requests);assert.equal(f.ledger.read().recoveries?.length,2);assert.equal(f.ledger.canStartJudge(),false);
}finally{f.cleanup();}});


test('fixed 270 snapshot preserves all eleven responses and two recovery events, requests only53 and isolates invalid outputs',async()=>{const f=fixture();try{
 f.ledger.recoverFormatHalt(f.recovery);
 for(const i of [1,2]){f.ledger.beginRequest({id:'returned'+i,role:'judge',trialId:'task'+i});f.ledger.finishRequest('returned'+i,{inputTokens:2,outputTokens:3,responseModel:model});}
 f.ledger.halt('Unsupported additional judgment field reasonDetail');const backup262=join(f.directory,'262.json');writeFileSync(backup262,readFileSync(f.path));
 f.ledger.recoverFormatHalt({...f.recovery,originalLedgerSha256:digest(readFileSync(f.path)),backupPath:backup262,reusedRequestId:'returned2',remainingJudgeTrialIds:Array.from({length:61},(_,i)=>'task'+(i+3)),parentRecoverySha256:digest(JSON.stringify(f.ledger.read().recoveries!.at(-1)))});
 for(let i=3;i<11;i++){f.ledger.beginRequest({id:'returned'+i,role:'judge',trialId:'task'+i});f.ledger.finishRequest('returned'+i,{inputTokens:2,outputTokens:3,responseModel:model});}
 f.ledger.halt(formatHalt);const original270=f.ledger.read(),backup270=join(f.directory,'270.json');writeFileSync(backup270,readFileSync(f.path));
 const remaining=Array.from({length:53},(_,i)=>'task'+(i+11)),recovery={...f.recovery,originalLedgerSha256:digest(readFileSync(f.path)),backupPath:backup270,reusedRequestId:'returned10',remainingJudgeTrialIds:remaining,parentRecoverySha256:digest(JSON.stringify(original270.recoveries!.at(-1)))};
 assertOriginalLedger(original270,'task0',Array.from({length:10},(_,i)=>'task'+(i+1)));assert.throws(()=>f.ledger.recoverFormatHalt({...recovery,parentRecoverySha256:'wrong'}));f.ledger.recoverFormatHalt(recovery);assert.deepEqual(f.ledger.read().recoveries?.slice(0,2),original270.recoveries);
 const work:JudgeWork[]=Array.from({length:64},(_,i)=>({trial:{id:'run'+i,status:'recorded',group:'S0-N',caseId:'Q01',split:'development'},input:{schemaVersion:1,id:'task'+i,unit:'task',businessContext:'offline',userPrompts:[],visibleTranscript:[],stateEvidence:[],expectedBehavior:{},temporalRule:'evidence first'}}));
 const bad={...output,id:'task10',verdict:'pending',axes:{...output.axes,completion:'pending',boundaries:'fail',coverage:'pending'}},reusedRecords=Array.from({length:11},(_,i)=>({id:'task'+i,...(i===10?{judgeError:{validationErrors:['verdict contradicts axes'],rawJudgment:bad}}:{})} as JudgeRecord)),reusedOutputs=Array.from({length:11},(_,i)=>i===10?null:{...output,id:'task'+i});const requested:string[]=[];
 const result=await continueJudgments({directory:f.directory,work,reusedRecords,reusedOutputs,ledger:f.ledger,config,rubric:'offline',secret:'offline-secret',verify:async()=>{},transport:(async(_url,init)=>{const id=JSON.parse(JSON.parse(init?.body as string).messages[1].content).id;requested.push(id);const content=requested.length===1?'not-json':JSON.stringify({...output,id,...(requested.length===2?{reason:undefined}:{}),...(requested.length===3?{axes:{...output.axes,extra:'pass'}}:{})});return Response.json({id:'provider'+requested.length,model,usage:{prompt_tokens:1,completion_tokens:1},choices:[{finish_reason:'stop',message:{role:'assistant',content}}]});}) as typeof fetch});
 assert.deepEqual(requested,remaining);assert.equal(result.records.length,64);assert.equal(result.scores.length,64);assert.equal(result.scores.filter(s=>s.strict==='judge_error').length,4);assert.equal(result.scores[14].strict,'pass');assert.deepEqual(result.records[10].judgeError?.rawJudgment,bad);assert.equal(f.ledger.totals().requests,323);assert.equal(f.ledger.totals('judge').requests,88);assert.deepEqual(f.ledger.read().requests.slice(0,270),original270.requests);assert.equal(f.ledger.read().recoveries?.length,3);assert.equal(f.ledger.read().halted,undefined);
}finally{f.cleanup();}});

test('continuation still stops globally on network failure with unknown usage',async()=>{const f=fixture();try{
 f.ledger.recoverFormatHalt(f.recovery);let calls=0;const work:JudgeWork[]=Array.from({length:64},(_,i)=>({trial:{id:'run'+i,status:'recorded',group:'S0-N',caseId:'Q01',split:'development'},input:{schemaVersion:1,id:'task'+i,unit:'task',businessContext:'offline',userPrompts:[],visibleTranscript:[],stateEvidence:[],expectedBehavior:{},temporalRule:'evidence first'}}));
 await assert.rejects(continueJudgments({directory:f.directory,work,reusedRecords:[{id:'task0'} as JudgeRecord],reusedOutputs:[output],ledger:f.ledger,config,rubric:'offline',secret:'offline-secret',verify:async()=>{},transport:(async()=>{calls++;throw new Error('offline network failure');}) as typeof fetch}),/network failure/);assert.equal(calls,1);assert.equal(f.ledger.totals().unknown,1);assert.ok(f.ledger.read().halted);assert.equal(JSON.parse(readFileSync(join(f.directory,'progress.json'),'utf8')).records.length,1);
}finally{f.cleanup();}});
