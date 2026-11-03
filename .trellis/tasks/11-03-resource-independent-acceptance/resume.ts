/** One authorized continuation of the recorded N07 pre-provider failure; no model calls. */
import assert from 'node:assert/strict';
import {existsSync,readFileSync,readdirSync} from 'node:fs';
import {cp} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepare,schedule} from './run.js';
import {hashes,save,taskRoot,revision} from './runtime.js';
import {digest} from './provider.js';
import {limits,profile,type LedgerData} from './budget.js';
import {assertEquivalentAnnotationSelections} from './reference-check.js';
export const sourcePins={protocol:'067ab9752b84ac64d8e8147ef1a1d8d4325a712422623be4b4e7a0300072d492',ledger:'aa080ada79703da2abceb89087d12393b8faf694b6fcfa04d9e74a851e59ff54',publicGate:'419383f5664c9b64dc9536d436aa90399e6912e5ee89be09c87478d2deb64414',n07Audit:'7181bbcea859d80c234a33d5b9c04ef3ad4def5b29de7420c196f3f8412d4dbd'} as const;
export const reusedIds=schedule.slice(0,10).map(s=>s.id);
export const remainingIds=schedule.slice(10).map(s=>s.id);
interface Protocol {productRevision:string;files:Record<string,string>;profile:unknown;limits:unknown;schedule:unknown;runtimeIntegrity:Record<string,string>;dependencies:unknown;bodyRewriting:boolean;taskRetries:number}
const read=<T>(path:string)=>JSON.parse(readFileSync(path,'utf8')) as T;
export function assertFreshResumeDirectory(directory:string){assert.ok(!existsSync(directory),'resume_destination_already_exists');}
export function validateSourceMetadata(protocolBytes:Buffer,ledgerBytes:Buffer){
 assert.equal(digest(protocolBytes),sourcePins.protocol,'resume_source_protocol_drift');
 assert.equal(digest(ledgerBytes),sourcePins.ledger,'resume_source_ledger_drift');
 const protocol=JSON.parse(protocolBytes.toString()) as Protocol,ledger=JSON.parse(ledgerBytes.toString()) as LedgerData;
 assert.equal(ledger.freezeHash,digest(JSON.stringify(protocol)),'source_freeze_mismatch');
 assert.equal(protocol.productRevision,revision);assert.deepEqual(protocol.profile,profile);assert.deepEqual(protocol.limits,limits);assert.deepEqual(protocol.schedule,schedule);
 assert.equal(protocol.bodyRewriting,false);assert.equal(protocol.taskRetries,0);
 validateCarryoverLedger(ledger);
 return {protocol,ledger};
}
export function validateCarryoverLedger(ledger:LedgerData){
 assert.equal(ledger.halted,'integrity_or_protocol_assertion','unexpected_resume_halt');
 assert.equal(ledger.attempts.length,48,'unexpected_source_attempt_count');
 assert.equal(ledger.responseModel,'deepseek-v4-1-flash-261017','source_model_mismatch');
 for(const [index,a] of ledger.attempts.entries()){
  assert.equal(a.id,index+1,'attempt_sequence_mismatch');assert.ok(reusedIds.includes(a.trialId),'source_attempt_outside_reused_slots');
  assert.equal(a.status,'finished','unsettled_or_failed_source_request');
  assert.ok(a.usage&&Number.isSafeInteger(a.usage.input)&&a.usage.input>=0&&Number.isSafeInteger(a.usage.output)&&a.usage.output>=0,'unknown_source_usage');
 }
 assert.equal(ledger.attempts.reduce((sum,a)=>sum+a.usage!.input,0),1_624_623,'source_input_mismatch');
 assert.equal(ledger.attempts.reduce((sum,a)=>sum+a.usage!.output,0),35_216,'source_output_mismatch');
}
export function carriedLedger(ledger:LedgerData,newFreezeHash:string):LedgerData{
 validateCarryoverLedger(ledger);assert.match(newFreezeHash,/^[a-f0-9]{64}$/);
 return {freezeHash:newFreezeHash,attempts:structuredClone(ledger.attempts),responseModel:ledger.responseModel};
}
export function inspectResumeSource(source:string){
 const {protocol,ledger}=validateSourceMetadata(readFileSync(join(source,'protocol.json')),readFileSync(join(source,'ledger.json')));
 assert.equal(digest(readFileSync(join(source,'public-gate.json'))),sourcePins.publicGate,'source_public_gate_drift');
 for(const [file,hash] of Object.entries(protocol.files)){
  const archived=join(source,'frozen-materials-before-resume',file.replaceAll('../','_parent_/'));
  assert.equal(digest(readFileSync(archived)),hash,'source_archive_drift: '+file);
  if(file!=='browser.ts')assert.equal(digest(readFileSync(resolve(taskRoot,file))),hash,'unapproved_material_change: '+file);
 }
 const originalBrowser=readFileSync(join(source,'frozen-materials-before-resume/browser.ts'),'utf8');
 const expectedBrowser=originalBrowser.replace("import {profile} from './budget.js';","import {profile} from './budget.js';\nimport {assertEquivalentAnnotationSelections} from './reference-check.js';").replace('assert.deepEqual(body.annotationRefs,selection(trial,turn).annotationRefs);','assertEquivalentAnnotationSelections(body.annotationRefs,selection(trial,turn).annotationRefs);');
 assert.equal(readFileSync(join(taskRoot,'browser.ts'),'utf8'),expectedBrowser,'browser_change_exceeds_authorized_fix');
 const n07=join(source,'N07-1'),failed=read<{status:string;error:string;stateChanged:boolean}>(join(n07,'result.json'));
 assert.equal(failed.status,'batch_halted');assert.equal(failed.stateChanged,false);assert.ok(failed.error.includes('deep-equal')&&failed.error.includes('n07-w')&&failed.error.includes('n07-e'),'unexpected_n07_failure');
 assert.ok(!ledger.attempts.some(a=>a.trialId==='N07-1'),'n07_provider_already_called');
 assert.ok(!readdirSync(n07).some(name=>/^provider-\d+-/.test(name)),'n07_provider_evidence_present');
 assert.equal(digest(readFileSync(join(n07,'execution-audit.json'))),sourcePins.n07Audit,'n07_audit_drift');
 const audit=read<{providerAttempts:number;actualAnnotationRefs:unknown;expectedGrouping:unknown;preservedEvidence:Record<string,string>}>(join(n07,'execution-audit.json'));
 for(const [path,hash] of Object.entries(audit.preservedEvidence))assert.equal(digest(readFileSync(join(n07,path))),hash,'n07_evidence_drift: '+path);
 const sent=read<Array<{annotationRefs:unknown}>>(join(n07,'browser-turn-1/sent-message-bodies.json'));assert.equal(sent.length,1);assert.deepEqual(sent[0].annotationRefs,audit.actualAnnotationRefs);
 assert.equal(audit.providerAttempts,0);assertEquivalentAnnotationSelections(audit.actualAnnotationRefs,audit.expectedGrouping);
 const bytes:Record<string,Record<string,string>>={};
 for(const id of reusedIds){
  const directory=join(source,id),result=read<{status:string;stateChanged:boolean}>(join(directory,'result.json'));
  assert.ok(['trajectory_recorded','incomplete'].includes(result.status),'unreusable_slot: '+id);
  assert.equal(result.stateChanged,false,'source_business_mutation: '+id);
  const gate=read<{reviewer:string;rationale:string;continuationAllowed:boolean;trajectoryAuditable:boolean}>(join(directory,'continuation-review.json'));
  assert.ok(gate.reviewer&&gate.rationale&&gate.continuationAllowed&&gate.trajectoryAuditable,'unreviewed_source_slot: '+id);
  bytes[id]=hashes(directory);
 }
 for(const id of remainingIds.slice(1))assert.ok(!existsSync(join(source,id)),'unexpected_started_slot: '+id);
 assert.deepEqual(hashes(join(source,'product')),protocol.runtimeIntegrity,'source_product_drift');
 return {protocol,ledger,bytes};
}
export async function prepareResume(sourceDirectory:string,destinationDirectory:string){
 const source=resolve(sourceDirectory),destination=resolve(destinationDirectory);assertFreshResumeDirectory(destination);assert.notEqual(source,destination);
 const prior=inspectResumeSource(source);
 await prepare(destination); // Builds the unchanged product and freezes all repaired evaluator bytes.
 const current=read<Protocol>(join(destination,'protocol.json'));
 assert.equal(current.productRevision,prior.protocol.productRevision);assert.deepEqual(current.profile,prior.protocol.profile);assert.deepEqual(current.limits,prior.protocol.limits);assert.deepEqual(current.schedule,prior.protocol.schedule);
 assert.deepEqual(current.dependencies,prior.protocol.dependencies,'resume_dependencies_changed');
 // Rebuilding Vite can change archive paths; exact product baseline is checked by buildRuntime.
 for(const id of reusedIds){await cp(join(source,id),join(destination,id),{recursive:true,errorOnExist:true,force:false,preserveTimestamps:true});assert.deepEqual(hashes(join(destination,id)),prior.bytes[id],'copied_evidence_mismatch: '+id);}
 await cp(join(source,'public-gate.json'),join(destination,'public-gate.json'),{errorOnExist:true,force:false});
 assert.equal(digest(readFileSync(join(source,'ledger.json'))),sourcePins.ledger,'source_changed_during_resume');
 const ledger=carriedLedger(prior.ledger,digest(JSON.stringify(current)));save(join(destination,'ledger.json'),ledger);
 save(join(destination,'resume-manifest.json'),{kind:'authorized-evaluator-repair-continuation',authorization:'2026-11-03 用户：修复并继续；仅恢复N07和剩余9槽，不重跑已执行10项',sourceDirectory:source,sourcePins,sourceHalt:prior.ledger.halted,oldFreezeHash:prior.ledger.freezeHash,newFreezeHash:ledger.freezeHash,reusedIds,remainingIds,carriedRequests:48,carriedInput:1_624_623,carriedOutput:35_216,reusedEvidenceHashes:prior.bytes,oldFailureDirectory:join(source,'N07-1'),repair:'Only fixed-reference selection equivalence; actual UI payload and question/scoring/product unchanged',at:new Date().toISOString()});
 assert.ok(!existsSync(join(destination,'N07-1')));assert.ok(!existsSync(join(destination,'readiness.json')),'root_readiness_must_be_new');
 return {destination,reusedIds,remainingIds,carriedRequests:48,readyForModel:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [source,destination]=process.argv.slice(2);assert.ok(source&&destination,'Usage: resume.ts SOURCE NEW_DESTINATION');void prepareResume(source,destination).then(value=>console.info(JSON.stringify(value))).catch(error=>{console.error((error as Error).message);process.exitCode=1;});
}
