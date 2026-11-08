import { Type, type Static } from 'typebox';
import type { HandoffFile } from './collaboration.js';
import type { ContextRef, Position } from './context.js';

const strict = { additionalProperties: false };
const uuid = Type.String({ pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' });
const ref = Type.Object({
  systemId: Type.Literal('situation'),
  objectType: Type.String({ minLength: 1, maxLength: 128 }),
  objectId: Type.String({ minLength: 1, maxLength: 128 }),
}, strict);
export const commandInputSchema = Type.Object({
  action: Type.Optional(Type.Union([Type.Literal('dispatch'), Type.Literal('reroute'), Type.Literal('cancel')])),
  targetCommandId: Type.Optional(uuid),
  expectedExecutionRevision: Type.Optional(Type.Integer({minimum:1})),
  vehicles: Type.Array(ref, { minItems: 1, maxItems: 24 }),
  destination: ref,
  route: Type.Array(ref, { maxItems: 20 }),
  notes: Type.Optional(Type.String({ maxLength: 4000 })),
  attachmentFileId: Type.Optional(uuid),
}, strict);
export type CommandInput = Static<typeof commandInputSchema>;
export const pageCommandPrepareSchema = Type.Object({
  workspaceId: uuid,
  clientActionId: uuid,
  command: commandInputSchema,
}, strict);
export const commandToolSchema = Type.Object({ command: commandInputSchema }, strict);

export interface CommandReceipt {
  commandId: string;
  receiptId: string;
  status: 'received';
  receivedAt: string;
  contentHash: string;
}
export interface CommandRecord {
  id: string;
  taskSpaceId: string;
  workspaceId: string;
  seatId: string;
  seatName: string;
  source: 'page' | 'agent';
  command: CommandInput;
  attachment?: HandoffFile;
  contentHash: string;
  createdAt: string;
  status: 'prepared' | 'cancelled' | 'unknown' | 'received' | 'rejected';
  receipt?: CommandReceipt;
  error?: string;
  execution?: CommandExecution;
  executionError?: string;
}
/** Server-built transport metadata. Business clients never choose ownership or actor. */
export interface ExternalCommand {
  commandId: string;
  scenarioInstanceId: string;
  taskId: string;
  issuedBy: { seatId: string; seatName: string };
  command: Omit<CommandInput, 'attachmentFileId'>;
  contentHash: string;
}

export type VehicleExecutionState = 'waiting' | 'en_route' | 'blocked' | 'arrived' | 'cancelled';
export interface ExecutionTrackPoint { businessTime: string; position: Position; sourceRevision: number }
export interface VehicleExecution {
  vehicle: ContextRef; state: VehicleExecutionState; position: Position;
  route: ContextRef[]; path: Position[]; trace: ExecutionTrackPoint[];
  distanceMeters: number; travelledMeters: number; speedMetersPerSecond: number;
  departAt: string; estimatedArrivalAt: string; arrivedAt?: string; blockedReason?: string;
}
export interface ExecutionHistory {
  commandId: string; action: 'dispatch' | 'reroute' | 'cancel'; businessTime: string;
  vehicles: ContextRef[]; reason?: string;
}
export interface CommandExecution {
  protocolVersion: 2; commandId: string; rootCommandId: string; revision: number;
  status: 'accepted' | 'refused' | 'active' | 'completed' | 'cancelled';
  businessNow: string; reason?: string; vehicles: VehicleExecution[]; history: ExecutionHistory[];
}
