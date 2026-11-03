import {buildFixture as oldBuild,type AcceptanceFixture as OldFixture} from '../11-03-resource-independent-acceptance/fixtures.js';
import {fixtureCase,type CaseId} from './cases.js';
export type AcceptanceFixture=Omit<OldFixture,'caseId'> & {caseId:CaseId};
export function buildFixture(id:CaseId,taskId:string,t0:string):AcceptanceFixture {
 const f:AcceptanceFixture={...oldBuild(fixtureCase[id],taskId,t0),caseId:id};
 if(id==='P01'){
  f.annotationLayers=f.annotationLayers.map(layer=>layer.layerId==='n08-target'?{...layer,name:'测试图层',features:layer.features.filter(x=>['n08-car','n08-boat'].includes(x.objectId))}:layer);
  f.objects=[];f.systems=[];f.contextAreas=[];
 }
 return f;
}
