import { RequestError } from '../contracts/errors.js';
import type { ContextRef } from '../contracts/context.js';

export type AnnotationResourceIssue = {kind: 'draft' | 'binding' | 'current' | 'source'; state: 'missing' | 'stale'; itemIndex?: number; ref?: ContextRef};
/** Safe machine-readable recovery facts; never inferred from error prose. */
export class AnnotationError extends RequestError {
  constructor(code: string, message: string, public readonly recovery: {
    outcome: 'not_committed' | 'unknown'; resources?: AnnotationResourceIssue[]; clientActionIds?: string[]; itemIndex?: number;
  }, statusCode = 409) { super(code, message, statusCode); }
}
