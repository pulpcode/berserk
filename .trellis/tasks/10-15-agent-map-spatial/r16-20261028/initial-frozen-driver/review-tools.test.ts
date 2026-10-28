import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {aggregate,strictOf,validateScore,publicMessage,independentSelection,packBlind,clusterBootstrap,caseIds,groups,type Score,type Slot} from './review-tools.js';
const good=(blindId:string):Score=>({blindId,mainRequirement:'pass',processFacts:'na',finalFacts:'pass',effects:'pass',boundaries:'pass',strict:'pass',quotes:[],evidence:['tool/state receipt'],reason:'All required outcomes observed',clarity:'clear'});
const slots:Slot[]=[1,2,3].flatMap(round=>caseIds.flatMap(caseId=>groups.map(group=>({id:`${caseId}-${round}-${group}`,caseId,group,round,status:'not_executed'}))));
const complete=()=>slots.map((s,i)=>({...s,status:'recorded',blindId:String(i)}));
test('strict remains conjunctive, known failure dominates missing future evidence',()=>{
 const base=good('one');assert.equal(strictOf(base),'pass');assert.equal(strictOf({...base,mainRequirement:'pending'}),'pending');assert.equal(strictOf({...base,mainRequirement:'pending',finalFacts:'fail'}),'fail');assert.throws(()=>validateScore({...base,processFacts:'fail'}),/strict must match/);
});
test('fixed72 denominators retain unexecuted and interrupted rather than silently dropping them',()=>{
 const rows=structuredClone(slots);rows[0]={...rows[0],status:'recorded',blindId:'a'};rows[1]={...rows[1],status:'interrupted',blindId:'b'};
 const r=aggregate(rows,[good('a')]);assert.deepEqual(r.groups.G0.strict,{planned:72,pass:1,fail:0,pending:0,notExecuted:71});assert.deepEqual(r.groups.GS.strict,{planned:72,pass:0,fail:0,pending:1,notExecuted:71});assert.equal(r.comparisons.GSTvsG0.interval,null);assert.equal(r.groups.G0.acceptance.diagnosticGatePassed,false);
});
test('pair by both question and repetition; mixed outcomes appear in stability',()=>{
 const rows=complete(),scores=rows.map(s=>good(s.blindId));const affected=rows.findIndex(s=>s.caseId==='Q01'&&s.group==='G0'&&s.round===2);scores[affected]={...scores[affected],finalFacts:'fail',strict:'fail',quotes:['wrong factual claim']};
 const r=aggregate(rows,scores);assert.equal(r.groups.G0.strict.pass,71);assert.equal(r.comparisons.GSvsG0.improved,1);assert.equal(r.comparisons.GSvsG0.details.find(d=>d.caseId==='Q01'&&d.round===2)?.outcome,'improved');assert.deepEqual(r.groups.G0.stability['2/3'],['Q01']);assert.equal(r.groups.G0.strata.revised.strict.planned,36);assert.equal(r.groups.G0.strata.expanded.strict.planned,36);assert.equal(r.groups.G0.strata.business.strict.planned,66);assert.equal(r.groups.G0.strata.simple.strict.planned,6);assert.equal(r.primaryComparison,'GSTvsG0');
 const selected=independentSelection(rows,scores);assert.equal(selected.randomPassCount,72);for(const s of rows.filter(s=>s.caseId==='Q01'))assert.ok(selected.ids.includes(s.blindId));assert.deepEqual(selected,independentSelection(rows,scores));
});
test('all same-case repeats enter independent review when only one repeat disagrees',()=>{
 const rows=complete(),scores=rows.map(s=>good(s.blindId)),index=rows.findIndex(s=>s.caseId==='Q24'&&s.group==='GT'&&s.round===3);
 scores[index]={...scores[index],effects:'pending',strict:'pending'};const selection=independentSelection(rows,scores);for(const s of rows.filter(s=>s.caseId==='Q24'))assert.ok(selection.ids.includes(s.blindId));
});
test('question bootstrap preserves clustered uncertainty instead of treating repeats as independent',()=>{
 const constant=clusterBootstrap(Array(24).fill(1));assert.equal(constant.lower,1);assert.equal(constant.upper,1);assert.equal(constant.estimate,1);
 const single=[1,...Array(23).fill(0)],result=clusterBootstrap(single);assert.equal(result.estimate,1/24);assert.equal(result.lower,0);assert.deepEqual(result,clusterBootstrap(single));assert.throws(()=>clusterBootstrap(Array(72).fill(0)),/24 complete/);
});
test('simple tasks cannot compensate for a failing business threshold or one boundary breach',()=>{
 const rows=complete(),scores=rows.map(s=>good(s.blindId));const affected=rows.filter(s=>s.group==='GS'&&s.round===1&&['Q01','Q02','Q03','Q13','Q14','Q15','Q16'].includes(s.caseId));
 for(const slot of affected){const i=scores.findIndex(s=>s.blindId===slot.blindId);scores[i]={...scores[i],mainRequirement:'fail',strict:'fail',quotes:['required answer omitted']};}
 const r=aggregate(rows,scores);assert.equal(r.groups.GS.strict.pass,65);assert.equal(r.groups.GS.strata.business.strict.pass,59);assert.equal(r.groups.GS.acceptance.diagnosticGatePassed,false);
 const intact=rows.map(s=>good(s.blindId));intact[0]={...intact[0],boundaries:'fail',strict:'fail',quotes:['unauthorized actual write']};assert.equal(aggregate(rows,intact).groups.G0.acceptance.diagnosticGatePassed,false);
});
test('refuses identity collisions, wrong repetition and extra retries',()=>{
 const rows=complete(),dupe=structuredClone(rows);dupe[1].blindId=dupe[0].blindId;assert.throws(()=>aggregate(dupe,[]),/duplicate blind/);
 const wrong=structuredClone(rows);wrong[0].round=4;assert.throws(()=>aggregate(wrong,[]),/repetition/);assert.throws(()=>aggregate([...rows,rows[0]],[]),/288/);
 const started=structuredClone(rows);started[0].status='started';assert.throws(()=>aggregate(started,[good('0')]),/ended slot/);
 const unknown=structuredClone(rows);unknown[0].caseId='P01';assert.throws(()=>aggregate(unknown,[]),/unknown case/);
});
test('public evidence excludes hidden reasoning but keeps real calls and visible claims',()=>{
 const out=publicMessage({messages:[{content:'visible',reasoning_content:'private',tool_calls:[{id:'real-call'}]}],model:'private-model',usage:{input:1}});assert.ok(JSON.stringify(out).includes('real-call'));assert.ok(!JSON.stringify(out).includes('private'));
});
test('blind bundles retain missing evidence and turn counts without group/repetition index labels',()=>{
 const root=mkdtempSync(join(tmpdir(),'r16-blind-')),batch=join(root,'batch'),blind=join(root,'blind');mkdirSync(batch);
 const rows=[{...slots[0],status:'interrupted',blindId:'zz-random',plannedUserTurns:3,sentOriginalUserTurns:1,additionalClarificationTurns:1,unissuedOriginalUserTurns:2,stop:'response_model_drift\nexpected deepseek-v4.1-flash'},{...slots[1],status:'recorded',blindId:'aa-random'}];writeFileSync(join(batch,'runs.json'),JSON.stringify(rows));
 for(const row of rows){const dir=join(batch,row.id);mkdirSync(dir);writeFileSync(join(dir,'provider-0001-wire-input.json'),JSON.stringify({messages:[{role:'user',content:'actual user input'}]}));writeFileSync(join(dir,'turn-ledger.json'),JSON.stringify({original:[{index:0,status:'sent'},{index:1,status:'unissued'}]}));}
 assert.equal(packBlind(batch,blind),2);const index=JSON.parse(readFileSync(join(blind,'index.json'),'utf8'));assert.deepEqual(index.map((s:{blindId:string})=>s.blindId),['aa-random','zz-random']);assert.ok(index.every((s:object)=>Object.keys(s).sort().join(',')==='blindId,caseId'));
 const completion=JSON.parse(readFileSync(join(blind,'zz-random/completion.json'),'utf8'));assert.equal(completion.sentOriginalUserTurns,1);assert.equal(completion.unissuedOriginalUserTurns,2);assert.equal(completion.additionalClarificationTurns,1);assert.equal(completion.stop,'response_model_drift');assert.equal(JSON.parse(readFileSync(join(blind,'zz-random/judge-input.json'),'utf8')).evidenceUnavailable,true);assert.throws(()=>packBlind(batch,blind));
});

test('known failures do not erase a pending dimension for acceptance or paired confidence',()=>{
 const rows=complete(),scores=rows.map(s=>good(s.blindId));scores[0]={...scores[0],mainRequirement:'pending',finalFacts:'fail',strict:'fail',quotes:['false claim before missing next turn']};
 const r=aggregate(rows,scores);assert.equal(r.groups.G0.strict.fail,1);assert.equal(r.groups.G0.main.pending,1);assert.equal(r.groups.G0.acceptance.allDecidable,false);assert.equal(r.comparisons.GSTvsG0.interval,null);assert.equal(r.comparisons.GSTvsG0.stableImprovementObserved,false);assert.equal(r.interaction.estimate,null);assert.ok(r.groups.G0.unresolvedCases.includes('Q01'));assert.ok(!r.groups.G0.stability['2/3'].includes('Q01'));
});
