/** Model-visible business questions. No expected result is imported here. */
export type CaseId = 'P01'|'P02'|'P03'|'P04'|'A01'|'A02'|'A03'|'A04'|'A05'|'A06'|'A07'|'A08';
export interface AcceptanceTurn {
  text:string;
  annotationSelection?:'draft-layer'|'published-layer';
  areaObjectId?:string;
  after?:'source-update';
}
export interface HumanFact {
  id:string;
  topic:'region';
  value:string;
  objectId:string;
  /** Controller-only facts: never append proactively to model context. */
  acceptableForms:string[];
  rule:string;
}
export interface AcceptanceCase {
  id:CaseId; phase:'public'|'formal'; title:string; taskTitle:string; taskGoal:string;
  turns:AcceptanceTurn[]; humanFacts:HumanFact[];
}
const normalGoal='核对澄湾演练的资源情况，为值班人员提供有据可查的清单。仅查询，不保存或修改业务资料。';
const entry=(id:CaseId,title:string,turns:AcceptanceTurn[],goal=normalGoal,humanFacts:HumanFact[]=[]):AcceptanceCase=>({id,phase:id.startsWith('P')?'public':'formal',title,taskTitle:`澄湾演练·${title}`,taskGoal:goal,turns,humanFacts});
export const acceptanceCases:AcceptanceCase[]=[
  entry('P01','柳堤图层核对',[{text:'只看我引用图层，在我引用的区域内统计实际资源，边界单列。',annotationSelection:'published-layer',areaObjectId:'p01-quay'}]),
  entry('P02','芦汀勤务核查',[{text:'查本任务已分配且可用的资源，按芦汀勤务区分别列出区域内、边界、区域外；缺位置单列。',areaObjectId:'p02-reed'}]),
  entry('P03','北区资料查阅',[{text:'查北区资源。'}],normalGoal,[{id:'p03-region',topic:'region',value:'我指的是北区（堤岸侧），区域 ID p03-bank。',objectId:'p03-bank',acceptableForms:['北区（堤岸侧）','p03-bank'],rule:'只在实际澄清要求选择区域时回答；选项须按含义匹配，不能猜选项序号。'}]),
  entry('P04','巡检名册续读',[{text:'查本任务资源名单，先只向我列出前 3 条；保留这次查询结果，余下的我稍后问。'},{text:'继续列出刚才名单剩余部分，不重新查询。',after:'source-update'}]),
  entry('A01','澄湾物资联络',[{text:'查一下本任务有哪些资源，任务相关和有依据的支援分开列；已分配、可用情况按证据说。'}]),
  entry('A02','堤口现场资料',[{text:'把本任务已知的实际资源列出来，草稿和任务采用版本也考虑；计划位置、不能确认的对象和状态另外说明。'}]),
  entry('A03','联运资源清册',[{text:'整理这批资源的名单和数量，同一资源的副本不要重复算；身份不能确认的单列。'}]),
  entry('A04','东埠班次资源',[{text:'哪些已分配给本任务而且目前可用？有条件支援、不可用和待核实的也分别列出。'}]),
  entry('A05','青沙作业区清点',[{text:'按实际位置统计青沙作业区内的资源，边界另列；数量按类别和单位分开，无法定位的不要当区域外。',areaObjectId:'a05-sand'}]),
  entry('A06','双来源覆盖核查',[{text:'查清澜登记源和白榆巡查源在榆岸区的资源，有没有资源、查全没有、任务关系是否明确，分别说明。',areaObjectId:'a06-elm'}]),
  entry('A07','桦堤图层清点',[{text:'只统计我引用图层中的实际资源，区域内和边界分开，不分析任务关系。',annotationSelection:'published-layer',areaObjectId:'a07-birch'},{text:'再看同一图层里的全部点图形，包括普通点和计划点，分别有多少在区域内、边界和区域外？'}]),
  entry('A08','北区可用资料',[{text:'看北区内本任务的可用资源，边界单列。'}],normalGoal,[{id:'a08-region',topic:'region',value:'我指北区（港口侧），区域 ID a08-harbor。',objectId:'a08-harbor',acceptableForms:['北区（港口侧）','a08-harbor'],rule:'只有 Agent 实际问区域选择时才提供；不把此事实放任务标题、初始消息、引用或来源默认排序提示。其他问题暂停核题。'}]),
];
export function acceptanceCase(id:CaseId):AcceptanceCase {const result=acceptanceCases.find(c=>c.id===id);if(!result)throw new Error(`Unknown case ${id}`);return structuredClone(result);}
