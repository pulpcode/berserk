import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import type { Map as LibreMap } from 'maplibre-gl';

declare global { interface Window { __basemapTestMap?: LibreMap } }
/** Capture the actual map in the dev-transformed module, without a product debug API. */
export async function captureMap(page: Page) {
  await page.route('**/src/web/situation/MapCanvas.tsx*', async route => {
    const response = await route.fetch();
    const source = await response.text();
    const body = source.replace(/map\.current\s*=\s*instance\s*;/, '$& globalThis.__basemapTestMap = instance;');
    if (body === source) throw new Error('MapCanvas capture point not found');
    await route.fulfill({response,body});
  });
}
export async function mapSnapshot(page: Page) {
  return page.evaluate(() => {
    const map=window.__basemapTestMap!;
    return {center:map.getCenter().toArray(),zoom:map.getZoom(),bearing:map.getBearing(),pitch:map.getPitch(),
      business:map.getStyle().sources['business:objects'],
      annotationSources:Object.fromEntries(Object.entries(map.getStyle().sources).filter(([id])=>id.startsWith('annotation:')))};
  });
}
export async function localVectorTiles(page: Page, fixture: 'basemap-vector.pbf' | 'basemap-road-hierarchy.pbf' = 'basemap-vector.pbf') {
  const body=await readFile(new URL(`../fixtures/${fixture}`,import.meta.url));
  let requests=0,fail=false,delay=0;
  await page.route('**/basemap-vector/**',async route=>{requests++;if(delay)await new Promise(resolve=>setTimeout(resolve,delay));if(fail)return route.fulfill({status:503,body:'offline'});return route.fulfill({contentType:'application/x-protobuf',body});});
  return {requests:()=>requests,offline:()=>{fail=true;},online:()=>{fail=false;},delay:(ms:number)=>{delay=ms;}};
}
export function basemapFixture(origin:string) {
  const common={coordinateSystem:'wgs84',projection:'web-mercator',scheme:'xyz',bounds:[-180,-85.051129,180,85.051129],minZoom:0,maxZoom:14,attributions:[{text:'本地底图回归数据',url:'https://example.org/credits'}]};
  return {defaultView:'imagery',imagery:{...common,providerId:'test-imagery',name:'测试影像',tiles:[`${origin}/test-tiles/{z}/{x}/{y}.png`],tileSize:256},roads:{...common,providerId:'test-roads',name:'测试路网',tiles:[`${origin}/basemap-vector/{z}/{x}/{y}.pbf`],glyphs:`${origin}/basemap-fonts/{fontstack}/{range}.pbf`}};
}
