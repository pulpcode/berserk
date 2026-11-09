import type { Map as LibreMap } from 'maplibre-gl';
import type { SituationObject } from '../../contracts/context';
import { refKey } from './evidence';
import { ensureMapSymbols, registerSymbolImage, symbolImageId } from '../map-symbols';
const vehicleSymbols:Readonly<Record<string,string>>={
  water_tanker:'xf3013-2020.6.2.1',foam:'xf3013-2020.6.2.2',
  rescue:'xf3013-2020.6.2.13',communications:'xf3013-2020.6.2.17',
};
const assets={
  vehicle:new URL('./source-symbol-assets/vehicle.svg',import.meta.url).href,
  location:new URL('./source-symbol-assets/location.svg',import.meta.url).href,
  hydrant:new URL('./source-symbol-assets/hydrant.svg',import.meta.url).href,
  resource:new URL('./source-symbol-assets/resource.svg',import.meta.url).href,
};
/** Source fields choose artwork; a name/count never declares a specific vehicle. */
export function sourceSymbolImage(item:SituationObject):string|undefined {
  if(item.ref.objectType!=='resource'||item.geometry?.type!=='Point')return;
  const resource=item.resourceData?.resource,type=resource?.vehicle?.type;
  if(type&&vehicleSymbols[type])return symbolImageId(vehicleSymbols[type]);
  const category=type||resource?.category==='vehicle'||resource?.category==='fire_engine'?'vehicle'
    :resource?.category==='facility'?'location':resource?.category==='hydrant'?'hydrant':'resource';
  return `source-symbol:${category}`;
}
const registrations=new WeakMap<LibreMap,Promise<string[]>>();
export function ensureSourceSymbols(map:LibreMap):Promise<string[]> {
  const existing=registrations.get(map);if(existing)return existing;
  const loading=Promise.all([ensureMapSymbols(map),Promise.all(Object.entries(assets).map(async([name,url])=>
    await registerSymbolImage(map,`source-symbol:${name}`,url)?undefined:name))]).then(([professional,generic])=>[...professional,...generic.filter((name):name is string=>name!==undefined)]);
  registrations.set(map,loading);return loading;
}

/** Coincident reports share one glyph; every original object remains available in the label list. */
export function sourcePointSymbols(objects:SituationObject[],selected?:string) {
  const groups=new Map<string,SituationObject[]>(),result=new Map<string,{image:string;symbolVisible:boolean}>();
  for(const item of objects){const image=sourceSymbolImage(item);if(!image||item.geometry?.type!=='Point')continue;
    const coordinate=JSON.stringify(item.geometry.coordinates);groups.set(coordinate,[...(groups.get(coordinate)??[]),item]);
    result.set(refKey(item.ref),{image,symbolVisible:false});
  }
  for(const items of groups.values()){
    const chosen=items.find(item=>refKey(item.ref)===selected),vehicles=items.filter(item=>item.resourceData?.resource.vehicle||['vehicle','fire_engine'].includes(item.resourceData?.resource.category??''));
    const primary=chosen??vehicles[0]??items[0];
    result.set(refKey(primary.ref),{image:!chosen&&vehicles.length>1?'source-symbol:vehicle':sourceSymbolImage(primary)!,symbolVisible:true});
  }
  return result;
}
