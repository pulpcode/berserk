import { describe,expect,it } from 'vitest';
import { workPerspective } from '../src/contracts/workbench.js';

describe('work responsibility projection', () => {
  it.each([
    ['assigned','actionable','following'],['working','actionable','following'],['returned','actionable','following'],['submitted','following','actionable'],['completed','done','done'],
  ] as const)('%s belongs to the actual next actor', (state,assignee,creator) => {
    const work = {state,creatorSeatId:'a',assigneeSeatId:'b'};
    expect(workPerspective(work,'a').bucket).toBe(creator);
    expect(workPerspective(work,'b').bucket).toBe(assignee);
  });
});
