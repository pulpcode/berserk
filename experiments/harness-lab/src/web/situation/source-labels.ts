import { Marker, type Map as LibreMap } from 'maplibre-gl';
import type { SituationObject } from '../../contracts/context';
import { refKey } from './evidence';
import { positionNote, sourceCategory } from './map-data';

/** Labels group coincident source coordinates without moving the reported positions. */
export function createSourceLabels(map:LibreMap,pick:(key:string)=>void) {
  let markers:Marker[]=[];let renderKey='';
  const clear=()=>{markers.forEach(marker=>marker.remove());markers=[];};
  return {
    update(objects:SituationObject[],selected:string|undefined,sourceTimes:Record<string,string>,interactive=true) {
      const detailed=map.getZoom()>=13.5;
      const key=JSON.stringify([objects,selected,sourceTimes,detailed,interactive]);if(key===renderKey)return;renderKey=key;clear();
      const groups=new globalThis.Map<string,SituationObject[]>();
      for(const item of objects) {
        if(item.geometry?.type!=='Point' || !['vehicle','facility','hydrant'].includes(sourceCategory(item)))continue;
        const coordinate=JSON.stringify(item.geometry.coordinates);groups.set(coordinate,[...(groups.get(coordinate)||[]),item]);
      }
      for(const items of groups.values()) {
        const vehicles=items.filter(item=>sourceCategory(item)==='vehicle');
        const facilities=items.filter(item=>sourceCategory(item)==='facility');
        const selectedItem=items.find(item=>refKey(item.ref)===selected);
        if(!detailed && !facilities.length && !selectedItem && vehicles.length<2)continue;
        const element=document.createElement('div');element.className='source-point-label';element.style.pointerEvents=interactive?'auto':'none';
        element.addEventListener('click',event=>event.stopPropagation());element.addEventListener('wheel',event=>event.stopPropagation());
        const addItem=(item:SituationObject)=>{
          const button=document.createElement('button');button.type='button';button.textContent=item.name;button.setAttribute('aria-pressed',String(refKey(item.ref)===selected));
          if(!interactive){button.style.pointerEvents='none';button.tabIndex=-1;}
          button.addEventListener('click',event=>{event.stopPropagation();pick(refKey(item.ref));});element.append(button);
          const note=positionNote(item,sourceTimes[item.ref.systemId]);if(note){const text=document.createElement('small');text.className='source-position-note';text.textContent=note;element.append(text);}
        };
        if(facilities.length)facilities.forEach(addItem);
        if(vehicles.length>1){const count=document.createElement('small');count.textContent=detailed?`同位置记录${vehicles.length}辆`:`${vehicles.length}辆`;count.title=`同位置记录${vehicles.length}辆`;element.append(count);}
        if(detailed)items.filter(item=>!facilities.includes(item)).forEach(addItem);
        else if(selectedItem&&!facilities.includes(selectedItem))addItem(selectedItem);
        const coordinates=items[0]!.geometry!;if(coordinates.type==='Point')markers.push(new Marker({element,anchor:'left',offset:[22,0]}).setLngLat(coordinates.coordinates).addTo(map));
      }
    },
    destroy(){clear();},
  };
}
