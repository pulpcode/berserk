/** Read-only evidence audit; no provider calls and no historical score changes. */
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {sourceFreeze} from '../r6-20261022/live.ts';
import {repo,digest,hashes} from '../r6-20261022/runtime.ts';
import {cases,schedule} from '../r6-20261022/cases.ts';
const dest=dirname(fileURLToPath(import.meta.url)),batch=join(repo,'.local/spatial-r6/r6-20261022-01'),read=p=>JSON.parse(readFileSync(p,'utf8'));
const protocol=read(join(batch,'protocol.json')),runs=read(join(batch,'runs.json')),attempts=read(join(batch,'attempts.json')),budget=read(join(batch,'budget.json'));
assert.deepEqual(await sourceFreeze(),protocol.source,'Frozen implementation drift');
assert.deepEqual(protocol.schedule,schedule);assert.equal(runs.length,12);assert.equal(runs.filter(r=>r.status==='not_executed'||r.status==='interrupted').length,0);
assert.ok(attempts.every(a=>a.completed&&a.status===200&&!a.error));
assert.deepEqual(budget,{requests:attempts.length,input:attempts.reduce((s,a)=>s+a.usage.prompt_tokens,0),output:attempts.reduce((s,a)=>s+a.usage.completion_tokens,0),unknownUsage:0});
const haversine=(a,b)=>{const rad=Math.PI/180,dlat=(b[1]-a[1])*rad,dlon=(b[0]-a[0])*rad,h=Math.sin(dlat/2)**2+Math.cos(a[1]*rad)*Math.cos(b[1]*rad)*Math.sin(dlon/2)**2;return 6371008.8*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));};
const audit=[];let evidenceFiles=0;
for(const run of runs){
 const dir=join(batch,run.id),r=read(join(dir,'review.json')),stored=read(join(dir,'evidence-hashes.json'));
 for(const [name,hash] of Object.entries(stored)){assert.equal(digest(readFileSync(join(dir,name))),hash);evidenceFiles++;}
 const calls=attempts.filter(a=>a.entry===run.id),target=cases.find(c=>c.id===run.caseId).targetSkill;
 const exposure=calls.map(a=>read(join(dir,`provider-${String(a.id).padStart(4,'0')}-loading.json`)));
 const firstTurns=[...new Set(exposure.filter(e=>e.parent).map(e=>e.turn))].map(t=>exposure.find(e=>e.parent&&e.turn===t));
 assert.ok(firstTurns.every(e=>e.skills[target].bodyPresent));
 let effect;
 if(run.caseId!=='D16'){assert.deepEqual(r.after,r.fixture.before);effect={fullMapUnchanged:true};}
 else{
  assert.equal(r.conflictInjected,true);
  const injection=read(join(dir,'injected-conflict.json')),old=injection.after.version.document.layers.flatMap(l=>l.features),now=r.after.version.document.layers.flatMap(l=>l.features),ids=new Set(old.map(f=>f.objectId));
  for(const f of old)assert.deepEqual(now.find(x=>x.objectId===f.objectId),f);
  const added=now.filter(f=>!ids.has(f.objectId));assert.equal(added.length,1);assert.equal(added[0].name,'临时范围');assert.ok(r.after.version.document.layers.find(l=>l.layerId==='derived').features.some(f=>f.objectId===added[0].objectId));
  const buffer=r.final.messages.find(m=>m.spatialResult?.operation==='buffer').spatialResult;assert.deepEqual(added[0].geometry,buffer.geometry);
  assert.equal(now.find(f=>f.objectId==='origin').note,'外部已核实，请保留');
  assert.deepEqual(r.after.publications,r.fixture.before.publications);assert.deepEqual(r.after.current,r.fixture.before.current);
  assert.deepEqual(read(join(dir,'turn-1.json')).after,r.fixture.before);
  effect={firstPreviewUnchanged:true,exactGeometry:true,externalNoteRetained:true,allPriorObjectsUnchangedFromInjectedVersion:true,publishedOrAdopted:false,addedId:added[0].objectId,vertices:buffer.geometry.coordinates[0].length};
 }
 const toolCalls=calls.flatMap(a=>a.tools.map(t=>({...t,args:JSON.parse(t.arguments)})));
 let geometryOracle;
 if(run.caseId==='D17'){
  const features=r.fixture.before.version.document.layers.flatMap(l=>l.features),ring=features.find(f=>f.objectId==='region').geometry.coordinates[0],xs=ring.map(p=>p[0]),ys=ring.map(p=>p[1]),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  const positions=Object.fromEntries(r.fixture.before.version.document.layers.find(l=>l.layerId==='resources').features.map(f=>{const [x,y]=f.geometry.coordinates;return [f.objectId,x<minX||x>maxX||y<minY||y>maxY?'exterior':x===minX||x===maxX||y===minY||y===maxY?'boundary':'interior'];}));
  assert.deepEqual(positions,{r1:'boundary',r2:'interior',r3:'interior',edge:'boundary',outside:'exterior'});
  for(const m of r.final.messages.filter(m=>m.spatialResult?.operation==='classify_points'))assert.deepEqual(Object.fromEntries(m.spatialResult.classifications.map(c=>[JSON.parse(c.itemId)[2],c.position])),positions);
  geometryOracle={positions,widthSouthM:haversine([minX,minY],[maxX,minY]),widthNorthM:haversine([minX,maxY],[maxX,maxY]),heightM:haversine([minX,minY],[minX,maxY])};
 }
 const ordinary=run.caseId==='D11';let choice;
 if(ordinary){const gate=read(join(dir,'clarification-gate.json')),decision=read(join(dir,'decision.json'));const {status,gateHash,decisionPath,instructions,...body}=gate;
  assert.equal(digest(JSON.stringify(body)),gateHash);assert.equal(digest(JSON.stringify(gate.snapshot)),gate.snapshotHash);assert.equal(decision.gateHash,gateHash);assert.equal(decision.approve,true);
  const replies=r.apiAnswered?r.interactions.filter(i=>i.resolved?.status==='answered'):r.final.messages.filter(m=>m.role==='user'&&m.text===gate.answer);
  assert.equal(replies.length,1);assert.equal(gate.snapshot.messages.filter(m=>m.toolName==='spatial_analyze').length,0);
  const features=r.fixture.before.version.document.layers.flatMap(l=>l.features),distance=haversine(features.find(f=>f.objectId==='origin').geometry.coordinates,features.find(f=>f.objectId==='amb-b').geometry.coordinates);assert.ok(Math.abs(distance-r.truth.distanceM)<1e-8);
  choice={channel:gate.channel,actualReplies:replies.length,gateBound:true,distanceOracle:r.truth.distanceM};
 }
 audit.push({entryId:run.id,status:run.status,stop:run.stop??null,requests:calls.length,input:calls.reduce((s,a)=>s+a.usage.prompt_tokens,0),output:calls.reduce((s,a)=>s+a.usage.completion_tokens,0),tools:toolCalls.length,firstTurns: firstTurns.map(e=>({turn:e.turn,request:e.request,target,bodyPresent:e.skills[target].bodyPresent})),allParentRequestsHaveTarget:exposure.filter(e=>e.parent).every(e=>e.skills[target].bodyPresent),exposedMethods:[...new Set(exposure.flatMap(e=>Object.entries(e.skills).filter(([,s])=>s.bodyPresent).map(([id])=>id)))],nameQueryCalls:toolCalls.filter(t=>t.name==='annotation_read'&&t.args.objectNames).length,classifyCalls:toolCalls.filter(t=>t.name==='spatial_analyze'&&t.args.operation==='classify_points').length,effect,...(choice?{choice}:{}),...(geometryOracle?{geometryOracle}:{}),transcriptHash:digest(readFileSync(join(dir,'review.json')))});
}
const runtimes=[];
for(const build of readdirSync(join(batch,'runtime-builds'))){for(const group of ['E0','E1','E2']){
 const dir=join(batch,'runtime-builds',build,'runtimes',group),integrity=read(join(dir,'runtime-integrity.json')),actual=await hashes(dir);
 for(const [p,h] of Object.entries(integrity.after))assert.equal(actual[p],h);
 runtimes.push({group,archiveHash:integrity.archiveHash,allowedDiff:integrity.allowedDiff});
}}
assert.equal(new Set(runtimes.map(r=>r.archiveHash)).size,1);
const result={at:new Date().toISOString(),batch:'.local/spatial-r6/r6-20261022-01',frozenSourceUnchanged:true,evidenceFilesVerified:evidenceFiles,planned:12,executed:12,technicalInterruptions:0,protocolRecorded:runs.filter(r=>r.status==='recorded').length,unnecessaryInteractionStopped:runs.filter(r=>r.status==='interaction_recorded').map(r=>r.id),budget,runtimes,rows:audit};
writeFileSync(join(dest,'r6-evidence-audit-20261022.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
