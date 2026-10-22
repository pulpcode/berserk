/** Input delivery evidence only. It never certifies understanding or semantic correctness. */
export interface Payload {messages?:Array<{role?:string;content:unknown}>;tools?:unknown;model?:string;max_tokens?:number;thinking?:{type?:string}}
export interface Exposure {request:number;turn:number;skills:Record<string,{catalogPresent:boolean;bodyPresent:boolean;hash:string}>}
export function auditPayload(payload:Payload,skills:Record<string,{content:string;hash:string;description?:string}>,request:number,turn:number):Exposure{
 const content=(value:unknown):string=>typeof value==='string'?value:Array.isArray(value)?value.map(b=>b&&typeof b==='object'&&'text' in b?String(b.text):'').join('\n'):JSON.stringify(value);
 const text=(payload.messages??[]).map(m=>content(m.content)).join('\n');
 const catalogs=(payload.messages??[]).filter(m=>m.role==='system').flatMap(m=>content(m.content).split('\n').filter(line=>line.startsWith('可用 Skill：')));
 return {request,turn,skills:Object.fromEntries(Object.entries(skills).map(([id,s])=>[id,{hash:s.hash,catalogPresent:!!s.description&&catalogs.some(line=>line.includes(`${id}（${s.description}）`)),bodyPresent:text.includes(s.content)||text.includes(JSON.stringify(s.content).slice(1,-1))}]))};
}
export interface Decision {request:number;turn:number;kind:'scope'|'method'|'write'|'claim';evidence:string}
/** Reviewers identify the decision's actual response; delivery was in that response's input. */
export function exposureAtDecision(exposures:Exposure[],decision:Decision,id:string){
 const at=exposures.find(e=>e.request===decision.request&&e.turn===decision.turn);
 const first=exposures.find(e=>e.skills[id]?.bodyPresent);
 return {firstBodyRequest:first?.request??null,bodyInDecisionInput:at?.skills[id]?.bodyPresent??false,
  evidenceMissing:!at,decision,understanding:'not-established-by-delivery'};
}
