import { createHash } from 'node:crypto';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type, type Static } from 'typebox';
import type { AnnotationService, AnnotationActor } from '../annotations/service.js';
import { AnnotationRequestState } from './annotation-state.js';
import { RequestError } from '../contracts/errors.js';
import { AnnotationError } from '../annotations/errors.js';

const strict = { additionalProperties: false };
const id = Type.String({ pattern: '^[A-Za-z0-9_.:-]{1,128}$' });
const uuid = Type.String({ format: 'uuid' });
const revision = Type.Integer({ minimum: 1 });
const name = Type.String({ minLength: 1, maxLength: 120 });
const selection = {layerIds: Type.Optional(Type.Array(id, {minItems: 1, maxItems: 32, uniqueItems: true})), objectIds: Type.Optional(Type.Array(id, {minItems: 1, maxItems: 500, uniqueItems: true}))};
export const annotationRefSchema = Type.Union([Type.Object({setId: uuid, revision}, strict), Type.Object({publicationId: uuid}, strict)]);
export const annotationSelectionSchema = Type.Union([Type.Object({setId: uuid, revision, ...selection}, strict), Type.Object({publicationId: uuid, ...selection}, strict)]);
// Provider schemas accept one items schema; the service additionally enforces latitude within [-90, 90].
const position = Type.Unsafe<[number, number]>(Type.Array(Type.Number({minimum: -180, maximum: 180}), {minItems: 2, maxItems: 2, description: 'WGS84 [经度, 纬度]，经度 -180～180，纬度 -90～90。'}));
const geometry = Type.Union([
  Type.Object({type: Type.Literal('Point'), coordinates: position}, strict),
  Type.Object({type: Type.Literal('LineString'), coordinates: Type.Array(position, {minItems: 2, maxItems: 20000})}, strict),
  Type.Object({type: Type.Literal('Polygon'), coordinates: Type.Array(Type.Array(position, {minItems: 4, maxItems: 20000}), {minItems: 1, maxItems: 1})}, strict),
]);
const style = Type.Object({color: Type.Optional(Type.String({pattern: '^#[0-9a-fA-F]{6}$'})), fillColor: Type.Optional(Type.String({pattern: '^#[0-9a-fA-F]{6}$'})),
  opacity: Type.Optional(Type.Number({minimum: 0, maximum: 1})), size: Type.Optional(Type.Number({minimum: 0, maximum: 100})), width: Type.Optional(Type.Number({minimum: 0, maximum: 30})),
  lineStyle: Type.Optional(Type.Union(['solid','dashed','dotted'].map(value => Type.Literal(value)))), symbol: Type.Optional(Type.Union(['circle','square','triangle'].map(value => Type.Literal(value)))), label: Type.Optional(Type.String({maxLength: 200}))}, strict);
const geometryRef = Type.Unsafe<Static<typeof geometry>>({$ref: '#/$defs/geometry'});
const styleRef = Type.Unsafe<Static<typeof style>>({$ref: '#/$defs/style'});
const featureFields = {kind: Type.Union(['point','line','polygon','text'].map(value => Type.Literal(value))), name, geometry: geometryRef,
  note: Type.Optional(Type.String({maxLength: 4000})), attributes: Type.Optional(Type.Record(Type.String(), Type.Union([Type.String(),Type.Number(),Type.Boolean(),Type.Null()]))), style: Type.Optional(styleRef),
  sourceRefs: Type.Optional(Type.Array(Type.Object({systemId: id, objectType: id, objectId: id, revision: Type.Optional(revision), queriedAt: Type.Optional(Type.String())}, strict), {maxItems: 20}))};
const feature = Type.Object({objectId: id, ...featureFields}, strict);
const featureRef = Type.Unsafe<Static<typeof feature>>({$ref: '#/$defs/feature'});
const layerFields = {name, order: Type.Integer({minimum: 0}), defaultVisible: Type.Boolean()};
const operations = Type.Array(Type.Union([
  Type.Object({op: Type.Literal('rename_set'), title: name}, strict),
  Type.Object({op: Type.Literal('add_layer'), layer: Type.Object({layerId: id, ...layerFields, features: Type.Array(featureRef, {maxItems: 500})}, strict)}, strict),
  Type.Object({op: Type.Literal('update_layer'), layerId: id, changes: Type.Partial(Type.Object(layerFields, strict))}, strict),
  Type.Object({op: Type.Literal('delete_layer'), layerId: id}, strict),
  Type.Object({op: Type.Literal('add_object'), layerId: id, feature: featureRef}, strict),
  Type.Object({op: Type.Literal('update_object'), objectId: id, changes: Type.Partial(Type.Object(featureFields, strict)), layerId: Type.Optional(id)}, strict),
  Type.Object({op: Type.Literal('delete_object'), objectId: id}, strict),
  Type.Object({op: Type.Literal('copy_object'), source: annotationRefSchema, objectId: id, newObjectId: id, layerId: id}, strict),
]), {minItems: 1, maxItems: 100});
const operationsRef = Type.Unsafe<Static<typeof operations>>({$ref: '#/$defs/operations'});
const actionSchemas = [
  Type.Object({action: Type.Literal('create_draft'), baseRef: Type.Union([annotationRefSchema, Type.Null()], {description: '新草稿的固定派生基线；null 从空白创建。该引用不证明此版本曾被或正在被任务采用。'}), title: Type.Optional(name), operations: Type.Optional(operationsRef)}, strict),
  Type.Object({action: Type.Literal('apply'), operations: operationsRef}, strict),
  Type.Object({action: Type.Literal('publish'), revision, title: name, note: Type.Optional(Type.String({maxLength: 4000}))}, strict),
] as const;
const currentSchema = Type.Object({action: Type.Literal('set_current'), publicationId: uuid}, strict);
const pagination = {offset: Type.Optional(Type.Integer({minimum: 0})), limit: Type.Optional(Type.Integer({minimum: 1, maximum: 100}))};
export const annotationFromSourceSchema = Type.Object({items: Type.Array(Type.Object({
  mode: Type.Union([Type.Literal('add'),Type.Literal('refresh')], {description:'add 新建来源标注；refresh 明确重新采用来源几何，替换此前人工调整的几何。'}),
  sourceRef: Type.Object({systemId:id,objectType:id,objectId:id}, {...strict,description:'situation_query 返回的完整来源对象 ref；区域标签不一定是对象 ID。'}),
  layerId: Type.String({pattern:'^[A-Za-z0-9_.:-]{1,128}$',description:'本会话草稿中已存在的目标图层 ID。'}),
  objectId: Type.String({pattern:'^[A-Za-z0-9_.:-]{1,128}$',description:'add 时取未使用的标注 ID；refresh 时使用该图层内既有标注 ID，保持对象身份。'}),
}, strict), {minItems: 1, maxItems: 20})}, strict);
/** Stable per native call; unknown effects are inspected through a receipt, never replayed by the host. */
export function annotationActionId(requestId: string, toolCallId: string): string {
  const value = createHash('sha256').update(JSON.stringify([requestId, toolCallId])).digest('hex');
  return `${value.slice(0,8)}-${value.slice(8,12)}-5${value.slice(13,16)}-a${value.slice(17,20)}-${value.slice(20,32)}`;
}
export function annotationTools(service: AnnotationService, scope: {actor: AnnotationActor; sessionId: string; taskId: string; requestId: string; signal: AbortSignal; check: () => void; state?: AnnotationRequestState}) {
  const state = scope.state ?? new AnnotationRequestState();
  const execute = async <T>(callId: string, work: (signal: AbortSignal, dispatch: () => void, committed: () => void) => T | Promise<T>, signal?: AbortSignal) => {
    const scoped = signal ? AbortSignal.any([scope.signal, signal]) : scope.signal;
    let dispatched = false, effectCommitted = false;
    const clientActionId = annotationActionId(scope.requestId, callId);
    try {
      scoped.throwIfAborted(); scope.check();
      const result = await work(scoped, () => { dispatched = true; }, () => { effectCommitted = true; state.noteWrite(callId, clientActionId); });
      scoped.throwIfAborted(); scope.check();
      return {content: [{type: 'text' as const, text: JSON.stringify(result)}], details: {}};
    } catch (error) {
      state.rejectResult(callId);
      if (scoped.aborted) { state.invalidate(); scoped.throwIfAborted(); }
      const unknown = dispatched && (effectCommitted || !(error instanceof RequestError) || (error instanceof AnnotationError && error.recovery.outcome === 'unknown'));
      if (unknown) state.markUncertain(clientActionId);
      throw new Error(JSON.stringify({
        code: unknown ? 'ANNOTATION_RESULT_UNCERTAIN' : error instanceof RequestError ? error.code : 'ANNOTATION_TOOL_FAILED',
        message: unknown ? '保存结果未能可靠返回；请查询原动作回执，确认后重新读取。未找到回执不能当成未执行，不要换动作重复保存。' : error instanceof Error ? error.message : '地图操作失败。',
        ...(error instanceof AnnotationError ? error.recovery : {outcome: 'not_committed'}),
        ...(unknown ? {outcome: 'unknown', clientActionIds: [clientActionId]} : {}),
      }));
    }
  };
  const canSetCurrent = service.canSetCurrent(scope.actor, scope.taskId);
  const actionSchema = Type.Union([...actionSchemas, currentSchema], {type: 'object', $defs: {geometry, style, feature, operations}});
  if (!canSetCurrent) actionSchema.anyOf.splice(-1, 1);
  return [
    defineTool({name: 'annotation_list', label: '浏览任务标注', description: '列出本任务可见的草稿和发布版本及当前设定，只有元信息、不含几何。current.publication 是任务独立选择的发布版；current.publication:null 才表示读取时尚未设置，缺少 current 只是未提供状态。基线、草稿修订和历史回答都不能代替本次查询。采用者字段不证明操作所属会话，也不等于发布者。不会切换本会话编辑目标。分页读取。',
      parameters: Type.Object(pagination, strict), executionMode: 'sequential',
      execute: (callId, params, signal) => execute(callId, () => {
        const result = {...service.list(scope.actor, scope.taskId, params.offset, params.limit), current: service.current(scope.actor, scope.taskId)};
        state.observeCurrent(result.current.sequence, callId); return result;
      }, signal)}),
    defineTool({name: 'annotation_read', label: '读取地图标注', description: 'draft 读取本会话当前草稿（或明确未建草稿状态），收到结果后才可编辑。read 读取明确固定版本，不建立可写依据。默认仅摘要。查询个别对象而未知ID时，先不带fields读取摘要定位，再按objectIds读取所需字段；不要为单对象问题读取整图几何。仅在需要时选择 geometry/note/attributes/style/sourceRefs/originFeatureRef，按对象或图层缩小范围。hasMore 时尚未读完。compare 比较两个固定版本；receipt 按动作ID，或原始 requestId + toolCallId 查询已提交动作，不会重放。读取引用不会改变可写草稿。固定版本不代表任务当前；历史 receipt 是原动作结果，不能说成本请求刚完成的操作。',
      parameters: Type.Union([
        Type.Object({mode: Type.Literal('draft'), ...selection, fields: Type.Optional(Type.Array(Type.Union(['geometry','note','attributes','style','sourceRefs','originFeatureRef'].map(value => Type.Literal(value))), {uniqueItems: true})), ...pagination}, strict),
        Type.Object({mode: Type.Literal('read'), ref: annotationRefSchema, ...selection, fields: Type.Optional(Type.Array(Type.Union(['geometry','note','attributes','style','sourceRefs','originFeatureRef'].map(value => Type.Literal(value))), {uniqueItems: true})), ...pagination}, strict),
        Type.Object({mode: Type.Literal('compare'), left: annotationRefSchema, right: annotationRefSchema, ...pagination}, strict),
        Type.Object({mode: Type.Literal('receipt'), clientActionId: uuid}, strict),
        Type.Object({mode: Type.Literal('receipt'), requestId: uuid, toolCallId: Type.String({minLength: 1, maxLength: 256})}, strict),
      ], {type: 'object'}), executionMode: 'sequential', execute: (callId, params, signal) => execute(callId, () => {
        if (params.mode === 'draft') {
          const binding = service.binding(scope.actor, scope.sessionId);
          const result = binding.draft ? service.read(scope.actor, scope.taskId, {ref: {setId: binding.draft.setId, revision: binding.draft.headRevision}, layerIds: params.layerIds, objectIds: params.objectIds, fields: params.fields, offset: params.offset, limit: params.limit}) : null;
          state.observeDraft(binding, callId);
          return result ? {status: 'draft', ...result} : {status: 'empty', bindingRevision: binding.bindingRevision, baseRef: binding.baseRef, writable: binding.writable};
        }
        if (params.mode === 'compare') return service.compare(scope.actor, scope.taskId, params.left, params.right, params.offset, params.limit);
        if (params.mode === 'receipt') {
          const receipt=service.receipt(scope.actor, 'clientActionId' in params ? params.clientActionId : annotationActionId(params.requestId, params.toolCallId));
          if(receipt && receipt.taskId!==scope.taskId) throw new RequestError('ANNOTATION_NOT_FOUND','标注不存在或无权访问。',404);
          if (receipt) state.observeReceipt(receipt, callId);
          return receipt;
        }
        return service.read(scope.actor, scope.taskId, {ref: params.ref, layerIds: params.layerIds, objectIds: params.objectIds, fields: params.fields, offset: params.offset, limit: params.limit});
      }, signal)}),
    defineTool({name:'annotation_from_source',label:'按来源生成或刷新标注',
      description:'将已查询的来源对象精确标到本会话已有草稿和图层中；宿主重新查询并核对来源修订，保存原几何及本次真实查询时间，无需抄写坐标或时间。来源缺几何/修订变化时明确失败，不估算。add 使用来源名称；refresh 要求目标恰有一个匹配来源且几何类型兼容，保留标注ID、名称、样式、说明、属性及其他来源引用，只替换几何与该来源修订/时间。业务说明和属性不会自动更新，变化详情按需 situation_query 后另用 annotation_action 编辑。自定义规划区域使用 annotation_action；意图不清先澄清。1～20 项 items 整批原子保存；已有草稿须先读取本会话 draft；本轮新建成功的草稿无需重复读取。来源须先查询并收到结果再保存，版本条件由宿主维护。结果 fromSources[].queriedAt 是本工具新查询的 UTC 原值，不是此前查询时间；说明文件可按固定修订读取 sourceRefs，勿只改时区后缀。不发布、不设为任务当前。',
      parameters:annotationFromSourceSchema,executionMode:'sequential',
      execute:(toolCallId,params,signal)=>execute(toolCallId, async (scoped, dispatch, committed) => {
        const clientActionId = annotationActionId(scope.requestId, toolCallId);
        const replay = service.hostReplay(scope.actor, scope.sessionId, {...params, action: 'from_source', clientActionId});
        if (replay) return {...replay.receipt, replayed: true};
        state.requireDraftAndSources(params.items.map(item => item.sourceRef));
        const basis = state.draftBasis();
        const items = params.items.map(item => ({...item, expectedSourceRevision: state.sourceRevision(item.sourceRef)}));
        dispatch();
        const result = await service.fromSourcesFromHost(scope.actor, scope.sessionId, {clientActionId, expectedRevision: basis.revision, items}, basis, scoped, scope.check, committed);
        state.committed(result.receipt, result.replayed);
        return {...result.receipt, ...(result.replayed ? {replayed: true} : {})};
      },signal)}),
    defineTool({name: 'annotation_action', label: '编辑或发布标注', description: '创建、修改和发布仅针对当前会话自己的草稿；任务当前采用是独立的共享设定。创建新草稿明确空白 baseRef:null 或固定 baseRef，无需先读取空草稿；服务检查无草稿和绑定条件，不覆盖已有草稿。修改已有草稿先 annotation_read mode:draft 读取；本轮创建成功可继续新增。版本条件由宿主管理。参数错误只修正参数，缺少依据只补读指定资源；冲突重读对应资源评估。结果不确定先查原回执再重读，不能直接重复写入。复用来源对象几何用 annotation_from_source；本工具用于自定义绘制及名称、样式、说明等编辑。冲突必须重新评估，不能静默覆盖。publish 仅在用户明确要求共享时执行；保存或发布都不会自动设为任务当前，无审批，也不通知、不修改现实来源。只报告本次实际效果，无需顺带总结任务当前。若要说明任务当前，以本次 annotation_list 查询或本次实际成功采用回执为依据，分别说明读取或提交时状态；历史回答、旧动作回执及 replayed:true 都不能代替。未提供 current 不能推断为没有当前版本或基线正在被采用。图层和对象ID由模型取唯一短标识。' + (canSetCurrent ? '当前席位可以 set_current，仅在用户明确要求设为任务当前时执行；先 annotation_list 读取当前设定，收到结果后再采用；已有当前版本时先比较再设定。' : '当前席位不能设为任务当前，该操作不在可用参数中；不要尝试采用。'),
      parameters: actionSchema, executionMode: 'sequential',
      execute: (toolCallId, params, signal) => execute(toolCallId, (scoped, dispatch, committed) => {
        const clientActionId = annotationActionId(scope.requestId, toolCallId);
        const replay = service.hostReplay(scope.actor, scope.sessionId, {...params, clientActionId});
        if (replay) return {...replay.receipt, replayed: true};
        state.assertWritable();
        // Resolve local preconditions before marking the service call as dispatched.
        const basis = params.action === 'apply' ? state.draftBasis() : undefined;
        const sequence = params.action === 'set_current' ? state.currentSequence() : undefined;
        dispatch();
        const result = params.action === 'set_current'
          ? service.setCurrentFromHost(scope.actor, scope.sessionId, {publicationId: params.publicationId, expectedCurrentSequence: sequence!, clientActionId}, scoped, committed)
          : params.action === 'apply'
            ? service.actionFromHost(scope.actor, scope.sessionId, {...params, clientActionId, expectedRevision: basis!.revision}, basis, scoped, committed)
            : service.actionFromHost(scope.actor, scope.sessionId, {...params, clientActionId}, undefined, scoped, committed);
        state.committed(result.receipt, result.replayed);
        return {...result.receipt, ...(result.replayed ? {replayed: true} : {})};
      }, signal)}),
  ];
}
