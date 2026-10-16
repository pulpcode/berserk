import type { SpatialInput, SpatialResult } from '../../contracts/spatial';
import { analysisReferenceId, type AnalysisMapState } from './analysis-runtime';
export const analysisLabels: Record<SpatialResult['operation'], string> = { measure: '空间测量', relate: '空间关系', buffer: '缓冲范围', filter: '范围筛选', nearest: '邻近排序', summarize: '分类统计' };
export function analysisValue(result: SpatialResult): string {
  const values = result.values;
  if (!values) return `${result.items.length} 个${result.operation === 'buffer' ? '参与' : '结果'}对象`;
  if ('value' in values) return `${values.value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })} ${values.unit}`;
  if ('matches' in values) return `${({contains:'包含',intersects:'相交',disjoint:'分离'})[values.relation]}：${values.matches ? '是' : '否'}`;
  return `共 ${values.total} 个对象`;
}
function parameterLabel(result: SpatialResult): string {
  const params=result.parameters;
  switch(params.operation) {
    case 'measure': return ({distance:'两点球面距离',point_to_line:'点到线最短距离',length:'折线长度',area:'实际区域面积'})[params.metric];
    case 'relate': return `关系：${({contains:'包含（含边界）',intersects:'相交（含接触）',disjoint:'分离'})[params.relation]}`;
    case 'buffer': return `缓冲距离 ${params.distanceM} m`;
    case 'nearest': return `限定候选中的最近 ${params.count} 个点，按地理距离排序`;
    case 'summarize': return `分类字段：${params.field}`;
    case 'filter': return [params.spatial?('distanceM' in params.spatial?`距离 ≤ ${params.spatial.distanceM} m`:`空间关系：${({contains:'范围包含候选',intersects:'相交',disjoint:'分离'})[params.spatial.relation]}`):'',...(params.attributes || []).map(item=>`${item.field} ${({eq:'=',ne:'≠',gt:'>',gte:'≥',lt:'<',lte:'≤'})[item.op]} ${String(item.value)}`)].filter(Boolean).join('；');
  }
}
function scopeLabel(scope: SpatialInput): string {
  switch (scope.kind) {
    case 'source': return `来源 ${scope.systemId} · ${scope.objectRefs ? `指定 ${scope.objectRefs.length} 个对象` : scope.areaIds ? `区域 ${scope.areaIds.join('、')}` : '全部获准对象'}`;
    case 'annotation': return `固定标绘 ${'setId' in scope.ref ? `修订 r${scope.ref.revision}` : '发布版'} · ${scope.objectIds ? `指定 ${scope.objectIds.length} 个对象` : scope.layerIds ? `图层 ${scope.layerIds.join('、')}` : '整个版本'}`;
    case 'result': return `前序固定分析 · ${scope.geometry ? '生成范围' : scope.itemIds ? `指定 ${scope.itemIds.length} 个结果对象` : '结果对象集合'}`;
  }
}
export function AnalysisPanel({ state, editing = false }: { state: AnalysisMapState; editing?: boolean }) {
  const { result } = state;
  return <section className="analysis-panel" aria-label="空间分析结果">
    <header><strong>{analysisLabels[result.operation]}</strong><span>临时结果 · 只读</span></header>
    <p className="analysis-value">{analysisValue(result)}</p><p>{parameterLabel(result)}</p>
    <p className="resource-help">候选范围已完整读取：{result.completeness.candidateCount} 个对象。计算时间：{new Date(result.createdAt).toLocaleString('zh-CN')}</p>
    <div className="situation-actions"><button type="button" onClick={state.toggle} aria-pressed={state.visible}>{state.visible ? '隐藏分析' : '显示分析'}</button><button type="button" onClick={() => state.locate()} disabled={editing}>定位分析</button><button type="button" onClick={state.clear}>清除临时显示</button></div>
    {editing && <p className="resource-help">绘制期间保留视角；完成绘制后可定位分析。</p>}
    {result.values && 'groups' in result.values && <ul>{result.values.groups.map((group, index) => <li key={index}>{group.value === null ? '未分类' : String(group.value)}：{group.count}</li>)}</ul>}
    {result.items.length > 0 && <ul className="analysis-items">{result.items.map(item => <li key={item.id}><button type="button" aria-pressed={state.selected === item.id} onClick={() => state.pick(item.id)}>{item.name}{item.distanceM !== undefined && <small>{item.distanceM.toLocaleString('zh-CN', { maximumFractionDigits: 2 })} m</small>}</button><button type="button" disabled={editing} aria-label={`定位分析对象 ${item.name}`} onClick={() => state.locate(item.id)}>定位</button></li>)}</ul>}
    {!!result.referenceItems?.length && <section aria-label="分析参考对象"><h4>参考范围与对象</h4><p className="resource-help">本次计算的固定参照，不计入结果对象；地图以灰色描边、线面虚线标识。</p><ul className="analysis-items">{result.referenceItems.map(item=><li key={item.id}><button type="button" aria-pressed={state.selected===analysisReferenceId(item.id)} onClick={()=>state.pick(analysisReferenceId(item.id))}>参考：{item.name}</button><button type="button" disabled={editing} aria-label={`定位参考对象 ${item.name}`} onClick={()=>state.locate(analysisReferenceId(item.id))}>定位</button></li>)}</ul></section>}
    <details><summary>范围与计算依据</summary><ul>{result.scope.map((scope, index) => <li key={index}>{scopeLabel(scope)}</li>)}</ul><ul>{result.provenance.map((entry,index)=><li key={index}>读取时间 {new Date(entry.queriedAt).toLocaleString('zh-CN')}；来源时间 {new Date(entry.asOf).toLocaleString('zh-CN')}{entry.sourceRefs?.map(ref=><span key={`${ref.systemId}:${ref.objectType}:${ref.objectId}`}> · {ref.objectId} r{ref.revision}</span>)}</li>)}</ul><p>{result.method}</p>{result.limitations.map(value => <p key={value}>{value}</p>)}</details>
    <p className="resource-help">保留本次固定结果；清除显示不删除会话记录。保存请在对话中提出。</p>
  </section>;
}
