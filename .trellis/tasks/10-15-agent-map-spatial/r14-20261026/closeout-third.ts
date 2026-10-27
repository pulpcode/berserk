/** Explicitly authorized R14 third segment: exactly 110 never-started tasks. */
import assert from 'node:assert/strict';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyFirstSegment,firstDirectory,secondClaim,carriedTotals as firstTotals} from './closeout-second.js';
import {remainingEntries,validateComparable,validateCloseoutAccount,originalDirectory,type CloseoutOptions} from './closeout.js';
import {runLive,sourceFreeze,type Row} from './live.js';
import {validateSeed,type LedgerSeed,type Data,type AccountPreflight} from './budget.js';
import {repo,digest,hashes,save} from './runtime.js';
const root=fileURLToPath(new URL('.',import.meta.url));
const read=<T>(path:string)=>JSON.parse(readFileSync(path,'utf8')) as T;
export const secondDirectory=join(repo,'.local/spatial-r14/closeout-second-20261026');
export const thirdClaim=join(repo,'.local/spatial-r14/closeout-third-remaining-claim.json');
export const thirdGate=join(root,'third-closeout-offline-gate.json');
const manifestPath=join(root,'closeout-second-segment-manifest.json');
const protocolPath=join(root,'third-closeout-protocol.md');
const secondHash='1e51c7720aadd287f27b5003b6d321b91384491e0a26e30291f4b575cebd999d';
export const carriedTotals={requests:159,input:3032768,output:61051,afp:873.5313,unknown:0};
export const thirdAuthorization='explicit_third_remaining_110_isolated_draft_failure_no_retry';
type Frozen=Awaited<ReturnType<typeof sourceFreeze>>;
export function validateThirdComparable(previous:Frozen,current:Frozen){
 for(const [name,hash] of Object.entries(previous.driver))if(!['cases.ts','live.ts'].includes(name))assert.equal(current.driver[name],hash,`third_unapproved_driver_change:${name}`);
}
export async function verifySecondSegment(){
 const first=await verifyFirstSegment(),manifest=read<{files:Record<string,string>}>(manifestPath),prefix='.local/spatial-r14/closeout-second-20261026/',expected:Record<string,string>={};
 for(const [path,hash] of Object.entries(manifest.files)){assert.ok(path.startsWith(prefix)&&!path.slice(prefix.length).split('/').includes('..'));expected[path.slice(prefix.length)]=hash;}
 assert.equal(Object.keys(expected).length,1519);assert.deepEqual(await hashes(secondDirectory),expected,'second_segment_evidence_changed');
 const claim=read<{directory:string;freezeHash:string;offlineSimulation:boolean}>(secondClaim);assert.equal(claim.directory,secondDirectory);assert.equal(claim.freezeHash,secondHash);assert.equal(claim.offlineSimulation,false);
 const protocol=read<{source:Frozen;freezeHash:string;account:AccountPreflight;mode:string}>(join(secondDirectory,'protocol.json'));assert.equal(protocol.freezeHash,secondHash);assert.equal(digest(JSON.stringify(protocol.source)),secondHash);assert.equal(protocol.mode,'live');
 const rows=read<Row[]>(join(secondDirectory,'runs.json')),remaining=remainingEntries(rows,first.remaining),started=rows.filter(r=>r.status!=='not_executed');
 assert.equal(remaining.length,110);assert.equal(started.length,15);assert.deepEqual(started.map(r=>r.id),first.remaining.slice(0,15).map(r=>r.id));assert.equal(remaining[0].id,'D12-1-A');assert.ok(!remaining.some(r=>r.id==='D12-1-C'));
 const readonlyManifest=read<{remainingIds:string[];sourceRunsSha256:string}>(join(root,'final-offer-unstarted-manifest.json'));assert.deepEqual(remaining.map(r=>r.id),readonlyManifest.remainingIds);assert.equal(digest(readFileSync(join(secondDirectory,'runs.json'))),readonlyManifest.sourceRunsSha256);
 const ledger=read<Data>(join(secondDirectory,'ledger.json'));assert.equal(ledger.freezeHash,secondHash);assert.equal(ledger.halted,'unauthorized_draft_change');assert.deepEqual(ledger.account,protocol.account);assert.deepEqual(ledger.requests.slice(0,firstTotals.requests),first.ledgerSeed.requests,'prior_75_requests_changed_or_duplicated');
 const ledgerSeed:LedgerSeed={requests:ledger.requests,source:{directory:secondDirectory,freezeHash:secondHash,ledgerHash:digest(readFileSync(join(secondDirectory,'ledger.json'))),halted:ledger.halted}};validateSeed(ledgerSeed);
 const totals={requests:ledger.requests.length,input:ledger.requests.reduce((n,r)=>n+r.usage!.input,0),output:ledger.requests.reduce((n,r)=>n+r.usage!.output,0),afp:ledger.requests.reduce((n,r)=>n+r.afp!,0),unknown:ledger.requests.filter(r=>!r.usage).length};
 for(const k of ['requests','input','output','unknown'] as const)assert.equal(totals[k],carriedTotals[k]);assert.ok(Math.abs(totals.afp-carriedTotals.afp)<1e-8);
 const attempts=read<Array<{id:number;entry:string;group:string;completed:boolean;error?:string;usage?:{prompt_tokens:number;completion_tokens:number}}>>(join(secondDirectory,'attempts.json'));assert.equal(attempts.length,84);
 for(const [i,a] of attempts.entries()){const r=ledger.requests[i+firstTotals.requests];assert.equal(a.id,r.id);assert.equal(a.entry,r.trialId);assert.equal(a.group,r.group);assert.equal(a.completed,true);assert.ok(!a.error&&a.usage);assert.equal(a.usage.prompt_tokens,r.usage!.input);assert.equal(a.usage.completion_tokens,r.usage!.output);assert.ok(started.some(s=>s.id===a.entry));}
 const canonicalHashes={...first.canonicalHashes};
 for(const row of started){const triple=read<{canonicalHash:string}>(join(secondDirectory,`${row.caseId}-r${row.round}-triple.json`));assert.equal(digest(JSON.stringify(read(join(secondDirectory,row.id,'canonical-fixture.json')))),triple.canonicalHash);canonicalHashes[`${row.caseId}:${row.round}`]=triple.canonicalHash;}
 return {first,protocol,rows,remaining,ledgerSeed,totals,canonicalHashes,manifestHash:digest(readFileSync(manifestPath)),claimHash:digest(readFileSync(secondClaim))};
}
export async function thirdFreeze(){
 const previous=await verifySecondSegment(),current=await sourceFreeze();validateComparable(previous.first.original.protocol.source,current);validateThirdComparable(previous.protocol.source,current);
 return {...current,explicitThirdCloseout:{authorization:thirdAuthorization,previousDirectory:secondDirectory,previousFreeze:secondHash,originalManifestHash:previous.first.original.manifestHash,firstManifestHash:previous.first.manifestHash,secondManifestHash:previous.manifestHash,priorClaimHashes:[previous.first.original.claimHash,previous.first.claimHash,previous.claimHash],previousLedgerHash:previous.ledgerSeed.source.ledgerHash,protocolHash:digest(readFileSync(protocolPath)),remainingManifestHash:digest(readFileSync(join(root,'final-offer-unstarted-manifest.json'))),carriedTotals,remaining:previous.remaining,canonicalHashes:previous.canonicalHashes,thirdClaim,draftViolationScope:'isolated-task',automaticRetry:false}};
}
export async function runThirdCloseout(options:CloseoutOptions){
 const destination=resolve(options.directory);for(const path of [originalDirectory,firstDirectory,secondDirectory])assert.ok(destination!==path&&!destination.startsWith(path+'/'),'third_output_must_not_modify_prior_evidence');
 const previous=await verifySecondSegment(),fresh=read<AccountPreflight>(options.accountPath),account=validateCloseoutAccount(fresh,previous),offline=options.offline;
 let entries=previous.remaining;if(offline?.prefixSlots!==undefined){assert.ok(Number.isInteger(offline.prefixSlots)&&offline.prefixSlots>0&&offline.prefixSlots<=entries.length);entries=entries.slice(0,offline.prefixSlots);}
 const result=await runLive({directory:options.directory,freezePath:options.freezePath,port:options.port,env:options.env,draftViolationScope:'isolated-task',offline:offline?{transport:offline.transport,claimPath:offline.claimPath}:undefined,continuation:{entries,claimPath:offline?resolve(offline.claimPath):thirdClaim,gatePath:thirdGate,freeze:thirdFreeze,ledgerSeed:previous.ledgerSeed,account,accountObservation:fresh,originalDirectory:secondDirectory,canonicalHashes:previous.canonicalHashes,authorization:thirdAuthorization}});
 await verifySecondSegment();save(join(options.directory,'third-closeout-summary.json'),{priorDirectories:[originalDirectory,firstDirectory,secondDirectory],carriedTotals,newTotals:{requests:result.total.requests-carriedTotals.requests,input:result.total.input-carriedTotals.input,output:result.total.output-carriedTotals.output,afp:result.total.afp-previous.totals.afp,unknown:result.total.unknown},cumulativeTotals:result.total,continuedSlots:result.rows.length,stop:result.stop??null,priorEvidenceUnchanged:3764,automaticRetry:false,offlineSimulation:Boolean(offline)});return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [mode,...args]=process.argv.slice(2);
 if(mode==='prepare'){assert.equal(args.length,1);assert.ok(!existsSync(args[0]));void thirdFreeze().then(f=>{writeFileSync(args[0],JSON.stringify(f,null,2)+'\n',{flag:'wx',mode:0o600});console.info(JSON.stringify({prepared:args[0],remainingTrials:110,preservedTrials:34,modelCalls:0}));});}
 else{assert.equal(mode,'run');const [directory,freezePath,accountPath,port]=args;assert.ok(directory&&freezePath&&accountPath);void runThirdCloseout({directory,freezePath,accountPath,port:Number(port??4687)}).then(r=>{console.info(JSON.stringify(r));if(r.stop)process.exitCode=1;}).catch(error=>{console.error(error instanceof Error?error.message:'third closeout failed');process.exitCode=1;});}
}
