import type { ContextConfig } from '../context/config.js';
import { readContextJson } from '../context/http.js';
import { contextInteger, contextRecord, contextText } from '../context/validation.js';
import { RequestError } from '../contracts/errors.js';

const instanceId = (value: unknown): string => {
  const id = contextText(value, 64);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(id)) throw new RequestError('SCENARIO_SCOPE_CONFLICT', '资料归属无效。', 409);
  return id;
};
const mismatch = () => new RequestError('SCENARIO_SCOPE_CONFLICT', '资料归属与已保存来源不一致。', 409);

/** A source-derived admission view. The source pointer remains the sole active-run authority. */
export class ScenarioScope {
  private current?: string;
  private revision = 0;
  private closing = new Set<string>();
  constructor(private readonly config: ContextConfig, private readonly env: NodeJS.ProcessEnv = process.env) {}
  activeId() { return this.current; }
  activeRevision() { return this.revision; }
  isWritable(id: string) { return id === this.current && !this.closing.has(id); }
  assertWritable(id: string) {
    if (!this.isWritable(id)) throw new RequestError('TASK_READ_ONLY', '资料已只读，请重新进入后操作。', 409);
  }
  close(id: string) { this.closing.add(instanceId(id)); }
  private async read(path: string): Promise<unknown> {
    const config = this.config.simulation, token = config && this.env[config.tokenEnv];
    if (!config?.enabled || !token) throw new RequestError('SIMULATION_UNAVAILABLE', '业务资料来源暂不可用。', 503);
    return readContextJson(new URL(`${config.baseUrl}/control/${path}`), token, undefined, {maxBytes: 2 * 1024 * 1024});
  }
  provenance(id: string) { return this.read(`instances/${encodeURIComponent(instanceId(id))}/provenance`); }
  async reconcileLegacy(events: Array<{id:string;sourceId:string;sourceMessageId:string;title:string;text:string;subjectId?:string;occurredAt?:string;scenarioInstanceId?:string;files?:unknown[]}>, bind: (eventId:string,id:string)=>Promise<void>) {
    const candidates=events.filter(event=>event.scenarioInstanceId===undefined && this.config.simulation?.sources.some(mapping=>mapping.sourceId===event.sourceId && this.config.systems.some(system=>system.id===mapping.systemId&&system.scenarioClock===true)));
    if(!candidates.length)return;
    let cursor: string|undefined;
    const seen=new Set<string>();
    do {
      const list=contextRecord(await this.read(`instances${cursor?`?cursor=${encodeURIComponent(cursor)}`:''}`),['items','activeInstanceId','activeRevision','hasMore','nextCursor'],['items','hasMore','nextCursor']);
      if(!Array.isArray(list.items))throw mismatch();
      for(const item of list.items){
        const id=instanceId((item as {instanceId?:unknown}).instanceId);
        const raw=contextRecord(await this.provenance(id),['instanceId','tasks','notifications','actions'],['instanceId','notifications']);
        if(raw.instanceId!==id||!Array.isArray(raw.notifications))throw mismatch();
        for(const entry of raw.notifications){
          const row=contextRecord(entry,['actionId','systemId','notification'],['actionId','systemId','notification']);
          const source=this.config.simulation!.sources.find(mapping=>mapping.systemId===row.systemId);
          const notice=contextRecord(row.notification,['scenarioInstanceId','sourceMessageId','title','text','subjectId','occurredAt'],['sourceMessageId','title','text']);
          for(const event of candidates.filter(event=>event.sourceId===source?.sourceId && event.sourceMessageId===notice.sourceMessageId)){
            if(event.files?.length)throw mismatch();
            if(notice.scenarioInstanceId!==undefined&&notice.scenarioInstanceId!==id)throw mismatch();
            for(const key of ['sourceMessageId','title','text','subjectId','occurredAt'] as const)if(event[key]!==notice[key])throw mismatch();
            await bind(event.id,id);
          }
        }
      }
      if(list.hasMore!==true)break;
      cursor=contextText(list.nextCursor,200);
      if(seen.has(cursor))throw mismatch();seen.add(cursor);
    } while(cursor);
  }
  async sync() {
    const response = contextRecord(await this.read('instances'), ['items','activeInstanceId','activeRevision','hasMore','nextCursor'], ['activeInstanceId','activeRevision']);
    this.current = response.activeInstanceId === null ? undefined : instanceId(response.activeInstanceId);
    this.revision = contextInteger(response.activeRevision, 0);
  }
  async confirmActive(id: string) {
    await this.sync();
    if (this.current !== id) throw mismatch();
  }
  open(id: string) {
    if(this.current!==id)throw mismatch();
    this.closing.delete(id);
  }
  async verifyIncoming(sourceId: string, input: {scenarioInstanceId?: string; sourceMessageId: string; title: string; text: string; subjectId?: string; occurredAt?: string; uploadIds?: string[]}): Promise<string | undefined> {
    const mapping = this.config.simulation?.sources.find(source => source.sourceId === sourceId);
    const trusted = mapping && this.config.systems.some(system => system.id === mapping.systemId && system.scenarioClock === true);
    if (!trusted) {
      if (input.scenarioInstanceId !== undefined) throw mismatch();
      return undefined;
    }
    if (input.scenarioInstanceId === undefined) throw mismatch();
    const id = instanceId(input.scenarioInstanceId);
    const raw = contextRecord(await this.read(`instances/${encodeURIComponent(id)}/notifications/${encodeURIComponent(input.sourceMessageId)}`), ['instanceId','systemId','notification','actionId'], ['instanceId','systemId','notification','actionId']);
    if (raw.instanceId !== id || raw.systemId !== mapping.systemId) throw mismatch();
    const saved = contextRecord(raw.notification, ['sourceMessageId','title','text','subjectId','occurredAt','scenarioInstanceId'], ['sourceMessageId','title','text']);
    if (saved.scenarioInstanceId !== undefined && saved.scenarioInstanceId !== id) throw mismatch();
    for (const key of ['sourceMessageId','title','text','subjectId','occurredAt'] as const) if (saved[key] !== input[key]) throw mismatch();
    if (input.uploadIds?.length) throw mismatch();
    return id;
  }
}
