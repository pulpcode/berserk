import { isBasemapView, type BasemapSourceMetadata, type MapConfig, type RoadBasemap } from '../contracts/map.js';
import { isAbsolute } from 'node:path';
import { readControlled } from '../resources/files.js';

export interface ContextSystemConfig {
  id: string; name: string; adapter: 'mock-information-http' | 'mock-situation-http';
  baseUrl: string; tokenEnv: string; areas?: Array<{id: string; name: string}>;
}
export interface ContextScopeConfig { id: string; name: string; systemIds: string[]; seatIds: string[] }
export interface SimulationConfig { enabled: boolean; baseUrl: string; tokenEnv: string; sources: Array<{systemId: string; sourceId: string}> }
export interface ContextConfig { systems: ContextSystemConfig[]; scopes: ContextScopeConfig[]; simulation?: SimulationConfig; map?: MapConfig }
const fail = () => new Error('业务查询配置无效，请核对系统、资料范围和凭证环境变量名称。');
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw fail();
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 128): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw fail();
  return value;
}
function id(value: unknown): string {
  const result = text(value); if (!/^[a-zA-Z0-9_-]+$/.test(result)) throw fail(); return result;
}
function list(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 100) throw fail();
  const result = value.map(id); if (new Set(result).size !== result.length) throw fail(); return result;
}
const metadataKeys = ['providerId','name','coordinateSystem','projection','scheme','bounds','minZoom','maxZoom','attributions'];
function publicUrl(value: unknown, allowHash = false): string {
  const result = text(value,2048), url = new URL(result);
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password || (!allowHash && url.hash)) throw fail();
  return result;
}
function tileUrls(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length || value.length > 4) throw fail();
  return value.map(item => { const url=publicUrl(item); if (!['{z}','{x}','{y}'].every(token=>url.includes(token))) throw fail(); return url; });
}
function metadata(raw: Record<string,unknown>): BasemapSourceMetadata {
  if (raw.coordinateSystem !== 'wgs84' || raw.projection !== 'web-mercator' || raw.scheme !== 'xyz') throw fail();
  const bounds=raw.bounds;
  if (!Array.isArray(bounds) || bounds.length !== 4 || bounds.some(value=>typeof value !== 'number' || !Number.isFinite(value)) || bounds[0] < -180 || bounds[2] > 180 || bounds[0] >= bounds[2] || bounds[1] < -85.051129 || bounds[3] > 85.051129 || bounds[1] >= bounds[3]) throw fail();
  if (typeof raw.minZoom !== 'number' || typeof raw.maxZoom !== 'number' || !Number.isInteger(raw.minZoom) || !Number.isInteger(raw.maxZoom) || raw.minZoom < 0 || raw.maxZoom > 24 || raw.minZoom > raw.maxZoom) throw fail();
  if (!Array.isArray(raw.attributions) || !raw.attributions.length || raw.attributions.length > 8) throw fail();
  const attributions=raw.attributions.map(value=>{const a=object(value,['text','url']);return {text:text(a.text,500),url:publicUrl(a.url,true)};});
  return {providerId:id(raw.providerId),name:text(raw.name,100),coordinateSystem:'wgs84',projection:'web-mercator',scheme:'xyz',bounds:bounds as BasemapSourceMetadata['bounds'],minZoom:raw.minZoom,maxZoom:raw.maxZoom,attributions};
}
export function parseContextConfig(value: unknown): ContextConfig {
  const raw = object(value, ['systems', 'scopes', 'simulation', 'map']);
  if (!Array.isArray(raw.systems) || !Array.isArray(raw.scopes) || raw.systems.length > 100 || raw.scopes.length > 100) throw fail();
  const systems = raw.systems.map(value => {
    const s = object(value, ['id', 'name', 'adapter', 'baseUrl', 'tokenEnv', 'areas']);
    if (s.adapter !== 'mock-information-http' && s.adapter !== 'mock-situation-http') throw fail();
    const baseUrl = text(s.baseUrl, 2048), url = new URL(baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw fail();
    const tokenEnv = text(s.tokenEnv, 100); if (!/^[A-Z][A-Z0-9_]{0,99}$/.test(tokenEnv)) throw fail();
    const areas = s.areas === undefined ? undefined : (() => { if (!Array.isArray(s.areas) || s.areas.length > 100) throw fail(); return s.areas.map(value => { const a = object(value, ['id', 'name']); return {id: id(a.id), name: text(a.name, 200)}; }); })();
    return {...(areas ? {areas} : {}), id: id(s.id), name: text(s.name, 200), adapter: s.adapter, baseUrl: url.href.replace(/\/$/, ''), tokenEnv} satisfies ContextSystemConfig;
  });
  const scopes = raw.scopes.map(value => {
    const s = object(value, ['id', 'name', 'systemIds', 'seatIds']);
    const systemIds = list(s.systemIds), seatIds = list(s.seatIds);
    if (!systemIds.length || systemIds.some(systemId => !systems.some(system => system.id === systemId))) throw fail();
    return {id: id(s.id), name: text(s.name, 200), systemIds, seatIds};
  });
  if (new Set(systems.map(s => s.id)).size !== systems.length || new Set(scopes.map(s => s.id)).size !== scopes.length) throw fail();
  let simulation: SimulationConfig | undefined;
  if (raw.simulation !== undefined) {
    const c = object(raw.simulation, ['enabled','baseUrl','tokenEnv','sources']);
    const url = new URL(text(c.baseUrl,2048));
    if (typeof c.enabled !== 'boolean' || !['http:','https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !Array.isArray(c.sources) || !c.sources.length || c.sources.length > 100) throw fail();
    const tokenEnv = text(c.tokenEnv,100); if (!/^[A-Z][A-Z0-9_]{0,99}$/.test(tokenEnv)) throw fail();
    const sources = c.sources.map(value => { const source = object(value,['systemId','sourceId']); return {systemId:id(source.systemId),sourceId:id(source.sourceId)}; });
    if (sources.some(source => !systems.some(system => system.id === source.systemId)) || new Set(sources.map(source => source.systemId)).size !== sources.length) throw fail();
    if (c.enabled && (sources.length !== 2 || !sources.some(source => source.systemId === 'intel' && systems.some(system => system.id === 'intel' && system.adapter === 'mock-information-http')) || !sources.some(source => source.systemId === 'situation' && systems.some(system => system.id === 'situation' && system.adapter === 'mock-situation-http')) || systems.some(system => system.tokenEnv === tokenEnv))) throw fail();
    simulation = {enabled:c.enabled,baseUrl:url.href.replace(/\/$/,''),tokenEnv,sources};
  }
  let map: MapConfig | undefined;
  if (raw.map !== undefined) {
    const m = object(raw.map,['defaultView','imagery','roads','providerId','tiles','tileSize','attributionText','attributionUrl']);
    if ('imagery' in m || 'roads' in m || 'defaultView' in m) {
      object(m,['defaultView','imagery','roads']);
      if (!isBasemapView(m.defaultView)) throw fail();
      const imagery = object(m.imagery,[...metadataKeys,'tiles','tileSize']);
      if (imagery.tileSize !== 256 && imagery.tileSize !== 512) throw fail();
      const roads = object(m.roads,[...metadataKeys,'url','tiles','glyphs']);
      if ((roads.url === undefined) === (roads.tiles === undefined)) throw fail();
      const roadSource: RoadBasemap = {...metadata(roads),glyphs:publicUrl(roads.glyphs),...(roads.url === undefined ? {tiles:tileUrls(roads.tiles)} : {url:publicUrl(roads.url)})};
      if (!roadSource.glyphs.includes('{fontstack}') || !roadSource.glyphs.includes('{range}')) throw fail();
      map = {defaultView:m.defaultView,imagery:{...metadata(imagery),tiles:tileUrls(imagery.tiles),tileSize:imagery.tileSize},roads:roadSource};
    } else {
      object(m,['providerId','tiles','tileSize','attributionText','attributionUrl']);
      if (m.tileSize !== 256 && m.tileSize !== 512) throw fail();
      map = {providerId:id(m.providerId),tiles:tileUrls(m.tiles),tileSize:m.tileSize,attributionText:text(m.attributionText,500),attributionUrl:publicUrl(m.attributionUrl,true)};
    }
  }
  return {systems, scopes,...(simulation ? {simulation} : {}),...(map ? {map} : {})};
}
export function assertContextCredentials(config: ContextConfig, env: NodeJS.ProcessEnv) {
  if (config.systems.some(system => !env[system.tokenEnv]?.trim()) || (config.simulation?.enabled && !env[config.simulation.tokenEnv]?.trim())) throw new Error('业务查询凭证未配置，请在服务端环境变量中配置。');
}
export async function loadContextConfig(env: NodeJS.ProcessEnv = process.env): Promise<ContextConfig | undefined> {
  if (!env.LAB_CONTEXT_CONFIG) return undefined;
  if (!isAbsolute(env.LAB_CONTEXT_CONFIG)) throw new Error('LAB_CONTEXT_CONFIG 必须是配置文件的绝对路径。');
  let config: ContextConfig;
  try { config = parseContextConfig(JSON.parse((await readControlled(env.LAB_CONTEXT_CONFIG, 256 * 1024))!)); }
  catch { throw fail(); }
  assertContextCredentials(config, env); return config;
}
