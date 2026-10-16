import { describe, expect, it } from 'vitest';
import { runCalculation } from '../src/spatial/worker.js';
import type { Calculation } from '../src/spatial/calculation.js';
import type { SpatialGeometry, SpatialInput, SpatialResult } from '../src/contracts/spatial.js';

function payload(geometry: SpatialGeometry): Calculation {
  const input: SpatialInput = { kind: 'source', systemId: 'fixture', objectRefs: [{ systemId: 'fixture', objectType: 'road', objectId: 'line' }] };
  const request = { operation: 'buffer' as const, input, distanceM: 10 };
  const items = [{ id: 'line', name: 'test', geometry, properties: {} }];
  const provenance = [{ input, queriedAt: '2026-10-16T00:00:00.000Z', asOf: '2026-10-16T00:00:00.000Z' }];
  const result: SpatialResult = {
    schemaVersion: 1, resultRef: 'spatial:00000000-0000-4000-8000-000000000001:worker-test', requestId: '00000000-0000-4000-8000-000000000001', toolCallId: 'worker-test',
    operation: 'buffer', parameters: request, createdAt: '2026-10-16T00:00:00.000Z', scope: [input], completeness: { status: 'complete', candidateCount: 1 }, items, provenance, method: 'test', limitations: [],
  };
  return { request, data: { items, provenance }, result };
}
const pathological = (): SpatialGeometry => ({ type: 'LineString', coordinates: Array.from({ length: 2000 }, (_, i) => [120 + i * .000001, 30 + (i % 2) * .00001]) });

describe('bounded spatial worker execution', () => {
  it('loads the real source-runtime worker and returns actual geometry', async () => {
    const result = await runCalculation(payload({ type: 'Point', coordinates: [120, 30] }), new AbortController().signal);
    expect(result.geometry?.type).toBe('Polygon');
    expect(result.geometry?.coordinates.length).toBeGreaterThan(0);
  });

  it('rejects work beyond the four-calculation cap and releases completed slots', async () => {
    const work = Array.from({ length: 4 }, () => runCalculation(payload({ type: 'Point', coordinates: [120, 30] }), new AbortController().signal));
    await expect(runCalculation(payload({ type: 'Point', coordinates: [120, 30] }), new AbortController().signal)).rejects.toMatchObject({ code: 'SPATIAL_BUSY' });
    const finished = await Promise.all(work);
    expect(finished.every(value => value.geometry?.type === 'Polygon')).toBe(true);
    expect((await runCalculation(payload({ type: 'Point', coordinates: [120, 30] }), new AbortController().signal)).geometry?.type).toBe('Polygon');
  }, 10000);

  it('refuses a pre-cancelled computation without launching work', async () => {
    const controller = new AbortController(); const reason = new Error('cancel-before-launch'); controller.abort(reason);
    await expect(runCalculation(payload(pathological()), controller.signal)).rejects.toBe(reason);
  });

  it('settles abort while a costly geometry computation cannot block the host heartbeat', async () => {
    const controller = new AbortController(), reason = new Error('cancel-expensive-buffer');
    let beats = 0;
    const heartbeat = setInterval(() => { beats++; }, 20);
    const abort = setTimeout(() => controller.abort(reason), 300);
    const start = performance.now();
    try {
      await expect(runCalculation(payload(pathological()), controller.signal)).rejects.toBe(reason);
      expect(beats).toBeGreaterThan(1);
      expect(performance.now() - start).toBeLessThan(2500);
    } finally { clearInterval(heartbeat); clearTimeout(abort); }
    // A cancelled worker releases its slot and cannot poison later calculations.
    const next = await runCalculation(payload({ type: 'Point', coordinates: [151, -34] }), new AbortController().signal);
    expect(next.geometry?.type).toBe('Polygon');
  }, 10000);

  it('bounds pathological work by memory or time without crashing the host process', async () => {
    let beats = 0;
    const heartbeat = setInterval(() => { beats++; }, 20), start = performance.now();
    try {
      await expect(runCalculation(payload(pathological()), new AbortController().signal)).rejects.toMatchObject({ code: expect.stringMatching(/SPATIAL_LIMIT|ERR_WORKER_OUT_OF_MEMORY/) });
      expect(beats).toBeGreaterThan(1);
      expect(performance.now() - start).toBeLessThan(6000);
    } finally { clearInterval(heartbeat); }
    const next = await runCalculation(payload({ type: 'Point', coordinates: [120, 30] }), new AbortController().signal);
    expect(next.geometry?.type).toBe('Polygon');
  }, 10000);
});
