import { describe, expect, it } from 'vitest';
import { area } from '@turf/area';
import { makeBuffer, measure, relate } from '../src/spatial/geometry.js';
import { validateGeometry } from '../src/spatial/validation.js';
import type { SpatialGeometry } from '../src/contracts/spatial.js';

const point = (x: number, y: number): SpatialGeometry => ({ type: 'Point', coordinates: [x, y] });
const sphereRadius = 6371008.8;
const radians = Math.PI / 180;
const square: SpatialGeometry = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] };

describe('independent analytic spatial oracles', () => {
  it('measures equatorial/meridional arcs and zero without degree-as-metre conversion', () => {
    const expected = sphereRadius * radians;
    expect(measure('distance', point(0, 0), point(1, 0))).toBeCloseTo(expected, 6);
    expect(measure('distance', point(0, 0), point(0, 1))).toBeCloseTo(expected, 6);
    expect(measure('distance', point(151, -34), point(151, -34))).toBe(0);
  });
  it('measures the full bent line rather than endpoint distance', () => {
    const line: SpatialGeometry = { type: 'LineString', coordinates: [[0, 1], [0, 0], [1, 0]] };
    expect(measure('length', line)).toBeCloseTo(2 * sphereRadius * radians, 6);
    expect(measure('length', line)).toBeGreaterThan(measure('distance', point(0, 1), point(1, 0)));
  });
  it('uses the closest location on a segment, not just its vertices', () => {
    const line: SpatialGeometry = { type: 'LineString', coordinates: [[-1, 0], [1, 0]] };
    expect(measure('point_to_line', point(0, 0.01), line)).toBeCloseTo(sphereRadius * radians * 0.01, 6);
  });
  it('measures a spherical rectangle with analytic integral R² Δlongitude Δsin(latitude)', () => {
    const expected = sphereRadius ** 2 * radians * Math.sin(radians);
    expect(measure('area', square)).toBeCloseTo(expected, 3);
    const hole: SpatialGeometry = { type: 'Polygon', coordinates: [...square.coordinates, [[0.2, 0.2], [0.2, 0.4], [0.4, 0.4], [0.4, 0.2], [0.2, 0.2]]] };
    const removed = sphereRadius ** 2 * 0.2 * radians * (Math.sin(0.4 * radians) - Math.sin(0.2 * radians));
    expect(measure('area', hole)).toBeCloseTo(expected - removed, 3);
  });
  it('matches a small spherical circle area within declared polygon approximation error', () => {
    for (const [x, y] of [[120.3, 36.1], [151.2, -33.9]]) {
      const radius = 1000;
      const geometry = makeBuffer(point(x, y), radius);
      const expected = 2 * Math.PI * sphereRadius ** 2 * (1 - Math.cos(radius / sphereRadius));
      expect(Math.abs(area(geometry) - expected) / expected).toBeLessThan(0.002);
      expect(relate('contains', geometry, point(x, y))).toBe(true);
    }
  });
});

describe('closed-region relations and rejection boundaries', () => {
  it('includes boundary points, touching and overlapping collinear lines', () => {
    expect(relate('contains', square, point(1, 0.5))).toBe(true);
    const a: SpatialGeometry = { type: 'LineString', coordinates: [[0, 0], [1, 0]] };
    const b: SpatialGeometry = { type: 'LineString', coordinates: [[0.5, 0], [1.5, 0]] };
    expect(relate('intersects', a, b)).toBe(true);
    expect(relate('disjoint', a, b)).toBe(false);
    expect(relate('contains', square, square)).toBe(true);
  });
  it('does not infer line containment merely from endpoints in a concave region', () => {
    const region: SpatialGeometry = { type: 'Polygon', coordinates: [[[0, 0], [3, 0], [3, 3], [2, 3], [2, 1], [1, 1], [1, 3], [0, 3], [0, 0]]] };
    expect(relate('contains', region, { type: 'LineString', coordinates: [[0.5, 2], [2.5, 2]] })).toBe(false);
    expect(relate('contains', region, { type: 'LineString', coordinates: [[0.5, 0.5], [2.5, 0.5]] })).toBe(true);
  });
  it('retains holes in line and polygon containment', () => {
    const region: SpatialGeometry = { type: 'Polygon', coordinates: [[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]], [[1, 1], [1, 3], [3, 3], [3, 1], [1, 1]]] };
    expect(relate('contains', region, point(2, 2))).toBe(false);
    expect(relate('contains', region, point(1, 2))).toBe(true);
    expect(relate('contains', region, { type: 'LineString', coordinates: [[0.5, 2], [3.5, 2]] })).toBe(false);
    expect(relate('contains', region, { type: 'Polygon', coordinates: [[[0.5, 0.5], [3.5, 0.5], [3.5, 3.5], [0.5, 3.5], [0.5, 0.5]]] })).toBe(false);
  });
  it('rejects unsupported and invalid geometry instead of repairing source data', () => {
    const crossing: SpatialGeometry = { type: 'Polygon', coordinates: [[[0, 0], [1, 1], [0, 1], [1, 0], [0, 0]]] };
    expect(() => validateGeometry(crossing)).toThrow();
    expect(() => validateGeometry({ type: 'LineString', coordinates: [[179, 0], [-179, 0]] })).toThrow();
    expect(() => validateGeometry(point(0, 81))).toThrow();
    expect(() => makeBuffer(square, 500)).toThrow();
  });
});
