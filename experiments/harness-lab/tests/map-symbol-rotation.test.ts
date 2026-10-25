import { describe, expect, it } from 'vitest';
import { headingFromScreen, normalizeHeading, projectedEastAngle, screenHeading } from '../src/web/annotations/rotation-handle';

describe('professional symbol screen rotation', () => {
  it('wraps clockwise headings across north without losing 0 or 359 degrees', () => {
    expect(normalizeHeading(360)).toBe(0);
    expect(normalizeHeading(-1)).toBe(359);
    for (const east of [0, -35, -128.5, 179]) for (const heading of [0, 90, 359]) {
      expect(headingFromScreen(screenHeading(heading, east), east)).toBeCloseTo(heading, 8);
    }
  });
  it('uses the projected local east tangent, including tilted nonuniform map projection', () => {
    const point: [number, number] = [116.4, 39.9];
    const map = {project: ([x, y]: [number, number]) => ({x: 4*x + y, y: -2*x + 3*y})};
    const east = projectedEastAngle(map as Parameters<typeof projectedEastAngle>[0], point);
    expect(east).toBeCloseTo(Math.atan2(-2, 4)*180/Math.PI, 5);
    expect(screenHeading(90, east)).toBeCloseTo(63.4349488, 5);
    expect(headingFromScreen(0, east)).toBeCloseTo(26.5650512, 5);
  });
});
