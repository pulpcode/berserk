import assert from 'node:assert/strict';
import {test} from 'node:test';
import {comparisonSummary,type GroupScore} from './comparison-summary.js';
import {criticalKeys} from '../11-02-task-resource-acceptance/scoring.js';
import {schedule} from './cases.js';
test('each group retains twelve denominator; no cross-model borrowing or public dilution',()=>{
 const empty=comparisonSummary([]);assert.deepEqual(empty.map(g=>[g.planned,g.mainRate,g.modelScoreThresholdMet]),[[12,0,false],[12,0,false]]);
 const rows=schedule.filter(s=>s.phase==='formal').map(s=>({...s,entryId:s.id,cohort:s.phase,status:'reviewed',mainTask:true,strict:true,explanation:true,processExplanation:null,critical:Object.fromEntries(criticalKeys.map(k=>[k,true]))} as unknown as GroupScore));
 assert.deepEqual(comparisonSummary(rows).map(g=>g.modelScoreThresholdMet),[true,true]);
 rows[0].strict=false;rows[0].mainTask=false;assert.equal(comparisonSummary(rows)[0].modelScoreThresholdMet,true);
 const another=rows.find(s=>s.group==='A'&&s.caseId===rows[0].caseId&&s.repeat===2)!;another.strict=false;another.mainTask=false;
 assert.equal(comparisonSummary(rows)[0].modelScoreThresholdMet,false);assert.equal(comparisonSummary(rows)[1].strictRate,1);
 assert.throws(()=>comparisonSummary([...rows,rows[0]]),/duplicate/);
});
