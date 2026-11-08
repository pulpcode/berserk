import { randomUUID } from 'node:crypto';
import type { CommandExecution, CommandReceipt, ExternalCommand, VehicleExecution } from '../../../src/contracts/commands.js';
import type { ScenarioAction, ScenarioActor, ScenarioStepSummary } from '../../../src/contracts/scenarios.js';
import type { ContextRef, SituationObject } from '../../../src/contracts/context.js';
import { assertCommandObjects, commandExecution, commandHash, commandInput } from '../../../src/commands/validation.js';
import { resourceFactActive } from '../../../src/contracts/task-resources.js';
import type { SceneRecord } from './store.js';
import { executionRoutingParameters as parameters, meters, pathFor, positionAlong, type PathSegment } from './routing.js';
interface StoredVehicle extends VehicleExecution {
    segments: PathSegment[];
    lastAt: string;
    occupied: boolean;
    hasDeparted: boolean;
}
interface StoredExecution extends Omit<CommandExecution, 'vehicles'> {
    vehicles: StoredVehicle[];
    taskId: string;
    seatId: string;
}
interface StoredReceipt {
    input: ExternalCommand;
    receipt: CommandReceipt;
    root: string;
}
export interface ExecutionState {
    schemaVersion: 1;
    commands: Record<string, StoredReceipt>;
    roots: Record<string, StoredExecution>;
    timeline: ScenarioStepSummary[];
}
export const executionTime = (milliseconds: number) => new Date(milliseconds + parameters.businessUtcOffsetMinutes * 60000).toISOString().replace('Z','+08:00');
const stamp = executionTime;
const plus = (time: string, seconds: number) => stamp(Date.parse(time) + seconds * 1000);
const refEquals = (a: ContextRef, b: ContextRef) => a.systemId === b.systemId && a.objectType === b.objectType && a.objectId === b.objectId;
const object = (record: SceneRecord, ref: ContextRef) => record.objects.find(o => refEquals(o.ref, ref));
const point = (item: SituationObject | undefined) => item?.geometry?.type === 'Point' ? item.geometry.coordinates : undefined;
export function executionState(record: SceneRecord): ExecutionState {
    record.execution ??= { schemaVersion: 1, commands: {}, roots: {}, timeline: [] };
    if (record.execution.schemaVersion !== 1 || !record.execution.commands || !record.execution.roots || !Array.isArray(record.execution.timeline))
        throw new Error('执行快照无效。');
    for (const [id, entry] of Object.entries(record.execution.commands)) {
        commandInput(entry.input.command);
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(entry.receipt.receiptId)
            || entry.input.commandId !== id || entry.input.scenarioInstanceId !== record.instance.instanceId
            || entry.receipt.commandId !== id || entry.receipt.status !== 'received'
            || !Number.isFinite(Date.parse(entry.receipt.receivedAt))
            || entry.receipt.contentHash !== commandHash(entry.input.command)
            || !record.execution.roots[entry.root])
            throw new Error('执行回执或归属损坏。');
        const root = record.execution.roots[entry.root];
        if (root.taskId !== entry.input.taskId || root.seatId !== entry.input.issuedBy.seatId)
            throw new Error('执行主体归属损坏。');
        commandExecution(executionView(record, id));
    }
    const occupied = new Set<string>();
    for (const [id, root] of Object.entries(record.execution.roots)) {
        if (!record.execution.commands[id] || !root.history.length || root.status==='refused'&&!root.reason || root.status !== 'refused' && !root.vehicles.length)
            throw new Error('执行根记录损坏。');
        for (const vehicle of root.vehicles) {
            if (typeof vehicle.occupied !== 'boolean' || typeof vehicle.hasDeparted !== 'boolean'
                || !Number.isFinite(Date.parse(vehicle.lastAt)) || !Array.isArray(vehicle.segments)
                || !vehicle.segments.length || vehicle.path.length !== vehicle.segments.length + 1
                || vehicle.travelledMeters > vehicle.distanceMeters + 0.001)
                throw new Error('执行车辆记录损坏。');
            let length = 0;
            for (const [index, segment] of vehicle.segments.entries()) {
                if (!Number.isFinite(segment.meters) || segment.meters < 0
                    || meters(segment.from,vehicle.path[index]) > 0.05
                    || meters(segment.to,vehicle.path[index + 1]) > 0.05)
                    throw new Error('执行路径损坏。');
                length += segment.meters;
            }
            if (Math.abs(length - vehicle.distanceMeters) > 0.01)
                throw new Error('执行距离损坏。');
            if (vehicle.occupied) {
                if (occupied.has(vehicle.vehicle.objectId) || !object(record, vehicle.vehicle)?.resourceData)
                    throw new Error('车辆占用损坏。');
                occupied.add(vehicle.vehicle.objectId);
            }
        }
    }
    return record.execution;
}
export function executionView(record: SceneRecord, id: string): CommandExecution | undefined {
    const state = record.execution, entry = state?.commands[id];
    if (!state || !entry)
        return;
    const root = state.roots[entry.root];
    if (!root)
        throw new Error('执行指令归属损坏。');
    const { taskId: _task, seatId: _seat, ...view } = root;
    void _task;
    void _seat;
    return { ...structuredClone(view), commandId: id, businessNow: record.instance.businessNow, vehicles: view.vehicles.map(({ segments: _segments, lastAt: _at, occupied: _occupied, hasDeparted: _departed, ...vehicle }) => { void _segments; void _at; void _occupied; void _departed; return structuredClone(vehicle); }) };
}
function changeVehicle(record: SceneRecord, root: StoredExecution, vehicle: StoredVehicle) {
    const source = object(record, vehicle.vehicle);
    if (!source?.resourceData)
        throw new Error('执行车辆不存在。');
    const before = structuredClone(source), time = record.instance.businessNow;
    source.revision++;
    source.effectiveAt = time;
    source.geometry = { type: 'Point', coordinates: [...vehicle.position] };
    const evidence = [{ kind: 'source' as const, ref: source.ref, revision: source.revision }];
    source.resourceData.resource.availability = { state: vehicle.occupied ? 'unavailable' : 'available', effectiveAt: time, reportedAt: time, evidence: [...evidence, { kind: 'declaration', note: vehicle.occupied ? (vehicle.state === 'cancelled' ? '行动安排已取消，车辆保持当前位置并待后续处置' : `车辆执行任务占用，指令${root.rootCommandId}`) : '未出发安排已取消，车辆可用' }] };
    source.resourceData.resource.position = { meaning: 'actual', appliesTo: 'resource', effectiveAt: time, reportedAt: time, evidence };
    vehicle.trace.push({ businessTime: time, position: [...vehicle.position], sourceRevision: source.revision });
    source.properties = { executionState: vehicle.state, executionCommandId: root.rootCommandId, executionTrack: structuredClone(vehicle.trace) };
    record.changes.push({ cursor: `scene:${record.instance.instanceId}:${record.changes.length + 1}`, effectiveAt: time, before, after: structuredClone(source) });
}
function notify(record: SceneRecord, root: StoredExecution, vehicles: StoredVehicle[], message: string, stepId: string, actor: ScenarioActor) {
    if (!vehicles.length)
        return;
    const time = record.instance.businessNow, code = `execution-${root.rootCommandId}-${root.revision}-${record.actions.length}`;
    const title = `车辆执行反馈：${message}`;
    const text = `${vehicles.map(v => object(record, v.vehicle)?.name ?? v.vehicle.objectId).join('、')}：${message}。指令${root.rootCommandId}。业务时间${time}。`;
    const reportId = `${record.instance.instanceId}-report-${code}`;
    record.reports.push({ reportId, subjectId: reportId, revision: 1, title, summary: text, content: text, objectRefs: vehicles.map(v => v.vehicle), areaIds: [...new Set(vehicles.flatMap(v => object(record, v.vehicle)?.areaIds ?? []))], observedAt: time, publishedAt: time, validTime: null });
    const action: ScenarioAction = { id: randomUUID(), instanceId: record.instance.instanceId, stepId, actor: structuredClone(actor), systemId: 'situation', revision: record.instance.revision, createdAt: new Date().toISOString(), sendState: 'unsent', notification: { scenarioInstanceId: record.instance.instanceId, sourceMessageId: `${record.instance.instanceId}-${code}`, title, text: `${text}\n报告 intel/${reportId}，修订1。`, subjectId: reportId, occurredAt: time } };
    record.actions.push(action);
}
function newVehicle(record: SceneRecord, ref: ContextRef, input: ExternalCommand['command']): StoredVehicle {
    const item = object(record, ref), position = point(item), destination = point(object(record, input.destination));
    if (!position || !destination || !item?.resourceData?.resource.vehicle)
        throw new Error('车辆位置或目的地缺少可核验坐标。');
    const state = item.resourceData.resource.availability;
    if (!resourceFactActive(state, record.instance.businessNow) || state?.state !== 'available')
        throw new Error(`${item.name}当前不可调派或依据已过期。`);
    const segments = pathFor(position, destination, input.route, record.objects), distanceMeters = segments.reduce((n, s) => n + s.meters, 0), departAt = plus(record.instance.businessNow, parameters.preparationSeconds);
    return { vehicle: ref, state: 'waiting', position: [...position], route: structuredClone(input.route), path: [segments[0].from, ...segments.map(s => s.to)], segments, distanceMeters, travelledMeters: 0, speedMetersPerSecond: parameters.speedMetersPerSecond, departAt, estimatedArrivalAt: plus(departAt, Math.ceil(distanceMeters / parameters.speedMetersPerSecond)), trace: [], lastAt: record.instance.businessNow, occupied: true, hasDeparted: false };
}
export function receiveExecution(record: SceneRecord, input: ExternalCommand, actor: ScenarioActor): CommandReceipt {
    const state = executionState(record), time = record.instance.businessNow, action = input.command.action ?? 'dispatch';
    const rootId = action === 'dispatch' ? input.commandId : input.command.targetCommandId!;
    const receipt: CommandReceipt = { commandId: input.commandId, receiptId: randomUUID(), status: 'received', receivedAt: new Date().toISOString(), contentHash: input.contentHash };
    const original = state.roots[rootId];
    let root: StoredExecution;
    let storageRoot = rootId;
    try {
        assertCommandObjects(input.command,record.objects);
        if (action === 'dispatch') {
            const vehicles = input.command.vehicles.map(ref => newVehicle(record, ref, input.command));
            if (Object.values(state.roots).some(value => value.vehicles.some(v => v.occupied && vehicles.some(next => refEquals(v.vehicle, next.vehicle)))))
                throw new Error('车辆已被其他指令占用。');
            root = { protocolVersion: 2, commandId: rootId, rootCommandId: rootId, revision: 1, status: 'accepted', businessNow: time, vehicles, history: [{ commandId: input.commandId, action, businessTime: time, vehicles: input.command.vehicles }], taskId: input.taskId, seatId: input.issuedBy.seatId };
            state.roots[rootId] = root;
            for (const vehicle of vehicles)
                changeVehicle(record, root, vehicle);
        }
        else {
            if (!original || original.taskId !== input.taskId || original.seatId !== input.issuedBy.seatId)
                throw new Error('原指令不属于当前任务或席位。');
            const originalInput = state.commands[rootId]?.input.command;
            if (!originalInput || !refEquals(originalInput.destination, input.command.destination))
                throw new Error('调整须保留原指令的目的地。');
            if (original.revision !== input.command.expectedExecutionRevision)
                throw new Error('执行进展已更新，请核对最新版本。');
            if (!['accepted', 'active'].includes(original.status))
                throw new Error('原行动已经结束，不能再次调整。');
            const selected = input.command.vehicles.map(ref => original.vehicles.find(v => refEquals(v.vehicle, ref)));
            if (selected.some(v => !v || ['arrived', 'cancelled'].includes(v.state)))
                throw new Error('只允许调整本指令尚未完成的车辆。');
            const replacements = (selected as StoredVehicle[]).map(vehicle => {
                const next = structuredClone(vehicle);
                if (action === 'cancel') {
                    next.state = 'cancelled';
                    next.occupied = vehicle.hasDeparted;
                    return next;
                }
                const destination = point(object(record, input.command.destination));
                if (!destination)
                    throw new Error('目的地坐标缺失。');
                next.segments = pathFor(vehicle.position, destination, input.command.route, record.objects);
                next.path = [next.segments[0].from, ...next.segments.map(s => s.to)];
                next.route = structuredClone(input.command.route);
                next.distanceMeters = next.segments.reduce((n, s) => n + s.meters, 0);
                next.travelledMeters = 0;
                next.departAt = plus(time, parameters.preparationSeconds);
                next.estimatedArrivalAt = plus(next.departAt, Math.ceil(next.distanceMeters / next.speedMetersPerSecond));
                next.lastAt = time;
                next.state = 'waiting';
                delete next.blockedReason;
                return next;
            });
            root = original;
            root.revision++;
            for (const vehicle of replacements) {
                root.vehicles[root.vehicles.findIndex(v => refEquals(v.vehicle, vehicle.vehicle))] = vehicle;
                changeVehicle(record, root, vehicle);
            }
            root.history.push({ commandId: input.commandId, action, businessTime: time, vehicles: input.command.vehicles });
            root.status = root.vehicles.every(v => v.state === 'cancelled') ? 'cancelled'
                : root.vehicles.every(v => v.state === 'arrived' || v.state === 'cancelled') ? 'completed' : 'active';
            notify(record, root, replacements, action === 'cancel' ? '后续行动已取消' : '已接收调整，等待继续出发', `command-${input.commandId}`, actor);
        }
    }
    catch (error) {
        root = { protocolVersion: 2, commandId: input.commandId, rootCommandId: rootId, revision: 1, status: 'refused', businessNow: time, reason: error instanceof Error ? error.message : '执行条件未满足。', vehicles: [], history: [{ commandId: input.commandId, action, businessTime: time, vehicles: input.command.vehicles }], taskId: input.taskId, seatId: input.issuedBy.seatId };
        state.roots[input.commandId] = root;
        storageRoot = input.commandId;
    }
    state.commands[input.commandId] = { input: structuredClone(input), receipt, root: storageRoot };
    return receipt;
}
export function nextExecutionTime(record: SceneRecord): number | undefined {
    const times: number[] = [];
    for (const root of Object.values(record.execution?.roots ?? {}))
        for (const vehicle of root.vehicles) {
            if (vehicle.state === 'waiting')
                times.push(Date.parse(vehicle.departAt));
            else if (vehicle.state === 'en_route')
                times.push(Math.min(Date.parse(vehicle.estimatedArrivalAt), Date.parse(vehicle.lastAt) + parameters.updateSeconds * 1000));
        }
    return times.length ? Math.max(Date.parse(record.instance.businessNow), Math.min(...times)) : undefined;
}
export function advanceExecution(record: SceneRecord, actor: ScenarioActor, stepId: string) {
    const time = record.instance.businessNow;
    for (const root of Object.values(record.execution?.roots ?? {})) {
        const changed: StoredVehicle[] = [], departed: StoredVehicle[] = [], arrived: StoredVehicle[] = [], blocked: StoredVehicle[] = [];
        for (const vehicle of root.vehicles) {
            if (!['waiting', 'en_route'].includes(vehicle.state))
                continue;
            if (Date.parse(time) < Date.parse(vehicle.departAt))
                continue;
            const oldState = vehicle.state;
            if (vehicle.state === 'waiting') {
                vehicle.state = 'en_route';
                vehicle.hasDeparted = true;
                vehicle.lastAt = vehicle.departAt;
                departed.push(vehicle);
            }
            let offset = 0;
            const remaining = vehicle.segments.filter(segment => { offset += segment.meters; return offset > vehicle.travelledMeters; });
            const closed = remaining.find(segment => segment.road && record.objects.some(o => o.ref.objectId.endsWith('-' + segment.road) && 'passability' in o.properties && o.properties.passability !== 'open'));
            if (closed) {
                vehicle.state = 'blocked';
                vehicle.blockedReason = `前方${closed.road}不可通行`;
                blocked.push(vehicle);
            }
            else {
                const elapsed = Math.max(0, (Date.parse(time) - Date.parse(vehicle.lastAt)) / 1000);
                vehicle.travelledMeters = Math.min(vehicle.distanceMeters, vehicle.travelledMeters + elapsed * vehicle.speedMetersPerSecond);
                vehicle.position = positionAlong(vehicle.segments, vehicle.travelledMeters);
                if (vehicle.travelledMeters >= vehicle.distanceMeters - 0.001) {
                    vehicle.state = 'arrived';
                    vehicle.arrivedAt = time;
                    arrived.push(vehicle);
                }
            }
            if (oldState !== vehicle.state || time !== vehicle.lastAt) {
                vehicle.lastAt = time;
                changed.push(vehicle);
                changeVehicle(record, root, vehicle);
            }
        }
        if (changed.length) {
            root.revision++;
            root.businessNow = time;
            root.status = root.vehicles.every(v => ['arrived', 'cancelled'].includes(v.state)) ? 'completed' : 'active';
            notify(record, root, departed, '已出发', stepId, actor);
            notify(record, root, blocked, '前方道路封闭，等待调整', stepId, actor);
            notify(record, root, arrived, '已到场，继续任务占用', stepId, actor);
        }
    }
}
export function executionSummary(record: SceneRecord, time: number): ScenarioStepSummary {
    const active = Object.values(record.execution?.roots ?? {}).flatMap(root => root.vehicles).filter(vehicle => ['waiting', 'en_route'].includes(vehicle.state));
    const departed = active.filter(vehicle => vehicle.state === 'waiting' && Date.parse(vehicle.departAt) <= time);
    const arrived = active.filter(vehicle => vehicle.state === 'en_route' && Date.parse(vehicle.estimatedArrivalAt) <= time);
    const selected = arrived.length ? arrived : departed.length ? departed : active;
    const action = arrived.length ? '到场' : departed.length ? '出发' : '位置更新';
    return { id: `exec-${time}`, title: `${selected.length}辆车${action}`, description: selected.map(v => object(record, v.vehicle)?.name ?? v.vehicle.objectId).join('、'), businessTime: stamp(time), messageCount: 0, kind: 'execution', state: 'pending' };
}
