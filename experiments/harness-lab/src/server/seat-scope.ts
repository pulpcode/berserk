import { identityOf } from './auth.js';
import type { FastifyRequest } from 'fastify';
import { RequestError } from '../contracts/errors.js';
import type { LabConfig } from './config.js';

/** One explicit route tree; request identity never mutates the shared runtime. */
export function apiScope(config: Pick<LabConfig, 'seatId' | 'testSeats' | 'auth'>) {
  const testing = !!config.testSeats;
  return {
    base: testing ? '/api/test-seats/:seatId' : '/api',
    seat(request: FastifyRequest): string {
      if (config.auth) return identityOf(request).seatId;
      if (!testing) return config.seatId ?? 'test-seat';
      const seatId = (request.params as { seatId?: string }).seatId;
      if (!seatId || !config.testSeats!.some(seat => seat.id === seatId)) throw new RequestError('SEAT_NOT_FOUND', '测试席位不存在。', 404);
      return seatId;
    },
    params(properties: Record<string, unknown>) {
      return { type: 'object', properties: { ...properties, ...(testing ? { seatId: { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,64}$' } } : {}) },
        required: [...Object.keys(properties), ...(testing ? ['seatId'] : [])], additionalProperties: false };
    },
  };
}
