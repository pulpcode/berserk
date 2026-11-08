import { createHash } from 'node:crypto';
import { Check } from 'typebox/value';
import { commandInputSchema, type CommandInput } from '../contracts/commands.js';
import type { SituationObject } from '../contracts/context.js';
import { RequestError } from '../contracts/errors.js';
import { Type } from 'typebox';
import { contextRef, contextTimestamp } from '../context/validation.js';
import type { CommandExecution } from '../contracts/commands.js';

export function stableCommand(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
}
export function commandHash(value: unknown): string {
  return createHash('sha256').update(stableCommand(value)).digest('hex');
}
export function commandInput(value: unknown): CommandInput {
  if (!Check(commandInputSchema, value)) throw new RequestError('INVALID_INPUT', '请核对车辆、目的地、路线和附件。');
  const command = structuredClone(value);
  const ids = command.vehicles.map(ref => ref.objectId);
  if (new Set(ids).size !== ids.length) throw new RequestError('INVALID_INPUT', '车辆不能重复。');
  const action = command.action ?? 'dispatch';
  if (action === 'dispatch' && (command.targetCommandId !== undefined || command.expectedExecutionRevision !== undefined)
    || action !== 'dispatch' && (!command.targetCommandId || command.expectedExecutionRevision === undefined)) {
    throw new RequestError('INVALID_INPUT', '调整或取消须引用原始指令及执行版本。');
  }
  return command;
}
export function assertCommandObjects(command: CommandInput, objects: SituationObject[]): void {
  const find = (ref: CommandInput['destination']) => objects.find(item => item.ref.systemId === ref.systemId && item.ref.objectType === ref.objectType && item.ref.objectId === ref.objectId);
  if (command.vehicles.some(ref => ref.objectType !== 'resource' || !find(ref)?.resourceData?.resource.vehicle)
    || command.destination.objectType !== 'resource' || find(command.destination)?.resourceData?.resource.category !== 'facility'
    || command.route.some(ref => ref.objectType !== 'road' || !find(ref))) {
    throw new RequestError('INVALID_INPUT', '车辆、目的地或道路不属于当前可查询对象。');
  }
}

const strict = { additionalProperties: false };
const text = Type.String({ minLength: 1, maxLength: 4000 });
const timestamp = Type.String({ minLength: 1, maxLength: 64 });
const uuid = Type.String({ pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' });
const position = Type.Tuple([Type.Number({ minimum: -180, maximum: 180 }), Type.Number({ minimum: -90, maximum: 90 })]);
const resource = Type.Object({ systemId: Type.Literal('situation'), objectType: Type.Literal('resource'), objectId: Type.String({ minLength: 1, maxLength: 128 }) }, strict);
const road = Type.Object({ systemId: Type.Literal('situation'), objectType: Type.Literal('road'), objectId: Type.String({ minLength: 1, maxLength: 128 }) }, strict);
const executionSchema = Type.Object({
  protocolVersion: Type.Literal(2), commandId: uuid, rootCommandId: uuid,
  revision: Type.Integer({ minimum: 1 }),
  status: Type.Union(['accepted', 'refused', 'active', 'completed', 'cancelled'].map(value => Type.Literal(value))),
  businessNow: timestamp, reason: Type.Optional(text),
  vehicles: Type.Array(Type.Object({
    vehicle: resource,
    state: Type.Union(['waiting', 'en_route', 'blocked', 'arrived', 'cancelled'].map(value => Type.Literal(value))),
    position, route: Type.Array(road, { maxItems: 20 }), path: Type.Array(position, { maxItems: 20000 }),
    trace: Type.Array(Type.Object({ businessTime: timestamp, position, sourceRevision: Type.Integer({ minimum: 1 }) }, strict), { maxItems: 20000 }),
    distanceMeters: Type.Number({ minimum: 0 }), travelledMeters: Type.Number({ minimum: 0 }),
    speedMetersPerSecond: Type.Number({ exclusiveMinimum: 0 }), departAt: timestamp, estimatedArrivalAt: timestamp,
    arrivedAt: Type.Optional(timestamp), blockedReason: Type.Optional(text),
  }, strict), { maxItems: 24 }),
  history: Type.Array(Type.Object({ commandId: uuid,
    action: Type.Union(['dispatch', 'reroute', 'cancel'].map(value => Type.Literal(value))),
    businessTime: timestamp, vehicles: Type.Array(resource, { maxItems: 24 }), reason: Type.Optional(text),
  }, strict), { maxItems: 10000 }),
}, strict);

/** Validate external state before publishing it to the page or native tool result. */
export function commandExecution(value: unknown): CommandExecution {
  if (!Check(executionSchema, value)) throw new RequestError('COMMAND_EXECUTION_INVALID', '执行进展返回内容无效，请核查来源。', 502);
  contextTimestamp(value.businessNow);
  const ids = new Set<string>();
  for (const vehicle of value.vehicles) {
    const id = contextRef(vehicle.vehicle).objectId;
    if (ids.has(id)) throw new RequestError('COMMAND_EXECUTION_INVALID', '执行进展包含重复车辆。', 502);
    ids.add(id);
    if (![vehicle.distanceMeters, vehicle.travelledMeters, vehicle.speedMetersPerSecond].every(Number.isFinite)) {
      throw new RequestError('COMMAND_EXECUTION_INVALID', '执行行程参数无效。', 502);
    }
    contextTimestamp(vehicle.departAt); contextTimestamp(vehicle.estimatedArrivalAt);
    if (vehicle.arrivedAt) contextTimestamp(vehicle.arrivedAt);
    for (const point of vehicle.trace) contextTimestamp(point.businessTime);
  }
  for (const item of value.history) contextTimestamp(item.businessTime);
  return structuredClone(value) as CommandExecution;
}
