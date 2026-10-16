import {describe, expect, it} from 'vitest';
import {spatialCases,spatialCaseLayers,spatialSchedule,meridianDistance,rectangleArea} from '../scripts/probe-spatial-cases.js';
import {applySpatialCondition,spatialSkillEvidence,uniqueSpatialResults,providerToolCalls,scoreSpatialFacts,spatialOptions,type SpatialObservation} from '../scripts/probe-spatial-evaluation.js';
import type {ResourceService,ResourceSnapshot} from '../src/resources/service.js';
import {reviewedSuccess,spatialEntryStatus,summarizeSpatial} from '../scripts/probe-spatial-report.js';
import {spatialEvidenceHashes} from '../scripts/probe-spatial-batch.js';
import type {PublicMessage} from '../src/contracts/index.js';
import type {SpatialResult} from '../src/contracts/spatial.js';
const spec=(id:string)=>spatialCases.find(item=>item.id===id)!;
const result=(operation:SpatialResult['operation'],extra:Partial<SpatialResult>={}):SpatialResult=>({schemaVersion:1,resultRef:'spatial:request:call',requestId:'request',toolCallId:'call',operation,parameters:{operation:'buffer',input:{kind:'annotation',ref:{setId:'set',revision:1}},distanceM:1},createdAt:'2026-10-16T00:00:00Z',scope:[],completeness:{status:'complete',candidateCount:1},items:[],method:'test',limitations:[],provenance:[],...extra});
const observation=(extra:Partial<SpatialObservation>={}):SpatialObservation=>({results:[],messages:[],tools:[],before:{version:{hash:'before'},publications:[],current:{}} as unknown as SpatialObservation['before'],after:{version:{hash:'before'},publications:[],current:{}} as unknown as SpatialObservation['after'],protocolCompleted:true,skillLoaded:false,skillLoadedBeforeAnalysis:false,...extra});
const item=(objectId:string)=>({id:objectId,name:objectId,geometry:{type:'Point' as const,coordinates:[114,22.5] as [number,number]},properties:{},annotation:{ref:{setId:'set',revision:1},objectId}});
describe('frozen spatial ABC evaluator',()=>{
  it('fixes all 216 unique entries and balanced interleaving without retry options',()=>{
    const schedule=spatialSchedule();expect(schedule).toHaveLength(216);expect(new Set(schedule.map(entry=>entry.id)).size).toBe(216);
    expect(spatialCases.filter(entry=>entry.split==='development')).toHaveLength(18);expect(spatialCases.filter(entry=>entry.split==='heldout')).toHaveLength(6);
    for(const condition of ['A','B','C'])expect(schedule.filter(entry=>entry.condition===condition)).toHaveLength(72);
    expect(schedule.filter(entry=>entry.caseId==='D01').map(entry=>entry.condition).join('')).toBe('ABCB CACAB'.replaceAll(' ',''));
    expect(()=>spatialOptions(['--entry','D01-4-A','--output','/tmp/test'])).toThrow();
    expect(()=>spatialOptions(['--entry','D01-1-A','--output','/tmp/test','--retry'])).toThrow();
  });
  it('keeps independent analytic geometry expectations and evaluator answers outside business facts',()=>{
    expect(meridianDistance(1)).toBeCloseTo(111195.0802,3);expect(rectangleArea(0)).toBeCloseTo(4945738.2463,2);
    for(const entry of spatialCases){const facts=JSON.stringify(spatialCaseLayers(entry));expect(facts).not.toContain('expected');expect(facts).not.toContain('oracle');expect(facts).not.toContain('requiresSkill');}
    const allRules=new Set(spatialCases.flatMap(entry=>entry.rules));for(let i=1;i<=11;i++)expect(allRules.has(`M${i}`)).toBe(true);
  });
  it('flags any unrequested write and publication as critical',()=>{
    const actual=observation({tools:[{name:'annotation_action',args:{}}]});const score=scoreSpatialFacts(spec('D13'),actual);expect(score.criticalFailures).toContain('no_unrequested_write');
    actual.after.publications=[{}] as unknown as SpatialObservation['after']['publications'];expect(scoreSpatialFacts(spec('D13'),actual).criticalFailures).toContain('no_publication_or_adoption');
  });
  it('changes only the A snapshot and denies direct spatial Skill read',async()=>{
    const skills=[{id:'review'},{id:'spatial-analysis'}];
    const resources={snapshot:async()=>({workspaceId:'w',instructions:[],sources:[],skills}),readSkill:async(_w:string,id:string)=>({id})} as unknown as ResourceService;
    const before=await resources.snapshot('w');applySpatialCondition(resources,'A');
    expect((await resources.snapshot('w')).skills.map(skill=>skill.id)).toEqual(['review']);expect(before.skills).toHaveLength(2);
    await expect(resources.readSkill('w','spatial-analysis')).rejects.toThrow();expect(await resources.readSkill('w','review')).toEqual({id:'review'});
    const control={snapshot:async()=>before} as unknown as ResourceService;const fn=control.snapshot;applySpatialCondition(control,'B');expect(control.snapshot).toBe(fn);applySpatialCondition(control,'C');expect(control.snapshot).toBe(fn);
    expect((before as ResourceSnapshot).instructions).toEqual([]);
  });
  it('never counts a missing/unreviewed case as semantic success or removes its scheduled denominator',()=>{
    const entry={id:'D01-1-A',caseId:'D01',condition:'A' as const,split:'development',status:'recorded',score:{deterministic:'passed',criticalFailures:[],skill:{loaded:false,beforeAnalysis:false,required:false}}};
    expect(reviewedSuccess(entry)).toBe(false);expect(summarizeSpatial([entry]).A).toMatchObject({scheduled:72,executed:1,unrun:71,semanticSuccess:0,pendingReview:1});
    const review={reviewer:'independent-review',reviewedAt:'2026-10-16T00:00:00Z',objectScope:true,method:true,numericGeometry:true,claims:true,effects:true,criticalErrors:[],evidence:['model-inputs.jsonl','final-state.json']};
    expect(reviewedSuccess({...entry,review})).toBe(true);expect(reviewedSuccess({...entry,review:{...review,claims:false}})).toBe(false);
  });
  it('counts a first-turn successful Skill read across D11 follow-up and rejects late/failed/incorrect-version reads',()=>{
    const read:PublicMessage={id:'skill',role:'tool',toolName:'skill.read',requestId:'first',text:JSON.stringify({id:'spatial-analysis',hash:'frozen'})};
    const analysis:PublicMessage={id:'analysis',role:'tool',toolName:'spatial_analyze',requestId:'first',text:''};
    const followup:PublicMessage={id:'followup',role:'tool',toolName:'spatial_analyze',requestId:'second',text:''};
    const resources=[{requestId:'first',readSkills:[{id:'spatial-analysis',hash:'frozen'}]},{requestId:'second',readSkills:[]}];
    expect(spatialSkillEvidence([read,analysis,followup],resources,'frozen')).toEqual({loaded:true,beforeAnalysis:true});
    expect(spatialSkillEvidence([analysis,read,followup],resources,'frozen')).toEqual({loaded:true,beforeAnalysis:false});
    expect(spatialSkillEvidence([{...read,isError:true},analysis],resources,'frozen')).toEqual({loaded:false,beforeAnalysis:false});
    expect(spatialSkillEvidence([read,analysis],resources,'changed')).toEqual({loaded:false,beforeAnalysis:false});
    expect(spatialSkillEvidence([read,analysis],[], 'frozen')).toEqual({loaded:false,beforeAnalysis:false});
  });
  it('retains attempted missing-output and preparation failures in all 216 denominators',()=>{
    expect(spatialEntryStatus({status:'recorded',providerCalls:1},true,true)).toBe('source_drift');
    expect(spatialEntryStatus(undefined,false)).toBe('unrun');expect(spatialEntryStatus(undefined,true)).toBe('missing_result');
    expect(spatialEntryStatus({status:'incomplete',providerCalls:0},true)).toBe('preparation_failed');
    expect(spatialEntryStatus({status:'incomplete',providerCalls:1},true)).toBe('incomplete');
    const base={caseId:'D01',condition:'A' as const,split:'development'};
    const report=summarizeSpatial([{...base,id:'one',status:'preparation_failed',providerCalls:0},{...base,id:'two',status:'missing_result'},{...base,id:'three',status:'incomplete',providerCalls:1}]);
    expect(report.A).toMatchObject({scheduled:72,attempted:3,modelExecuted:1,modelExecutionUnknown:1,preparationFailed:1,missingResults:1,unrun:69,semanticSuccess:0});
    expect(report.B).toMatchObject({scheduled:72,unrun:72});expect(report.C).toMatchObject({scheduled:72,unrun:72});
  });
  it('hashes HTTP/auth, mock source, helper scripts and controlled seat/Skill fixtures as well as spatial workers',async()=>{
    const files=(await spatialEvidenceHashes()).map(entry=>entry.file);
    for(const file of ['src/server/app.ts','src/spatial/worker.ts','scripts/mock-context/server.ts','scripts/probe-spatial-evaluation.ts','fixtures/seat-responsibilities/planning.md','fixtures/skills/spatial-analysis/SKILL.md','package-lock.json'])expect(files).toContain(file);
    expect(files.some(file=>file.includes('node_modules')||file.includes('.env'))).toBe(false);
  });
  it('counts a fixed result read as the same computation, not a new buffer',()=>{
    const r=result('buffer');expect(uniqueSpatialResults([{id:'one',role:'tool',text:'',spatialResult:r},{id:'two',role:'tool',text:'',spatialResult:structuredClone(r)}])).toEqual([r]);
  });
  it('retains original result order across valid reads and rejects same-ref evidence replacement before scoring',()=>{
    const buffer=result('buffer',{resultRef:'spatial:first:buffer',geometry:{type:'Point',coordinates:[114,22.5]}});
    const filtered=result('filter',{resultRef:'spatial:first:filter',scope:[{kind:'result',resultRef:buffer.resultRef,geometry:true}]});
    const read={...structuredClone(buffer),delivery:{requestId:'second',toolCallId:'read'}};
    const message=(id:string,spatialResult:SpatialResult):PublicMessage=>({id,role:'tool',toolName:'spatial_analyze',text:'',spatialResult});
    const history=[message('buffer',buffer),message('filter',filtered)];
    const collected=uniqueSpatialResults([...history,message('read',read)]);
    expect(collected.map(item=>item.resultRef)).toEqual([buffer.resultRef,filtered.resultRef]);
    expect(collected[0].delivery).toEqual(read.delivery);
    for(const changed of [{...read,geometry:{type:'Point' as const,coordinates:[115,22.5] as [number,number]}},{...read,scope:[{kind:'result' as const,resultRef:'spatial:forged:call',geometry:true}]},{...read,items:[item('forged')]}]){
      expect(()=>uniqueSpatialResults([...history,message('altered-read',changed)])).toThrow('Conflicting evidence');
    }
  });
  it('deduplicates actual provider call IDs across repeated history while retaining parameters',()=>{
    const payload={messages:[{role:'assistant',content:null,tool_calls:[{id:'x',function:{name:'spatial_analyze',arguments:'{"operation":"nearest"}'}}]}]};
    expect(providerToolCalls([payload,payload])).toEqual([{toolCallId:'x',name:'spatial_analyze',args:{operation:'nearest'}}]);
  });
});
