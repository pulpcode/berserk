/** Second explicit segment of the already authorized R14 closeout; not a general resume facility. */
import assert from 'node:assert/strict';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyOriginal,remainingEntries,validateComparable,validateCloseoutAccount,originalDirectory,closeoutClaim,type CloseoutOptions} from './closeout.js';
import {runLive,sourceFreeze,type Row} from './live.js';
import {validateSeed,type LedgerSeed,type Data,type AccountPreflight} from './budget.js';
import {repo,digest,hashes,save} from './runtime.js';
const root=fileURLToPath(new URL('.',import.meta.url));
const read=<T>(p:string)=>JSON.parse(readFileSync(p,'utf8')) as T;
export const firstDirectory=join(repo,'.local/spatial-r14/closeout-20261026');
export const secondClaim=join(repo,'.local/spatial-r14/closeout-second-remaining-claim.json');
export const secondGate=join(root,'second-closeout-offline-gate.json');
const firstManifest=join(root,'closeout-first-segment-manifest.json');
const protocolPath=join(root,'closeout-offer-fix-protocol.md');
const firstFreeze='1747c7427225734cff6074960ee182181346f48aefa2e510d886428580013bb2';
export const carriedTotals={requests:75,input:1355944,output:26692,afp:350.66225,unknown:0};
type Frozen=Awaited<ReturnType<typeof sourceFreeze>>;
export function validateSecondComparable(first:Frozen,current:Frozen){
 const allowed=new Set(['cases.ts','closeout-clarification.test.ts']);
 for(const [name,hash] of Object.entries(first.driver))if(!allowed.has(name))assert.equal(current.driver[name],hash,`second_unapproved_driver_change:${name}`);

}
export async function verifyFirstSegment(){
 const original=await verifyOriginal();
 const manifest=read<{files:Record<string,string>}>(firstManifest),prefix='.local/spatial-r14/closeout-20261026/',expected:Record<string,string>={};
 for(const [path,hash] of Object.entries(manifest.files)){assert.ok(path.startsWith(prefix)&&!path.slice(prefix.length).split('/').includes('..'));expected[path.slice(prefix.length)]=hash;}
 assert.equal(Object.keys(expected).length,1169);assert.deepEqual(await hashes(firstDirectory),expected,'first_segment_evidence_changed');
 const claim=read<{directory:string;freezeHash:string;offlineSimulation:boolean}>(closeoutClaim);assert.equal(claim.directory,firstDirectory);assert.equal(claim.freezeHash,firstFreeze);assert.equal(claim.offlineSimulation,false);
 const protocol=read<{source:Frozen;freezeHash:string;account:AccountPreflight;mode:string}>(join(firstDirectory,'protocol.json'));assert.equal(protocol.freezeHash,firstFreeze);assert.equal(digest(JSON.stringify(protocol.source)),firstFreeze);assert.equal(protocol.mode,'live');
 const rows=read<Row[]>(join(firstDirectory,'runs.json')),remaining=remainingEntries(rows,original.remaining),started=rows.filter(r=>r.status!=='not_executed');
 assert.equal(remaining.length,125);assert.equal(started.length,11);assert.deepEqual(started.map(r=>r.id),original.remaining.slice(0,11).map(r=>r.id));assert.equal(remaining[0].id,'D07-1-B');
 const ledger=read<Data>(join(firstDirectory,'ledger.json'));assert.equal(ledger.freezeHash,firstFreeze);assert.equal(ledger.halted,'waiting_user_unmapped_plain_question');assert.deepEqual(ledger.account,protocol.account);assert.deepEqual(ledger.requests.slice(0,34),original.ledgerSeed.requests,'old_requests_changed_or_double_charged');
 const ledgerSeed:LedgerSeed={requests:ledger.requests,source:{directory:firstDirectory,freezeHash:firstFreeze,ledgerHash:digest(readFileSync(join(firstDirectory,'ledger.json'))),halted:ledger.halted}};validateSeed(ledgerSeed);
 const totals={requests:ledger.requests.length,input:ledger.requests.reduce((n,r)=>n+r.usage!.input,0),output:ledger.requests.reduce((n,r)=>n+r.usage!.output,0),afp:ledger.requests.reduce((n,r)=>n+r.afp!,0),unknown:ledger.requests.filter(r=>!r.usage).length};
 for(const k of ['requests','input','output','unknown'] as const)assert.equal(totals[k],carriedTotals[k]);assert.ok(Math.abs(totals.afp-carriedTotals.afp)<1e-8);
 const attempts=read<Array<{id:number;entry:string;group:string;completed:boolean;error?:string;usage?:{prompt_tokens:number;completion_tokens:number}}>>(join(firstDirectory,'attempts.json'));assert.equal(attempts.length,41);
 for(const [i,a] of attempts.entries()){const r=ledger.requests[i+34];assert.equal(a.id,r.id);assert.equal(a.entry,r.trialId);assert.equal(a.group,r.group);assert.equal(a.completed,true);assert.ok(!a.error&&a.usage);assert.equal(a.usage.prompt_tokens,r.usage!.input);assert.equal(a.usage.completion_tokens,r.usage!.output);assert.ok(started.some(s=>s.id===a.entry));}
 const canonicalHashes={...original.canonicalHashes};
 for(const row of started){const triple=read<{canonicalHash:string}>(join(firstDirectory,`${row.caseId}-r${row.round}-triple.json`));assert.equal(digest(JSON.stringify(read(join(firstDirectory,row.id,'canonical-fixture.json')))),triple.canonicalHash);canonicalHashes[`${row.caseId}:${row.round}`]=triple.canonicalHash;}
 return {original,protocol,rows,remaining,ledgerSeed,totals,canonicalHashes,manifestHash:digest(readFileSync(firstManifest)),claimHash:digest(readFileSync(closeoutClaim))};
}
export async function secondFreeze(){
 const first=await verifyFirstSegment(),current=await sourceFreeze();validateComparable(first.original.protocol.source,current);validateSecondComparable(first.protocol.source,current);
 return {...current,explicitSecondCloseout:{authorization:'完成原计划剩余125项，不重跑19项；修复助手可选后续工作误停',firstDirectory,firstFreeze,originalDirectory,originalManifestHash:first.original.manifestHash,originalClaimHash:first.original.claimHash,firstManifestHash:first.manifestHash,firstClaimHash:first.claimHash,firstLedgerHash:first.ledgerSeed.source.ledgerHash,protocolHash:digest(readFileSync(protocolPath)),carriedTotals,remaining:first.remaining,canonicalHashes:first.canonicalHashes,secondClaim,automaticRetry:false}};
}
export async function runSecondCloseout(options:CloseoutOptions){
 const destination=resolve(options.directory);for(const p of [originalDirectory,firstDirectory])assert.ok(destination!==p&&!destination.startsWith(p+'/'),'second_output_must_not_modify_prior_evidence');
 const first=await verifyFirstSegment(),fresh=read<AccountPreflight>(options.accountPath),account=validateCloseoutAccount(fresh,first),offline=options.offline;
 let entries=first.remaining;if(offline?.prefixSlots!==undefined){assert.ok(Number.isInteger(offline.prefixSlots)&&offline.prefixSlots>0&&offline.prefixSlots<=entries.length);entries=entries.slice(0,offline.prefixSlots);}
 const result=await runLive({directory:options.directory,freezePath:options.freezePath,port:options.port,env:options.env,offline:offline?{transport:offline.transport,claimPath:offline.claimPath}:undefined,continuation:{entries,claimPath:offline?resolve(offline.claimPath):secondClaim,gatePath:secondGate,freeze:secondFreeze,ledgerSeed:first.ledgerSeed,account,accountObservation:fresh,originalDirectory:firstDirectory,canonicalHashes:first.canonicalHashes,authorization:'explicit_second_remaining_125_only_no_retry_no_budget_increase'}});
 await verifyFirstSegment();save(join(options.directory,'second-closeout-summary.json'),{priorDirectories:[originalDirectory,firstDirectory],carriedTotals,newTotals:{requests:result.total.requests-carriedTotals.requests,input:result.total.input-carriedTotals.input,output:result.total.output-carriedTotals.output,afp:result.total.afp-first.totals.afp,unknown:result.total.unknown},cumulativeTotals:result.total,continuedSlots:result.rows.length,stop:result.stop??null,priorEvidenceUnchanged:1076+1169,automaticRetry:false,offlineSimulation:Boolean(offline)});return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [mode,...args]=process.argv.slice(2);
 if(mode==='prepare'){assert.equal(args.length,1);assert.ok(!existsSync(args[0]));void secondFreeze().then(f=>{writeFileSync(args[0],JSON.stringify(f,null,2)+'\n',{flag:'wx',mode:0o600});console.info(JSON.stringify({prepared:args[0],remainingTrials:125,preservedTrials:19,modelCalls:0}));});}
 else{assert.equal(mode,'run');const [directory,freezePath,accountPath,port]=args;assert.ok(directory&&freezePath&&accountPath);void runSecondCloseout({directory,freezePath,accountPath,port:Number(port??4687)}).then(r=>{console.info(JSON.stringify(r));if(r.stop)process.exitCode=1;}).catch(error=>{console.error(error instanceof Error?error.message:'second closeout failed');process.exitCode=1;});}
}
