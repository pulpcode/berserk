import type { WorkOverviewItem, WorkOverviewPage } from '../contracts/workbench';

export type WorkOverviewView = 'list' | 'flow';
export const workFlowLimit = 200;
export const workLaneHeight = 140;
export const workLaneHeaderWidth = 144;
export const workNodeWidth = 186;
export const workNodeHeight = 112;
export const parseWorkOverviewView = (value: string | null): WorkOverviewView => value === 'flow' ? 'flow' : 'list';

export function workFlowProblem(page: WorkOverviewPage): 'overflow' | 'incomplete' | undefined {
  if (page.total > workFlowLimit) return 'overflow';
  if (!Number.isSafeInteger(page.total) || page.total < 0 || page.offset !== 0 || page.items.length !== page.total || new Set(page.items.map(item => item.id)).size !== page.items.length) return 'incomplete';
}

/** Slots depend on identity, never on status, name or the server's changing update order. */
export function layoutWorkSwimlane(items: WorkOverviewItem[]) {
  const byId = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  const seats = new Map<string, string>();
  for (const item of [...items].sort((a, b) => byId(a.id, b.id))) {
    seats.set(item.creatorSeatId, item.creatorSeatName);
    seats.set(item.assigneeSeatId, item.assigneeSeatName);
  }
  const lanes = [...seats].sort(([a], [b]) => byId(a, b)).map(([id, name], index) => ({ id, name, y: index * workLaneHeight, duplicateName: [...seats.values()].filter(value => value === name).length > 1 }));
  const row = new Map(lanes.map((lane, index) => [lane.id, index]));
  const works = [...items].sort((a, b) => byId(a.id, b.id)).map((item, index) => {
    const slot = workLaneHeaderWidth + 24 + index * 274;
    const sourceY = row.get(item.creatorSeatId)! * workLaneHeight + workLaneHeight / 2;
    const targetY = row.get(item.assigneeSeatId)! * workLaneHeight + workLaneHeight / 2;
    const x = slot + 64, y = targetY - workNodeHeight / 2;
    const bend = targetY > sourceY ? 8 : -8;
    const path = sourceY === targetY
      ? `M${slot + 12} ${sourceY} H${x - 6}`
      : `M${slot + 12} ${sourceY} H${slot + 36} Q${slot + 44} ${sourceY} ${slot + 44} ${sourceY + bend} V${targetY - bend} Q${slot + 44} ${targetY} ${slot + 52} ${targetY} H${x - 6}`;
    return { item, x, y, sourceX: slot + 12, sourceY, path };
  });
  return { lanes, works, width: Math.max(900, workLaneHeaderWidth + 24 + items.length * 274), height: Math.max(workLaneHeight, lanes.length * workLaneHeight) };
}

export type WorkCamera = { x: number; y: number; scale: number };
export function zoomWorkCamera(camera: WorkCamera, factor: number, point: { x: number; y: number }, minimum: number): WorkCamera {
  const scale = Math.max(minimum, Math.min(2, camera.scale * factor));
  return { scale, x: point.x - (point.x - camera.x) * scale / camera.scale, y: point.y - (point.y - camera.y) * scale / camera.scale };
}
