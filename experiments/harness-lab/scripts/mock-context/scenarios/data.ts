import { createHash } from 'node:crypto';
import type { ContextRef, InformationReport, SituationObject, Position } from '../../../src/contracts/context.js';
import type { ScenarioDefinitionSummary, ScenarioStepSummary, ScenarioTaskDefinition } from '../../../src/contracts/scenarios.js';

export interface SceneNotice { systemId: 'intel' | 'situation'; reportId: string; title: string; text: string; occurredAt: string }
export interface SceneStep { summary: ScenarioStepSummary; objects: SituationObject[]; reports: InformationReport[]; notices: SceneNotice[] }
export interface SceneWorld { objects: SituationObject[]; reports: InformationReport[]; steps: SceneStep[]; tasks: ScenarioTaskDefinition[] }
export const businessAt = (time: string) => `2026-11-03T${time}:00+08:00`;
const centers: Position[] = [[121.84,30.88],[121.90,30.90],[121.79,30.90],[121.85,30.96],[121.80,30.86],[121.93,30.96]];
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
const sitePositions: Record<string,Position> = {L01:[121.855,30.883],L02:[121.803,30.892],L03:[121.825,30.883]};
const roadRows: Array<[string,string,number,Position[]]> = [
  ['R01','中轴桥',0,[[121.82,30.895],[121.85,30.895],[121.88,30.895]]],['R02','东环线',1,[[121.90,30.90],[121.914,30.89],[121.897,30.875],[121.855,30.883]]],
  ['R03','滨港路',0,[[121.84,30.88],[121.855,30.883],[121.875,30.878]]],['R04','北货运路',3,[[121.82,30.965],[121.85,30.96],[121.88,30.965]]],
  ['R05','城北路',3,[[121.85,30.96],[121.89,30.955],[121.93,30.96]]],['R06','南湾支路',4,[[121.785,30.86],[121.80,30.86],[121.817,30.865]]],
];

/** All coordinates below are synthetic business overlays, not real road/vehicle observations. */
export function sceneWorld(instanceId: string): SceneWorld {
  const ref = (type: string,id: string): ContextRef => ({systemId:'situation',objectType:type,objectId:`${instanceId}-${id}`});
  const area = (index:number) => `${instanceId}-A${String(index+1).padStart(2,'0')}`;
  const evidence = (objectRef:ContextRef,revision=1) => [{kind:'source' as const,ref:objectRef,revision}];
  const position = (id:string):Position => id.startsWith('S') ? centers[Number(id.slice(1))-1] : sitePositions[id];
  const base = (type:string,id:string,name:string,index:number):SituationObject => ({ref:ref(type,id),name,revision:1,areaIds:[area(index)],effectiveAt:businessAt('09:10'),validTime:null,properties:{}});
  const objects:SituationObject[]=[];
  for(let i=0;i<6;i++) {
    const id=`S${String(i+1).padStart(2,'0')}`,r=ref('resource',id);
    objects.push({...base('resource',id,`${areaNames[i]}消防站`,i),geometry:{type:'Point',coordinates:centers[i]},resourceData:{entityId:`${instanceId}-${id}`,resource:{meaning:'actual_resource',category:'facility',granularity:'individual',quantity:{value:1,unit:'处',meaning:'entities',scope:r.objectId,evidence:evidence(r)},position:{meaning:'actual',appliesTo:'resource',reportedAt:businessAt('09:10'),evidence:evidence(r)}}}});
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
    const id=`H${String(i+1).padStart(2,'0')}`,index=i<4?0:i-3,r=ref('resource',id),center=centers[index];
    objects.push({...base('resource',id,`${id} 消火栓`,index),geometry:{type:'Point',coordinates:[center[0]+0.002*(i%3+1),center[1]+0.0015*(i%2+1)]},resourceData:{entityId:`${instanceId}-${id}`,resource:{meaning:'actual_resource',category:'hydrant',granularity:'individual',quantity:{value:1,unit:'个',meaning:'entities',scope:r.objectId,evidence:evidence(r)},availability:{state:'available',effectiveAt:businessAt('09:10'),reportedAt:businessAt('09:10'),evidence:evidence(r)},position:{meaning:'actual',appliesTo:'resource',reportedAt:businessAt('09:10'),evidence:evidence(r)}}}});
  }
  for(const [id,name,index,coordinates] of roadRows)objects.push({...base('road',id,name,index),geometry:{type:'LineString',coordinates},properties:{passability:'open'}});
  for(let i=0;i<6;i++) {
    const [x,y]=centers[i],members=objects.filter(o=>o.areaIds.includes(area(i))).map(o=>o.ref);
    objects.push({...base('area',`A${String(i+1).padStart(2,'0')}`,areaNames[i],i),geometry:{type:'Polygon',coordinates:[[[x-.023,y-.016],[x+.023,y-.016],[x+.023,y+.016],[x-.023,y+.016],[x-.023,y-.016]]]},properties:{memberRefs:members}});
  }
  const stepRows: Array<[string,string,string,string,string[],string[]]> = [
    ['E01','09:12','首报位置待核实','社会来电称临港仓储区有烟，三号仓库与相邻仓库描述不一致，位置待核实。',['L01'],[]],
    ['E02','09:13','交通救援进展','T02交通救援仍占用V02、V14，当前尚未释放，原承诺至10:00。',['L02','V02','V14'],['V02','V14']],
    ['E03','09:14','登高演练继续','T03已批准演练正常进行，V05继续执行既定安排，占用至09:45，释放以回报为准。',['L03','V05'],['V05']],
    ['E04','09:16','仓库位置核实','园区值班员确认烟情来自临港三号仓库。',['L01'],[]],
    ['E05','09:18','车辆资源清单确认','资源来源核对六站二十四车清单；V24仅有08:50旧记录，当前状态与位置待确认，其余状态按各车来源记录。',vehicleRows.map(r=>r[0]),vehicleRows.filter(r=>r[0]!=='V24').map(r=>r[0])],
    ['E06','09:19','北货运路施工','R04北货运路局部施工限制通行，限制影响其自身路段。',['R04'],['R04']],
    ['E07','09:21','城北路巡查','R05城北路例行巡查确认通行正常。',['R05'],['R05']],
    ['E08','09:23','中轴桥封闭','R01中轴桥因临时事故封闭至10:00。本次来源只提供道路状态，不提供车辆调派或过桥结论。',['R01'],['R01']],
    ['E09','09:24','旧巡查报告晚到','延迟送达巡查报告：R01中轴桥在09:11观测时畅通。该记录描述旧时刻，不修改09:23封闭事实。',['R01'],[]],
    ['E10','09:25','东环线通行确认','道路来源确认R02东环线当前通行正常。',['R02'],['R02']],
    ['E11','09:30','交通救援持续处置','T02交通事件仍在处置，V02与V14暂未释放，原占用未因其他任务而改变。',['L02','V02','V14'],['V02','V14']],
    ['E12','09:40','现场火势趋稳','临港三号仓库现场报告火势趋稳、继续处置，尚不能确认事件结束；本报告不证明本系统完成调派或支援到场。',['L01'],[]],
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
    const selectedRefs=objectRefs.slice(0,20),report:InformationReport={reportId:`${instanceId}-report-${id}-a`,subjectId:`${instanceId}-${id}`,revision:1,title,summary:text,content:text,objectRefs:selectedRefs,areaIds:[...new Set(selectedRefs.flatMap(r=>simulated.find(o=>o.ref.objectId===r.objectId)?.areaIds??[]))],observedAt:observed,publishedAt:stamp,validTime:id==='E09'?{from:observed,to:businessAt('09:12')}:null};
    const reports=[report];
    if(id==='E04')reports.push({...structuredClone(report),reportId:`${instanceId}-report-${id}-b`,title:'无人机确认仓库位置',summary:'无人机观测支持三号仓库位置判断。',content:'无人机在09:16观测到临港三号仓库烟情，位置与园区值班员报告一致。'});
    const systemId=['E06','E07','E08','E10'].includes(id)?'situation':'intel';
    steps.push({summary:{id,title,description:text,businessTime:stamp,messageCount:reports.length},objects:updatedObjects,reports,notices:reports.map(r=>({systemId,reportId:r.reportId,title:r.title,text:`模拟场景 ${instanceId}；投放时场景时间 ${stamp}；观测时间 ${r.observedAt}。报告 intel/${r.reportId} 修订1：${r.summary} 请通过来源查询核对正文与对象。`,occurredAt:observed}))});
  }
  const tasks:ScenarioTaskDefinition[]=[
    {code:'T01',title:'临港三号仓库火情',goal:`模拟场景：09:35前到齐4水罐+1泡沫+1抢险救援+1通信车。现场关注范围仅临港。支援检索范围为situation来源的本实例六个区域：${areaNames.map((_name,index)=>area(index)).join('、')}；先按此明确范围查询六站车辆。全部可读不等于与本任务相关或已分配，初始无车辆分配。来源只提供事实，方案须由人员决定；业务判断采用查询返回的场景时间。`,businessRefs:[ref('resource','L01')],areaIds:[area(0)]},
    {code:'T02',title:'城西交通救援',goal:'模拟场景：09:00—10:00交通救援，V02/V14仍在作业，释放以来源回报为准；不经过R01/R02/R03。业务判断采用查询返回的场景时间。',businessRefs:[ref('resource','L02'),ref('resource','V02'),ref('resource','V14')],areaIds:[area(2)]},
    {code:'T03',title:'临港登高演练',goal:'模拟场景：09:00—09:45已批准演练，V05继续既定安排，之后释放以回报为准。业务判断采用查询返回的场景时间。',businessRefs:[ref('resource','L03'),ref('resource','V05')],areaIds:[area(0)]},
  ];
  return {objects,reports:[],steps,tasks};
}
/** Director navigation only; excluded from world facts, definition hashes and notifications. */
export const directorStepTasks: Record<string, ScenarioTaskDefinition['code'][]> = {
  E01:['T01'], E02:['T02'], E03:['T03'], E04:['T01'], E05:['T01','T02','T03'],
  E06:['T01'], E07:['T01'], E08:['T01'], E09:['T01'], E10:['T01'], E11:['T02'], E12:['T01'],
};
const definitionHash=createHash('sha256').update(JSON.stringify(sceneWorld('definition'))).digest('hex');
export const scenarioDefinition:ScenarioDefinitionSummary={id:'harbor-fire',version:'1',name:'临港仓储火情',description:'虚构城市澜江市六站二十四车的来源事件演示。',definitionHash,businessDay:'2026-11-03',initialBusinessNow:businessAt('09:10'),modes:['main_story','source_replay'],counts:{vehicles:24,objects:53,resources:41,steps:12,messages:13},geography:{label:'临港周边底图上的合成业务覆盖层',attribution:'业务对象和线面坐标均为合成演示数据，不代表真实道路、设施或路况；底图署名沿用地图来源。',bounds:[121.76,30.82,121.96,30.98],synthetic:true}};
