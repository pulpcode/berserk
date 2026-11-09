import { expect, test } from 'vitest';
import { sceneWorld } from '../scripts/mock-context/scenarios/data';
import { sourcePointSymbols, sourceSymbolImage } from '../src/web/situation/source-symbols';
import { refKey } from '../src/web/situation/evidence';
const objects=sceneWorld('symbols').objects;
const object=(code:string)=>objects.find(item=>item.ref.objectId===`symbols-${code}`)!;
test('maps explicit source vehicle types to existing professional artwork without guessing subtypes',()=>{
  expect(sourceSymbolImage(object('V01'))).toBe('annotation-symbol:xf3013-2020.6.2.1');
  expect(sourceSymbolImage(object('V03'))).toBe('annotation-symbol:xf3013-2020.6.2.2');
  expect(sourceSymbolImage(object('V06'))).toBe('annotation-symbol:xf3013-2020.6.2.13');
  expect(sourceSymbolImage(object('V05'))).toBe('source-symbol:vehicle'); // generic ladder is not a declared aerial-platform subtype
  expect(sourceSymbolImage({...object('V01'),resourceData:undefined,name:'云梯消防车',properties:{availableCount:6,unit:'辆'}})).toBe('source-symbol:resource');
});
test('uses neutral category pictograms for sites, water and other resources; roads keep line geometry',()=>{
  expect(sourceSymbolImage(object('S01'))).toBe('source-symbol:location');
  expect(sourceSymbolImage(object('L01'))).toBe('source-symbol:location');
  expect(sourceSymbolImage(object('H01'))).toBe('source-symbol:hydrant');
  expect(sourceSymbolImage(object('R03'))).toBeUndefined();
});
test('coincident vehicles use one group glyph, retain coordinates, and reveal the selected subtype',()=>{
  const items=[object('V01'),object('V03'),object('V06')],before=JSON.stringify(items);
  expect(new Set(items.map(item=>JSON.stringify(item.geometry))).size).toBe(1);
  const grouped=sourcePointSymbols(items);
  expect([...grouped.values()].filter(value=>value.symbolVisible)).toEqual([{image:'source-symbol:vehicle',symbolVisible:true}]);
  const selected=sourcePointSymbols(items,refKey(items[1].ref));
  expect(selected.get(refKey(items[1].ref))).toEqual({image:'annotation-symbol:xf3013-2020.6.2.2',symbolVisible:true});
  expect([...selected.values()].filter(value=>value.symbolVisible)).toHaveLength(1);
  expect(JSON.stringify(items)).toBe(before);
});
