import assert from 'node:assert/strict';

/** Compare the selected fixed objects, never rewrite the actual browser payload. */
export function canonicalAnnotationSelections(value:unknown):string[]{
 if(value===undefined)return [];
 assert.ok(Array.isArray(value),'annotation_selection_array_required');
 const tokens=new Set<string>();
 for(const entry of value){
  assert.ok(entry&&typeof entry==='object'&&!Array.isArray(entry),'annotation_selection_object_required');
  const row=entry as Record<string,unknown>;
  assert.ok(Object.keys(row).every(key=>['setId','revision','publicationId','layerIds','objectIds'].includes(key)),'unknown_annotation_selection_field');
  let identity:unknown[];
  if('publicationId' in row){
   assert.ok(typeof row.publicationId==='string'&&row.publicationId.length>0&&!('setId' in row)&&!('revision' in row),'invalid_publication_identity');identity=['publication',row.publicationId];
  }else{
   assert.ok(typeof row.setId==='string'&&row.setId.length>0&&Number.isSafeInteger(row.revision)&&Number(row.revision)>0,'invalid_fixed_identity');identity=['version',row.setId,row.revision];
  }
  const ids=(key:'layerIds'|'objectIds')=>{
   if(!(key in row))return undefined;const items=row[key];
   assert.ok(Array.isArray(items)&&items.length>0&&items.every(id=>typeof id==='string'&&id.length>0),'invalid_selection_ids');
   return [...new Set(items as string[])].sort();
  };
  const layers=ids('layerIds'),objects=ids('objectIds');
  // Mixed filters remain atomic: do not distribute a layer/object intersection.
  if(layers&&objects)tokens.add(JSON.stringify([identity,'mixed',layers,objects]));
  else if(layers)for(const id of layers)tokens.add(JSON.stringify([identity,'layer',id]));
  else if(objects)for(const id of objects)tokens.add(JSON.stringify([identity,'object',id]));
  else tokens.add(JSON.stringify([identity,'whole-version']));
 }
 return [...tokens].sort();
}
export function assertEquivalentAnnotationSelections(actual:unknown,expected:unknown){
 assert.deepEqual(canonicalAnnotationSelections(actual),canonicalAnnotationSelections(expected),'annotation_selection_scope_mismatch');
}
