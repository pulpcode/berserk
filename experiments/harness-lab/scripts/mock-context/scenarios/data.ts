import { executionRoutingParameters, simulationAccessCorridors } from './routing.js';
import { areaRings, hydrantPositions, roadRows, sitePositions, stationPositions } from './geography.js';
import { createHash } from 'node:crypto';
import type { ContextRef, InformationReport, SituationObject, Position } from '../../../src/contracts/context.js';
import type { ScenarioDefinitionSummary, ScenarioStepSummary, ScenarioTaskDefinition, ScenarioTaskBootstrap } from '../../../src/contracts/scenarios.js';

export interface SceneNotice { systemId: 'intel' | 'situation'; reportId: string; title: string; text: string; occurredAt: string }
export interface SceneStep { summary: ScenarioStepSummary; objects: SituationObject[]; reports: InformationReport[]; notices: SceneNotice[] }
export interface SceneWorld { objects: SituationObject[]; reports: InformationReport[]; steps: SceneStep[]; tasks: ScenarioTaskDefinition[] }
export const businessAt = (time: string) => `2026-11-03T${time}:00+08:00`;
const areaNames = ['临港','东城','西城','北城','南湾','新区'];
const vehicleRows: Array<[string, number, string, string, string]> = [
  ['V01',0,'water_tanker','S01','可用'],['V02',0,'water_tanker','L02','交通救援占用至10:00'],['V03',0,'foam','S01','可用'],['V04',0,'foam','S01','检修预计11:00完成，须确认'],['V05',0,'ladder','L03','演练占用至09:45'],['V06',0,'rescue','S01','可用'],
  ['V07',1,'water_tanker','S02','可用'],['V08',1,'water_tanker','S02','可用'],['V09',1,'foam','S02','可用'],['V10',1,'ladder','S02','可用'],['V11',1,'communications','S02','可用'],
  ['V12',2,'water_tanker','S03','例行检查，最早09:40，须完成确认'],['V13',2,'water_tanker','S03','可用'],['V14',2,'rescue','L02','交通救援占用至10:00'],['V15',2,'logistics','S03','可用'],
  ['V16',3,'water_tanker','S04','可用'],['V17',3,'water_tanker','S04','可用'],['V18',3,'ladder','S04','可用'],['V19',3,'communications','S04','可用'],
  ['V20',4,'water_tanker','S05','可用'],['V21',4,'rescue','S05','南湾留守，跨区支援需确认'],['V22',4,'logistics','S05','可用'],['V23',5,'water_tanker','S06','可用'],['V24',5,'foam','S06','最后08:50记录，当前状态与位置待确认'],
];
const typeNames: Record<string,string> = {water_tanker:'水罐车',foam:'泡沫车',ladder:'登高车',rescue:'抢险救援车',communications:'通信车',logistics:'后勤车'};
const unavailableUntil: Record<string,string> = {V02:'10:00',V04:'11:00',V05:'09:45',V12:'09:40',V14:'10:00'};
export function sceneWorld(instanceId: string): SceneWorld {
  const ref = (type: string,id: string): ContextRef => ({systemId:'situation',objectType:type,objectId:`${instanceId}-${id}`});
  const area = (index:number) => `${instanceId}-A${String(index+1).padStart(2,'0')}`;
  const evidence = (objectRef:ContextRef,revision=1) => [{kind:'source' as const,ref:objectRef,revision}];
  const position = (id:string):Position => id.startsWith('S') ? stationPositions[Number(id.slice(1))-1] : sitePositions[id];
  const base = (type:string,id:string,name:string,index:number):SituationObject => ({ref:ref(type,id),name,revision:1,areaIds:[area(index)],effectiveAt:businessAt('09:10'),validTime:null,properties:{}});
  const objects:SituationObject[]=[];
  for(let i=0;i<6;i++) {
    const id=`S${String(i+1).padStart(2,'0')}`,r=ref('resource',id);
    objects.push({...base('resource',id,`${areaNames[i]}消防站`,i),geometry:{type:'Point',coordinates:stationPositions[i]},resourceData:{entityId:`${instanceId}-${id}`,resource:{meaning:'actual_resource',category:'facility',granularity:'individual',quantity:{value:1,unit:'处',meaning:'entities',scope:r.objectId,evidence:evidence(r)},position:{meaning:'actual',appliesTo:'resource',reportedAt:businessAt('09:10'),evidence:evidence(r)}}}});
  }
  for(const [id,index,type,location,note] of vehicleRows) {
    const r=ref('resource',id),unknown=['V21','V24'].includes(id),until=unavailableUntil[id],observed=businessAt(id==='V24'?'08:50':'09:10');
    const currentArea=location==='L02'?2:location==='L03'?0:index;
    objects.push({...base('resource',id,`${id} ${typeNames[type]}`,currentArea),geometry:{type:'Point',coordinates:position(location)},resourceData:{entityId:`${instanceId}-${id}`,resource:{meaning:'actual_resource',category:['communications','logistics'].includes(type)?'vehicle':'fire_engine',granularity:'individual',quantity:{value:1,unit:'辆',meaning:'entities',scope:`${instanceId}-vehicles`,evidence:evidence(r)},
      vehicle:{type:type as 'water_tanker'|'foam'|'ladder'|'rescue'|'communications'|'logistics',homeStationRef:ref('resource',`S${String(index+1).padStart(2,'0')}`)},
      availability:{state:unknown?'unknown':until?'unavailable':'available',effectiveAt:businessAt('09:10'),reportedAt:observed,...(until?{validUntil:businessAt(until)}:{}),evidence:[...evidence(r),{kind:'declaration',note}]},
      position:{meaning:'actual',appliesTo:'resource',reportedAt:observed,effectiveAt:observed,...(id==='V24'?{validUntil:businessAt('09:10')}:{}),evidence:evidence(r)},
    }}});
  }
  for(const [id,name,index] of [['L01','临港三号仓库',0],['L02','城西交通救援现场',2],['L03','临港登高演练场',0]] as const) {
    const r=ref('resource',id);objects.push({...base('resource',id,name,index),geometry:{type:'Point',coordinates:sitePositions[id]},resourceData:{entityId:`${instanceId}-${id}`,resource:{meaning:'actual_resource',category:'facility',granularity:'individual',quantity:{value:1,unit:'处',meaning:'entities',scope:r.objectId,evidence:evidence(r)},position:{meaning:'actual',appliesTo:'resource',reportedAt:businessAt('09:10'),evidence:evidence(r)}}}});
  }
  for(let i=0;i<8;i++) {
    const id=`H${String(i+1).padStart(2,'0')}`,index=i<4?0:i-3,r=ref('resource',id);
    objects.push({...base('resource',id,`${id} 消火栓`,index),geometry:{type:'Point',coordinates:hydrantPositions[i]},resourceData:{entityId:`${instanceId}-${id}`,resource:{meaning:'actual_resource',category:'hydrant',granularity:'individual',quantity:{value:1,unit:'个',meaning:'entities',scope:r.objectId,evidence:evidence(r)},availability:{state:'available',effectiveAt:businessAt('09:10'),reportedAt:businessAt('09:10'),evidence:evidence(r)},position:{meaning:'actual',appliesTo:'resource',reportedAt:businessAt('09:10'),evidence:evidence(r)}}}});
  }
  for(const [id,name,index,coordinates] of roadRows)objects.push({...base('road',id,name,index),geometry:{type:'LineString',coordinates},properties:{passability:'open'}});
  for(let i=0;i<6;i++) {
    const members=objects.filter(o=>o.areaIds.includes(area(i))).map(o=>o.ref);
    objects.push({...base('area',`A${String(i+1).padStart(2,'0')}`,areaNames[i],i),geometry:{type:'Polygon',coordinates:[areaRings[i]]},properties:{memberRefs:members}});
  }
  const stepRows: Array<[string,string,string,string,string[],string[]]> = [
    ['E01','09:12','首报位置待核实','社会来电称临港仓储区有烟，三号仓库与相邻仓库描述不一致，位置待核实。',['L01'],[]],
    ['E02','09:13','交通救援进展','城西交通救援仍占用V02、V14，当前尚未释放，原承诺至10:00。',['L02','V02','V14'],['V02','V14']],
    ['E03','09:14','登高演练继续','临港登高演练已批准，演练正常进行，V05继续执行既定安排，占用至09:45，释放以回报为准。',['L03','V05'],['V05']],
    ['E04','09:16','仓库位置核实','园区值班员确认烟情来自临港三号仓库。',['L01'],[]],
    ['E05','09:18','车辆资源清单确认','已核对六站二十四车清单；V24仅有08:50旧记录，当前状态与位置待确认，其余车辆状态见各车记录。',vehicleRows.map(r=>r[0]),vehicleRows.filter(r=>r[0]!=='V24').map(r=>r[0])],
    ['E06','09:19','北货运路施工','R04北货运路局部施工，限制通行。',['R04'],['R04']],
    ['E07','09:21','城北路巡查','R05城北路例行巡查确认通行正常。',['R05'],['R05']],
    ['E08','09:23','中轴桥封闭','R01中轴桥因临时事故封闭至10:00。',['R01'],['R01']],
    ['E09','09:24','旧巡查报告晚到','09:11巡查时，R01中轴桥通行正常。',['R01'],[]],
    ['E10','09:25','东环线通行确认','R02东环线当前通行正常。',['R02'],['R02']],
    ['E11','09:30','交通救援持续处置','城西交通救援仍在处置，V02与V14暂未释放。',['L02','V02','V14'],['V02','V14']],
    ['E12','09:40','现场火势趋稳','临港三号仓库现场报告火势趋稳，继续处置，尚不能确认事件结束。',['L01'],[]],
  ];
  const simulated=structuredClone(objects),steps:SceneStep[]=[];
  for(const [id,time,title,text,ids,updated] of stepRows) {
    const stamp=businessAt(time),observed=businessAt(id==='E09'?'09:11':time),updatedObjects:SituationObject[]=[];
    for(const code of updated) {
      const object=simulated.find(o=>o.ref.objectId===`${instanceId}-${code}`)!;object.revision++;object.effectiveAt=stamp;
      if(object.ref.objectType==='road')object.properties={passability:code==='R01'?'closed':code==='R04'?'restricted':'open',...(code==='R01'?{restrictionNote:'临时事故封闭至10:00'}:code==='R04'?{restrictionNote:'局部施工限制通行'}:{})};
      if(code==='R01')object.validTime={from:stamp,to:businessAt('10:00')};
      if(object.resourceData){const resource=object.resourceData.resource;if(resource.availability){resource.availability.reportedAt=stamp;resource.availability.evidence=resource.availability.evidence.map(e=>e.kind==='source'?{...e,revision:object.revision}:e);}if(resource.position)resource.position.evidence=evidence(object.ref,object.revision);if(resource.quantity)resource.quantity.evidence=evidence(object.ref,object.revision);}
      updatedObjects.push(structuredClone(object));
    }
    const objectRefs=ids.map(code=>ref(code.startsWith('R')?'road':'resource',code));
    // Report reference cap is 20; inventory membership remains available in source objects.
    const selectedRefs=objectRefs.slice(0,20),report:InformationReport={reportId:`${instanceId}-report-${id}-a`,subjectId:`${instanceId}-${id}`,revision:1,title:id==='E09'?'中轴桥巡查情况':title,summary:text,content:text,objectRefs:selectedRefs,areaIds:[...new Set(selectedRefs.flatMap(r=>simulated.find(o=>o.ref.objectId===r.objectId)?.areaIds??[]))],observedAt:observed,publishedAt:stamp,validTime:id==='E09'?{from:observed,to:businessAt('09:12')}:null};
    const reports=[report];
    if(id==='E04')reports.push({...structuredClone(report),reportId:`${instanceId}-report-${id}-b`,title:'无人机确认仓库位置',summary:'无人机观测支持三号仓库位置判断。',content:'无人机在09:16观测到临港三号仓库烟情，位置与园区值班员报告一致。'});
    const systemId=['E06','E07','E08','E10'].includes(id)?'situation':'intel';
    steps.push({summary:{id,title,description:text,businessTime:stamp,messageCount:reports.length},objects:updatedObjects,reports,notices:reports.map(r=>({systemId,reportId:r.reportId,title:r.title,text:`${r.summary}\n观测时间：${r.observedAt}。报告 intel/${r.reportId}，修订${r.revision}。`,occurredAt:observed}))});
  }
  const tasks:ScenarioTaskDefinition[]=[
    {code:'T02',title:'城西交通救援',goal:'09:00—10:00开展城西交通救援，V02/V14仍在作业，释放以来源回报为准；不经过R01/R02/R03。',businessRefs:[ref('resource','L02'),ref('resource','V02'),ref('resource','V14')],areaIds:[area(2)]},
    {code:'T03',title:'临港登高演练',goal:'09:00—09:45开展已批准的临港登高演练，V05继续既定安排，之后释放以回报为准。',businessRefs:[ref('resource','L03'),ref('resource','V05')],areaIds:[area(0)]},
  ];
  return {objects,reports:[],steps,tasks};
}
/** Director navigation only; excluded from world facts, definition hashes and notifications. */
export const directorStepTasks: Record<string, ScenarioTaskDefinition['code'][]> = {
  E01:[], E02:['T02'], E03:['T03'], E04:[], E05:['T02','T03'],
  E06:[], E07:[], E08:[], E09:[], E10:[], E11:['T02'], E12:[],
};
const definitionHash=createHash('sha256').update(JSON.stringify(sceneWorld('definition'))).digest('hex');
export const scenarioDefinition:ScenarioDefinitionSummary={id:'harbor-fire',version:'4',name:'临港仓储火情',description:'虚构城市澜江市六站二十四车的来源事件演示。',definitionHash,businessDay:'2026-11-03',initialBusinessNow:businessAt('09:10'),modes:['main_story','source_replay'],counts:{vehicles:24,objects:53,resources:41,steps:12,messages:13},geography:{label:'上海临港实景上的消防演示',attribution:'道路、建筑锚点及街区几何 © OpenStreetMap contributors（ODbL）。消防设施、辖区、车辆和路况为演示设定。',bounds:[121.76,30.82,121.96,30.98],synthetic:true}};

export const taskBootstrap:ScenarioTaskBootstrap={schemaVersion:2,definitionId:'harbor-fire',definitionVersion:'4',definitionHash,expectedTaskCodes:['T02','T03']};

/** V5 adds parameter-driven execution; V4 facts/hash remain addressable unchanged. */
export const executionDefinition:ScenarioDefinitionSummary={...scenarioDefinition,version:'5',description:'支持车辆指令、确定性行进与执行反馈的合成场景。',definitionHash:createHash('sha256').update(JSON.stringify({definitionHash,executionRoutingParameters,simulationAccessCorridors})).digest('hex')};
export const executionBootstrap:ScenarioTaskBootstrap={...taskBootstrap,definitionVersion:'5',definitionHash:executionDefinition.definitionHash};

/** V6 changes notification facts and history read projection, never motion parameters. */
export const repairedExecutionDefinition:ScenarioDefinitionSummary={...executionDefinition,version:'6',description:'逐车执行事实反馈与轻量历史查询的合成场景。',definitionHash:createHash('sha256').update(JSON.stringify({executionHash:executionDefinition.definitionHash,feedbackVersion:2,historyView:'state'})).digest('hex')};
export const repairedExecutionBootstrap:ScenarioTaskBootstrap={...executionBootstrap,definitionVersion:'6',definitionHash:repairedExecutionDefinition.definitionHash};
