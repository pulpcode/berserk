/** Fourth segment: only the 21 never-started slots remaining within the authorized third 110. */
import assert from 'node:assert/strict';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifySecondSegment,secondDirectory,thirdClaim,thirdAuthorization,carriedTotals as previousTotals} from './closeout-third.js';
import {firstDirectory} from './closeout-second.js';
import {remainingEntries,validateComparable,originalDirectory,type CloseoutOptions} from './closeout.js';
import {runLive,sourceFreeze,type Row} from './live.js';
import {validateSeed,validateAccount,type LedgerSeed,type Data,type AccountPreflight} from './budget.js';
import {repo,digest,hashes,save} from './runtime.js';
const root=fileURLToPath(new URL('.',import.meta.url));
const read=<T>(p:string)=>JSON.parse(readFileSync(p,'utf8')) as T;
export const thirdDirectory=join(repo,'.local/spatial-r14/closeout-third-20261027');
export const fourthDirectory=join(repo,'.local/spatial-r14/closeout-fourth-20261027');
export const fourthClaim=join(repo,'.local/spatial-r14/closeout-fourth-remaining-claim.json');
export const fourthGate=join(root,'fourth-closeout-offline-gate.json');
const manifestPath=join(root,'closeout-third-segment-manifest.json');
const protocolPath=join(root,'fourth-closeout-protocol.md');
const thirdHash='13cc763108334fa2a851deb0203bf74a5c1aa01264b5a41e9c5c2174adbd1085';
export const carriedTotals={requests:573,input:11056965,output:189716,afp:2982.36455,unknown:0};
type Frozen=Awaited<ReturnType<typeof sourceFreeze>>;
type Protocol={source:Frozen;freezeHash:string;account:AccountPreflight;mode:string;continuation:{freshAccountObservation:AccountPreflight}};
export function validateFourthComparable(previous:Frozen,current:Frozen){
 validateComparable(previous,current);
 for(const [name,hash] of Object.entries(previous.driver))assert.equal(current.driver[name],hash,`fourth_must_not_change_existing_driver:${name}`);
}
export async function verifyThirdSegment(){
 const previous=await verifySecondSegment(),manifest=read<{files:Record<string,string>;driverFiles:Record<string,string>;freezeHash:string}>(manifestPath),prefix='.local/spatial-r14/closeout-third-20261027/',expected:Record<string,string>={};
 assert.equal(manifest.freezeHash,thirdHash);
 for(const [path,hash] of Object.entries(manifest.files)){assert.ok(path.startsWith(prefix)&&!path.slice(prefix.length).split('/').includes('..'));expected[path.slice(prefix.length)]=hash;}
 assert.equal(Object.keys(expected).length,4635);assert.deepEqual(await hashes(thirdDirectory),expected,'third_segment_evidence_changed');
 const archivePrefix='.local/spatial-r14/third-driver-before-fourth/',archive:Record<string,string>={};
 for(const [path,hash] of Object.entries(manifest.driverFiles)){assert.ok(path.startsWith(archivePrefix)&&!path.slice(archivePrefix.length).split('/').includes('..'));archive[path.slice(archivePrefix.length)]=hash;}
 assert.equal(Object.keys(archive).length,37);assert.deepEqual(await hashes(join(repo,archivePrefix)),archive,'third_driver_archive_changed');
 const claim=read<{directory:string;freezeHash:string;offlineSimulation:boolean}>(thirdClaim);assert.equal(claim.directory,thirdDirectory);assert.equal(claim.freezeHash,thirdHash);assert.equal(claim.offlineSimulation,false);
 const protocol=read<Protocol>(join(thirdDirectory,'protocol.json'));assert.equal(protocol.freezeHash,thirdHash);assert.equal(digest(JSON.stringify(protocol.source)),thirdHash);assert.equal(protocol.mode,'live');assert.deepEqual(archive,protocol.source.driver);
 const rows=read<Row[]>(join(thirdDirectory,'runs.json')),remaining=remainingEntries(rows,previous.remaining),started=rows.filter(r=>r.status!=='not_executed');
 assert.equal(remaining.length,21);assert.equal(started.length,89);assert.deepEqual(started.map(r=>r.id),previous.remaining.slice(0,89).map(r=>r.id));assert.equal(remaining[0].id,'D07-2-A');assert.ok(remaining.every(r=>r.caseId!=='D08'));
 const last=started.at(-1)!;assert.equal(last.id,'D08-2-B');assert.equal(last.stop,'waiting_user_unmapped_plain_question');
 const ledger=read<Data>(join(thirdDirectory,'ledger.json'));assert.equal(ledger.freezeHash,thirdHash);assert.equal(ledger.halted,'waiting_user_unmapped_plain_question');assert.deepEqual(ledger.account,protocol.account);assert.deepEqual(ledger.requests.slice(0,previousTotals.requests),previous.ledgerSeed.requests,'prior_159_requests_changed_or_duplicated');
 const ledgerSeed:LedgerSeed={requests:ledger.requests,source:{directory:thirdDirectory,freezeHash:thirdHash,ledgerHash:digest(readFileSync(join(thirdDirectory,'ledger.json'))),halted:ledger.halted}};validateSeed(ledgerSeed);
 const totals={requests:ledger.requests.length,input:ledger.requests.reduce((n,r)=>n+r.usage!.input,0),output:ledger.requests.reduce((n,r)=>n+r.usage!.output,0),afp:ledger.requests.reduce((n,r)=>n+r.afp!,0),unknown:ledger.requests.filter(r=>!r.usage).length};
 for(const k of ['requests','input','output','unknown'] as const)assert.equal(totals[k],carriedTotals[k]);assert.ok(Math.abs(totals.afp-carriedTotals.afp)<1e-8);
 const attempts=read<Array<{id:number;entry:string;group:string;completed:boolean;error?:string;usage?:{prompt_tokens:number;completion_tokens:number}}>>(join(thirdDirectory,'attempts.json'));assert.equal(attempts.length,414);
 for(const [i,a] of attempts.entries()){const r=ledger.requests[i+previousTotals.requests];assert.equal(a.id,r.id);assert.equal(a.entry,r.trialId);assert.equal(a.group,r.group);assert.equal(a.completed,true);assert.ok(!a.error&&a.usage);assert.equal(a.usage.prompt_tokens,r.usage!.input);assert.equal(a.usage.completion_tokens,r.usage!.output);assert.ok(started.some(s=>s.id===a.entry));}
 const canonicalHashes={...previous.canonicalHashes};
 for(const row of started){const triple=read<{canonicalHash:string}>(join(thirdDirectory,`${row.caseId}-r${row.round}-triple.json`));assert.equal(digest(JSON.stringify(read(join(thirdDirectory,row.id,'canonical-fixture.json')))),triple.canonicalHash);canonicalHashes[`${row.caseId}:${row.round}`]=triple.canonicalHash;}
 return {previous,protocol,rows,remaining,ledgerSeed,totals,canonicalHashes,manifestHash:digest(readFileSync(manifestPath)),claimHash:digest(readFileSync(thirdClaim))};
}
/** This is the same frozen account cap, not a new balance observation or restored window allowance. */
export function carriedAccount(prior:Awaited<ReturnType<typeof verifyThirdSegment>>,observation:AccountPreflight,now=Date.now()){
 assert.deepEqual(observation,prior.protocol.continuation.freshAccountObservation,'fourth_account_observation_changed');validateAccount(observation,now);validateAccount(prior.protocol.account,now);
 assert.ok(now-Date.parse(observation.checkedAt)<=5*60*60*1000,'fourth_original_account_observation_outside_five_hours');
 return structuredClone(prior.protocol.account);
}
export async function fourthFreeze(){
 const previous=await verifyThirdSegment(),current=await sourceFreeze();validateFourthComparable(previous.protocol.source,current);
 return {...current,explicitFourthCloseout:{authorization:'用户批准继续原计划余下21项，原D08缺口回答不重跑',inheritedPolicyAuthorization:thirdAuthorization,previousDirectory:thirdDirectory,previousFreeze:thirdHash,previousManifestHash:previous.manifestHash,previousClaimHash:previous.claimHash,previousLedgerHash:previous.ledgerSeed.source.ledgerHash,protocolHash:digest(readFileSync(protocolPath)),carriedTotals,remaining:previous.remaining,canonicalHashes:previous.canonicalHashes,fourthClaim,draftViolationScope:'isolated-task',automaticRetry:false}};
}
export async function runFourthCloseout(options:CloseoutOptions){
 const destination=resolve(options.directory);for(const path of [originalDirectory,firstDirectory,secondDirectory,thirdDirectory])assert.ok(destination!==path&&!destination.startsWith(path+'/'),'fourth_output_must_not_modify_prior_evidence');
 const previous=await verifyThirdSegment(),observation=read<AccountPreflight>(options.accountPath),account=carriedAccount(previous,observation),offline=options.offline;
 let entries=previous.remaining;if(offline?.prefixSlots!==undefined){assert.ok(Number.isInteger(offline.prefixSlots)&&offline.prefixSlots>0&&offline.prefixSlots<=entries.length);entries=entries.slice(0,offline.prefixSlots);}
 // Reuse the existing policy authorization for the original 110: these 21 are its never-started suffix.
 const result=await runLive({directory:options.directory,freezePath:options.freezePath,port:options.port,env:options.env,draftViolationScope:'isolated-task',offline:offline?{transport:offline.transport,claimPath:offline.claimPath}:undefined,continuation:{entries,claimPath:offline?resolve(offline.claimPath):fourthClaim,gatePath:fourthGate,freeze:fourthFreeze,ledgerSeed:previous.ledgerSeed,account,accountObservation:observation,originalDirectory:thirdDirectory,canonicalHashes:previous.canonicalHashes,authorization:thirdAuthorization}});
 await verifyThirdSegment();save(join(options.directory,'fourth-closeout-summary.json'),{priorDirectories:[originalDirectory,firstDirectory,secondDirectory,thirdDirectory],carriedTotals,newTotals:{requests:result.total.requests-carriedTotals.requests,input:result.total.input-carriedTotals.input,output:result.total.output-carriedTotals.output,afp:result.total.afp-previous.totals.afp,unknown:result.total.unknown},cumulativeTotals:result.total,continuedSlots:result.rows.length,stop:result.stop??null,priorEvidenceUnchanged:8399,automaticRetry:false,offlineSimulation:Boolean(offline)});return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [mode,...args]=process.argv.slice(2);
 if(mode==='prepare'){assert.equal(args.length,1);assert.ok(!existsSync(args[0]));void fourthFreeze().then(f=>{writeFileSync(args[0],JSON.stringify(f,null,2)+'\n',{flag:'wx',mode:0o600});console.info(JSON.stringify({prepared:args[0],remainingTrials:21,preservedTrials:123,modelCalls:0}));});}
 else{assert.equal(mode,'run');const [directory,freezePath,accountPath,port]=args;assert.ok(directory&&freezePath&&accountPath);void runFourthCloseout({directory,freezePath,accountPath,port:Number(port??4687)}).then(r=>{console.info(JSON.stringify(r));if(r.stop)process.exitCode=1;}).catch(error=>{console.error(error instanceof Error?error.message:'fourth closeout failed');process.exitCode=1;});}
}
