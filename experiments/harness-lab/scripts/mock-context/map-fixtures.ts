import type { InformationReport, SituationObject } from '../../src/contracts/context.js';
import { objects, reports } from './fixtures.js';
/** Selected OSM Orchard Road way coordinates, fetched 2026-10-11 via the OSM map API.
 * © OpenStreetMap contributors, ODbL https://www.openstreetmap.org/copyright
 * Western segment: way 16679081 v34; eastern segment: way 481677045 v12.
 * No topology or live traffic claims; all conditions/resources/regions are synthetic.
 */
export const orchardRoadSegments = {
  west: [[103.8322866,1.3047841],[103.8323264,1.3047617],[103.8324948,1.3046666],[103.8325992,1.304608],[103.8329914,1.3043877]],
  east: [[103.8351571,1.3032537],[103.8357661,1.3029095],[103.8358887,1.3028412]],
} satisfies Record<string, [number,number][]>;
export function mapFixtures(instanceId: string, day: string) {
  if (!/^[a-zA-Z0-9-]{1,64}$/.test(instanceId) || !/^\d{4}-\d{2}-\d{2}$/.test(day) || new Date(`${day}T00:00:00Z`).toISOString().slice(0,10) !== day) throw new Error('Invalid simulation instance/date');
  const transform = <T>(v: T): T => JSON.parse(JSON.stringify(v).replaceAll('2026-10-01', day).replace(/"(road-(?:west|east)-01|vehicles-(?:west|east)-01|zone-(?:west|east)|report-west-01)"/g, `"${instanceId}-$1"`));
  const spatial = transform(objects());
  for (const o of spatial) {
    const west = o.ref.objectId.includes('-west'), x = west ? 103.832 : 103.835, y = west ? 1.304 : 1.303;
    if (o.ref.objectType === 'road') {o.geometry = {type:'LineString',coordinates:structuredClone(orchardRoadSegments[west?'west':'east'])}; o.properties = {passability:'open'};}
    if (o.ref.objectType === 'resource') o.geometry = {type:'Point',coordinates:[x+0.0005,y+0.0006]};
    if (o.ref.objectType === 'area') o.geometry = {type:'Polygon',coordinates:[[[x-0.0003,y-0.0005],[x+0.0013,y-0.0005],[x+0.0013,y+0.001],[x-0.0003,y+0.001],[x-0.0003,y-0.0005]]]};
  }
  return {objects: spatial as SituationObject[], reports: transform(reports()) as InformationReport[], asOf:`${day}T09:00:00+08:00`};
}
