import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { MAP_SYMBOLS, getMapSymbol } from '../src/contracts/map-symbols.js';
import { feature } from '../src/annotations/validation.js';

it('maps every approved sample to a unique controlled ID and preserves its provenance',async()=>{
  const manifest=JSON.parse(await readFile(new URL('../src/web/map-symbols/provenance.json',import.meta.url),'utf8')) as {items:Array<{id:string;name:string;standardRef?:string}>};
  expect(MAP_SYMBOLS).toHaveLength(22);expect(new Set(MAP_SYMBOLS.map(s=>s.id)).size).toBe(22);
  expect(MAP_SYMBOLS.filter(s=>s.sourceKind==='standard')).toHaveLength(20);
  for(const [index,symbol] of MAP_SYMBOLS.entries()){
    const sample=manifest.items[index];expect(symbol.name).toBe(sample.name);
    if(symbol.sourceKind==='standard'){expect(symbol.standardRef).toBe(sample.standardRef);expect(symbol.id).toBe(`xf3013-2020.${sample.standardRef}`);}
    else expect(sample.standardRef).toBeUndefined();
    expect(symbol.id).toBe(sample.id);
    expect(getMapSymbol(symbol.id)).toBe(symbol);
    expect(feature({objectId:'test',kind:'point',name:symbol.name,geometry:{type:'Point',coordinates:[103,1]},style:{symbolId:symbol.id,iconSize:symbol.defaultIconSize,...(symbol.orientation==='heading'?{heading:0}:{})}}).style?.symbolId).toBe(symbol.id);
  }
  expect(getMapSymbol(undefined)).toBeUndefined();expect(getMapSymbol('fire-truck')).toBeUndefined();
});
