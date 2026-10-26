import type { AnnotationFeature, AnnotationOperation } from '../../contracts/annotations';

const fields = ['name', 'note', 'informationRole', 'geometry', 'sourceRefs'] as const;
const labels: Record<string, string> = {name:'名称',note:'备注',informationRole:'信息性质',geometry:'坐标',sourceRefs:'来源关联',layerId:'所属图层',heading:'方向',iconSize:'图标尺寸',symbolId:'图标',label:'地图标签',color:'颜色',fillColor:'填充色',opacity:'透明度',size:'点大小',width:'线宽',lineStyle:'线型',symbol:'点符号',lineEnd:'路线末端'};
export interface FeatureLocation { feature: AnnotationFeature; layerId: string }
export interface EditDifference { id:string; group?:'style'|'attributes'; field:string; label:string; before:unknown; local:unknown; latest:unknown; localChanged:boolean; latestChanged:boolean; conflict:boolean }
export type EditChoices = Record<string,'local'|'latest'>;
const own=(value:Record<string,unknown>|undefined,key:string)=>value&&Object.hasOwn(value,key)?value[key]:undefined;
const put=(value:Record<string,unknown>,key:string,item:unknown)=>Object.defineProperty(value,key,{value:item,enumerable:true,configurable:true,writable:true});

export function sameValue(a:unknown,b:unknown):boolean {
  if(Object.is(a,b))return true;
  if(!a || !b || typeof a!=='object' || typeof b!=='object')return false;
  if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((v,i)=>sameValue(v,b[i]));
  const left=a as Record<string,unknown>,right=b as Record<string,unknown>;
  const keys=Object.keys(left).filter(key=>left[key]!==undefined),other=Object.keys(right).filter(key=>right[key]!==undefined);
  return keys.length===other.length&&keys.every(key=>Object.hasOwn(right,key)&&sameValue(left[key],right[key]));
}

// Compare displayed initial/current values, but keep the exact saved absence of untouched values.
export function preserveUntouchedFields(original:AnnotationFeature, initial:AnnotationFeature, current:AnnotationFeature):AnnotationFeature {
  const result={...original};
  for(const field of fields)if(!sameValue(initial[field],current[field]))Object.assign(result,{[field]:current[field]});
  for(const group of ['style','attributes'] as const){
    const before=initial[group] as Record<string,unknown>|undefined,after=current[group] as Record<string,unknown>|undefined;
    const changed=[...new Set([...Object.keys(before||{}),...Object.keys(after||{})])].filter(key=>!sameValue(own(before,key),own(after,key)));
    if(changed.length){const value:Record<string,unknown>={...original[group]};for(const key of changed){if(own(after,key)===undefined)delete value[key];else put(value,key,own(after,key));}Object.assign(result,{[group]:value});}
  }
  return result;
}

export function compareFeatureEdits(base:FeatureLocation,local:FeatureLocation,latest:FeatureLocation):EditDifference[]{
  const changes:EditDifference[]=[];
  function add(field:string,before:unknown,mine:unknown,remote:unknown,group?:'style'|'attributes'){
    const localChanged=!sameValue(before,mine),latestChanged=!sameValue(before,remote);
    if(localChanged||latestChanged)changes.push({id:JSON.stringify([group||'',field]),group,field,label:group==='attributes'?`业务属性 · ${field}`:labels[field]||field,before,local:mine,latest:remote,localChanged,latestChanged,conflict:localChanged&&latestChanged&&!sameValue(mine,remote)});
  }
  for(const field of fields)add(field,base.feature[field],local.feature[field],latest.feature[field]);
  add('layerId',base.layerId,local.layerId,latest.layerId);
  for(const group of ['style','attributes'] as const){const b=base.feature[group] as Record<string,unknown>|undefined,l=local.feature[group] as Record<string,unknown>|undefined,r=latest.feature[group] as Record<string,unknown>|undefined;for(const field of new Set([...Object.keys(b||{}),...Object.keys(l||{}),...Object.keys(r||{})]))add(field,own(b,field),own(l,field),own(r,field),group);}
  return changes;
}

export function mergeFeatureEdits(latest:FeatureLocation,differences:EditDifference[],choices:EditChoices):FeatureLocation|undefined {
  if(differences.some(item=>item.conflict&&!choices[item.id]))return undefined;
  const result:FeatureLocation={layerId:latest.layerId,feature:structuredClone(latest.feature)};
  for(const item of differences){
    if(!item.localChanged || item.conflict&&choices[item.id]!=='local')continue;
    if(item.field==='layerId'&&!item.group){result.layerId=String(item.local);continue;}
    if(item.group){const value:Record<string,unknown>={...result.feature[item.group]};if(item.local===undefined)delete value[item.field];else put(value,item.field,item.local);Object.assign(result.feature,{[item.group]:value});}
    else if(item.local===undefined)Reflect.deleteProperty(result.feature,item.field);else Object.assign(result.feature,{[item.field]:item.local});
  }
  return result;
}

export function featureUpdate(base:FeatureLocation,next:FeatureLocation):Extract<AnnotationOperation,{op:'update_object'}>|undefined {
  const changes:Extract<AnnotationOperation,{op:'update_object'}>['changes']={};
  for(const field of [...fields,'style','attributes'] as const)if(!sameValue(base.feature[field],next.feature[field]))Object.assign(changes,{[field]:next.feature[field]});
  const moved=base.layerId!==next.layerId;
  if(!Object.keys(changes).length&&!moved)return undefined;
  return {op:'update_object',objectId:base.feature.objectId,changes,...(moved?{layerId:next.layerId}:{})};
}
