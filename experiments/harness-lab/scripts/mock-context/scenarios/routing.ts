import { distance } from '@turf/distance';
import type { ContextRef, Position, SituationObject } from '../../../src/contracts/context.js';
import { roadRows, sitePositions, stationPositions } from './geography.js';
/** Explicit fictional access corridors. They are simulation data, not public navigation. */
export const simulationAccessCorridors: Position[][] = [
    [stationPositions[0], [121.8636, 30.8839], roadRows[2][3][4]],
    [roadRows[2][3][5], [121.8647, 30.8835], [121.8650368, 30.8835], sitePositions.L01],
    [stationPositions[1], roadRows[1][3][0]],
    [stationPositions[1], [121.9018478, 30.91], [121.88, 30.91], [121.86, 30.91], roadRows[0][3][0]],
    [stationPositions[2], [121.81, 30.899414], [121.84, 30.91], [121.86, 30.91]],
];
export const executionRoutingParameters = { speedMetersPerSecond: 12, businessUtcOffsetMinutes: 480, preparationSeconds: 60, updateSeconds: 60, version: 1 };
export interface PathSegment {
    from: Position;
    to: Position;
    meters: number;
    road?: string;
}
export const meters = (a: Position, b: Position) => distance(a, b, { units: 'meters' });
const pointKey = (p: Position) => p.map(v => v.toFixed(7)).join(',');
function project(point: Position, a: Position, b: Position) {
    const x = b[0] - a[0], y = b[1] - a[1], ratio = Math.max(0, Math.min(1, ((point[0] - a[0]) * x + (point[1] - a[1]) * y) / (x * x + y * y || 1)));
    return [a[0] + ratio * x, a[1] + ratio * y] as Position;
}
function graphSegments() {
    const result: PathSegment[] = [];
    for (const [id, , , points] of roadRows)
        for (let i = 1; i < points.length; i++)
            result.push({ from: points[i - 1], to: points[i], meters: meters(points[i - 1], points[i]), road: id });
    for (const points of simulationAccessCorridors)
        for (let i = 1; i < points.length; i++)
            result.push({ from: points[i - 1], to: points[i], meters: meters(points[i - 1], points[i]) });
    return result;
}
export function pathFor(origin: Position, destination: Position, route: ContextRef[], objects: SituationObject[], allowClosed = false): PathSegment[] {
    const roads = route.map(ref => ref.objectId.slice(-3));
    if (!roads.length || roads.some(id => !roadRows.some(row => row[0] === id)))
        throw new Error('请指定支持的道路，当前指令缺少可执行路线。');
    if (!allowClosed && roads.some(id => {
        const road = objects.find(item => item.ref.objectId.endsWith('-' + id));
        return !road || !('passability' in road.properties) || road.properties.passability !== 'open';
    })) throw new Error('所选路线当前不可通行。');
    let segments = graphSegments();
    for (const point of [origin, destination]) {
        if (segments.some(s => pointKey(s.from) === pointKey(point) || pointKey(s.to) === pointKey(point)))
            continue;
        const candidates = segments.map((s, index) => ({ index, position: project(point, s.from, s.to) })).filter(x => meters(point, x.position) < 1);
        if (!candidates.length)
            throw new Error('当前位置或目的地未接入已配置的模拟通道。');
        const index = candidates[0].index, s = segments[index], snapped = candidates[0].position;
        segments = segments.filter((_, i) => i !== index).concat([{ ...s, to: snapped, meters: meters(s.from, snapped) }, { ...s, from: snapped, meters: meters(snapped, s.to) }]);
        if (pointKey(point) !== pointKey(snapped))
            segments.push({ from: point, to: snapped, meters: meters(point, snapped) });
    }
    const neighbors = new Map<string, PathSegment[]>();
    for (const segment of segments)
        for (const edge of [segment, { ...segment, from: segment.to, to: segment.from }]) {
            const key = pointKey(edge.from);
            neighbors.set(key, [...(neighbors.get(key) ?? []), edge]);
        }
    const start = pointKey(origin) + '|0', costs = new Map([[start, 0]]), previous = new Map<string, {
        key: string;
        edge: PathSegment;
    }>(), queue = [{ key: start, position: origin, index: 0, cost: 0 }];
    let end: string | undefined;
    while (queue.length) {
        queue.sort((a, b) => a.cost - b.cost);
        const current = queue.shift()!;
        if (current.cost !== costs.get(current.key))
            continue;
        if (pointKey(current.position) === pointKey(destination) && current.index === roads.length) {
            end = current.key;
            break;
        }
        for (const edge of neighbors.get(pointKey(current.position)) ?? []) {
            let next = current.index;
            if (edge.road) {
                if (edge.road === roads[next])
                    next++;
                else if (edge.road !== roads[next - 1])
                    continue;
            }
            const key = pointKey(edge.to) + '|' + next, cost = current.cost + edge.meters;
            if (cost >= (costs.get(key) ?? Infinity))
                continue;
            costs.set(key, cost);
            previous.set(key, { key: current.key, edge });
            queue.push({ key, position: edge.to, index: next, cost });
        }
    }
    if (!end)
        throw new Error('所选道路未形成当前位置到目的地的连续模拟路径。');
    const result: PathSegment[] = [];
    let cursor: string = end;
    while (cursor !== start) {
        const prior: {
            key: string;
            edge: PathSegment;
        } = previous.get(cursor)!;
        result.unshift(prior.edge);
        cursor = prior.key;
    }
    return result;
}
export function positionAlong(path: PathSegment[], traveled: number): Position {
    let remaining = traveled;
    for (const segment of path) {
        if (remaining <= segment.meters) {
            const ratio = segment.meters ? remaining / segment.meters : 0;
            return [segment.from[0] + (segment.to[0] - segment.from[0]) * ratio, segment.from[1] + (segment.to[1] - segment.from[1]) * ratio];
        }
        remaining -= segment.meters;
    }
    return path.at(-1)!.to;
}
