import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {aggregate,strictOf,validateScore,publicMessage,independentSelection,packBlind,type Score,type Slot} from './review-tools.js';
const good=(blindId:string):Score=>({blindId,mainRequirement:'pass',processFacts:'na',finalFacts:'pass',effects:'pass',boundaries:'pass',strict:'pass',quotes:[],evidence:['tool/state receipt'],reason:'All required outcomes observed',clarity:'clear'});
const slots:Slot[]=Array.from({length:24},(_,i)=>[1,2].flatMap(round=>['A','B','C'].map(group=>({id:`D${String(i+1).padStart(2,'0')}-${round}-${group}`,caseId:`D${String(i+1).padStart(2,'0')}`,group,round,status:'not_executed'})))).flat();
test('strict cannot contradict components; uncertainty cannot hide an established failure',()=>{
 const base=good('one');assert.equal(strictOf(base),'pass');assert.equal(strictOf({...base,mainRequirement:'pending'}),'pending');assert.equal(strictOf({...base,mainRequirement:'pending',finalFacts:'fail'}),'fail');assert.throws(()=>validateScore({...base,processFacts:'fail'}),/strict must match/);assert.throws(()=>validateScore({...base,evidence:[]}),/evidence/);
});
test('incomplete batches keep denominators and distinguish unknown from not executed',()=>{
 const rows=structuredClone(slots);rows[0]={...rows[0],status:'recorded',blindId:'a'};rows[1]={...rows[1],status:'interrupted',blindId:'b'};const result=aggregate(rows,[good('a')],['D01','D05','D09','D13','D17','D21']);assert.deepEqual(result.groups.A.strict,{planned:48,pass:1,fail:0,pending:0,notExecuted:47});assert.deepEqual(result.groups.B.strict,{planned:48,pass:0,fail:0,pending:1,notExecuted:47});assert.equal(result.groups.A.repeated.incomplete,24);assert.equal(result.comparisons.BvsA.unresolved,48);
});
test('repeats and pair comparisons use same case and repetition rather than pooled totals',()=>{
 const rows=slots.map((s,i)=>({...s,status:'recorded',blindId:String(i)})),scores=rows.map(r=>good(r.blindId));scores[0]={...scores[0],finalFacts:'fail',strict:'fail',quotes:['wrong factual claim']};const result=aggregate(rows,scores,['D01','D05','D09','D13','D17','D21']);assert.equal(result.groups.A.strict.pass,47);assert.equal(result.groups.A.repeated.mixed,1);assert.equal(result.groups.A.repeated.bothPass,23);assert.equal(result.groups.B.new.pass,36);assert.equal(result.comparisons.BvsA.improved,1);assert.equal(result.comparisons.BvsA.net,1);
 const selection=independentSelection(rows,scores);assert.ok(selection.ids.includes('0'));assert.ok(selection.ids.includes('1'));assert.ok(selection.ids.includes('2'));assert.deepEqual(selection,independentSelection(rows,scores));assert.equal(selection.randomPassCount,36);
});
test('public evidence keeps tool calls and content but excludes private reasoning recursively',()=>{
 const value={messages:[{role:'assistant',content:'public answer',reasoning_content:'secret',tool_calls:[{id:'call1',function:{name:'annotation_read',arguments:'{}'}}]}],model:'hidden-model',usage:{input:1}};const result=publicMessage(value);assert.ok(!JSON.stringify(result).includes('secret'));assert.ok(!JSON.stringify(result).includes('hidden-model'));assert.ok(JSON.stringify(result).includes('call1'));assert.ok(JSON.stringify(result).includes('public answer'));
});

test('aggregation refuses duplicate identities, malformed pairs, and reviews of unexecuted slots',()=>{
 const base=slots.map((s,i)=>({...s,status:'recorded',blindId:String(i)}));
 const duplicate=structuredClone(base);duplicate[1].blindId=duplicate[0].blindId;assert.throws(()=>aggregate(duplicate,[],[]),/duplicate blind ID/);
 const wrongPair=structuredClone(base);wrongPair[1].group='A';assert.throws(()=>aggregate(wrongPair,[],[]),/duplicate scheduled tuple/);
 const unexecuted=structuredClone(base);unexecuted[0].status='not_executed';assert.throws(()=>aggregate(unexecuted,[good('0')],[]),/unexecuted slot/);
 const started=structuredClone(base);started[0].status='started';assert.throws(()=>aggregate(started,[good('0')],[]),/ended slot/);
 const wrongCase=structuredClone(base);wrongCase[0].caseId='D25';assert.throws(()=>aggregate(wrongCase,[],[]),/unknown case/);
});
test('blind index order cannot expose the known group execution rotation',()=>{
 const root=mkdtempSync(join(tmpdir(),'r14-offline-blind-')),batch=join(root,'batch'),blind=join(root,'blind');mkdirSync(batch);
 const rows=[{...slots[0],status:'recorded',blindId:'zz-random'},{...slots[1],status:'recorded',blindId:'aa-random'},{...slots[2],status:'recorded',blindId:'mm-random'}];
 writeFileSync(join(batch,'runs.json'),JSON.stringify(rows));
 for(const row of rows){const dir=join(batch,row.id);mkdirSync(dir);writeFileSync(join(dir,'judge-input.json'),JSON.stringify({id:row.blindId,visibleTranscript:[{role:'assistant',text:'public'}]}));writeFileSync(join(dir,'provider-0001-wire-input.json'),JSON.stringify({model:'private group model',messages:[{role:'assistant',content:'public',reasoning_content:'private trace'}]}));}
 assert.equal(packBlind(batch,blind),3);const index=JSON.parse(readFileSync(join(blind,'index.json'),'utf8')) as Array<{blindId:string;caseId:string}>;
 assert.deepEqual(index.map(r=>r.blindId),['aa-random','mm-random','zz-random']);assert.ok(index.every(r=>Object.keys(r).sort().join(',')==='blindId,caseId'));assert.ok(!readFileSync(join(blind,'aa-random/model-visible-evidence.json'),'utf8').includes('private trace'));
});

test('started failure without judge input remains in the blind review as explicitly missing evidence',()=>{
 const root=mkdtempSync(join(tmpdir(),'r14-offline-blind-failure-')),batch=join(root,'batch'),blind=join(root,'blind');mkdirSync(batch);
 const row={...slots[0],status:'interrupted',blindId:'failed-random',completedUserTurns:0,plannedUserTurns:2,stop:'response_model_drift\nexpected deepseek-v4-pro-ga-260813'};writeFileSync(join(batch,'runs.json'),JSON.stringify([row,slots[1]]));const dir=join(batch,row.id);mkdirSync(dir);writeFileSync(join(dir,'provider-0001-wire-input.json'),JSON.stringify({messages:[{role:'user',content:'actual input'}]}));
 assert.equal(packBlind(batch,blind),1);const index=JSON.parse(readFileSync(join(blind,'index.json'),'utf8'));assert.equal(index[0].blindId,'failed-random');
 const judge=JSON.parse(readFileSync(join(blind,'failed-random/judge-input.json'),'utf8')),completion=JSON.parse(readFileSync(join(blind,'failed-random/completion.json'),'utf8'));assert.equal(judge.evidenceUnavailable,true);assert.deepEqual(judge.visibleTranscript,[]);assert.deepEqual(judge.stateEvidence,[]);assert.equal(completion.status,'interrupted');assert.equal(completion.completedUserTurns,0);assert.equal(completion.plannedUserTurns,2);assert.equal(completion.stop,'response_model_drift');assert.ok(readFileSync(join(blind,'failed-random/model-visible-evidence.json'),'utf8').includes('actual input'));
});
