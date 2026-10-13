import { createHash } from 'node:crypto';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type, type Static } from 'typebox';
import type { AnnotationService, AnnotationActor } from '../annotations/service.js';
import { RequestError } from '../contracts/errors.js';

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
  Type.Object({action: Type.Literal('create_draft'), baseRef: Type.Union([annotationRefSchema, Type.Null()]), title: Type.Optional(name), operations: Type.Optional(operationsRef)}, strict),
  Type.Object({action: Type.Literal('apply'), expectedRevision: revision, operations: operationsRef}, strict),
  Type.Object({action: Type.Literal('publish'), revision, title: name, note: Type.Optional(Type.String({maxLength: 4000}))}, strict),
] as const;
const currentSchema = Type.Object({action: Type.Literal('set_current'), publicationId: uuid, expectedCurrentSequence: Type.Integer({minimum: 0})}, strict);
const pagination = {offset: Type.Optional(Type.Integer({minimum: 0})), limit: Type.Optional(Type.Integer({minimum: 1, maximum: 100}))};
/** Stable per native call; unknown effects are inspected through a receipt, never replayed by the host. */
export function annotationActionId(requestId: string, toolCallId: string): string {
  const value = createHash('sha256').update(JSON.stringify([requestId, toolCallId])).digest('hex');
  return `${value.slice(0,8)}-${value.slice(8,12)}-5${value.slice(13,16)}-a${value.slice(17,20)}-${value.slice(20,32)}`;
}
export function annotationTools(service: AnnotationService, scope: {actor: AnnotationActor; sessionId: string; taskId: string; requestId: string; signal: AbortSignal; check: () => void}) {
  const execute = async <T>(work: (signal: AbortSignal) => T, signal?: AbortSignal) => {
    const scoped = signal ? AbortSignal.any([scope.signal, signal]) : scope.signal;
    scoped.throwIfAborted(); scope.check();
    try {
      const result = work(scoped);
      scoped.throwIfAborted(); scope.check();
      return {content: [{type: 'text' as const, text: JSON.stringify(result)}], details: {}};
    } catch (error) {
      scoped.throwIfAborted();
      if (error instanceof RequestError) throw new Error(`${error.code}: ${error.message}`);
      throw error;
    }
  };
  const canSetCurrent = service.canSetCurrent(scope.actor, scope.taskId);
  const actionSchema = Type.Union([...actionSchemas, currentSchema], {type: 'object', $defs: {geometry, style, feature, operations}});
  if (!canSetCurrent) actionSchema.anyOf.splice(-1, 1);
  return [
    defineTool({name: 'annotation_list', label: '浏览任务标注', description: '列出本任务可见的草稿和发布版本及当前设定，只有元信息、不含几何。不会切换本会话编辑目标。分页读取。',
      parameters: Type.Object(pagination, strict), executionMode: 'sequential',
      execute: (_id, params, signal) => execute(() => ({...service.list(scope.actor, scope.taskId, params.offset, params.limit), current: service.current(scope.actor, scope.taskId)}), signal)}),
    defineTool({name: 'annotation_read', label: '读取固定标注', description: '读取明确固定版本。默认仅摘要。查询个别对象而未知ID时，先不带fields读取摘要定位，再按objectIds读取所需字段；不要为单对象问题读取整图几何。仅在需要时选择 geometry/note/attributes/style/sourceRefs/originFeatureRef，按对象或图层缩小范围。hasMore 时尚未读完。compare 比较两个固定版本；receipt 按动作ID，或原始 requestId + toolCallId 查询已提交动作，不会重放。读取引用不会改变可写草稿。',
      parameters: Type.Union([
        Type.Object({mode: Type.Literal('read'), ref: annotationRefSchema, ...selection, fields: Type.Optional(Type.Array(Type.Union(['geometry','note','attributes','style','sourceRefs','originFeatureRef'].map(value => Type.Literal(value))), {uniqueItems: true})), ...pagination}, strict),
        Type.Object({mode: Type.Literal('compare'), left: annotationRefSchema, right: annotationRefSchema, ...pagination}, strict),
        Type.Object({mode: Type.Literal('receipt'), clientActionId: uuid}, strict),
        Type.Object({mode: Type.Literal('receipt'), requestId: uuid, toolCallId: Type.String({minLength: 1, maxLength: 256})}, strict),
      ], {type: 'object'}), executionMode: 'sequential', execute: (_id, params, signal) => execute(() => {
        if (params.mode === 'compare') return service.compare(scope.actor, scope.taskId, params.left, params.right, params.offset, params.limit);
        if (params.mode === 'receipt') {
          const receipt=service.receipt(scope.actor, 'clientActionId' in params ? params.clientActionId : annotationActionId(params.requestId, params.toolCallId));
          if(receipt && receipt.taskId!==scope.taskId) throw new RequestError('ANNOTATION_NOT_FOUND','标注不存在或无权访问。',404);
          return receipt;
        }
        return service.read(scope.actor, scope.taskId, {ref: params.ref, layerIds: params.layerIds, objectIds: params.objectIds, fields: params.fields, offset: params.offset, limit: params.limit});
      }, signal)}),
    defineTool({name: 'annotation_action', label: '编辑或发布标注', description: '仅操作当前会话自己的草稿。首次编辑明确空白 null 或固定 baseRef；保存基于已读取 expectedRevision，成功后使用返回新修订。冲突必须重新评估，不能静默覆盖。publish 仅在用户明确要求共享时执行，set_current 仅在用户明确要求设为任务当前时执行；先调用annotation_list读取current.sequence作为expectedCurrentSequence，不猜测序号；已有当前版本时先比较再设定；两者独立，无审批，也不通知、不修改现实来源。图层和对象ID由模型取唯一短标识。',
      parameters: actionSchema, executionMode: 'sequential',
      execute: (toolCallId, params, signal) => execute(scoped => {
        const clientActionId = annotationActionId(scope.requestId, toolCallId);
        if ('action' in params && params.action === 'set_current') {
          return service.setCurrent(scope.actor, scope.taskId, {publicationId: params.publicationId, expectedCurrentSequence: params.expectedCurrentSequence, clientActionId}, scoped);
        }
        return service.action(scope.actor, scope.sessionId, {...params, clientActionId}, scoped);
      }, signal)}),
  ];
}
