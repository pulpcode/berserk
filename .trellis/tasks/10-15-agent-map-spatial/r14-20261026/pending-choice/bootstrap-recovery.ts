/** One explicitly approved zero-request authentication bootstrap recovery, never a model retry. */
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {hashes,digest} from '../runtime.js';
import type {Data} from '../budget.js';
import type {MapTrialManifest} from '../../../../../experiments/harness-lab/scripts/probe-situation-map.js';
const read=<T>(path:string)=>JSON.parse(readFileSync(path,'utf8')) as T;
export interface BootstrapFailure {directory:string;claim:string}
export async function verifyBootstrapFailure(failure:BootstrapFailure,paths:{original:string;latest:string},offline=false){
 const claim=read<{entry:string;directory:string;freezeHash:string;offline:boolean}>(failure.claim),entry=join(paths.original,'D06-1-A'),manifest=read<MapTrialManifest>(join(entry,'manifest.json')),fixture=read<{fixture:{sessionId:string}}>(join(entry,'fixture.json'));
 assert.equal(claim.entry,'D06-1-A');assert.equal(realpathSync(claim.directory),realpathSync(failure.directory));
 const protocol=read<{freezeHash:string;frozen:{entry:string;original:string;latest:string;originalEntry:Record<string,string>;originalState:Record<string,string>}}>(join(failure.directory,'protocol.json'));
 assert.equal(protocol.freezeHash,claim.freezeHash);assert.equal(digest(JSON.stringify(protocol.frozen)),claim.freezeHash);assert.equal(protocol.frozen.entry,'D06-1-A');assert.equal(realpathSync(protocol.frozen.original),realpathSync(paths.original));assert.equal(realpathSync(protocol.frozen.latest),realpathSync(paths.latest));
 const reason=`GET /api/sessions/${fixture.fixture.sessionId}: HTTP 401`,result=read<{entryId:string;settled:boolean;stop:string;batchStop:string;taskStop:unknown;completedSupplementTurns:number;newTaskCount:number;newUsage:unknown;cumulative:unknown}>(join(failure.directory,'result.json'));
 assert.equal(result.entryId,'D06-1-A');assert.equal(result.settled,true);assert.equal(result.stop,reason);assert.equal(result.batchStop,reason);assert.equal(result.taskStop,null);assert.equal(result.completedSupplementTurns,0);assert.equal(result.newTaskCount,0);assert.deepEqual(result.newUsage,{requests:0,input:0,output:0,afp:0,unknown:0});assert.equal(read<{reason:string}>(join(failure.directory,'failure.json')).reason,reason);
 assert.deepEqual(read(join(failure.directory,'attempts.json')),[],'Any attempted model request forbids bootstrap recovery');
 const names=readdirSync(failure.directory);assert.ok(!names.some(n=>/^(?:turn-|provider-)/.test(n)||['before.json','review.json','tool-arguments.json','judge-input.json'].includes(n)),'Any sent user turn or provider evidence forbids bootstrap recovery');
 const ledger=read<Data>(join(failure.directory,'ledger.json')),latest=read<Data>(join(paths.latest,'ledger.json'));assert.equal(ledger.freezeHash,claim.freezeHash);assert.equal(ledger.halted,reason);assert.ok(!latest.halted);assert.deepEqual(ledger.requests,latest.requests,'Cumulative ledger must be identical');assert.deepEqual(ledger.account,latest.account);assert.deepEqual(read(join(failure.directory,'inherited-ledger.json')),latest);
 const totals={requests:latest.requests.length,input:latest.requests.reduce((n,r)=>n+(r.usage?.input??0),0),output:latest.requests.reduce((n,r)=>n+(r.usage?.output??0),0),afp:latest.requests.reduce((n,r)=>n+(r.afp??0),0),unknown:latest.requests.filter(r=>!r.usage||r.status!=='finished').length};assert.deepEqual(result.cumulative,totals);assert.equal(totals.unknown,0);
 if(!offline){assert.equal(claim.offline,false);assert.equal(claim.freezeHash,'7d4cf55fadf71221b33bd87a4494cb9fdd9c9ed33071bce846421e51306e26d6');assert.equal(totals.requests,650);assert.equal(totals.input,12467724);assert.equal(totals.output,216097);assert.ok(Math.abs(totals.afp-3349.835375)<1e-8);}
 assert.deepEqual(await hashes(entry),protocol.frozen.originalEntry,'Original task evidence changed');assert.deepEqual(await hashes(manifest.dataDir),protocol.frozen.originalState,'Original private state changed');
 const native=await hashes(join(manifest.dataDir,'sessions'));assert.deepEqual(await hashes(join(failure.directory,'restored/data/sessions')),native,'Failed bootstrap appended or changed native history');
 return {directory:failure.directory,claim:failure.claim,claimHash:digest(readFileSync(failure.claim)),failedEvidence:await hashes(failure.directory),native,zeroModelRequests:true,zeroUserMessages:true,cumulative:totals};
}
