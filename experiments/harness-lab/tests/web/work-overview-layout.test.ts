import { describe, expect, it } from 'vitest';
import type { WorkOverviewItem, WorkOverviewPage } from '../../src/contracts/workbench';
import { layoutWorkSwimlane, parseWorkOverviewView, workFlowProblem, workLaneHeight, workNodeHeight, zoomWorkCamera } from '../../src/web/work-overview-layout';

const work = (id: string, creatorSeatId = 'a', assigneeSeatId = 'b'): WorkOverviewItem => ({ id, title: '同名工作', taskSpaceId: 'task', taskTitle: '任务', creatorSeatId, assigneeSeatId, creatorSeatName: '同名席位', assigneeSeatName: '同名席位', state: 'assigned', createdAt: '2026-11-04T00:00:00Z', updatedAt: '2026-11-04T00:00:00Z', submissionCount: 0, participant: false });
const page = (items: WorkOverviewItem[], total = items.length): WorkOverviewPage => ({ items, total, offset: 0, limit: 200 });

describe('complete bounded work diagram', () => {
  it('accepts 0, 26 and 200 items but refuses overflow, missing or duplicate work IDs', () => {
    for (const count of [0, 26, 200]) expect(workFlowProblem(page(Array.from({ length: count }, (_, index) => work(String(index)))))).toBeUndefined();
    expect(workFlowProblem(page([work('1')], 201))).toBe('overflow');
    expect(workFlowProblem(page([work('1')], 2))).toBe('incomplete');
    expect(workFlowProblem(page([work('1'), work('1')]))).toBe('incomplete');
    expect(workFlowProblem({ ...page([work('1')]), offset: 25 })).toBe('incomplete');
    expect(workFlowProblem(page([], -1))).toBe('incomplete');
  });
  it('keeps seat identity, reverse links, every work and stable slots independent of state/order', () => {
    const items = [work('two', 'b', 'a'), work('one'), work('three', 'a', 'c')];
    const layout = layoutWorkSwimlane(items);
    expect(layout.lanes.map(lane => lane.id)).toEqual(['a', 'b', 'c']);
    expect(layout.lanes.every(lane => lane.duplicateName)).toBe(true);
    expect(layout.works.map(node => node.item.id)).toEqual(['one', 'three', 'two']);
    for (const node of layout.works) {
      expect(node.sourceY).toBe(layout.lanes.find(lane => lane.id === node.item.creatorSeatId)!.y + workLaneHeight / 2);
      expect(node.y + workNodeHeight / 2).toBe(layout.lanes.find(lane => lane.id === node.item.assigneeSeatId)!.y + workLaneHeight / 2);
    }
    const changed = layoutWorkSwimlane([...items].reverse().map(item => ({ ...item, state: 'returned', updatedAt: '2026-11-05T00:00:00Z' })));
    expect(changed.works.map(({ x, y, path }) => ({ x, y, path }))).toEqual(layout.works.map(({ x, y, path }) => ({ x, y, path })));
    const self = layoutWorkSwimlane([work('self', 'a', 'a')]);
    expect(self.lanes).toHaveLength(1);
    expect(self.works[0].path).not.toContain('NaN');
    expect(self.works[0].sourceY).toBe(self.works[0].y + workNodeHeight / 2);
  });
  it('preserves the graph-space point under the pointer while zooming and clamps the scale', () => {
    const camera = { x: 30, y: -20, scale: .8 }, pointer = { x: 240, y: 170 };
    const zoomed = zoomWorkCamera(camera, 1.15, pointer, .1);
    expect((pointer.x - zoomed.x) / zoomed.scale).toBeCloseTo((pointer.x - camera.x) / camera.scale);
    expect((pointer.y - zoomed.y) / zoomed.scale).toBeCloseTo((pointer.y - camera.y) / camera.scale);
    expect(zoomWorkCamera(camera, 100, pointer, .1).scale).toBe(2);
    expect(zoomWorkCamera(camera, .001, pointer, .1).scale).toBe(.1);
  });
  it('uses an independent validated work view without interpreting the old job view', () => {
    expect(parseWorkOverviewView('flow')).toBe('flow');
    for (const value of [null, 'list', 'board', 'invalid']) expect(parseWorkOverviewView(value)).toBe('list');
  });
});
