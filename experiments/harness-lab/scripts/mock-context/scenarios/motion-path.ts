import type { Position } from '../../../src/contracts/context.js';
import { positionAlong, type PathSegment } from './routing.js';
/** Prefix geometry preserves corners; these are not extra GPS reports. */
export function travelledPath(segments:PathSegment[],distance:number):Position[] {
  if(!segments.length)return [];
  const points:Position[]=[segments[0].from];let remaining=distance;
  for(const segment of segments){if(remaining<=0)break;if(remaining>=segment.meters){points.push(segment.to);remaining-=segment.meters;}else{points.push(positionAlong([segment],remaining));break;}}
  return points;
}
