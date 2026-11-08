import { DatabaseSync } from 'node:sqlite';
import { executionRoutingParameters, pathFor } from '../scripts/mock-context/scenarios/routing.js';
import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ScenarioStore } from '../scripts/mock-context/scenarios/store.js';
import { commandHash } from '../src/commands/validation.js';
import type { CommandInput, ExternalCommand } from '../src/contracts/commands.js';
const actor = { userId: 'director', seatId: 'director' };
const cleanup: Array<() => Promise<unknown> | void> = [];
afterEach(async () => {
    executionRoutingParameters.speedMetersPerSecond = 12;
    for (const f of cleanup.splice(0).reverse())
        await f();
});
function fixture(path?: string, initialSteps = 5) {
    const store = new ScenarioStore(path);
    cleanup.push(() => store.close());
    const made = store.create({ definitionId: 'harbor-fire', version: '5', mode: 'main_story', clientActionId: randomUUID() }, actor), id = made.instance.instanceId;
    store.activate(id, randomUUID(), made.instance.revision, 0, false, actor);
    const ref = (code: string): CommandInput['destination'] => ({ systemId: 'situation', objectType: code.startsWith('R') ? 'road' : 'resource', objectId: `${id}-${code}` });
    const accept = () => {
        for (const action of store.get(id).actions)
            if (action.sendState !== 'accepted')
                store.delivery(action.id, 'accepted', { status: 'accepted', eventId: randomUUID(), sourceMessageId: action.notification.sourceMessageId, receivedAt: new Date().toISOString() });
    };
    const next = () => { const p = store.preview(id); expect(p.canApply, p.reason).toBe(true); const before = JSON.stringify(store.get(id)); store.preview(id); expect(JSON.stringify(store.get(id))).toBe(before); const result = store.apply(id, p.step!.id, randomUUID(), p.instance.revision, actor); expect(result.actions).toHaveLength(p.step!.messageCount); expect(result.actions.every(a => a.stepId === p.step!.id)).toBe(true); accept(); return p.step!; };
    for (let i = 0; i < initialSteps; i++)
        next();
    const taskId = randomUUID();
    const input = (codes: string[], roads: string[], extra: Partial<CommandInput> = {}): ExternalCommand => { const command: CommandInput = { vehicles: codes.map(ref), destination: ref('L01'), route: roads.map(ref), ...extra }; return { commandId: randomUUID(), scenarioInstanceId: id, taskId, issuedBy: { seatId: 'control', seatName: '控制席' }, command, contentHash: commandHash(command) }; };
    return { store, id, ref, accept, next, input };
}
describe('external deterministic scene execution', () => {
    it('derives different journeys from actual vehicles and roads, reserves atomically and keeps reads pure', () => {
        const f = fixture();
        const local = f.input(['V01', 'V03', 'V06'], ['R03']), remote = f.input(['V07', 'V08', 'V11', 'V13'], ['R01', 'R03']);
        const now = f.store.get(f.id).instance.businessNow;
        f.store.receiveCommand(local);
        f.store.receiveCommand(remote);
        const a = f.store.commandExecution(local.commandId)!, b = f.store.commandExecution(remote.commandId)!;
        expect(a.status).toBe('accepted');
        expect(b.status).toBe('accepted');
        expect(a.vehicles[0].distanceMeters).toBeLessThan(b.vehicles[0].distanceMeters);
        expect(b.vehicles[0].distanceMeters).not.toBe(b.vehicles[3].distanceMeters);
        expect(Date.parse(a.vehicles[0].estimatedArrivalAt)).toBeGreaterThan(Date.parse(now));
        expect(f.store.get(f.id).instance.businessNow).toBe(now);
        const conflict = f.input(['V01', 'V09'], ['R03']);
        f.store.receiveCommand(conflict);
        expect(f.store.commandExecution(conflict.commandId)?.status).toBe('refused');
        const untouched = f.store.get(f.id).objects.find(o => o.ref.objectId.endsWith('-V09'))!;
        expect(untouched.resourceData?.resource.availability?.state).toBe('available');
        expect(f.store.receiveCommand(local)).toEqual(f.store.receiveCommand(local));
    });
    it('moves three local vehicles, blocks unpassed bridge travel, preserves old reports and resumes only after a new confirmed command', () => {
        const f = fixture(), local = f.input(['V01', 'V03', 'V06'], ['R03']), remote = f.input(['V07', 'V08', 'V11', 'V13'], ['R01', 'R03']);
        f.store.receiveCommand(local);
        f.store.receiveCommand(remote);
        for (let i = 0; i < 30; i++) {
            if (f.next().id === 'E08')
                break;
        }
        const old = f.store.commandExecution(remote.commandId)!;
        expect(old.vehicles.every(v => v.state === 'blocked')).toBe(true);
        expect(f.store.commandExecution(local.commandId)?.vehicles.every(v => v.state === 'arrived')).toBe(true);
        for (let i = 0; i < 10; i++) {
            if (f.next().id === 'E10')
                break;
        }
        expect(f.store.commandExecution(remote.commandId)?.vehicles.every(v => v.state === 'blocked')).toBe(true);
        const reroute = f.input(['V07', 'V08', 'V11', 'V13'], ['R02', 'R03'], { action: 'reroute', targetCommandId: remote.commandId, expectedExecutionRevision: f.store.commandExecution(remote.commandId)!.revision });
        f.store.receiveCommand(reroute);
        f.accept();
        expect(f.store.commandExecution(reroute.commandId)?.rootCommandId).toBe(remote.commandId);
        for (let i = 0; i < 120 && !f.store.commandExecution(remote.commandId)!.vehicles.every(v => v.state === 'arrived'); i++)
            f.next();
        const completed = f.store.commandExecution(remote.commandId)!;
        expect(completed.status).toBe('completed');
        expect(completed.vehicles.every(v => v.trace.length > 3)).toBe(true);
        expect(f.store.commandExecution(local.commandId)?.vehicles.every(v => v.state === 'arrived')).toBe(true);
        const road = f.store.get(f.id).objects.find(o => o.ref.objectId.endsWith('-R01'))!;
        expect(road.properties).toMatchObject({ passability: 'closed' });
    });
    it('rejects busy, stale, unsupported and unconnected commands without inventing motion', () => {
        const f = fixture();
        for (const input of [f.input(['V02'], ['R01', 'R03']), f.input(['V24'], ['R02', 'R03']), f.input(['V16'], ['R04', 'R03']), f.input(['V01'], [])]) {
            f.store.receiveCommand(input);
            const view = f.store.commandExecution(input.commandId)!;
            expect(view.status).toBe('refused');
            expect(view.reason).toBeTruthy();
            expect(view.vehicles).toEqual([]);
        }
    });
    it('cancels waiting vehicles, rejects stale amendments and prevents an old owner receiving new commands', () => {
        const f = fixture(), dispatch = f.input(['V01'], ['R03']);
        f.store.receiveCommand(dispatch);
        const revision = f.store.commandExecution(dispatch.commandId)!.revision;
        const cancel = f.input(['V01'], [], { action: 'cancel', targetCommandId: dispatch.commandId, expectedExecutionRevision: revision });
        f.store.receiveCommand(cancel);
        f.accept();
        expect(f.store.commandExecution(dispatch.commandId)?.vehicles[0].state).toBe('cancelled');
        expect(f.store.get(f.id).objects.find(o => o.ref.objectId.endsWith('-V01'))?.resourceData?.resource.availability?.state).toBe('available');
        const stale = f.input(['V01'], ['R03'], { action: 'reroute', targetCommandId: dispatch.commandId, expectedExecutionRevision: revision });
        f.store.receiveCommand(stale);
        expect(f.store.commandExecution(stale.commandId)).toMatchObject({ rootCommandId: dispatch.commandId, status: 'refused' });
        const old = f.store.get(f.id);
        f.store.control(f.id, 'pause', randomUUID(), old.instance.revision, actor);
        const made = f.store.create({ definitionId: 'harbor-fire', version: '5', mode: 'main_story', clientActionId: randomUUID() }, actor);
        f.store.activate(made.instance.instanceId, randomUUID(), made.instance.revision, f.store.active().revision, true, actor);
        expect(() => f.store.receiveCommand(f.input(['V03'], ['R03']))).toThrow();
        expect(f.store.commandExecution(dispatch.commandId)?.vehicles[0].state).toBe('cancelled');
    });
    it('reopens source execution and exact receipts without ticking time or repeating occupation', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'scene-execution-'));
        cleanup.push(() => rm(dir, { recursive: true, force: true }));
        const path = join(dir, 'source.sqlite'), f = fixture(path), input = f.input(['V07'], ['R01', 'R03']);
        const receipt = f.store.receiveCommand(input);
        f.next();
        const before = f.store.commandExecution(input.commandId);
        f.store.close();
        cleanup.pop();
        const reopened = new ScenarioStore(path);
        cleanup.push(() => reopened.close());
        expect(reopened.commandExecution(input.commandId)).toEqual(before);
        expect(reopened.receiveCommand(input)).toEqual(receipt);
    });
    it.each([-1, 0, 1])('does not retroactively block a bridge crossed %s seconds relative to closure', offset => {
        const f = fixture(), input = f.input(['V07'], ['R01', 'R03']);
        const record = f.store.get(f.id), origin = record.objects.find(o => o.ref.objectId.endsWith('-V07'))!.geometry!;
        const destination = record.objects.find(o => o.ref.objectId.endsWith('-L01'))!.geometry!;
        if (origin.type !== 'Point' || destination.type !== 'Point')
            throw new Error('Missing fixture coordinates');
        const segments = pathFor(origin.coordinates, destination.coordinates, input.command.route, record.objects);
        let bridgeEnd = 0;
        for (const segment of segments) {
            bridgeEnd += segment.meters;
            if (segment.road === 'R01')
                break;
        }
        executionRoutingParameters.speedMetersPerSecond = bridgeEnd / (240 + offset);
        f.store.receiveCommand(input);
        for (let i = 0; i < 30; i++) {
            if (f.next().id === 'E08')
                break;
        }
        const vehicle = f.store.commandExecution(input.commandId)!.vehicles[0];
        expect(vehicle.state).toBe(offset < 0 ? 'en_route' : 'blocked');
    });
    it('keeps occupation when a previously departed vehicle is cancelled during reroute preparation', () => {
        const f = fixture(), input = f.input(['V07'], ['R01', 'R03']);
        f.store.receiveCommand(input);
        f.next();
        const reroute = f.input(['V07'], ['R02', 'R03'], { action: 'reroute', targetCommandId: input.commandId, expectedExecutionRevision: f.store.commandExecution(input.commandId)!.revision });
        f.store.receiveCommand(reroute);
        f.accept();
        const cancel = f.input(['V07'], [], { action: 'cancel', targetCommandId: input.commandId, expectedExecutionRevision: f.store.commandExecution(input.commandId)!.revision });
        f.store.receiveCommand(cancel);
        f.accept();
        expect(f.store.commandExecution(input.commandId)?.vehicles[0].state).toBe('cancelled');
        expect(f.store.get(f.id).objects.find(o => o.ref.objectId.endsWith('-V07'))?.resourceData?.resource.availability?.state).toBe('unavailable');
    });
    it.each(['missing', 'root', 'vehicle', 'receipt', 'receiptId'])('fails closed on damaged %s execution state and preserves stored evidence', async (damage) => {
        const dir = await mkdtemp(join(tmpdir(), 'scene-execution-damage-'));
        cleanup.push(() => rm(dir, { recursive: true, force: true }));
        const path = join(dir, 'source.sqlite'), f = fixture(path), input = f.input(['V07'], ['R01', 'R03']);
        f.store.receiveCommand(input);
        const db = new DatabaseSync(path);
        cleanup.push(() => db.close());
        const record = f.store.get(f.id);
        if (damage === 'missing')
            delete record.execution;
        else if (damage === 'root')
            record.execution!.roots[input.commandId].revision = 0;
        else if (damage === 'vehicle')
            record.execution!.roots[input.commandId].vehicles = [];
        else if (damage === 'receiptId')
            record.execution!.commands[input.commandId].receipt.receiptId = '';
        else
            record.execution!.commands[input.commandId].receipt.contentHash = 'broken';
        const bytes = JSON.stringify(record);
        db.prepare('UPDATE scenario_instances SET body=? WHERE instance_id=?').run(bytes, f.id);
        expect(() => f.store.get(f.id)).toThrow();
        expect(db.prepare('SELECT body FROM scenario_instances WHERE instance_id=?').get(f.id)?.body).toBe(bytes);
    });
    it('merges a later fleet declaration without rolling an arrived vehicle back to its station',()=>{
        const f=fixture(undefined,4), input=f.input(['V01'],['R03']);f.store.receiveCommand(input);
        for(let i=0;i<20;i++){if(f.next().id==='E05')break;}
        const execution=f.store.commandExecution(input.commandId)!,vehicle=execution.vehicles[0];
        expect(vehicle.state).toBe('arrived');
        const current=f.store.get(f.id).objects.find(o=>o.ref.objectId.endsWith('-V01'))!;
        expect(current.geometry).toEqual({type:'Point',coordinates:vehicle.position});
        expect(current.resourceData?.resource.availability?.state).toBe('unavailable');
        expect(current.revision).toBeGreaterThan(vehicle.trace.at(-1)!.sourceRevision);
    });

    it('finishes mixed arrived and cancelled vehicles without rolling back their physical state', () => {
        const f = fixture();
        executionRoutingParameters.speedMetersPerSecond = 1000;
        const input = f.input(['V07', 'V13'], ['R01', 'R03']);
        f.store.receiveCommand(input);
        for (let index = 0; index < 10; index++) {
            if (f.store.commandExecution(input.commandId)!.vehicles.some(vehicle => vehicle.state === 'arrived')) break;
            f.next();
        }
        const before = f.store.commandExecution(input.commandId)!;
        expect(before.vehicles.some(vehicle => vehicle.state === 'arrived')).toBe(true);
        const unfinished = before.vehicles.filter(vehicle => vehicle.state !== 'arrived');
        expect(unfinished).toHaveLength(1);
        const cancel = f.input(unfinished.map(vehicle => vehicle.vehicle.objectId.slice(-3)), [], {
            action: 'cancel', targetCommandId: input.commandId, expectedExecutionRevision: before.revision,
        });
        const start = f.store.get(f.id).actions.length;
        f.store.receiveCommand(cancel);
        const after = f.store.commandExecution(input.commandId)!;
        expect(after.status).toBe('completed');
        expect(after.vehicles.map(vehicle => vehicle.position)).toEqual(before.vehicles.map(vehicle => vehicle.position));
        expect(after.vehicles.map(vehicle => vehicle.state).sort()).toEqual(['arrived', 'cancelled']);
        const record = f.store.get(f.id);
        expect(record.actions.slice(start).every(action => action.revision === record.instance.revision)).toBe(true);
        expect(record.objects.filter(object => ['V07', 'V13'].some(code => object.ref.objectId.endsWith('-' + code)))
            .every(object => object.resourceData?.resource.availability?.state === 'unavailable')).toBe(true);
    });
    it('rejects a direct external amendment that changes the original destination', () => {
        const f = fixture(), input = f.input(['V07'], ['R01', 'R03']);
        f.store.receiveCommand(input);
        const original = f.store.commandExecution(input.commandId)!;
        const amendment = f.input(['V07'], ['R02', 'R03'], {
            action: 'reroute', targetCommandId: input.commandId,
            expectedExecutionRevision: original.revision, destination: f.ref('S01'),
        });
        f.store.receiveCommand(amendment);
        expect(f.store.commandExecution(amendment.commandId)).toMatchObject({ status: 'refused', reason: '调整须保留原指令的目的地。' });
        expect(f.store.commandExecution(input.commandId)).toEqual(original);
    });
    it('keeps frozen vehicle history without inventing a future executable node', () => {
        const f = fixture(), input = f.input(['V07'], ['R01', 'R03']);
        f.store.receiveCommand(input);
        const original = f.store.commandExecution(input.commandId)!;
        expect(f.store.detail(f.id).timeline?.some(node => node.kind === 'execution' && node.state === 'pending')).toBe(true);
        const record = f.store.get(f.id);
        f.store.control(f.id, 'pause', randomUUID(), record.instance.revision, actor);
        const next = f.store.create({ definitionId: 'harbor-fire', version: '5', mode: 'main_story', clientActionId: randomUUID() }, actor);
        f.store.activate(next.instance.instanceId, randomUUID(), next.instance.revision, f.store.active().revision, true, actor);
        expect(f.store.detail(f.id).timeline?.some(node => node.kind === 'execution' && node.state === 'pending')).toBe(false);
        expect(f.store.commandExecution(input.commandId)).toEqual(original);
    });

});
