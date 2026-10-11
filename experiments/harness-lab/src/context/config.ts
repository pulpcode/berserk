import type { MapConfig } from '../contracts/context.js';
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
    const m = object(raw.map,['providerId','tiles','tileSize','attributionText','attributionUrl']);
    if (!Array.isArray(m.tiles) || m.tiles.length !== 1 || ![256,512].includes(Number(m.tileSize))) throw fail();
    const tiles = m.tiles.map(value => text(value,2048));
    for (const value of [...tiles,text(m.attributionUrl,2048)]) { const url = new URL(value); if (!['http:','https:'].includes(url.protocol) || url.username || url.password) throw fail(); }
    map = {providerId:id(m.providerId),tiles,tileSize:Number(m.tileSize),attributionText:text(m.attributionText,500),attributionUrl:text(m.attributionUrl,2048)};
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
