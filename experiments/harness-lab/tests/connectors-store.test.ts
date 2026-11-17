import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, test, vi } from 'vitest';
import { CapabilityService, capabilityDigest } from '../src/capabilities/service.js';
import { initializeR2Schema } from '../src/capabilities/management.js';
import { initializeSkillSchema } from '../src/skills/service.js';
import { ConnectorService } from '../src/connectors/service.js';
import type { ConnectorActor, ConnectorConfigInput, ConnectorDiscovery, ConnectorPrincipal } from '../src/contracts/connectors.js';
import type { ContextConfig } from '../src/context/config.js';
import { validateConnectorConfig } from '../src/connectors/validation.js';

const roots:string[]=[];const services:ConnectorService[]=[];
afterEach(async()=>{for(const service of services.splice(0))service.close();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
const actor:ConnectorActor={userId:'administrator',assertActive:()=>{},assertAdministrator:()=>{}};
const user=(userId='alice',workspaceKind:'personal'|'task'='task',seatId='seat-a'):ConnectorPrincipal=>({userId,workspaceKind,seatId,assertActive:()=>{}});
const config=(extra:Partial<ConnectorConfigInput>={}):ConnectorConfigInput=>({name:'Knowledge',description:'Approved service',endpoint:'https://example.com/mcp',auth:{mode:'none',credentialSource:'organization'},approvedTargets:[],policy:{mode:'none',seatIds:[],personal:false},exposedTools:[],...extra});
const tool={name:'search',description:'Search',inputSchema:{type:'object',properties:{q:{type:'string'}},required:['q']},available:true,contractDigest:capabilityDigest({tool:'search'})};
const discovery:ConnectorDiscovery={protocolVersion:'2026-07-28',protocolEra:'modern',tools:[tool],digest:capabilityDigest([tool])};
async function setup(options:Parameters<typeof ConnectorService.open>[1]={}){const root=await mkdtemp(join(tmpdir(),'axon-r4-store-'));roots.push(root);const cap=await CapabilityService.open(root);initializeR2Schema(cap.db);initializeSkillSchema(cap.db);cap.close();const service=await ConnectorService.open(root,{createdNew:true,remoteFactory:()=>({discover:async()=>structuredClone(discovery),close:()=>{}}),...options});services.push(service);return{root,service};}
async function enable(service:ConnectorService,input=config()){let value=await service.create(actor,{...input,clientActionId:randomUUID()});const id=value.connection.connectorId;await service.discover(actor,id,{expectedRevisionId:value.revision.revisionId,clientActionId:randomUUID()});value=await service.update(actor,id,{...input,policy:{mode:'seats',seatIds:['seat-a'],personal:true},exposedTools:[{name:tool.name,contractDigest:tool.contractDigest}],expectedRevisionId:value.revision.revisionId,clientActionId:randomUUID()});await service.lifecycle(actor,id,{action:'restore',expectedStateRevision:0,clientActionId:randomUUID()});return id;}

test('CAS, replay receipts, immutable revisions and explicit exposure require actual discovery',async()=>{const{service}=await setup();const input={...config(),clientActionId:randomUUID()},copies=await Promise.all([service.create(actor,input),service.create(actor,input)]);expect(copies[0]).toEqual(copies[1]);const id=copies[0].connection.connectorId;expect(service.list(actor)).toHaveLength(1);await expect(service.create(actor,{...input,name:'changed'})).rejects.toMatchObject({code:'CONNECTOR_CONFLICT'});await expect(service.update(actor,id,{...config({exposedTools:[{name:'search',contractDigest:tool.contractDigest}]}),expectedRevisionId:copies[0].revision.revisionId,clientActionId:randomUUID()})).rejects.toMatchObject({code:'CONNECTOR_DISCOVERY_REQUIRED'});await service.discover(actor,id,{expectedRevisionId:copies[0].revision.revisionId,clientActionId:randomUUID()});const next={...config({policy:{mode:'all' as const,seatIds:[],personal:true},exposedTools:[{name:'search',contractDigest:tool.contractDigest}]}),expectedRevisionId:copies[0].revision.revisionId,clientActionId:randomUUID()},saved=await service.update(actor,id,next);expect(saved.revisions).toHaveLength(2);expect(saved.revisions[1]).toEqual(copies[0].revision);expect(await service.update(actor,id,next)).toEqual(saved);await expect(service.update(actor,id,{...next,clientActionId:randomUUID()})).rejects.toMatchObject({code:'CONNECTOR_CONFLICT'});await expect(service.update(actor,id,{...next,endpoint:'https://other.example/mcp',expectedRevisionId:saved.revision.revisionId,clientActionId:randomUUID()})).rejects.toMatchObject({code:'CONNECTOR_DISCOVERY_REQUIRED'});});

test('current workspace policy, explicit authenticated tool contract, ordinary disable and intent no replay',async()=>{const{service}=await setup(),id=await enable(service),principal=user(),admission=service.admit(id,principal);expect(service.catalog(user('bob','task','seat-b'))).toEqual([]);expect(service.catalog(user('seatless','personal','account-own'))).toHaveLength(1);expect(service.exposedTools(admission,principal)).toHaveLength(1);const input={intentId:randomUUID(),requestId:'request-a',action:'search',contractDigest:tool.contractDigest,argumentsDigest:capabilityDigest({q:'data'})},first=service.prepareIntent(principal,admission,input);expect(first.newlyCreated).toBe(true);expect(service.prepareIntent(principal,admission,input)).toEqual({...first,newlyCreated:false});service.markSent(principal,input.intentId,admission);expect(()=>service.markSent(principal,input.intentId,admission)).toThrow();expect(service.completeIntent(principal,input.intentId,'cancelled').state).toBe('unknown');expect(()=>service.intent(user('bob'),input.intentId)).toThrow();await service.lifecycle(actor,id,{action:'disable',expectedStateRevision:1,clientActionId:randomUUID()});expect(()=>service.admit(id,principal)).toThrow();expect(()=>service.assertAdmission(admission,principal)).not.toThrow();const value=service.detail(actor,id);await service.update(actor,id,{...config({policy:{mode:'none',seatIds:[],personal:false},exposedTools:value.revision.exposedTools}),expectedRevisionId:value.revision.revisionId,clientActionId:randomUUID()});expect(()=>service.assertAdmission(admission,principal)).toThrow();});

test('encrypted personal credentials stay per real account in private and authorized public task; no plaintext fallback',async()=>{const parent=await mkdtemp(join(tmpdir(),'axon-r4-key-'));roots.push(parent);const keyFile=join(parent,'key.json');await writeFile(keyFile,JSON.stringify({activeKeyId:'v1',keys:{v1:randomBytes(32).toString('base64')}}),{mode:0o600});const seen:string[]=[];const{root,service}=await setup({keyFile,remoteFactory:admission=>({discover:async()=>{seen.push(`${admission.subjectId}:${admission.headers.Authorization}`);return structuredClone(discovery);},close:()=>{}})});const initial=await service.create(actor,{...config({auth:{mode:'bearer',credentialSource:'personal'}}),clientActionId:randomUUID()}),id=initial.connection.connectorId;await service.setCredential(actor,id,{value:'admin-private-token',expectedVersion:0,clientActionId:randomUUID()},true);await service.discover(actor,id,{expectedRevisionId:initial.revision.revisionId,clientActionId:randomUUID()});await service.update(actor,id,{...config({auth:{mode:'bearer',credentialSource:'personal'},policy:{mode:'seats',seatIds:['seat-a'],personal:true},exposedTools:[{name:'search',contractDigest:tool.contractDigest}]}),expectedRevisionId:initial.revision.revisionId,clientActionId:randomUUID()});await service.lifecycle(actor,id,{action:'restore',expectedStateRevision:0,clientActionId:randomUUID()});const credential={value:'alice-very-private-token',expectedVersion:0,clientActionId:randomUUID()};expect(await service.setCredential(user(),id,credential)).toMatchObject({configured:true,version:1});expect(await service.setCredential(user(),id,credential)).toMatchObject({version:1});await expect(service.setCredential(user(),id,{...credential,value:'changed'})).rejects.toMatchObject({code:'CONNECTOR_CONFLICT'});expect(()=>service.admit(id,user('bob'))).toThrow();const own=service.admit(id,user()),ownPersonal=service.admit(id,user('alice','personal'));expect(own.headers.Authorization).toBe(ownPersonal.headers.Authorization);await service.discoverForUse(id,user());expect(seen).toEqual(['user:administrator:Bearer admin-private-token','user:alice:Bearer alice-very-private-token']);expect(service.catalog(user())[0].tools).toHaveLength(1);expect(service.catalog(user('bob'))[0].tools).toEqual([]);const publicBytes=JSON.stringify(service.detail(actor,id));expect(publicBytes).not.toContain('very-private-token');expect(publicBytes).not.toContain('admin-private-token');expect((await readFile(join(root,'capabilities/capabilities.sqlite'))).includes(Buffer.from('alice-very-private-token'))).toBe(false);await service.revokeCredential(user(),id,{expectedVersion:1,clientActionId:randomUUID()});expect(()=>service.assertAdmission(own,user())).toThrow();expect(()=>service.admit(id,actor)).not.toThrow();const noKey=await setup();const other=await noKey.service.create(actor,{...config({auth:{mode:'bearer',credentialSource:'organization'}}),clientActionId:randomUUID()});await expect(noKey.service.setCredential(actor,other.connection.connectorId,{value:'no-plaintext',expectedVersion:0,clientActionId:randomUUID()},true)).rejects.toMatchObject({code:'CONNECTOR_KEY_UNAVAILABLE'});});

test('fixed singleton mappings retain IDs when renamed/disabled; no config or create bypass',async()=>{const{service}=await setup({env:{QUERY_TOKEN:'query-token'}});const context:ContextConfig={systems:[{id:'original-source',name:'Original',adapter:'mock-information-http',baseUrl:'https://legacy.example',tokenEnv:'QUERY_TOKEN'}],scopes:[]};service.initializeLegacy(context);const legacy=service.list(actor)[0];expect(legacy.businessSlot).toBe('information');expect(service.resolveLegacy({systemId:'original-source'}).token).toBe('query-token');const before=service.detail(actor,legacy.connectorId).revision;await service.update(actor,legacy.connectorId,{...config({auth:before.auth,policy:before.policy,name:'Renamed',endpoint:'https://new.example/'}),expectedRevisionId:legacy.revisionId,clientActionId:randomUUID()});expect(service.resolveLegacy({systemId:'original-source'}).endpoint).toBe('https://new.example');expect(service.list(actor)).toHaveLength(1);await service.lifecycle(actor,legacy.connectorId,{action:'disable',expectedStateRevision:0,clientActionId:randomUUID()});expect(()=>service.resolveLegacy({systemId:'original-source'})).toThrow();expect(service.legacyProjection()?.context?.systems[0].id).toBe('original-source');const bindings=service.db.prepare('SELECT * FROM r4_connection_bindings').all();expect(bindings).toHaveLength(1);expect(()=>service.db.prepare('INSERT INTO r4_connection_bindings VALUES(?,?,?)').run('information','new',JSON.stringify({}))).toThrow();await expect(service.create(actor,{...config(),businessSlot:'information',clientActionId:randomUUID()} as never)).rejects.toThrow();const duplicate=await setup();expect(()=>duplicate.service.initializeLegacy({...context,systems:[...context.systems,{...context.systems[0],id:'second'}]})).toThrow('多条');expect(duplicate.service.list(actor)).toEqual([]);});


test('optional generic inbound source is preserved as its exact original channel without invented system binding',async()=>{const{service}=await setup({env:{QUERY:'query-value'},ingressEnv:{GENERIC_INGRESS:'generic-original-credential-value'}});service.initializeLegacy(undefined,{enabled:false,concurrency:1,modelConcurrency:1,backlogLimit:100,sources:[{sourceId:'existing-generic',name:'Generic channel',credentialRef:'GENERIC_INGRESS',allowedProfileIds:['legacy'],allowedRecipientSeatIds:['seat-a']}],profiles:[{id:'legacy',name:'Legacy',goal:'Process',tools:['source_read'],skillIds:[],agentIds:[],instructions:'',resources:[]}]});const value=service.legacyProjection();expect(value?.background?.sources[0].sourceId).toBe('existing-generic');expect(value?.background?.sources[0].systemId).toBeUndefined();expect(service.resolveLegacy({sourceId:'existing-generic'}).token).toBe('generic-original-credential-value');const row=service.db.prepare("SELECT data FROM r4_connection_bindings WHERE slot='ingress'").get()!;expect(JSON.parse(String(row.data)).systemIds).toEqual([]);expect(service.list(actor)).toHaveLength(1);});

test('lifecycle and credential CAS recheck a concurrent commit at the transaction boundary', async () => {
  const {service} = await setup({env:{QUERY:'original-token'}});
  service.initializeLegacy({systems:[{id:'intel',name:'Original',adapter:'mock-information-http',baseUrl:'https://legacy.example',tokenEnv:'QUERY'}],scopes:[]});
  const id = 'legacy-information', exec = service.db.exec.bind(service.db);
  let concurrent: (() => void) | undefined;
  const boundary = vi.spyOn(service.db, 'exec').mockImplementation(sql => {
    if (sql === 'BEGIN IMMEDIATE' && concurrent) {
      const commit = concurrent; concurrent = undefined; commit();
    }
    return exec(sql);
  });
  try {
    // Another connection's transaction can commit after the optimistic read and before BEGIN.
    concurrent = () => service.db.prepare("UPDATE r4_connections SET data=json_set(data,'$.state','disabled','$.stateRevision',1) WHERE id=?").run(id);
    await expect(service.lifecycle(actor,id,{action:'restore',expectedStateRevision:0,clientActionId:randomUUID()})).rejects.toMatchObject({code:'CONNECTOR_CONFLICT'});
    expect(service.detail(actor,id).connection).toMatchObject({state:'disabled',stateRevision:1});
    concurrent = () => service.db.prepare("UPDATE r4_connection_credentials SET version=2,data=json_set(data,'$.version',2,'$.revoked',json('true')) WHERE connection_id=? AND subject_id='organization'").run(id);
    await expect(service.revokeCredential(actor,id,{expectedVersion:1,clientActionId:randomUUID()},true)).rejects.toMatchObject({code:'CONNECTOR_CONFLICT'});
    expect(service.credentialStatus(id,actor,true)).toMatchObject({version:2,configured:false});
    expect(service.detail(actor,id).audit).toEqual([]);
  } finally { boundary.mockRestore(); }
});

test('restart requires ciphertext keys, preserves disabled fixed mappings and expires intents without replay', async () => {
  const parent = await mkdtemp(join(tmpdir(),'axon-r4-restart-')); roots.push(parent);
  const keyFile = join(parent,'keys.json');
  await writeFile(keyFile,JSON.stringify({activeKeyId:'v1',keys:{v1:randomBytes(32).toString('base64')}}),{mode:0o600});
  const {root,service} = await setup({keyFile,env:{QUERY:'old-environment-token'}});
  service.initializeLegacy({systems:[{id:'original',name:'Original',adapter:'mock-information-http',baseUrl:'https://legacy.example',tokenEnv:'QUERY'}],scopes:[]});
  await service.setCredential(actor,'legacy-information',{value:'encrypted-rotated-token',expectedVersion:1,clientActionId:randomUUID()},true);
  await service.lifecycle(actor,'legacy-information',{action:'disable',expectedStateRevision:0,clientActionId:randomUUID()});
  const id = await enable(service), principal = user(), admission = service.admit(id,principal);
  const prepared = {intentId:randomUUID(),requestId:'before-restart',action:'search',contractDigest:tool.contractDigest,argumentsDigest:capabilityDigest({q:'original'})};
  const sent = {...prepared,intentId:randomUUID()};
  service.prepareIntent(principal,admission,prepared);
  service.prepareIntent(principal,admission,sent); service.markSent(principal,sent.intentId,admission);
  service.close();
  await expect(ConnectorService.open(root,{env:{QUERY:'old-environment-token'}})).rejects.toMatchObject({code:'CONNECTOR_KEY_UNAVAILABLE'});
  const remoteFactory = vi.fn(() => ({discover:async()=>structuredClone(discovery),close:()=>{}}));
  const reopened = await ConnectorService.open(root,{keyFile,env:{QUERY:'old-environment-token'},remoteFactory}); services.push(reopened);
  expect(reopened.intent(principal,prepared.intentId).state).toBe('cancelled');
  expect(reopened.intent(principal,sent.intentId).state).toBe('unknown');
  expect(reopened.legacyProjection()?.context?.systems[0].id).toBe('original');
  expect(()=>reopened.resolveLegacy({systemId:'original'})).toThrow();
  await reopened.lifecycle(actor,'legacy-information',{action:'restore',expectedStateRevision:1,clientActionId:randomUUID()});
  expect(reopened.resolveLegacy({systemId:'original'}).token).toBe('encrypted-rotated-token');
  const retried = reopened.prepareIntent(principal,reopened.admit(id,principal),sent);
  expect(retried).toMatchObject({newlyCreated:false,intent:{state:'unknown'}});
  expect(()=>reopened.markSent(principal,sent.intentId,reopened.admit(id,principal))).toThrow();
  expect(remoteFactory).not.toHaveBeenCalled();
});

test('policy and auth enums reject coerced shapes and fixed adapters retain their original bearer contract', async () => {
  for (const input of [config({policy:{mode:['none'],seatIds:[],personal:false} as never}),config({auth:{mode:['none'],credentialSource:'organization'} as never}),config({auth:{mode:'bearer',credentialSource:['organization']} as never})]) {
    expect(()=>validateConnectorConfig(input)).toThrow();
  }
  const {service}=await setup({env:{QUERY:'original-token'}});
  service.initializeLegacy({systems:[{id:'intel',name:'Original',adapter:'mock-information-http',baseUrl:'https://legacy.example',tokenEnv:'QUERY'}],scopes:[]});
  const current=service.revision('legacy-information');
  for (const auth of [{mode:'none',credentialSource:'organization'},{mode:'api-key',credentialSource:'organization',headerName:'X-API-Key'},{mode:'bearer',credentialSource:'personal'}] as const) {
    await expect(service.update(actor,current.connectorId,{...config({name:current.name,description:current.description,endpoint:current.endpoint,policy:current.policy,auth}),expectedRevisionId:current.revisionId,clientActionId:randomUUID()})).rejects.toMatchObject({code:'INVALID_CONNECTOR_INPUT'});
  }
  expect(service.revision(current.connectorId)).toEqual(current);
  const generic=await setup({ingressEnv:{INGRESS:'original-inbound-token-at-least-24'}});
  generic.service.initializeLegacy(undefined,{enabled:false,concurrency:1,modelConcurrency:1,backlogLimit:100,sources:[{sourceId:'generic',name:'Original generic source',credentialRef:'INGRESS',allowedProfileIds:['legacy'],allowedRecipientSeatIds:['seat-a']}],profiles:[{id:'legacy',name:'Legacy',goal:'Process',tools:['source_read'],skillIds:[],agentIds:[],instructions:'',resources:[]}]});
  await expect(generic.service.setCredential(actor,'legacy-ingress',{value:'too-short',expectedVersion:1,clientActionId:randomUUID()},true,'generic')).rejects.toMatchObject({code:'INVALID_CONNECTOR_INPUT'});
  expect(generic.service.resolveLegacy({sourceId:'generic'}).token).toBe('original-inbound-token-at-least-24');
});
