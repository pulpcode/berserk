import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { AccessStore } from '../access/store.js';
import type { ContextService } from '../context/service.js';
import type { Identity } from '../contracts/access.js';
import type { AnnotationAction, AnnotationBaseInput, AnnotationBinding, AnnotationChange, AnnotationComparison, AnnotationContext, AnnotationCurrent, AnnotationCurrentInput, AnnotationDocument, AnnotationDraft, AnnotationFromSourceInput, AnnotationFromSourcesInput, AnnotationHostIntent, AnnotationHostResult, AnnotationEditBasis, AnnotationFromSourceResult, AnnotationListing, AnnotationOperation, AnnotationPage, AnnotationPublication, AnnotationReadInput, AnnotationReadResult, AnnotationReceipt, AnnotationRef, AnnotationSelection, AnnotationVersion, LoadedAnnotationSelection } from '../contracts/annotations.js';
import { RequestError } from '../contracts/errors.js';
import { AnnotationError } from './errors.js';
import type { ContextRef } from '../contracts/context.js';
import { stateError } from '../resources/files.js';
import type { WorkspaceStore } from '../workspaces/store.js';
import { AnnotationStore } from './store.js';
import * as validate from './validation.js';

export interface AnnotationActor { userId: string; seatId: string }
interface StoredBinding { sessionId: string; taskId: string; workspaceId: string; ownerSeatId: string; baseRef: AnnotationRef | null; bindingRevision: number }
interface StoredSet extends AnnotationDraft { ownerSeatId: string; createdByUserId: string }
interface StoredRevision { setId: string; revision: number; document: AnnotationDocument; hash: string; requiredSystemIds: string[]; createdAt: string; createdByUserId: string }
interface StoredPublication extends AnnotationPublication { setId: string; revision: number }
interface ActionOptions {
  receiptInput?: {clientActionId:string; hostIntent?:AnnotationHostIntent}; basis?: AnnotationEditBasis;
  fromSource?: AnnotationFromSourceResult; fromSources?: AnnotationFromSourceResult[];
  committed?: ()=>void;
}
const missing = () => new RequestError('ANNOTATION_NOT_FOUND','标注不存在或无权访问。',404);
const conflict = (message: string) => new RequestError('ANNOTATION_CONFLICT',message,409);
const stale = (kind: 'draft' | 'binding' | 'current', message: string) => new AnnotationError('ANNOTATION_CONFLICT',message,{outcome:'not_committed',resources:[{kind,state:'stale'}]});
const hash = (value: unknown) => createHash('sha256').update(validate.canonical(value)).digest('hex');
const parse = <T>(row: Record<string, unknown> | undefined): T | undefined => { if(!row) return undefined; try {return JSON.parse(String(row.data)) as T;} catch {throw stateError();} };
const pagination = <T>(items: T[],offset=0,limit=50): AnnotationPage<T> => {const valid=validate.page(offset,limit); return {items:items.slice(valid.offset,valid.offset+valid.limit),...valid,total:items.length,hasMore:items.length>valid.offset+valid.limit};};

/** One authorization/effect path for HTTP and the main Pi session. */
export class AnnotationService {
  readonly store: AnnotationStore;
  isSessionBusy?: (sessionId: string) => boolean;
  constructor(readonly db: DatabaseSync, readonly workspaces: WorkspaceStore, readonly access?: AccessStore, public context?: ContextService) {this.store=new AnnotationStore(db);}
  actorForSeat(seatId: string,userId?: string): AnnotationActor {
    if(this.access) {
      const actor=userId ? this.access.identity(userId) : this.access.identityForSeat(seatId);
      if(!actor || actor.seatId!==seatId) throw new RequestError('AUTH_REQUIRED','原操作账号已失效，请重新登录。',401);
      return {userId:actor.userId,seatId};
    }
    if(userId!==undefined && userId!==`test:${seatId}`) throw missing();
    return {userId:`test:${seatId}`,seatId};
  }
  private identity(actor: AnnotationActor): Identity | undefined {
    if(!this.access) {if(actor.userId!==`test:${actor.seatId}`) throw missing(); return undefined;}
    const current=this.access.identity(actor.userId);
    if(!current || current.seatId!==actor.seatId) throw new RequestError('AUTH_REQUIRED','原操作账号已失效，请重新登录。',401);
    return current;
  }
  private task(actor: AnnotationActor,taskId: string,write=false) {
    this.identity(actor);
    if(this.access) return this.access.get(taskId,actor.seatId,write);
    if(!this.workspaces.listAll().some(w=>w.taskSpaceId===taskId && w.seatId===actor.seatId)) throw missing();
    return undefined;
  }
  private session(actor: AnnotationActor,sessionId: string,write=false) {
    this.identity(actor); validate.uuid(sessionId);
    const workspaceId=this.workspaces.binding(sessionId,actor.seatId); if(!workspaceId) throw missing();
    const workspace=this.workspaces.get(workspaceId,actor.seatId); this.task(actor,workspace.taskSpaceId,write);
    return workspace;
  }
  private allowedSystems(actor: AnnotationActor,systems: string[]) {
    const available=new Set(this.context?.catalog(actor.seatId).systems.map(s=>s.id) ?? []);
    if(systems.some(id=>!available.has(id))) throw missing();
  }
  private rawBinding(sessionId: string) {return parse<StoredBinding>(this.db.prepare('SELECT data FROM annotation_session_bindings WHERE session_id=?').get(sessionId));}
  private rawSet(setId: string) {const set=parse<StoredSet>(this.db.prepare('SELECT data FROM annotation_sets WHERE id=?').get(setId)); if(!set || set.setId!==setId) throw missing(); return set;}
  private setForSession(sessionId: string) {return parse<StoredSet>(this.db.prepare('SELECT data FROM annotation_sets WHERE owner_session_id=?').get(sessionId));}
  private rawRevision(setId: string,revision: number) {
    const saved=parse<StoredRevision>(this.db.prepare('SELECT data FROM annotation_revisions WHERE set_id=? AND revision=?').get(setId,revision));
    if(!saved) throw missing();
    if(saved.setId!==setId || saved.revision!==revision || hash(saved.document)!==saved.hash || !Array.isArray(saved.requiredSystemIds) || saved.requiredSystemIds.some(id=>typeof id!=='string')) throw stateError();
    return saved;
  }
  private publicDocument(document: AnnotationDocument): AnnotationDocument {
    const copy=structuredClone(document);
    for(const layer of copy.layers) for(const feature of layer.features) if(feature.originFeatureRef && 'setId' in feature.originFeatureRef.ref) delete feature.originFeatureRef;
    return copy;
  }
  private publicationDTO(publication: StoredPublication): AnnotationPublication {
    return {publicationId:publication.publicationId,taskId:publication.taskId,title:publication.title,note:publication.note,hash:publication.hash,publishedAt:publication.publishedAt,publishedByUserId:publication.publishedByUserId};
  }
  private publication(actor: AnnotationActor,publicationId: string,taskId?: string) {
    const published=parse<StoredPublication>(this.db.prepare('SELECT data FROM annotation_publications WHERE id=?').get(publicationId));
    if(!published || (taskId && published.taskId!==taskId)) throw missing();
    this.task(actor,published.taskId); const saved=this.rawRevision(published.setId,published.revision); this.allowedSystems(actor,saved.requiredSystemIds);
    if(published.hash!==hash(this.publicDocument(saved.document))) throw stateError();
    return {published,saved};
  }
  private accessible(actor: AnnotationActor,taskId: string,reference: AnnotationRef) {
    this.task(actor,taskId); const normalized=validate.ref(reference);
    if('publicationId' in normalized) {const saved=this.publication(actor,normalized.publicationId,taskId).saved;return {...saved,document:this.publicDocument(saved.document)};}
    const set=this.rawSet(normalized.setId);
    if(set.taskId!==taskId || set.ownerSeatId!==actor.seatId || this.workspaces.binding(set.ownerSessionId,actor.seatId)!==set.workspaceId) throw missing();
    const saved=this.rawRevision(set.setId,normalized.revision); this.allowedSystems(actor,saved.requiredSystemIds); return saved;
  }
  /** Metadata admission deliberately avoids decoding geometry for ordinary chat turns. */
  private authorizeReference(actor: AnnotationActor,taskId: string,reference: AnnotationRef) {
    this.task(actor,taskId); const normalized=validate.ref(reference);
    let setId: string,revision: number;
    if('publicationId' in normalized) {
      const published=parse<StoredPublication>(this.db.prepare('SELECT data FROM annotation_publications WHERE id=?').get(normalized.publicationId));
      if(!published || published.taskId!==taskId) throw missing(); setId=published.setId;revision=published.revision;
    } else {
      const set=this.rawSet(normalized.setId);
      if(set.taskId!==taskId || set.ownerSeatId!==actor.seatId || this.workspaces.binding(set.ownerSessionId,actor.seatId)!==set.workspaceId) throw missing();
      setId=set.setId;revision=normalized.revision;
    }
    const row=this.db.prepare("SELECT json_extract(data,'$.requiredSystemIds') systems FROM annotation_revisions WHERE set_id=? AND revision=?").get(setId,revision);
    if(!row) throw missing();
    let systems: unknown;try {systems=JSON.parse(String(row.systems));} catch {throw stateError();}
    if(!Array.isArray(systems) || systems.some(id=>typeof id!=='string')) throw stateError();this.allowedSystems(actor,systems);
  }
  private draftDTO(actor: AnnotationActor,set: StoredSet): AnnotationDraft {
    this.authorizeReference(actor,set.taskId,{setId:set.setId,revision:set.headRevision});
    return {setId:set.setId,ownerSessionId:set.ownerSessionId,taskId:set.taskId,workspaceId:set.workspaceId,headRevision:set.headRevision,title:set.title,hash:set.hash,baseRef:set.baseRef,createdAt:set.createdAt,updatedAt:set.updatedAt};
  }
  binding(actor: AnnotationActor,sessionId: string): AnnotationBinding {
    const workspace=this.session(actor,sessionId), binding=this.rawBinding(sessionId), set=this.setForSession(sessionId);
    if(binding && (binding.workspaceId!==workspace.id || binding.taskId!==workspace.taskSpaceId || binding.ownerSeatId!==actor.seatId)) throw stateError();
    if(binding?.baseRef) this.authorizeReference(actor,workspace.taskSpaceId,binding.baseRef);
    const task=this.task(actor,workspace.taskSpaceId);
    return {sessionId,taskId:workspace.taskSpaceId,workspaceId:workspace.id,bindingRevision:binding?.bindingRevision ?? 0,baseRef:binding?.baseRef ?? null,draft:set ? this.draftDTO(actor,set) : null,writable:!task || task.state==='active'};
  }
  automaticContext(actor: AnnotationActor,sessionId: string): AnnotationContext | undefined {
    this.session(actor,sessionId);
    if(!this.rawBinding(sessionId) && !this.setForSession(sessionId)) return undefined;
    const binding=this.binding(actor,sessionId);
    return {sessionId,draft:binding.draft ? {setId:binding.draft.setId,revision:binding.draft.headRevision} : null,baseRef:binding.baseRef,writable:binding.writable};
  }
  version(actor: AnnotationActor,taskId: string,reference: AnnotationRef): AnnotationVersion {
    const normalized=validate.ref(reference), saved=this.accessible(actor,taskId,normalized);
    const document='publicationId' in normalized ? this.publicDocument(saved.document) : structuredClone(saved.document);
    const publication='publicationId' in normalized ? this.publication(actor,normalized.publicationId,taskId).published : undefined;
    return {ref:normalized,title:publication?.title ?? document.title,hash:hash(document),createdAt:publication?.publishedAt ?? saved.createdAt,document};
  }
  /** Private URL lookup still checks the original seat; publication grants never widen it. */
  privateVersion(actor: AnnotationActor,setId: string,revision: number) {const set=this.rawSet(validate.uuid(setId)); return this.version(actor,set.taskId,{setId,revision:validate.integer(revision,1)});}
  publishedVersion(actor: AnnotationActor,publicationId: string) {const {published}=this.publication(actor,validate.uuid(publicationId)); return this.version(actor,published.taskId,{publicationId});}
  canSetCurrent(actor: AnnotationActor,taskId: string): boolean {
    const identity=this.identity(actor),task=this.task(actor,taskId);
    return task ? task.visibility==='public' ? !!identity?.createPublicTask : task.ownerSeatId===actor.seatId : true;
  }
  list(actor: AnnotationActor,taskId: string,offset=0,limit=50): AnnotationListing {
    this.task(actor,taskId); validate.page(offset,limit);
    const drafts: AnnotationDraft[]=[],publications: AnnotationPublication[]=[];
    for(const row of this.db.prepare('SELECT data FROM annotation_sets WHERE task_id=? AND owner_seat_id=? ORDER BY rowid DESC').all(taskId,actor.seatId)) {
      try {drafts.push(this.draftDTO(actor,parse<StoredSet>(row)!));} catch(error) {if(!(error instanceof RequestError && error.statusCode===404)) throw error;}
    }
    for(const row of this.db.prepare('SELECT id FROM annotation_publications WHERE task_id=? ORDER BY rowid DESC').all(taskId)) {
      try {publications.push(this.publicationDTO(this.publication(actor,String(row.id),taskId).published));} catch(error) {if(!(error instanceof RequestError && error.statusCode===404)) throw error;}
    }
    return {drafts:pagination(drafts,offset,limit),publications:pagination(publications,offset,limit),canSetCurrent:this.canSetCurrent(actor,taskId)};
  }
  current(actor: AnnotationActor,taskId: string): AnnotationCurrent {
    this.task(actor,taskId);
    const current=parse<AnnotationCurrent>(this.db.prepare('SELECT data FROM task_annotation_selections WHERE task_id=? ORDER BY sequence DESC LIMIT 1').get(taskId));
    if(!current) return {taskId,sequence:0,publication:null};
    if(!current.publication) throw stateError();
    current.publication=this.publicationDTO(this.publication(actor,current.publication.publicationId,taskId).published); return current;
  }
  history(actor: AnnotationActor,taskId: string,offset=0,limit=50): AnnotationPage<AnnotationCurrent> {
    this.task(actor,taskId); const items: AnnotationCurrent[]=[];
    for(const row of this.db.prepare('SELECT data FROM task_annotation_selections WHERE task_id=? ORDER BY sequence DESC').all(taskId)) {
      const item=parse<AnnotationCurrent>(row)!; if(!item.publication) throw stateError();
      try {item.publication=this.publicationDTO(this.publication(actor,item.publication.publicationId,taskId).published);items.push(item);} catch(error) {if(!(error instanceof RequestError && error.statusCode===404)) throw error;}
    }
    return pagination(items,offset,limit);
  }
  read(actor: AnnotationActor,taskId: string,input: AnnotationReadInput): AnnotationReadResult {
    const normalized=validate.readInput(input), version=this.version(actor,taskId,normalized.ref);
    const layers=version.document.layers.filter(layer=>!normalized.layerIds || normalized.layerIds.includes(layer.layerId));
    if(normalized.layerIds?.some(id=>!layers.some(layer=>layer.layerId===id))) throw missing();
    const objects=layers.flatMap(layer=>layer.features.filter(feature=>!normalized.objectIds || normalized.objectIds.includes(feature.objectId)).map(feature=>{
      const selected: AnnotationReadResult['objects']['items'][number]={objectId:feature.objectId,name:feature.name,kind:feature.kind,layerId:layer.layerId};
      for(const field of normalized.fields ?? []) if(feature[field]!==undefined) Object.assign(selected,{[field]:feature[field]});
      return selected;
    }));
    if(normalized.objectIds?.some(id=>!objects.some(object=>object.objectId===id))) throw missing();
    const result: AnnotationReadResult={ref:version.ref,title:version.title,hash:version.hash,createdAt:version.createdAt,layers:layers.filter(layer=>!normalized.objectIds || layer.features.some(feature=>normalized.objectIds!.includes(feature.objectId))).map(({layerId,name,order,defaultVisible})=>({layerId,name,order,defaultVisible})),objects:pagination(objects,normalized.offset,normalized.limit)};
    if(Buffer.byteLength(JSON.stringify(result))>256*1024) throw validate.tooLarge();
    return result;
  }
  resolveSelections(actor: AnnotationActor,taskId: string,selections: AnnotationSelection[]): LoadedAnnotationSelection[] {
    if(!Array.isArray(selections) || selections.length>20) throw validate.invalid();
    const result=selections.map(value=>{
      const selection=validate.selection(value), {layerIds,objectIds,...reference}=selection;
      const version=this.version(actor,taskId,reference);
      const selectedLayers=layerIds ? version.document.layers.filter(layer=>layerIds.includes(layer.layerId)) : [];
      const selectedObjects=objectIds ? version.document.layers.flatMap(layer=>layer.features.filter(feature=>objectIds.includes(feature.objectId)).map(feature=>({objectId:feature.objectId,name:feature.name,kind:feature.kind,layerId:layer.layerId}))) : [];
      if(layerIds?.some(id=>!selectedLayers.some(layer=>layer.layerId===id)) || objectIds?.some(id=>!selectedObjects.some(feature=>feature.objectId===id))) throw missing();
      return {ref:reference,hash:version.hash,title:version.title,...(layerIds ? {layerIds} : {}),...(objectIds ? {objectIds} : {}),layers:selectedLayers.map(({layerId,name})=>({layerId,name})),objects:selectedObjects};
    });
    if(Buffer.byteLength(JSON.stringify(result))>256*1024) throw validate.tooLarge(); return result;
  }
  private ancestry(reference: AnnotationRef): Map<string,number> {
    const found=new Map<string,number>(); let cursor: AnnotationRef | null=reference;
    while(cursor) {
      let setId: string,revision: number;
      if('publicationId' in cursor) {
        const publication=parse<StoredPublication>(this.db.prepare('SELECT data FROM annotation_publications WHERE id=?').get(cursor.publicationId));
        if(!publication) throw stateError(); setId=publication.setId;revision=publication.revision;
      } else {setId=cursor.setId;revision=cursor.revision;}
      if(found.has(setId) || found.size>10000) throw stateError();
      found.set(setId,revision); cursor=this.rawSet(setId).baseRef;
    }
    return found;
  }
  compare(actor: AnnotationActor,taskId: string,left: AnnotationRef,right: AnnotationRef,offset=0,limit=50): AnnotationComparison {
    const a=this.version(actor,taskId,left),b=this.version(actor,taskId,right),changes: AnnotationChange[]=[];
    const ancestors=this.ancestry(left),rightAncestors=this.ancestry(right);
    const common=[...ancestors.keys()].find(id=>rightAncestors.has(id));
    // Shared set ancestry alone does not make independently added short IDs the same object.
    const baseline=common ? this.rawRevision(common,Math.min(ancestors.get(common)!,rightAncestors.get(common)!)).document : undefined;
    if(a.document.title!==b.document.title) changes.push({kind:'title',id:'title',change:'changed',fields:['title']});
    for(const kind of ['layer','object'] as const) {
      const entries=(document: AnnotationDocument): Map<string,Record<string,unknown>> => kind==='layer' ? new Map(document.layers.map(({layerId,name,order,defaultVisible})=>[layerId,{name,order,defaultVisible}])) : new Map(document.layers.flatMap(layer=>layer.features.map(feature=>[feature.objectId,{...feature,layerId:layer.layerId}] as const)));
      const old=entries(a.document),next=entries(b.document),inherited=baseline ? entries(baseline) : new Map();
      for(const id of new Set([...old.keys(),...next.keys()])) {
        const before=old.get(id),after=next.get(id);
        if(before && after && !inherited.has(id)) {changes.push({kind,id,change:'removed',fields:[]},{kind,id,change:'added',fields:[]});}
        else if(!before || !after) changes.push({kind,id,change:before ? 'removed' : 'added',fields:[]});
        else {const fields=[...new Set([...Object.keys(before),...Object.keys(after)])].filter(key=>validate.canonical(before[key])!==validate.canonical(after[key])); if(fields.length) changes.push({kind,id,change:'changed',fields});}
      }
    }
    return {left:a.ref,right:b.ref,changes:pagination(changes,offset,limit),counts:{added:changes.filter(c=>c.change==='added').length,removed:changes.filter(c=>c.change==='removed').length,changed:changes.filter(c=>c.change==='changed').length}};
  }
  private putBinding(binding: StoredBinding) {this.db.prepare('INSERT INTO annotation_session_bindings VALUES(?,?) ON CONFLICT(session_id) DO UPDATE SET data=excluded.data').run(binding.sessionId,JSON.stringify(binding));}
  private assertReceiptAccess(actor: AnnotationActor,receipt: AnnotationReceipt) {
    this.task(actor,receipt.taskId); if(receipt.sessionId) this.session(actor,receipt.sessionId);
    if(receipt.ref) this.accessible(actor,receipt.taskId,receipt.ref);
    if(receipt.binding?.baseRef) this.accessible(actor,receipt.taskId,receipt.binding.baseRef);
    if(receipt.current?.publication) this.publication(actor,receipt.current.publication.publicationId,receipt.taskId);
  }
  receipt(actor: AnnotationActor,clientActionId: string): AnnotationReceipt | null {
    this.identity(actor); validate.uuid(clientActionId);
    const saved=parse<AnnotationReceipt>(this.db.prepare('SELECT data FROM annotation_actions WHERE user_id=? AND action_id=?').get(actor.userId,clientActionId));
    if(saved) this.assertReceiptAccess(actor,saved); return saved ?? null;
  }
  private mutation(actor: AnnotationActor,taskId: string,sessionId: string | undefined,input: {clientActionId:string},work: ()=>AnnotationReceipt,signal?: AbortSignal,onCommitted?: ()=>void): AnnotationReceipt {
    this.task(actor,taskId); signal?.throwIfAborted();
    const digest=hash({taskId,sessionId,input});
    const previous=this.db.prepare('SELECT digest,data FROM annotation_actions WHERE user_id=? AND action_id=?').get(actor.userId,input.clientActionId);
    if(previous) {const result=parse<AnnotationReceipt>(previous)!;this.assertReceiptAccess(actor,result);if(previous.digest!==digest) throw conflict('同一动作标识已用于不同内容。');return result;}
    const release=this.access?.acquire(taskId,actor.seatId);
    try {const result=this.store.transaction(()=>{
      this.task(actor,taskId,true); if(sessionId) this.session(actor,sessionId,true); signal?.throwIfAborted();
      const result=work(); signal?.throwIfAborted();
      this.db.prepare('INSERT INTO annotation_actions VALUES(?,?,?,?,?,?)').run(actor.userId,input.clientActionId,taskId,sessionId ?? null,digest,JSON.stringify(result)); return result;
    });onCommitted?.();return result;} finally {release?.();}
  }
  setBase(actor: AnnotationActor,sessionId: string,input: AnnotationBaseInput,signal?: AbortSignal): AnnotationReceipt {
    const normalized=validate.base(input),workspace=this.session(actor,sessionId);
    if(normalized.baseRef) this.accessible(actor,workspace.taskSpaceId,normalized.baseRef);
    return this.mutation(actor,workspace.taskSpaceId,sessionId,normalized,()=>{
      if(this.isSessionBusy?.(sessionId)) throw conflict('会话正在处理请求，暂时不能更换基线。');
      if(this.setForSession(sessionId)) throw conflict('已有草稿，不能重新绑定基线。');
      const old=this.rawBinding(sessionId); if((old?.bindingRevision ?? 0)!==normalized.expectedBindingRevision) throw conflict('会话基线已变化，请重新查看。');
      if(normalized.baseRef) this.accessible(actor,workspace.taskSpaceId,normalized.baseRef);
      this.putBinding({sessionId,taskId:workspace.taskSpaceId,workspaceId:workspace.id,ownerSeatId:actor.seatId,baseRef:normalized.baseRef,bindingRevision:(old?.bindingRevision ?? 0)+1});
      return {clientActionId:normalized.clientActionId,action:'set_base',taskId:workspace.taskSpaceId,sessionId,committedAt:new Date().toISOString(),binding:this.binding(actor,sessionId)};
    },signal);
  }
  private prepareChanges(actor: AnnotationActor,taskId: string,document: AnnotationDocument,operations: AnnotationOperation[],inherited: string[]) {
    const copy=structuredClone(document),systems=new Set(inherited);
    const layer=(id: string)=>{const result=copy.layers.find(layer=>layer.layerId===id); if(!result) throw missing();return result;};
    const object=(id: string)=>{for(const layer of copy.layers) {const feature=layer.features.find(feature=>feature.objectId===id);if(feature) return {layer,feature};}throw missing();};
    for(const operation of operations) {
      switch(operation.op) {
        case 'rename_set':copy.title=operation.title;break;
        case 'add_layer':copy.layers.push(structuredClone(operation.layer));break;
        case 'update_layer':Object.assign(layer(operation.layerId),operation.changes);break;
        case 'delete_layer':layer(operation.layerId);copy.layers=copy.layers.filter(layer=>layer.layerId!==operation.layerId);break;
        case 'add_object':layer(operation.layerId).features.push(structuredClone(operation.feature));break;
        case 'update_object': {const entry=object(operation.objectId);Object.assign(entry.feature,validate.feature({...entry.feature,...operation.changes})); if(operation.layerId && operation.layerId!==entry.layer.layerId) {const target=layer(operation.layerId);entry.layer.features=entry.layer.features.filter(f=>f.objectId!==operation.objectId);target.features.push(entry.feature);}break;}
        case 'delete_object': {const entry=object(operation.objectId);entry.layer.features=entry.layer.features.filter(f=>f.objectId!==operation.objectId);break;}
        case 'copy_object': {const source=this.accessible(actor,taskId,operation.source);source.requiredSystemIds.forEach(id=>systems.add(id)); const found=source.document.layers.flatMap(l=>l.features).find(f=>f.objectId===operation.objectId); if(!found) throw missing();layer(operation.layerId).features.push({...structuredClone(found),objectId:operation.newObjectId,originFeatureRef:{ref:operation.source,objectId:operation.objectId}});break;}
      }
      // Source restrictions are monotonic even when added content is deleted later in the same batch.
      for(const feature of copy.layers.flatMap(l=>l.features)) for(const source of feature.sourceRefs ?? []) systems.add(source.systemId);
    }
    const normalized=validate.document(copy); this.allowedSystems(actor,[...systems]);
    return {document:normalized,requiredSystemIds:[...systems].sort()};
  }
  action(actor: AnnotationActor,sessionId: string,input: AnnotationAction,signal?: AbortSignal): AnnotationReceipt {
    return this.applyAction(actor,sessionId,validate.action(input),signal);
  }
  /** Replay checks original intent before a host attempts to rebuild transient read bases. */
  hostReplay(actor: AnnotationActor,sessionId: string,input: AnnotationHostIntent): AnnotationHostResult | null {
    const intent=validate.hostIntent(input),workspace=this.session(actor,sessionId);
    const receiptInput={clientActionId:intent.clientActionId,hostIntent:intent};
    const previous=this.db.prepare('SELECT digest,data FROM annotation_actions WHERE user_id=? AND action_id=?').get(actor.userId,intent.clientActionId);
    if(!previous) return null;
    const receipt=parse<AnnotationReceipt>(previous)!;
    this.assertReceiptAccess(actor,receipt);
    if(previous.digest!==hash({taskId:workspace.taskSpaceId,sessionId,input:receiptInput})) throw conflict('同一动作标识已用于不同内容。');
    return {receipt,replayed:true};
  }
  /** Host-only CAS adapter; public HTTP action() never accepts basis or intent overrides. */
  actionFromHost(actor: AnnotationActor,sessionId: string,input: AnnotationAction,basis?: AnnotationEditBasis,signal?: AbortSignal,onCommitted?: ()=>void): AnnotationHostResult {
    const normalized=validate.action(input);
    const {expectedRevision: _revision,...rawIntent}=normalized.action==='apply' ? normalized : {...normalized,expectedRevision:undefined};
    void _revision;
    const intent=validate.hostIntent(rawIntent),prior=this.hostReplay(actor,sessionId,intent);
    signal?.throwIfAborted(); if(prior) return prior;
    if(normalized.action==='create_draft') {
      const binding=this.binding(actor,sessionId);
      basis={bindingRevision:binding.bindingRevision,baseRef:binding.baseRef};
    }
    this.assertBasis(actor,sessionId,normalized,basis);
    let committed=false;
    const receipt=this.applyAction(actor,sessionId,normalized,signal,{basis,receiptInput:{clientActionId:intent.clientActionId,hostIntent:intent},committed:()=>{committed=true;onCommitted?.();}});
    return {receipt,replayed:!committed};
  }
  private assertBasis(actor: AnnotationActor,sessionId: string,input: AnnotationAction,basis?: AnnotationEditBasis) {
    if(input.action==='publish') return;
    const binding=this.binding(actor,sessionId);
    if(input.action==='create_draft') {
      if(!basis || !('bindingRevision' in basis)) throw new RequestError('ANNOTATION_READ_REQUIRED','请先读取本会话草稿状态。');
      if(binding.draft || binding.bindingRevision!==basis.bindingRevision || validate.canonical(binding.baseRef)!==validate.canonical(basis.baseRef)) throw stale('binding','会话草稿或基线已变化，请重新读取。');
    } else {
      if(!basis || !('setId' in basis)) throw new RequestError('ANNOTATION_READ_REQUIRED','请先读取本会话草稿。');
      if(binding.draft?.setId!==basis.setId || basis.revision!==input.expectedRevision || binding.draft.headRevision!==basis.revision) throw stale('draft','草稿已有新修订，请查看后重新编辑。');
    }
  }
  /** Legacy explicit-CAS API retained for existing service callers. */
  async fromSource(actor: AnnotationActor,sessionId: string,input: AnnotationFromSourceInput,signal?: AbortSignal,check?: ()=>void): Promise<AnnotationReceipt> {
    const normalized=validate.fromSource(input);
    const {clientActionId,expectedRevision,...item}=normalized;
    return this.copySources(actor,sessionId,{clientActionId,expectedRevision,items:[item]},signal,check,{receiptInput:normalized},true);
  }
  async fromSourcesFromHost(actor: AnnotationActor,sessionId: string,input: AnnotationFromSourcesInput,basis: AnnotationEditBasis,signal?: AbortSignal,check?: ()=>void,onCommitted?: ()=>void): Promise<AnnotationHostResult> {
    const normalized=validate.fromSources(input);
    const intent=validate.hostIntent({action:'from_source',clientActionId:normalized.clientActionId,items:normalized.items.map(({expectedSourceRevision,...item})=>{void expectedSourceRevision;return item;})});
    signal?.throwIfAborted(); check?.();
    const prior=this.hostReplay(actor,sessionId,intent); if(prior) return prior;
    this.assertBasis(actor,sessionId,{action:'apply',clientActionId:normalized.clientActionId,expectedRevision:normalized.expectedRevision,operations:[]},basis);
    let committed=false;
    const receipt=await this.copySources(actor,sessionId,normalized,signal,check,{basis,receiptInput:{clientActionId:intent.clientActionId,hostIntent:intent},committed:()=>{committed=true;onCommitted?.();}});
    return {receipt,replayed:!committed};
  }
  private async copySources(actor: AnnotationActor,sessionId: string,normalized: AnnotationFromSourcesInput,signal?: AbortSignal,check?: ()=>void,options: ActionOptions={},legacy=false): Promise<AnnotationReceipt> {
    signal?.throwIfAborted(); check?.();
    const workspace=this.session(actor,sessionId),taskId=workspace.taskSpaceId,receiptInput=options.receiptInput ?? normalized;
    if(this.receipt(actor,normalized.clientActionId)) return this.mutation(actor,taskId,sessionId,receiptInput,()=>{throw stateError();},signal);
    this.session(actor,sessionId,true);
    if(!this.context) throw new RequestError('CONTEXT_UNAVAILABLE','态势查询未配置。',503);
    this.allowedSystems(actor,normalized.items.map(item=>item.sourceRef.systemId));
    const set=this.setForSession(sessionId);
    if(!set) throw missing();
    if(set.headRevision!==normalized.expectedRevision) throw stale('draft','草稿已有新修订，请查看后重新编辑。');
    const saved=this.accessible(actor,taskId,{setId:set.setId,revision:set.headRevision});
    // Validate every target before any network request; the saved document is immutable.
    const targets=normalized.items.map((item,itemIndex)=>{
      try {
        const layer=saved.document.layers.find(layer=>layer.layerId===item.layerId);
        if(!layer) throw missing();
        const existing=layer.features.find(feature=>feature.objectId===item.objectId);
        const sameSource=(ref: ContextRef)=>ref.systemId===item.sourceRef.systemId && ref.objectType===item.sourceRef.objectType && ref.objectId===item.sourceRef.objectId;
        if(item.mode==='add' && saved.document.layers.some(layer=>layer.features.some(feature=>feature.objectId===item.objectId))) throw conflict('标注 ID 已存在，请选择新 ID 或明确刷新已有标注。');
        if(item.mode==='refresh') {
          if(!existing) throw missing();
          if(existing.sourceRefs?.filter(sameSource).length!==1) throw conflict('目标标注必须恰有一个匹配的来源引用，不能自动改接来源。');
        }
        return {item,existing,sameSource};
      } catch(error) {throw this.sourceItemError(error,itemIndex,legacy);}
    });
    const operations: AnnotationOperation[]=[],results: AnnotationFromSourceResult[]=[];
    for(const [itemIndex,{item,existing,sameSource}] of targets.entries()) {
      try {
        signal?.throwIfAborted(); check?.(); this.session(actor,sessionId,true); this.allowedSystems(actor,normalized.items.map(item=>item.sourceRef.systemId));
        const result=await this.context.query('situation_query',{systemId:item.sourceRef.systemId,mode:'current',objectRefs:[item.sourceRef]}, {kind:'seat',seatId:actor.seatId},signal);
        signal?.throwIfAborted(); check?.(); this.session(actor,sessionId,true); this.allowedSystems(actor,normalized.items.map(item=>item.sourceRef.systemId));
        if(!('changeCursor' in result.data)) throw new RequestError('CONTEXT_INVALID_RESPONSE','来源未返回当前态势对象。',502);
        const matches=result.data.items.filter(source=>sameSource(source.ref));
        if(matches.length===0) throw new RequestError('ANNOTATION_SOURCE_NOT_FOUND','未查询到指定来源对象；未生成标注。',404);
        if(matches.length!==1 || result.data.hasMore) throw new RequestError('CONTEXT_INVALID_RESPONSE','来源对象查询不唯一或未完整返回；未生成标注。',502);
        const source=matches[0];
        if(source.revision!==item.expectedSourceRevision) throw new AnnotationError('ANNOTATION_CONFLICT','来源对象修订已变化，请重新查询并评估后再操作。',{outcome:'not_committed',resources:[{kind:'source',state:'stale',ref:item.sourceRef,itemIndex}]});
        if(!source.geometry) throw new RequestError('ANNOTATION_SOURCE_GEOMETRY_MISSING','来源对象没有几何；未估算或生成标注。');
        const sourceRef={...source.ref,revision:source.revision,queriedAt:result.queriedAt};
        const kind=source.geometry.type==='Point' ? 'point' : source.geometry.type==='LineString' ? 'line' : 'polygon';
        if(existing && existing.geometry.type!==source.geometry.type) throw conflict('来源几何类型与目标标注不兼容，不能自动替换。');
        operations.push(item.mode==='add'
          ? {op:'add_object',layerId:item.layerId,feature:{objectId:item.objectId,kind,name:source.name,geometry:source.geometry,sourceRefs:[sourceRef]}}
          : {op:'update_object',objectId:item.objectId,changes:{geometry:source.geometry,sourceRefs:existing!.sourceRefs!.map(ref=>sameSource(ref) ? sourceRef : ref)}});
        results.push({mode:item.mode,layerId:item.layerId,objectId:item.objectId,sourceRef:source.ref,sourceRevision:source.revision,queriedAt:result.queriedAt,effectiveAt:source.effectiveAt,validTime:source.validTime});
      } catch(error) {throw this.sourceItemError(error,itemIndex,legacy);}
    }
    signal?.throwIfAborted(); check?.();
    return this.applyAction(actor,sessionId,{action:'apply',clientActionId:normalized.clientActionId,expectedRevision:normalized.expectedRevision,operations},signal,{...options,receiptInput,...(legacy ? {fromSource:results[0]} : {fromSources:results})});
  }
  private sourceItemError(error: unknown,itemIndex: number,legacy: boolean) {
    if(legacy || !(error instanceof RequestError)) return error;
    // Index refers to caller input only; preserve safe authorization errors without source content.
    return Object.assign(new AnnotationError(error.code,`来源项 ${itemIndex+1}：${error.message}`,{...(error instanceof AnnotationError ? error.recovery : {outcome:'not_committed' as const}),itemIndex},error.statusCode),{itemIndex});
  }
  private applyAction(actor: AnnotationActor,sessionId: string,normalized: AnnotationAction,signal?: AbortSignal,options: ActionOptions={}): AnnotationReceipt {
    const workspace=this.session(actor,sessionId),taskId=workspace.taskSpaceId,receiptInput=options.receiptInput ?? normalized;
    // Replaying an acknowledged action never attempts to reconstruct its old base from today's head.
    const existing=this.receipt(actor,normalized.clientActionId);
    if(existing) return this.mutation(actor,taskId,sessionId,receiptInput,()=>{throw stateError();},signal);
    if(options.basis) this.assertBasis(actor,sessionId,normalized,options.basis);
    const set=this.setForSession(sessionId),binding=this.rawBinding(sessionId);
    let prepared: ReturnType<AnnotationService['prepareChanges']> | undefined;
    let baseRef=binding?.baseRef ?? null;
    if(normalized.action==='create_draft') {
      if(set) throw conflict('本会话已有草稿，请基于它的明确修订编辑。');
      if(normalized.baseRef!==undefined) {if(binding && validate.canonical(normalized.baseRef)!==validate.canonical(binding.baseRef)) throw stale('binding','创建基线与会话绑定不一致，请先显式更换基线。');baseRef=normalized.baseRef;}
      else if(!binding) throw validate.invalid('首次创建须明确选择空白 baseRef:null 或固定版本。');
      const source=baseRef ? this.accessible(actor,taskId,baseRef) : undefined;
      const initial=source ? structuredClone(source.document) : {schemaVersion:1 as const,title:normalized.title ?? '会话标注',layers:[]};
      if(normalized.title) initial.title=normalized.title;
      prepared=this.prepareChanges(actor,taskId,initial,normalized.operations ?? [],source?.requiredSystemIds ?? []);
    } else {
      if(!set) throw missing();
      const saved=this.accessible(actor,taskId,{setId:set.setId,revision:normalized.action==='publish' ? normalized.revision : set.headRevision});
      if(normalized.action==='apply') {if(set.headRevision!==normalized.expectedRevision) throw stale('draft','草稿已有新修订，请查看后重新编辑。');prepared=this.prepareChanges(actor,taskId,saved.document,normalized.operations,saved.requiredSystemIds);}
    }
    return this.mutation(actor,taskId,sessionId,receiptInput,()=>{
      if(options.basis) this.assertBasis(actor,sessionId,normalized,options.basis);
      const latest=this.setForSession(sessionId),time=new Date().toISOString();
      if(normalized.action==='publish') {
        if(!latest) throw missing();
        const saved=this.accessible(actor,taskId,{setId:latest.setId,revision:normalized.revision});
        const prior=parse<StoredPublication>(this.db.prepare("SELECT data FROM annotation_publications WHERE set_id=? AND revision=? AND json_extract(data,'$.title')=? AND json_extract(data,'$.note')=? ORDER BY rowid LIMIT 1").get(latest.setId,normalized.revision,normalized.title,normalized.note ?? ''));
        const published: StoredPublication=prior ?? {publicationId:randomUUID(),taskId,setId:latest.setId,revision:normalized.revision,title:normalized.title,note:normalized.note ?? '',hash:hash(this.publicDocument(saved.document)),publishedByUserId:actor.userId,publishedAt:time};
        if(!prior) this.db.prepare('INSERT INTO annotation_publications VALUES(?,?,?,?,?)').run(published.publicationId,taskId,latest.setId,normalized.revision,JSON.stringify(published));
        return {clientActionId:normalized.clientActionId,action:'publish',taskId,sessionId,committedAt:time,ref:{publicationId:published.publicationId},hash:published.hash,publication:this.publicationDTO(published)};
      }
      if(normalized.action==='create_draft' && latest) throw conflict('本会话已创建草稿。');
      if(normalized.action==='apply' && (!latest || latest.headRevision!==normalized.expectedRevision)) throw stale('draft','草稿已有新修订，请查看后重新编辑。');
      if(validate.canonical(this.rawBinding(sessionId))!==validate.canonical(binding)) throw stale('binding','基线已变化。');
      this.allowedSystems(actor,prepared!.requiredSystemIds);
      if(baseRef) this.accessible(actor,taskId,baseRef);
      const next: StoredSet=latest ? {...latest,headRevision:latest.headRevision+1,updatedAt:time,title:prepared!.document.title,hash:hash(prepared!.document)} : {setId:randomUUID(),ownerSessionId:sessionId,ownerSeatId:actor.seatId,taskId,workspaceId:workspace.id,headRevision:1,title:prepared!.document.title,hash:hash(prepared!.document),baseRef,createdAt:time,updatedAt:time,createdByUserId:actor.userId};
      const revision: StoredRevision={setId:next.setId,revision:next.headRevision,document:prepared!.document,hash:next.hash,requiredSystemIds:prepared!.requiredSystemIds,createdAt:time,createdByUserId:actor.userId};
      this.db.prepare('INSERT INTO annotation_sets VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(next.setId,sessionId,taskId,actor.seatId,JSON.stringify(next));
      this.db.prepare('INSERT INTO annotation_revisions VALUES(?,?,?)').run(next.setId,next.headRevision,JSON.stringify(revision));
      if(!binding) this.putBinding({sessionId,taskId,workspaceId:workspace.id,ownerSeatId:actor.seatId,baseRef,bindingRevision:1});
      const existingIds=new Set(prepared!.document.layers.flatMap(layer=>layer.features.map(feature=>feature.objectId)));
      const objectIds=[...new Set((normalized.operations ?? []).flatMap(operation=>operation.op==='add_object' ? [operation.feature.objectId] : operation.op==='copy_object' ? [operation.newObjectId] : operation.op==='update_object' ? [operation.objectId] : operation.op==='add_layer' ? operation.layer.features.map(feature=>feature.objectId) : []).filter(id=>existingIds.has(id)))];
      return {clientActionId:normalized.clientActionId,action:options.fromSource || options.fromSources ? 'from_source' : normalized.action,taskId,sessionId,committedAt:time,ref:{setId:next.setId,revision:next.headRevision},hash:next.hash,binding:this.binding(actor,sessionId),
        beforeRef:latest ? {setId:latest.setId,revision:latest.headRevision} : null,afterRef:{setId:next.setId,revision:next.headRevision},objectIds,
        ...(options.fromSource ? {fromSource:options.fromSource} : {}),...(options.fromSources ? {fromSources:options.fromSources} : {})};
    },signal,options.committed);
  }
  setCurrentFromHost(actor: AnnotationActor,sessionId: string,input: AnnotationCurrentInput,signal?: AbortSignal,onCommitted?: ()=>void): AnnotationHostResult {
    const normalized=validate.current(input),intent=validate.hostIntent({action:'set_current',clientActionId:normalized.clientActionId,publicationId:normalized.publicationId});
    signal?.throwIfAborted(); const prior=this.hostReplay(actor,sessionId,intent); if(prior) return prior;
    const workspace=this.session(actor,sessionId);let committed=false;
    const receipt=this.applyCurrent(actor,workspace.taskSpaceId,normalized,signal,{receiptInput:{clientActionId:intent.clientActionId,hostIntent:intent},committed:()=>{committed=true;onCommitted?.();}},sessionId);
    return {receipt,replayed:!committed};
  }
  setCurrent(actor: AnnotationActor,taskId: string,input: AnnotationCurrentInput,signal?: AbortSignal): AnnotationReceipt {
    return this.applyCurrent(actor,taskId,validate.current(input),signal);
  }
  private applyCurrent(actor: AnnotationActor,taskId: string,normalized: AnnotationCurrentInput,signal?: AbortSignal,options: ActionOptions={},sessionId?: string): AnnotationReceipt {
    this.task(actor,taskId);
    if(!this.canSetCurrent(actor,taskId)) throw new RequestError('FORBIDDEN','当前席位无权设定任务当前标注。',403);
    return this.mutation(actor,taskId,sessionId,options.receiptInput ?? normalized,()=>{
      if(!this.canSetCurrent(actor,taskId)) throw new RequestError('FORBIDDEN','当前席位无权设定任务当前标注。',403);
      const publication=this.publicationDTO(this.publication(actor,normalized.publicationId,taskId).published),current=this.current(actor,taskId),time=new Date().toISOString();
      if(current.sequence!==normalized.expectedCurrentSequence) throw stale('current','任务当前标注已更新，请比较后重新选择。');
      const next=current.publication?.publicationId===normalized.publicationId ? current : {taskId,sequence:current.sequence+1,publication,selectedAt:time,selectedByUserId:actor.userId};
      if(next!==current) this.db.prepare('INSERT INTO task_annotation_selections VALUES(?,?,?,?)').run(taskId,next.sequence,normalized.publicationId,JSON.stringify(next));
      return {clientActionId:normalized.clientActionId,action:'set_current',taskId,...(sessionId ? {sessionId} : {}),committedAt:time,ref:{publicationId:normalized.publicationId},hash:publication.hash,current:next};
    },signal,options.committed);
  }
}
