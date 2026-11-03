/** Synthetic business facts from reviewed cases.md. Platform clocks/receipts are supplied by the runner. */
import type {AnnotationFeature,AnnotationLayer} from '../../../experiments/harness-lab/src/contracts/annotations.js';
import type {ContextRef,Position,SituationObject,SituationResourceCoverage} from '../../../experiments/harness-lab/src/contracts/context.js';
import type {ResourceEvidence,ResourceSourceCapability,TaskResource} from '../../../experiments/harness-lab/src/contracts/task-resources.js';
import type {CaseId} from './cases.js';

export interface FixtureSystem {
  id:string; name:string; resourceCapability:ResourceSourceCapability; coverage:SituationResourceCoverage;
  pageLimit?:number;
  /** N05 synthetic source snapshot clock, returned by the real HTTP endpoint. Otherwise use actual initial source snapshot time. */
  asOf?:string;
}
export interface AcceptanceFixture {
  caseId:CaseId; taskId:string; t0:string; systems:FixtureSystem[]; objects:SituationObject[];
  businessRefs:ContextRef[]; annotationLayers:AnnotationLayer[];
  controlledImports:Array<{objectId:string;sourceRef:ContextRef;layerId:string;name:string}>;
  contextAreas:Array<{id:string;name:string}>;
}
type Relation=NonNullable<TaskResource['taskRelations']>[number]['relation'];
type Availability=NonNullable<TaskResource['availability']>['state'];
type FactBasis=Pick<NonNullable<TaskResource['quantity']>,'evidence'|'reportedAt'|'effectiveAt'|'validUntil'>;
const ref=(systemId:string,objectId:string):ContextRef=>({systemId,objectType:'resource',objectId});
const at=(t0:string,minutes:number)=>new Date(Date.parse(t0)+minutes*60_000).toISOString();
const capability=(systemId:string):ResourceSourceCapability=>({systemId,categories:['vehicle','rescue_boat'],units:['辆','艘'],relations:['assigned','related','potential_support','unconfirmed'],filters:['category','task','relation'],taskIdMapping:'identity',supportRule:{id:'explicit-task-relation',description:'仅当记录为同一 taskId 明确声明 potential_support 时视作潜在支援，空间接近、平台引用和 related 不产生支援关系'},pagination:'cursor',snapshot:'fixed_revision'});
const system=(id:string,name:string,coverage:SituationResourceCoverage={status:'complete'},pageLimit?:number):FixtureSystem=>({id,name,resourceCapability:capability(id),coverage,...(pageLimit?{pageLimit}:{})});
const point=(objectId:string,name:string,coordinates:Position,resource?:TaskResource):AnnotationFeature=>({objectId,kind:'point',name,geometry:{type:'Point',coordinates},...(resource?{resource}:{})});
const rectangle=(objectId:string,name:string,w:number,s:number,e:number,n:number,note?:string):AnnotationFeature=>({objectId,kind:'polygon',name,geometry:{type:'Polygon',coordinates:[[[w,s],[e,s],[e,n],[w,n],[w,s]]]},...(note?{note}:{})});
const layer=(layerId:string,name:string,features:AnnotationFeature[],order=0):AnnotationLayer=>({layerId,name,features,order,defaultVisible:true});

/** t0 must come from a recorded real clock read BEFORE seeding. No Date.now fallback. */
export function buildFixture(caseId:CaseId,taskId:string,t0:string):AcceptanceFixture {
  if(!Number.isFinite(Date.parse(t0)))throw new Error('Fixture requires an actual recorded T0 ISO time');
  const f:AcceptanceFixture={caseId,taskId,t0,systems:[],objects:[],businessRefs:[],annotationLayers:[],controlledImports:[],contextAreas:[]};
  const basis=(source?:ContextRef,note?:string,reported=-5,effective=-10):FactBasis=>({
    evidence:[...(source?[{kind:'source' as const,ref:source,revision:1}]:[{kind:'declaration' as const,note:'合成验收声明'}]),...(note?[{kind:'declaration' as const,note}]:[])],
    reportedAt:at(t0,reported),effectiveAt:at(t0,effective),validUntil:at(t0,1440),
  });
  const declaration=(scope:string,source?:ContextRef,boat=false,relation:Relation='unconfirmed',state:Availability='available'):TaskResource=>({
    meaning:'actual_resource',category:boat?'rescue_boat':'vehicle',granularity:'individual',
    quantity:{value:1,unit:boat?'艘':'辆',meaning:'entities',scope,...basis(source)},
    taskRelations:[{taskId,relation,...basis(source)}],availability:{state,...basis(source)},position:{meaning:'actual',appliesTo:'resource',...basis(source)},
  });
  const resource=(systemId:string,objectId:string,entityId:string,name:string,xy:Position|null,scope:string,boat=false,relation:Relation='unconfirmed',state:Availability='available'):SituationObject=>{
    const source=ref(systemId,objectId);
    return {ref:source,name,revision:1,areaIds:[],effectiveAt:at(t0,-10),validTime:{from:at(t0,-10),to:at(t0,1440)},geometry:xy?{type:'Point',coordinates:xy}:null,properties:{},resourceData:{entityId,resource:declaration(scope,source,boat,relation,state)}};
  };
  const aggregate=(systemId:string,id:string,name:string,scope:string,count:number,members:string[]|undefined,boat=false,xy:Position|null=null):SituationObject=>{
    const o=resource(systemId,id,'unused',name,xy,scope,boat,'unconfirmed','unknown');
    delete o.resourceData!.entityId;
    o.resourceData!.resource.granularity='aggregate';o.resourceData!.resource.quantity!.value=count;
    o.resourceData!.coverage={scope,complete:members!==undefined,...(members?{memberEntityIds:members}:{})};
    if(xy)o.resourceData!.resource.position!.appliesTo='site';else delete o.resourceData!.resource.position;
    return o;
  };
  const planned=(source:ContextRef|undefined,site=false):TaskResource=>({meaning:'planned_location',granularity:'individual',position:{meaning:'planned',appliesTo:site?'site':'resource',...basis(source)}});
  const area=(id:string,name:string)=>layer(`${caseId.toLowerCase()}-areas`,name,[rectangle(id,name,121,31,121.04,31.04)]);
  const imported=(source:SituationObject,objectId:string,layerId:string,name:string)=>{f.controlledImports.push({objectId,sourceRef:source.ref,layerId,name});};
  switch(caseId){
    case 'P01':
      f.annotationLayers=[layer('p01-regions','绀溪区域',[rectangle('p01-area','绀溪矩形',121,31,121.04,31.04)]),layer('p01-assets','绀溪核验图层',[
        point('p01-car','溪鹭运输车',[121.01,31.02],declaration('p01-vehicles')),
        point('p01-boat','芦汀救生艇',[121.04,31.03],declaration('p01-boats',undefined,true)),
        point('p01-out','松砾运输车',[121.05,31.02],declaration('p01-vehicles')),
        {...point('p01-plan','水榭拟设车辆位',[121.02,31.01],planned(undefined)),informationRole:'plan'},
      ],1)];break;
    case 'P02':
      f.systems=[system('p02-weiting','苇汀调度',{status:'partial',reason:'仅开放当前同步片段，任务归属尚未确认'}),system('p02-shanjia','杉岬协作',{status:'partial',reason:'仅开放当前同步片段，任务归属尚未确认'})];
      f.objects=[resource('p02-weiting','wt-cart','wt-e41','苇汀运载车',[121.011,31.013],'p02-vehicles',false,'unconfirmed','unknown'),resource('p02-shanjia','sj-boat','sj-e72','杉岬巡护艇',[121.026,31.016],'p02-boats',true)];
      for(const o of f.objects)o.resourceData!.resource.taskRelations![0].evidence.push({kind:'declaration',note:'来源未确认对应任务关系'});
      break;
    case 'P03':
      f.annotationLayers=[layer('p03-areas','南坪区域',[rectangle('p03-southwest','南坪',121,31,121.03,31.03,'西侧南坪'),rectangle('p03-southeast','南坪',121.06,31,121.09,31.03,'东侧南坪')])];
      f.systems=[system('p03-lanting','蓝汀车辆')];f.objects=[resource('p03-lanting','lt-w','lt-e11','楝影运输车',[121.015,31.015],'p03-vehicles'),resource('p03-lanting','lt-e','lt-e28','汀铃运输车',[121.075,31.015],'p03-vehicles')];break;
    case 'P04':
      f.systems=[system('p04-wuzhan','雾栈车队',{status:'complete'},2)];
      f.objects=[['11','一',121.011],['22','二',121.022],['33','三',121.033],['44','四',121.044]].map(([id,label,x])=>resource('p04-wuzhan',`wz-${id}`,`wz-e${id}`,`雾杉${label}号车`,[Number(x),31.011],'p04-vehicles'));break;
    case 'N01':
      f.annotationLayers=[area('n01-area','砾岸矩形')];
      f.systems=[system('n01-qingbu','青埠台账'),system('n01-liaowan','蓼湾调度',{status:'partial',reason:'只包含已接入站点，另有站点未同步'},1)];
      f.objects=[resource('n01-liaowan','lw-car','lw-e63','蓼湾工程车',[121.012,31.017],'n01-vehicles'),resource('n01-liaowan','lw-boat','lw-e84','蓼湾轻舟',[121.029,31.021],'n01-boats',true,'unconfirmed','unknown')];break;
    case 'N02': {
      const s='n02-luqiao',scope='n02-fleet-entire';f.systems=[system(s,'鹭桥车籍')];
      const singles:[string,string,string,Position][]=[['lq-u','lq-e17','沄桥运输车',[121.011,31.012]],['lq-v','lq-e26','澄砾运输车',[121.017,31.018]],['lq-w','lq-e39','榆汀运输车',[121.023,31.024]],['lq-k','lq-e48','荻石运输车',[121.029,31.030]],['lq-m','lq-e56','岚湾运输车',[121.035,31.036]]];
      f.objects=[aggregate(s,'lq-morning','晨组车辆汇总',scope,3,['lq-e17','lq-e26','lq-e39']),aggregate(s,'lq-evening','暮组车辆汇总',scope,4,['lq-e26','lq-e39','lq-e48','lq-e56']),...singles.map(([id,e,n,xy])=>resource(s,id,e,n,xy,scope))];
      f.annotationLayers=[layer('n02-copies','鹭桥受控副本',[])];imported(f.objects[2],'n02-copy-u','n02-copies','沄桥运输车副本');break;
    }
    case 'N03':
      f.systems=[system('n03-shitai','石苔台账'),system('n03-tingjing','汀镜台账')];
      f.objects=[aggregate('n03-shitai','st-known','石苔明细车辆汇总','n03-shitai-vehicles',4,['st-e12','st-e24','st-e37','st-e49']),aggregate('n03-shitai','st-unlisted','石苔未列成员车辆汇总','n03-shitai-vehicles',6,undefined),aggregate('n03-tingjing','tj-upper','汀镜上段舟艇汇总','n03-tingjing-boats',2,['tj-e15','tj-e29'],true),aggregate('n03-tingjing','tj-lower','汀镜下段舟艇汇总','n03-tingjing-boats',3,['tj-e44','tj-e58','tj-e63'],true)];
      for(const o of f.objects)o.resourceData!.resource.quantity!.evidence.push({kind:'declaration',note:o.ref.systemId==='n03-shitai'?'各自数量为同一车辆范围内不重复实体数，但未列成员汇总未披露身份，未声明与另一组是否重叠':'成员列表覆盖本汇总全部实体，使用本来源相同实体ID命名空间'});
      break;
    case 'N04': {
      const s='n04-jipu';f.systems=[system(s,'霁浦调度')];
      const rows:[string,string,string,number,Relation,Availability,string,string][]=[
        ['clear','10','桤岸',.011,'assigned','available','现行调度令','已放行，可出动；尚未收到通信回执，回执不是放行条件'],
        ['cond','21','蕨港',.014,'assigned','available','现行调度令','复核尚未确认完成'],
        ['expired','32','茶岬',.017,'assigned','available','关系仍有效','没有续期'],
        ['dual-ready','43','柏屿',.020,'assigned','available','现行调度令','调度台报告可用'],
        ['dual-fault','43','柏屿',.020,'assigned','unavailable','同一调度令','检修台报告液压故障'],
        ['fault','54','榕坡',.023,'assigned','unavailable','现行调度令','制动系统故障，暂停出动'],
        ['related','65','枫埠',.026,'related','available','仅与任务相关，未下达分配令','无条件'],
        ['support','76','苔湾',.029,'potential_support','available','本任务潜在支援，尚未转为分配','无条件'],
        ['unknown','87','沁洲',.032,'assigned','unknown','现行调度令','最新可用状态未核实'],
        ['refonly','98','槐堤',.035,'unconfirmed','available','关系未确认','无条件'],
      ];
      f.objects=rows.map(([id,e,n,d,rel,state,rnote,anote])=>{
        const o=resource(s,`jp-${id}`,`jp-e${e}`,`${n}保障车`,[Number((121+d).toFixed(3)),Number((31+d).toFixed(3))],'n04-vehicles',false,rel,state),r=o.resourceData!.resource;
        r.taskRelations![0].evidence.push({kind:'declaration',note:rnote});r.availability!.evidence.push({kind:'declaration',note:anote});
        if(id==='clear')r.availability!.conditions=[];
        if(id==='cond')r.availability!.conditions=['须完成承载复核后方可使用'];
        if(id==='expired')Object.assign(r.availability!,{reportedAt:at(t0,-100),effectiveAt:at(t0,-110),validUntil:at(t0,-80)});
        return o;
      });
      f.annotationLayers=[layer('n04-copies','霁浦受控副本',[])];imported(f.objects[0],'n04-copy-clear','n04-copies','桤岸保障车副本');break;
    }
    case 'N05': {
      const h='n05-hekai',l='n05-luting';f.annotationLayers=[area('n05-area','鹤砾矩形')];f.systems=[{...system(h,'鹤开车辆'),asOf:at(t0,-20)},{...system(l,'芦庭舟艇'),asOf:at(t0,-90)}];
      const hs='n05-hekai-vehicles',ls='n05-luting-boats';
      f.objects=[aggregate(h,'hk-all','鹤开车辆全组',hs,4,['hk-e13','hk-e27','hk-e42','hk-e68'],false,[121.02,31.02]),resource(h,'hk-in','hk-e13','青芒运输车',[121.01,31.01],hs),resource(h,'hk-edge','hk-e27','银菰运输车',[121,31.02],hs),resource(h,'hk-out','hk-e42','赭砂运输车',[121.05,31.02],hs),resource(h,'hk-none','hk-e68','紫苇运输车',null,hs),
        {ref:ref(h,'hk-plan'),name:'鹤开拟设车辆位',revision:1,areaIds:[],effectiveAt:at(t0,-30),validTime:{from:at(t0,-30),to:at(t0,1440)},geometry:{type:'Point',coordinates:[121.03,31.01]},properties:{},resourceData:{resource:planned(ref(h,'hk-plan'))}},
        aggregate(l,'lt-all','芦庭舟艇全组',ls,4,['lt-e16','lt-e33','lt-e57','lt-e81'],true,[121.02,31.02]),resource(l,'lt-in','lt-e16','鹭纹救生艇',[121.03,31.01],ls,true),resource(l,'lt-edge','lt-e33','荻帆救生艇',[121.04,31.03],ls,true),resource(l,'lt-est','lt-e57','浦灯救生艇',[121.015,31.025],ls,true)];
      const none=f.objects[4].resourceData!.resource.position!;none.meaning='unknown';none.evidence.push({kind:'declaration',note:'未获取实际坐标'});
      const estimated=f.objects[9].resourceData!.resource.position!;estimated.meaning='estimated';estimated.evidence.push({kind:'declaration',note:'仅为估计位置'});
      for(const o of f.objects){const r=o.resourceData!.resource,reported=o.ref.systemId===h?-25:-95,effective=o.ref.systemId===h?-30:-100;
        o.effectiveAt=at(t0,effective);o.validTime={from:o.effectiveAt,to:at(t0,1440)};
        for(const fact of [r.quantity,r.position,r.availability,...r.taskRelations??[]])if(fact)Object.assign(fact,{reportedAt:at(t0,reported),effectiveAt:at(t0,effective)});
      }break;
    }
    case 'N06': {
      f.annotationLayers=[layer('n06-areas','北区范围',[rectangle('n06-west','北区',121,31,121.04,31.04,'西侧北区'),rectangle('n06-east','北区',121.06,31,121.10,31.04,'东侧北区')])];
      f.systems=[system('n06-rongchi','榕池调度')];
      const rows:[string,string,string,Position][]=[['rc-w-in','rc-e14','榕荫保障车',[121.02,31.02]],['rc-w-edge','rc-e25','池杉保障车',[121,31.03]],['rc-w-fault','rc-e36','苍苔保障车',[121.03,31.01]],['rc-e-in1','rc-e47','檀浦保障车',[121.07,31.01]],['rc-e-in2','rc-e58','雀榆保障车',[121.09,31.03]],['rc-e-edge','rc-e69','萤湾保障车',[121.10,31.02]]];
      f.objects=rows.map(([id,e,n,xy])=>resource('n06-rongchi',id,e,n,xy,'n06-vehicles',false,'assigned',id==='rc-w-fault'?'unavailable':'available'));
      f.objects[2].resourceData!.resource.availability!.evidence.push({kind:'declaration',note:'电气故障'});break;
    }
    case 'N07': {
      f.annotationLayers=[layer('n07-areas','北区比较',[rectangle('n07-w','北区',121,31,121.04,31.04,'西北区'),rectangle('n07-e','北区',121.02,31,121.06,31.04,'东北区')])];
      f.systems=[system('n07-shilu','石鹭资源')];
      const rows:[string,string,string,Position][]=[['sl-w','sl-e18','石芽运输车',[121.01,31.01]],['sl-shared','sl-e29','鹭羽运输车',[121.03,31.02]],['sl-e','sl-e41','砂汀运输车',[121.05,31.01]],['sl-w-edge','sl-e53','苇穗运输车',[121,31.02]],['sl-e-inneredge','sl-e67','青菱运输车',[121.02,31.03]],['sl-e-outeredge','sl-e79','霜菊运输车',[121.06,31.02]],['sl-out','sl-e83','卵石运输车',[121.07,31.03]]];
      f.objects=rows.map(([id,e,n,xy])=>resource('n07-shilu',id,e,n,xy,'n07-vehicles'));break;
    }
    case 'N08':
      f.annotationLayers=[layer('n08-target','沚灯现场图层',[
        {...point('n08-note','白砾观察点',[121.011,31.013]),informationRole:'observation'},
        {...point('n08-plan','芦影计划泊位',[121.019,31.021],planned(undefined,true)),informationRole:'plan'},
        point('n08-car','沚灯运输车',[121.027,31.029],declaration('n08-vehicles',undefined,false,'unconfirmed','unknown')),
        point('n08-boat','菰湾救生艇',[121.035,31.037],declaration('n08-boats',undefined,true,'unconfirmed','unknown')),
      ]),layer('n08-other','其他现场图层',[point('n08-other-car','枫沙运输车',[121.02,31.02],declaration('n08-other-vehicles'))],1)];
      f.systems=[system('n08-yulan','榆岚外部台账')];f.objects=[resource('n08-yulan','yl-extra','yl-e64','榆岚运输车',[121.03,31.03],'n08-external-vehicles',false,'assigned')];break;
  }
  // Annotation polygons are not source areaIds. Do not fabricate source registry memberships.
  return f;
}

/** Called only after P04's first turn. Actual update clock is supplied and retained by the controller. */
export function materializeSourceUpdate(f:AcceptanceFixture,updatedAt:string):SituationObject[] {
  if(f.caseId!=='P04'||!Number.isFinite(Date.parse(updatedAt))||Date.parse(updatedAt)<Date.parse(f.t0))throw new Error('Invalid P04 source update clock');
  const objects=structuredClone(f.objects);
  for(const o of objects){
    o.revision+=1;o.effectiveAt=updatedAt;o.validTime={from:updatedAt,to:at(f.t0,1440)};
    const r=o.resourceData!.resource;
    for(const fact of [r.quantity,r.availability,r.position,...r.taskRelations??[]])if(fact){
      for(const evidence of fact.evidence)if(evidence.kind==='source')evidence.revision=o.revision;
    }
    if(o.ref.objectId==='wz-11')o.name='雾杉一号车（新牌）';
    if(o.ref.objectId==='wz-33'){
      o.geometry={type:'Point',coordinates:[121.063,31.011]};
      const evidence:ResourceEvidence[]=[{kind:'source',ref:o.ref,revision:o.revision},{kind:'declaration',note:'制动故障'}];
      r.availability={state:'unavailable',evidence,reportedAt:updatedAt,effectiveAt:updatedAt,validUntil:at(f.t0,1440)};
      Object.assign(r.position!,{reportedAt:updatedAt,effectiveAt:updatedAt});
    }
  }
  return objects;
}
