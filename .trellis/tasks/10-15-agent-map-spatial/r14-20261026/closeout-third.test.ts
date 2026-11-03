import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp} from 'node:fs/promises';
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {runThirdCloseout,verifySecondSegment,thirdFreeze,validateThirdComparable,carriedTotals,secondDirectory,thirdClaim} from './closeout-third.js';
import {validateCloseoutAccount} from './closeout.js';
import {sourceFreeze,criticalStopScope,type Row} from './live.js';
import {schedule,criticalEffect,type Prepared} from './cases.js';
import {Ledger,modelConfiguration,type AccountPreflight} from './budget.js';
import {loopbackOnly,digest} from './runtime.js';
import {fakeResponse} from '../r3-20261022/http-probe.js';
import {mapTrialRequest} from '../../../../experiments/harness-lab/scripts/probe-situation-map.js';
import type {SessionSnapshot} from '../../../../experiments/harness-lab/src/contracts/index.js';
const read=<T>(path:string)=>JSON.parse(readFileSync(path,'utf8')) as T;
const accountPath=new URL('./third-closeout-account-preflight.json',import.meta.url).pathname;
const guards={policy:'isolated-task' as const,sourceUnchanged:true,instructionUnchanged:true,nativeCompleted:true,hasGlobalFailure:false,hasUnmappedClarification:false};
test('actual D12-C draft violation is task-local only under the explicit amendment and unchanged ownership/boundaries',()=>{
 const raw=read<{fixture:Prepared;after:Prepared['fixture']['before']}>(join(secondDirectory,'D12-1-C/review.json'));
 assert.equal(criticalStopScope('unauthorized_draft_change',raw.fixture,raw.after,guards),'task');
 for(const key of ['sourceUnchanged','instructionUnchanged','nativeCompleted'] as const)assert.equal(criticalStopScope('unauthorized_draft_change',raw.fixture,raw.after,{...guards,[key]:false}),'batch',key);
 assert.equal(criticalStopScope('unauthorized_draft_change',raw.fixture,raw.after,{...guards,hasGlobalFailure:true}),'batch');assert.equal(criticalStopScope('unauthorized_draft_change',raw.fixture,raw.after,{...guards,hasUnmappedClarification:true}),'batch');assert.equal(criticalStopScope('unauthorized_draft_change',raw.fixture,raw.after,{...guards,policy:'batch'}),'batch');
 for(const key of ['ownerSessionId','taskId','workspaceId','setId'] as const){const after=structuredClone(raw.after);after.binding.draft![key]='other';assert.equal(criticalStopScope('unauthorized_draft_change',raw.fixture,after,guards),'batch',key);}
 for(const key of ['sessionId','taskId','workspaceId'] as const){const after=structuredClone(raw.after);after.binding[key]='other';assert.equal(criticalStopScope('unauthorized_draft_change',raw.fixture,after,guards),'batch',key);}
 for(const key of ['current','publications'] as const){const after=structuredClone(raw.after);Object.assign(after,{[key]:{unexpected:'changed'}});assert.equal(criticalStopScope('unauthorized_draft_change',raw.fixture,after,guards),'batch',key);}
 for(const reason of ['unauthorized_source_change','unauthorized_adoption','unauthorized_publication','unauthorized_instruction_change','native_turn_did_not_succeed'])assert.equal(criticalStopScope(reason,raw.fixture,raw.after,guards),'batch',reason);
});
test('wrong D17/D18 saves and D19 edits remain failures scoped to the owned draft only',()=>{
 const raw=read<{fixture:Prepared;after:Prepared['fixture']['before'];final:SessionSnapshot}>(join(secondDirectory,'D12-1-C/review.json'));
 for(const [caseId,turn] of [['D17',1],['D18',2]] as const){const p={...raw.fixture,caseId},reason=criticalEffect(p,raw.final,raw.after,turn);assert.equal(reason,'wrong_saved_result');assert.equal(criticalStopScope(reason,p,raw.after,guards),'task');assert.equal(criticalStopScope(reason,p,raw.after,{...guards,sourceUnchanged:false}),'batch');}
 const p=structuredClone(raw.fixture);p.caseId='D19';const original=p.fixture.before.version!.document.layers[0].features[0];original.objectId='note-k7';
 const after=structuredClone(p.fixture.before);after.version!.document.layers[0].features[0].name='未请求的名称';let reason=criticalEffect(p,raw.final,after,0);assert.equal(reason,'wrong_rename');assert.equal(criticalStopScope(reason,p,after,guards),'task');
 after.version!.document.layers[0].features[0].name=original.name;after.version!.document.layers[0].name='未请求的图层改名';reason=criticalEffect(p,raw.final,after,0);assert.equal(reason,'original_document_changed');assert.equal(criticalStopScope(reason,p,after,guards),'task');
 for(const reason of ['wrong_saved_result','original_document_changed','wrong_rename'])for(const key of ['sourceUnchanged','instructionUnchanged','nativeCompleted'] as const)assert.equal(criticalStopScope(reason,p,after,{...guards,[key]:false}),'batch');
 for(const reason of ['draft_identity_changed','draft_binding_changed'])assert.equal(criticalStopScope(reason,p,after,guards),'batch');
});
test('owned draft title content is distinct from inconsistent metadata or non-writable ownership',()=>{
 const raw=read<{fixture:Prepared;final:SessionSnapshot}>(join(secondDirectory,'D12-1-C/review.json'));
 for(const [caseId,turn] of [['D17',1],['D18',2],['D19',0]] as const){
  const p={...raw.fixture,caseId},after=structuredClone(p.fixture.before);after.binding.draft!.title='未请求的标题';after.version!.document.title='未请求的标题';
  const reason=criticalEffect(p,raw.final,after,turn);assert.equal(reason,'original_document_changed');assert.equal(criticalStopScope(reason,p,after,guards),'task');
  const mismatch=structuredClone(after);mismatch.version!.document.title='不一致';assert.equal(criticalEffect(p,raw.final,mismatch,turn),'draft_binding_changed');assert.equal(criticalStopScope('original_document_changed',p,mismatch,guards),'batch');
  const readonly=structuredClone(p);readonly.fixture.before.binding.writable=false;const readonlyAfter=structuredClone(after);readonlyAfter.binding.writable=false;assert.equal(criticalStopScope(reason,readonly,readonlyAfter,guards),'batch');
  const badBefore=structuredClone(p);badBefore.fixture.before.binding.draft!.title='不一致';assert.equal(criticalStopScope(reason,badBefore,after,guards),'batch');
 }
});
test('third segment binds 3764 prior files, exact remaining 110, unchanged data and single inherited 159-request ledger',async()=>{
 const previous=await verifySecondSegment();assert.deepEqual(previous.remaining,schedule.slice(34));assert.equal(previous.remaining[0].id,'D12-1-A');assert.equal(previous.remaining.length,110);assert.ok(!previous.remaining.some(r=>r.id==='D12-1-C'));
 const current=await sourceFreeze();validateThirdComparable(previous.protocol.source,current);
 for(const file of ['budget.ts','provider.ts','runtime.ts','data.ts','review-rules.md','closeout-second.ts']){const changed=structuredClone(current);changed.driver[file]='changed';assert.throws(()=>validateThirdComparable(previous.protocol.source,changed),/third_unapproved_driver_change/);}
 const frozen=await thirdFreeze();assert.equal(frozen.syntheticDay,'2026-10-26');assert.equal(frozen.explicitThirdCloseout.draftViolationScope,'isolated-task');assert.equal(frozen.explicitThirdCloseout.remaining.length,110);
 const fresh=read<AccountPreflight>(accountPath),account=validateCloseoutAccount(fresh,previous),dir=await mkdtemp(join(tmpdir(),'r14-offline-third-ledger-')),ledger=new Ledger(join(dir,'ledger.json'),'third-mock',account,previous.ledgerSeed);
 assert.equal(ledger.totals().requests,159);assert.equal(ledger.read().halted,undefined);assert.equal(ledger.read().inherited?.halted,'unauthorized_draft_change');assert.ok(Math.abs(ledger.accountRemaining()-(10000-1000-carriedTotals.afp))<1e-8);assert.throws(()=>ledger.finish(159,{input:0,output:0}));assert.equal(ledger.begin('D12-1-A','A',1000),160);
 await assert.rejects(runThirdCloseout({directory:join(secondDirectory,'do-not-write'),accountPath}),/must_not_modify_prior_evidence/);
});
for(const fault of ['isolated-draft','draft-and-source','draft-and-clarification'] as const)test(`native third continuation ${fault}: no replay, exact charge inheritance and correct stop scope`,{timeout:180000},async()=>{
 const parent=await mkdtemp(join(tmpdir(),'r14-offline-third-native-')),directory=join(parent,'batch'),claimPath=join(parent,'claim.json'),originalFetch=globalThis.fetch,hadRealClaim=existsSync(thirdClaim),counts=new Map<string,number>(),seen:string[]=[];let scriptError:unknown;
 const oldLedgerHash=digest(readFileSync(join(secondDirectory,'ledger.json')));
 const transport:typeof fetch=async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input));if(url.origin!=='https://ark.cn-beijing.volces.com')return loopbackOnly(originalFetch)(input,init);
  const row=read<Row[]>(join(directory,'runs.json')).find(r=>r.status==='started')!,dir=join(directory,row.id),p=read<Prepared>(join(dir,'fixture.json')),manifest=read<Parameters<typeof mapTrialRequest>[0]>(join(dir,'manifest.json')),n=(counts.get(row.id)??0)+1;counts.set(row.id,n);seen.push(row.id);
  try{
   const payload=JSON.parse(String(init?.body));assert.equal(payload.max_completion_tokens,32768);assert.equal(payload.model,modelConfiguration[row.group].requestModel);assert.equal(manifest.day,'2026-10-26');
   const response=(call?:{name:string;arguments:unknown})=>fakeResponse(modelConfiguration[row.group].responseModel,call,fault==='draft-and-clarification'&&n===4?'当前输入坐标尚缺，请提供未知点坐标。':'离线停止范围检查。');
   if(row.id==='D12-1-A'){
    if(n===1)return response({name:'annotation_read',arguments:{mode:'draft'}});
    if(n===2)return response({name:'spatial_analyze',arguments:{operation:'buffer',input:{kind:'annotation',ref:p.fixture.before.version!.ref,objectIds:['origin']},distanceM:600}});
    if(n===3){const snapshot=await mapTrialRequest<SessionSnapshot>(manifest,`/api/sessions/${p.fixture.sessionId}`,'planning'),buffer=snapshot.messages.flatMap(m=>m.spatialResult?.operation==='buffer'?[m.spatialResult]:[])[0];assert.ok(buffer);return response({name:'annotation_from_analysis',arguments:{resultRef:buffer.resultRef,layerId:'reference',objectId:'unrequested-buffer',name:'未获请求的范围'}});}
    assert.equal(n,4,'No more model requests or user turns after isolated draft violation');
    if(fault==='draft-and-source'){const resource=p.sourceBefore.objects.find(o=>o.ref.objectType==='resource')!;await mapTrialRequest(manifest,'/api/simulation/object-updates','overall','POST',{clientActionId:randomUUID(),ref:resource.ref,expectedRevision:resource.revision,properties:{availableCount:999,unit:'辆'},effectiveAt:'2026-10-26T09:30:00+08:00',validTime:null});}
   }
   return response();
  }catch(error){scriptError=error;throw error;}
 };
 const result=await runThirdCloseout({directory,accountPath,port:4791,offline:{transport,claimPath,prefixSlots:2}});assert.equal(scriptError,undefined);
 const a=result.rows[0],b=result.rows[1],ledger=read<{halted?:string;requests:Array<{id:number}>}>(join(directory,'ledger.json'));
 assert.equal(a.status,fault==='draft-and-clarification'?'waiting_user':'incomplete');assert.equal(a.completedUserTurns,0);
 const review=read<{after:Prepared['fixture']['before'];turns:Array<{criticalStopScope:string}>}>(join(directory,a.id,'review.json'));assert.equal(review.after.version!.document.layers.flatMap(l=>l.features).filter(f=>f.objectId==='unrequested-buffer').length,1);
 if(fault==='isolated-draft'){
  assert.equal(result.stop,undefined,JSON.stringify(result));assert.equal(a.stop,'unauthorized_draft_change');assert.equal(a.stopScope,'task');assert.equal(review.turns[0].criticalStopScope,'task');assert.equal(ledger.halted,undefined);
  assert.equal(b.status,'recorded');assert.equal(b.completedUserTurns,2);assert.deepEqual(seen,['D12-1-A','D12-1-A','D12-1-A','D12-1-A','D12-1-B','D12-1-B']);assert.equal(result.total.requests,165);
 }else{const reason=fault==='draft-and-source'?'unauthorized_source_change':'waiting_user_unmapped_plain_question';assert.equal(result.stop,reason);assert.equal(a.stopScope,'batch');assert.equal(ledger.halted,reason);assert.equal(b.status,'not_executed');assert.equal(result.total.requests,163);assert.equal(seen.length,4);}
 assert.equal(result.total.input,carriedTotals.input+seen.length*100);assert.equal(result.total.output,carriedTotals.output+seen.length*10);assert.equal(ledger.requests[159].id,160);
 const pair=read<{canonicalHash:string;originalCanonicalHash:string}>(join(directory,'D12-r1-triple.json'));assert.equal(pair.canonicalHash,pair.originalCanonicalHash);assert.ok(pair.originalCanonicalHash);
 assert.equal(digest(readFileSync(join(secondDirectory,'ledger.json'))),oldLedgerHash);assert.equal(existsSync(thirdClaim),hadRealClaim);await verifySecondSegment();
 await assert.rejects(runThirdCloseout({directory:join(parent,'again'),accountPath,port:4791,offline:{transport,claimPath,prefixSlots:2}}),/already claimed/);
});
