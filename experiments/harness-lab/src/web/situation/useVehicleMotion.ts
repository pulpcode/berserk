import { useEffect, useState } from 'react';
import type { SituationObject, Position } from '../../contracts/context';
import type { SourceResult } from './map-data';
import { refKey } from './evidence';
const meters=(a:Position,b:Position)=>{const rad=Math.PI/180,x=(b[0]-a[0])*rad*Math.cos((a[1]+b[1])*rad/2),y=(b[1]-a[1])*rad;return Math.hypot(x,y)*6371008.8;};
export function displayPosition(path:Position[],distance:number):Position|undefined {
  for(let i=1;i<path.length;i++){const length=meters(path[i-1],path[i]);if(distance<=length){const t=length?Math.max(0,distance)/length:0;return [path[i-1][0]+(path[i][0]-path[i-1][0])*t,path[i-1][1]+(path[i][1]-path[i-1][1])*t];}distance-=length;}
  return path.at(-1);
}
export function useVehicleMotion(objects:SituationObject[],sources:Record<string,SourceResult>,failed:boolean) {
  const [frame,setFrame]=useState<{base:SituationObject[];items:SituationObject[]}>();
  useEffect(()=>{
    let handle=0;const received=performance.now();let previous=0;
    const render=(now:number)=>{
      const elapsed=Math.min(1000,now-received);
      if(document.visibilityState==='hidden'||failed)return;
      if(now-previous>=32){previous=now;setFrame({base:objects,items:objects.map(item=>{
        const motion=sources[item.ref.systemId]?.mapMotion,vehicle=motion?.vehicles.find(v=>refKey(v.ref)===refKey(item.ref));
        if(!motion||!vehicle)return item;
        const p=motion.progress,ratio=Math.min(1,Math.max(0,(Date.parse(motion.serverNow)+elapsed-Date.parse(p.startedAt))/p.durationMs));
        const target=Date.parse(p.from)+(Date.parse(p.to)-Date.parse(p.from))*ratio;
        const travelled=Math.min(vehicle.distance,vehicle.travelled+Math.max(0,target-Date.parse(motion.businessNow))/1000*vehicle.speed);
        const position=displayPosition(vehicle.path,travelled);
        // Status and completed trail remain the last authoritative source facts.
        return position?{...item,geometry:{type:'Point' as const,coordinates:position}}:item;
      })});}
      if(elapsed<1000)handle=requestAnimationFrame(render);
    };
    if(!matchMedia('(prefers-reduced-motion: reduce)').matches&&Object.values(sources).some(source=>source.mapMotion))handle=requestAnimationFrame(render);
    else queueMicrotask(()=>setFrame(undefined));
    return()=>cancelAnimationFrame(handle);
  },[objects,sources,failed]);
  return !failed&&frame?.base===objects?frame.items:objects;
}
