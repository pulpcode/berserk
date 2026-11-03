import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {cases,schedule} from './cases.js';
import {prepare,requireOffline} from './prepare.js';
test('24 slots pair six frozen prompts with counterbalanced loading and live is unavailable',()=>{
 assert.equal(cases.length,6);assert.equal(schedule.length,24);assert.equal(new Set(schedule.map(e=>e.id)).size,24);
 for(const c of cases)for(const round of [1,2])assert.deepEqual(schedule.filter(e=>e.caseId===c.id&&e.round===round).map(e=>e.group),round===1?['A','B']:['B','A']);
 assert.doesNotThrow(()=>requireOffline('prepare'));assert.throws(()=>requireOffline('live'),/Only offline/);
 assert.ok(cases.find(c=>c.id==='T2')!.prompt.includes('水罐消防车'));assert.ok(cases.find(c=>c.id==='R2')!.prompt.includes('完整草稿'));assert.ok(cases.find(c=>c.id==='S2')!.prompt.includes('当前系统图标目录'));
});
test('all slots use real HTTP/Pi and readonly tools; only B receives unchanged Skill body', {timeout:240000},async()=>{
 const directory=join(await mkdtemp(join(tmpdir(),'plotting-loading-')),'batch');const result=await prepare(directory,5283);assert.equal(result.prepared,24);assert.equal(result.syntheticProviderRequests,48);assert.equal(result.realProviderRequests,0);
 const read=async(path:string)=>JSON.parse(await readFile(join(directory,path),'utf8'));
 const pairs=new Map<string,unknown>();
 for(const row of schedule){
  const pairing=await read(row.id+'/pairing.json');if(pairs.has(pairing.pairKey))assert.deepEqual(pairing.normalizedDocument,pairs.get(pairing.pairKey));else pairs.set(pairing.pairKey,pairing.normalizedDocument);
  const input=await read(row.id+'/input.json'),fixture=await read(row.id+'/fixture.json'),loaded=await read(row.id+'/provider-1-loading.json');assert.equal(input.text,cases.find(c=>c.id===row.caseId)!.prompt);assert.equal(loaded.bodyPresent,row.group==='B');assert.equal(Boolean(input.skill),row.group==='B');
  const wire=await read(row.id+'/provider-1-wire.json');assert.equal(wire.model,'deepseek-v4.1-flash');assert.equal(wire.thinking.type,'disabled');assert.equal(wire.temperature,undefined);assert.equal(JSON.stringify(wire).includes('expectedSymbols'),false);
  const after=await read(row.id+'/result.json');assert.deepEqual(after.after,fixture.before);assert.equal(after.semanticReview,'not_applicable');
 }
 assert.equal(pairs.size,12);
 await assert.rejects(prepare(directory,5283),/overwriting/);console.info(JSON.stringify({loadingPreparationEvidence:directory,...result}));
});
