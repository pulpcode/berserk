import { RequestError } from '../contracts/errors.js';
import { AnnotationError } from '../annotations/errors.js';

/** Optional lookup advice on known recoverable errors; never authority or an automatic action. */
export function methodAdvice(error: unknown, available: readonly string[] = []): {methodAdvice?: {skillId: string; reason: string}} {
  if (!(error instanceof RequestError)) return {};
  if (error instanceof AnnotationError && error.recovery.outcome !== 'not_committed') return {};
  let skillId: string, reason: string;
  switch (error.code) {
    case 'ANNOTATION_READ_REQUIRED':
      skillId = 'map-annotations'; reason = '查看草稿读取依据与保存步骤。'; break;
    case 'ANNOTATION_CONFLICT':
      if (!(error instanceof AnnotationError) || !error.recovery.resources?.some(r => r.kind === 'draft' && r.state === 'stale')) return {};
      skillId = 'map-annotations'; reason = '查看草稿版本冲突后的重新读取与评估步骤。'; break;
    case 'SPATIAL_AMBIGUOUS':
      skillId = 'spatial-analysis'; reason = '查看对象数量和固定结果范围的选择方法。'; break;
    case 'SPATIAL_UNSUPPORTED_GEOMETRY':
      skillId = 'spatial-analysis'; reason = '查看空间方法适用的几何类型。'; break;
    default: return {};
  }
  return available.includes(skillId) ? {methodAdvice: {skillId, reason}} : {};
}
