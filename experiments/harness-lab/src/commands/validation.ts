import { createHash } from 'node:crypto';
import { Check } from 'typebox/value';
import { commandInputSchema, type CommandInput } from '../contracts/commands.js';
import type { SituationObject } from '../contracts/context.js';
import { RequestError } from '../contracts/errors.js';

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
