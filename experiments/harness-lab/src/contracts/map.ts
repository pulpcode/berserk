/** Business coordinates remain WGS84 lon/lat; all basemap tiles use Web Mercator XYZ. */
export type BasemapView = 'imagery' | 'road' | 'hybrid';
export interface BasemapAttribution { text: string; url: string }
export interface BasemapSourceMetadata {
  providerId: string; name: string;
  coordinateSystem: 'wgs84'; projection: 'web-mercator'; scheme: 'xyz';
  bounds: [number, number, number, number]; minZoom: number; maxZoom: number;
  attributions: BasemapAttribution[];
}
export interface ImageryBasemap extends BasemapSourceMetadata { tiles: string[]; tileSize: 256 | 512 }
export interface RoadBasemap extends BasemapSourceMetadata { url?: string; tiles?: string[]; glyphs: string }
export interface BasemapConfig { defaultView: BasemapView; imagery: ImageryBasemap; roads: RoadBasemap; simulationEnabled?: boolean }
export interface LegacyMapConfig { providerId: string; tiles: string[]; tileSize: number; attributionText: string; attributionUrl: string; simulationEnabled?: boolean }
export type MapConfig = BasemapConfig | LegacyMapConfig;
export const basemapViews: ReadonlyArray<{id: BasemapView; label: string}> = [{id:'imagery',label:'影像'},{id:'road',label:'路网'},{id:'hybrid',label:'混合'}];
export const isBasemapView = (value: unknown): value is BasemapView => value === 'imagery' || value === 'road' || value === 'hybrid';
const coordinates = {coordinateSystem:'wgs84',projection:'web-mercator',scheme:'xyz'} as const;
export const defaultMapConfig: BasemapConfig = {
  defaultView:'imagery',
  imagery:{...coordinates,providerId:'esri-world-imagery',name:'Esri World Imagery',tiles:['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],tileSize:256,bounds:[-180,-85,180,85],minZoom:0,maxZoom:19,attributions:[{text:'Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community',url:'https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9'}]},
  roads:{...coordinates,providerId:'openfreemap',name:'OpenFreeMap / OpenMapTiles',url:'https://tiles.openfreemap.org/planet',glyphs:'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',bounds:[-180,-85.051129,180,85.051129],minZoom:0,maxZoom:14,attributions:[{text:'OpenFreeMap',url:'https://openfreemap.org/'},{text:'© OpenMapTiles',url:'https://openmaptiles.org/'},{text:'© OpenStreetMap contributors',url:'https://www.openstreetmap.org/copyright'}]},
};
/** Old deployments and saved API fixtures remain usable without rewriting their config. */
export function normalizeMapConfig(config: MapConfig): BasemapConfig {
  if ('imagery' in config) return config;
  return {...defaultMapConfig,imagery:{...defaultMapConfig.imagery,providerId:config.providerId,name:config.providerId,tiles:config.tiles,tileSize:config.tileSize as 256 | 512,attributions:[{text:config.attributionText,url:config.attributionUrl}]},simulationEnabled:config.simulationEnabled};
}
