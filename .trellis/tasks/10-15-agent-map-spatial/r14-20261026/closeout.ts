/** Explicitly authorized closeout: only original not_executed slots, never retry an attempted slot. */
import assert from 'node:assert/strict';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {sourceFreeze,runLive,liveClaim,type Row} from './live.js';
import {schedule,type Entry} from './cases.js';
import {cumulativeAccount,validateAccount,validateSeed,type AccountPreflight,type Data as LedgerData,type LedgerSeed} from './budget.js';
import {repo,digest,hashes,save} from './runtime.js';
const root=fileURLToPath(new URL('.',import.meta.url));
export const originalDirectory=join(repo,'.local/spatial-r14/batch-20261026');
export const closeoutClaim=join(repo,'.local/spatial-r14/closeout-remaining-claim.json');
export const closeoutGate=join(root,'closeout-offline-gate.json');
export const originalManifest=join(root,'partial-evidence-manifest.json');
export const authorizedOriginalFreeze='e0924b62a5842d91eda23272972b07ccfd84d4557d3878a81372fc928bb094ac';
export const expectedOriginalTotals={requests:34,input:626034,output:12625,afp:172.56015,unknown:0};
const read=<T>(path:string)=>JSON.parse(readFileSync(path,'utf8')) as T;
type Frozen=Awaited<ReturnType<typeof sourceFreeze>>;
interface OriginalProtocol {source:Frozen;freezeHash:string;account:AccountPreflight;mode:string}
interface OriginalAttempt {id:number;entry:string;group:string;completed:boolean;error?:string;usage?:{prompt_tokens:number;completion_tokens:number}}
const allowedChangedDriver=new Set(['cases.ts','cases.test.ts','live.ts','budget.ts']);
export function remainingEntries(rows:Row[],expected:Entry[]=schedule):Entry[]{
 assert.equal(rows.length,expected.length,'original_schedule_length_changed');
 for(const [i,row] of rows.entries())for(const [key,value] of Object.entries(expected[i]))assert.deepEqual(row[key as keyof Row],value,`original_slot_changed:${i}:${key}`);
 assert.equal(new Set(rows.map(r=>r.id)).size,rows.length,'duplicate_original_slot');
 assert.ok(rows.every(r=>['recorded','waiting_user','incomplete','interrupted','not_executed'].includes(r.status)),'original_slot_still_running');
 return expected.filter((_,i)=>rows[i].status==='not_executed');
}
export function validateComparable(old:Frozen,current:Frozen){
 for(const key of ['syntheticDay','scope','runtime','helpers','historicalFixtures','httpHelpers','fixtureHelpers','historyBaseline','schedule','limits','tripleReserve','model'] as const)assert.deepEqual(current[key],old[key],`closeout_comparison_drift:${key}`);
 for(const [file,hash] of Object.entries(old.driver))if(!allowedChangedDriver.has(file))assert.equal(current.driver[file],hash,`unapproved_driver_change:${file}`);
}
export async function verifyOriginal(){
 const manifest=read<{files:Record<string,string>}>(originalManifest);assert.equal(Object.keys(manifest.files).length,1076,'original_evidence_count_changed');
 const prefix='.local/spatial-r14/batch-20261026/';const expected:Record<string,string>={};
 for(const [path,hash] of Object.entries(manifest.files)){assert.ok(path.startsWith(prefix)&&!path.slice(prefix.length).split('/').includes('..'),'invalid_original_evidence_path');expected[path.slice(prefix.length)]=hash;}
 assert.deepEqual(await hashes(originalDirectory),expected,'original_evidence_changed');
 const claim=read<{directory:string;freezeHash:string;offlineSimulation:boolean}>(liveClaim);assert.equal(claim.directory,originalDirectory);assert.equal(claim.freezeHash,authorizedOriginalFreeze);assert.equal(claim.offlineSimulation,false);
 const protocol=read<OriginalProtocol>(join(originalDirectory,'protocol.json'));assert.equal(protocol.freezeHash,authorizedOriginalFreeze);assert.equal(digest(JSON.stringify(protocol.source)),protocol.freezeHash);assert.equal(protocol.mode,'live');
 const rows=read<Row[]>(join(originalDirectory,'runs.json')),remaining=remainingEntries(rows);
 assert.equal(remaining.length,136,'only_136_unexecuted_authorized');assert.equal(rows.filter(r=>r.status!=='not_executed').length,8);assert.equal(remaining[0].id,'D03-1-B');assert.deepEqual(rows.filter(r=>r.status!=='not_executed').map(r=>r.id),schedule.slice(0,8).map(r=>r.id));
 const ledger=read<LedgerData>(join(originalDirectory,'ledger.json'));assert.equal(ledger.freezeHash,authorizedOriginalFreeze);assert.deepEqual(ledger.account,protocol.account);assert.equal(ledger.halted,'waiting_user_unmapped_plain_question');
 const ledgerSeed:LedgerSeed={requests:ledger.requests,source:{directory:originalDirectory,freezeHash:ledger.freezeHash,ledgerHash:digest(readFileSync(join(originalDirectory,'ledger.json'))),halted:ledger.halted}};validateSeed(ledgerSeed);
 const totals={requests:ledger.requests.length,input:ledger.requests.reduce((n,r)=>n+r.usage!.input,0),output:ledger.requests.reduce((n,r)=>n+r.usage!.output,0),afp:ledger.requests.reduce((n,r)=>n+r.afp!,0),unknown:ledger.requests.filter(r=>!r.usage).length};
 for(const k of ['requests','input','output','unknown'] as const)assert.equal(totals[k],expectedOriginalTotals[k]);assert.ok(Math.abs(totals.afp-expectedOriginalTotals.afp)<1e-8);
 const attempts=read<OriginalAttempt[]>(join(originalDirectory,'attempts.json'));assert.equal(attempts.length,34);
 for(const [i,a] of attempts.entries()){const row=ledger.requests[i];assert.equal(a.id,row.id);assert.equal(a.entry,row.trialId);assert.equal(a.group,row.group);assert.equal(a.completed,true);assert.ok(!a.error&&a.usage);assert.equal(a.usage.prompt_tokens,row.usage!.input);assert.equal(a.usage.completion_tokens,row.usage!.output);assert.ok(!remaining.some(e=>e.id===a.entry),'unexecuted_slot_already_has_request');}
 const canonicalHashes:Record<string,string>={};
 for(const row of rows.filter(r=>r.status!=='not_executed')){const key=`${row.caseId}:${row.round}`,path=join(originalDirectory,`${row.caseId}-r${row.round}-triple.json`),triple=read<{canonicalHash:string}>(path);assert.equal(digest(JSON.stringify(read(join(originalDirectory,row.id,'canonical-fixture.json')))),triple.canonicalHash);canonicalHashes[key]=triple.canonicalHash;}
 return {protocol,rows,remaining,ledgerSeed,totals,canonicalHashes,manifestHash:digest(readFileSync(originalManifest)),claimHash:digest(readFileSync(liveClaim))};
}
export async function closeoutFreeze(){
 const original=await verifyOriginal(),current=await sourceFreeze();validateComparable(original.protocol.source,current);
 return {...current,explicitCloseout:{authorization:'用户明确授权修复误停并完成原计划剩余136项；原8项不重跑；预算不增加',originalDirectory,originalFreezeHash:authorizedOriginalFreeze,originalEvidenceCount:1076,originalEvidenceManifestHash:original.manifestHash,originalClaimHash:original.claimHash,originalLedgerHash:original.ledgerSeed.source.ledgerHash,originalTotals:expectedOriginalTotals,remaining:original.remaining,canonicalHashes:original.canonicalHashes,allowedChangedDriver:[...allowedChangedDriver].sort(),changedDriver:Object.keys(original.protocol.source.driver).filter(p=>original.protocol.source.driver[p]!==current.driver[p]),closeoutClaim,automaticRetry:false}};
}
export function validateCloseoutAccount(fresh:AccountPreflight,original:{protocol:OriginalProtocol;rows:Row[];totals:{afp:number}},now=Date.now()){
 validateAccount(fresh,now);const latest=Math.max(...original.rows.flatMap(r=>r.endedAt?[Date.parse(r.endedAt)]:[]));assert.ok(Date.parse(fresh.checkedAt)>=latest,'account_observation_must_follow_original_requests');assert.ok(now-Date.parse(fresh.checkedAt)<=5*60*60*1000,'account_observation_outside_five_hour_window');
 return cumulativeAccount(original.protocol.account,fresh,original.totals.afp);
}
export interface CloseoutOptions {directory:string;freezePath?:string;accountPath:string;port?:number;env?:NodeJS.ProcessEnv;offline?:{transport:typeof fetch;claimPath:string;prefixSlots?:number}}
export async function runCloseout(options:CloseoutOptions){
 const destination=resolve(options.directory);assert.ok(destination!==originalDirectory&&!destination.startsWith(originalDirectory+'/'),'closeout_output_must_not_modify_original');
 const original=await verifyOriginal(),fresh=read<AccountPreflight>(options.accountPath),account=validateCloseoutAccount(fresh,original),offline=options.offline;
 let entries=original.remaining;
 if(offline?.prefixSlots!==undefined){assert.ok(Number.isInteger(offline.prefixSlots)&&offline.prefixSlots>0&&offline.prefixSlots<=entries.length);entries=entries.slice(0,offline.prefixSlots);}
 const result=await runLive({directory:options.directory,freezePath:options.freezePath,port:options.port,env:options.env,offline:offline?{transport:offline.transport,claimPath:offline.claimPath}:undefined,continuation:{entries,claimPath:offline?resolve(offline.claimPath):closeoutClaim,gatePath:closeoutGate,freeze:closeoutFreeze,ledgerSeed:original.ledgerSeed,account,accountObservation:fresh,originalDirectory,canonicalHashes:original.canonicalHashes,authorization:'explicit_remaining_136_only_no_retry_no_budget_increase'}});
 await verifyOriginal();save(join(options.directory,'closeout-summary.json'),{originalDirectory,originalTotals:expectedOriginalTotals,newTotals:{requests:result.total.requests-expectedOriginalTotals.requests,input:result.total.input-expectedOriginalTotals.input,output:result.total.output-expectedOriginalTotals.output,afp:result.total.afp-original.totals.afp,unknown:result.total.unknown},cumulativeTotals:result.total,continuedSlots:result.rows.length,stop:result.stop??null,originalEvidenceUnchanged:1076,automaticRetry:false,offlineSimulation:Boolean(offline)});
 return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [mode,...args]=process.argv.slice(2);
 if(mode==='prepare'){assert.equal(args.length,1);assert.ok(!existsSync(args[0]),'Refuse overwriting closeout freeze');void closeoutFreeze().then(f=>{writeFileSync(args[0],JSON.stringify(f,null,2)+'\n',{flag:'wx',mode:0o600});console.info(JSON.stringify({prepared:args[0],remainingTrials:136,originalTrialsPreserved:8,modelCalls:0}));});}
 else{assert.equal(mode,'run','closeout.ts prepare NEW_FREEZE | run NEW_OUTPUT FREEZE FRESH_ACCOUNT [PORT]');const [directory,freezePath,accountPath,port]=args;assert.ok(directory&&freezePath&&accountPath);void runCloseout({directory,freezePath,accountPath,port:Number(port??4687)}).then(r=>{console.info(JSON.stringify(r));if(r.stop)process.exitCode=1;}).catch(error=>{console.error(error instanceof Error?error.message:'R14 closeout failed');process.exitCode=1;});}
}
