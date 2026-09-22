import { Type, type Static } from 'typebox';

export interface ActorContext { readonly seatId: string }
export type WorkState = 'assigned' | 'working' | 'submitted' | 'returned' | 'completed';
export type WorkActionKind = 'assign' | 'claim' | 'submit' | 'review';
export interface HandoffFile { fileId: string; name: string; size: number; hash: string; createdAt: string }
export interface WorkItem {
  id: string; taskSpaceId: string; creatorSeatId: string; assigneeSeatId: string;
  title: string; goal: string; inputFileIds: string[]; state: WorkState; revision: number;
  latestSubmissionId?: string; createdAt: string; updatedAt: string;
}
export interface Submission {
  id: string; workItemId: string; attempt: number; file: HandoffFile;
  submittedBy: string; createdAt: string;
  review?: { decision: 'accept' | 'return'; reason?: string; seatId: string; createdAt: string };
}
export interface WorkDetail extends WorkItem { inputFiles: HandoffFile[]; submissions: Submission[]; sessionIds: string[] }
export interface WorkReceipt { operationId: string; workItemId: string; state: WorkState; revision: number; submissionId?: string; committedAt: string }
export interface WorkAction {
  operationId: string; source: 'page' | 'agent'; kind: WorkActionKind; seatId: string;
  title: string; description: string; taskSpaceId: string; workItemId?: string;
  expectedRevision?: number; creatorSeatId: string; assigneeSeatId: string;
  files: HandoffFile[]; createdAt: string; status: 'prepared' | 'committed' | 'cancelled' | 'expired';
  receipt?: WorkReceipt;
}
const strict = { additionalProperties: false };
const uuid = Type.String({ pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' });
const path = Type.String({ minLength: 1, maxLength: 4096 });
const revision = Type.Integer({ minimum: 1 });
const assign = {
  kind: Type.Literal('assign'), taskSpaceId: uuid,
  payload: Type.Object({ workspaceId: uuid, assigneeSeatId: Type.String({ pattern: '^[a-zA-Z0-9_-]{1,64}$' }), title: Type.String({ minLength: 1, maxLength: 120 }), goal: Type.String({ minLength: 1, maxLength: 12000, description: '接收方需要完成的工作目标与交付要求。' }), inputPaths: Type.Optional(Type.Array(path, { maxItems: 100, description: '随工作交接的当前工作区文件路径列表，准备时保存固定副本。无附件时可省略或传空数组。' })) }, strict),
};
const claim = { kind: Type.Literal('claim'), workItemId: uuid, expectedRevision: revision, payload: Type.Object({}, strict) };
const submit = { kind: Type.Literal('submit'), workItemId: uuid, expectedRevision: revision, payload: Type.Object({ workspaceId: uuid, path }, strict) };
const review = { kind: Type.Literal('review'), workItemId: uuid, expectedRevision: revision, payload: Type.Object({ submissionId: uuid, decision: Type.Union([Type.Literal('accept'), Type.Literal('return')]), reason: Type.Optional(Type.String({ maxLength: 4000 })) }, strict) };
export const workPrepareSchema = Type.Union([Type.Object(assign, strict), Type.Object(claim, strict), Type.Object(submit, strict), Type.Object(review, strict)]);
export type WorkPrepareInput = Static<typeof workPrepareSchema>;
const clientActionId = Type.String({ minLength: 1, maxLength: 128 });
export const pageWorkPrepareSchema = Type.Union([Type.Object({ ...assign, clientActionId }, strict), Type.Object({ ...claim, clientActionId }, strict), Type.Object({ ...submit, clientActionId }, strict), Type.Object({ ...review, clientActionId }, strict)]);
export type PageWorkPrepareInput = Static<typeof pageWorkPrepareSchema>;
export const workCommitSchema = Type.Object({ operationId: uuid }, strict);
export const workReadSchema = Type.Object({ workItemId: Type.Optional(uuid), operationId: Type.Optional(uuid) }, {...strict, minProperties: 1, maxProperties: 1});
export const handoffImportSchema = Type.Object({ fileId: { ...uuid, description: '已交接文件的编号，可从关联工作或工作详情取得，例如 inputFiles[].fileId 或 submissions[].file.fileId。' }, path: Type.Optional(path) }, strict);
export const pageHandoffImportSchema = Type.Object({ workspaceId: uuid, path: Type.Optional(path) }, strict);
export interface HandoffImportResult { fileId: string; workspaceId: string; path: string; name: string; size: number; hash: string }
export const handoffConfirmationSchema = Type.Object({
  operationId: uuid, kind: Type.Union([Type.Literal('assign'), Type.Literal('claim'), Type.Literal('submit'), Type.Literal('review')]),
  title: Type.String({ minLength: 1, maxLength: 240 }), description: Type.String({ minLength: 1, maxLength: 20000 }),
  files: Type.Array(Type.Object({ fileId: uuid, name: Type.String({ minLength: 1, maxLength: 4096 }), size: Type.Integer({ minimum: 0 }), hash: Type.String({ pattern: '^[a-f0-9]{64}$' }), createdAt: Type.String() }, strict), { maxItems: 100 }),
}, strict);
export type HandoffConfirmation = Static<typeof handoffConfirmationSchema>;
export function handoffConfirmation(action: WorkAction): HandoffConfirmation {
  return { operationId: action.operationId, kind: action.kind, title: action.title, description: action.description, files: action.files };
}
