import assert from 'node:assert/strict';
import { createAssistantMessageEventStream, type AssistantMessage } from '@earendil-works/pi-ai';
import type { ModelRuntime } from '@earendil-works/pi-coding-agent';

export interface ScenarioProbeBudget {
  maxApiRequests: number; maxInputTokens: number; maxOutputTokens: number; maxSeconds: number;
  maxCostCny: number; inputCnyPerMillion: number; outputCnyPerMillion: number;
  /** Verified provider limit, independent of the host's estimated compaction window. */
  providerInputLimitTokens: number;
}
interface Reservation { id: number; input: number; output: number; cost: number; sent: boolean }

/** Probe-only accounting. Rates must upper-bound all billed tokens, including cache/reasoning. */
export class ScenarioBudgetGuard {
  readonly controller = new AbortController();
  readonly startedAt = Date.now();
  private calls = 0;
  private attempts = 0;
  private input = 0;
  private output = 0;
  private cost = 0;
  private active?: Reservation;
  private reason?: string;
  constructor(readonly limits?: ScenarioProbeBudget) {
    if (limits) for (const value of Object.values(limits)) assert.ok(Number.isFinite(value) && value > 0, 'Every live budget/rate must be finite and positive');
  }
  stop(reason: string) {
    this.reason ??= reason;
    this.controller.abort(new Error('Scenario probe stopped'));
  }
  check() {
    if (this.limits && Date.now() - this.startedAt >= this.limits.maxSeconds * 1000) this.stop('wall_time_budget');
    assert.ok(!this.reason, `Scenario probe stopped: ${this.reason}`);
  }
  snapshot() {
    return { apiRequests: this.calls, attempts: this.attempts, inputTokensCharged: this.input, outputTokensCharged: this.output,
      conservativeCostCny: this.cost, pendingReservation: this.active, stoppedReason: this.reason ?? null,
      elapsedMs: Date.now() - this.startedAt, limits: this.limits ?? null };
  }
  begin(inputCap: number, outputCap: number) {
    this.check();
    assert.ok(this.limits, 'prepare-only blocks every provider request');
    assert.ok(!this.active, 'Probe requires one provider request at a time');
    assert.ok(Number.isSafeInteger(inputCap) && inputCap > 0 && Number.isSafeInteger(outputCap) && outputCap > 0, 'Verified model context/output limits required');
    const cost = (inputCap * this.limits.inputCnyPerMillion + outputCap * this.limits.outputCnyPerMillion) / 1_000_000;
    if (this.calls >= this.limits.maxApiRequests || this.input + inputCap > this.limits.maxInputTokens
      || this.output + outputCap > this.limits.maxOutputTokens || this.cost + cost > this.limits.maxCostCny) {
      this.stop('request_reservation_exceeds_budget'); this.check();
    }
    const reservation = { id: ++this.attempts, input: inputCap, output: outputCap, cost, sent: false };
    this.input += inputCap; this.output += outputCap; this.cost += cost; this.active = reservation;
    return reservation;
  }
  sent(reservation: Reservation) {
    this.check(); assert.equal(this.active, reservation, 'Unknown provider reservation');
    if (reservation.sent) { this.stop('automatic_http_retry_blocked'); this.check(); }
    reservation.sent = true; this.calls++;
  }
  finish(reservation: Reservation, message?: AssistantMessage) {
    assert.equal(this.active, reservation, 'Unknown provider reservation'); this.active = undefined;
    const usage = message?.usage, input = usage ? usage.input + usage.cacheRead + usage.cacheWrite : NaN, output = usage?.output ?? NaN;
    const known = [input, output, usage?.totalTokens].every(value => Number.isSafeInteger(value) && Number(value) >= 0)
      && input + output > 0 && usage?.totalTokens === input + output;
    if (known) {
      const cost = (input * this.limits!.inputCnyPerMillion + output * this.limits!.outputCnyPerMillion) / 1_000_000;
      this.input += input - reservation.input; this.output += output - reservation.output; this.cost += cost - reservation.cost;
      if (input > reservation.input || output > reservation.output) this.stop('provider_usage_exceeded_verified_limits');
    } else this.stop('provider_usage_unknown_reservation_retained');
    if (!reservation.sent) this.stop('provider_transport_not_observed');
    if (!message || !['stop', 'toolUse'].includes(message.stopReason)) this.stop('provider_did_not_complete_no_retry');
    return { reservation, actualUsage: known ? usage : null, accounting: this.snapshot() };
  }
}

/** Wrap the public SDK boundary; preserve host payload transforms, provider messages and tools. */
export function guardScenarioRuntime(runtime: ModelRuntime, guard: ScenarioBudgetGuard, expectedOrigin: string,
  record: (kind: string, value: unknown) => Promise<void>) {
  const original = runtime.streamSimple.bind(runtime);
  runtime.streamSimple = (model, context, options) => {
    const reservation = guard.begin(guard.limits?.providerInputLimitTokens ?? model.contextWindow, options?.maxTokens ?? model.maxTokens);
    const safe = createAssistantMessageEventStream();
    void (async () => {
      let final: AssistantMessage | undefined;
      try {
        const signal = AbortSignal.any([guard.controller.signal, ...(options?.signal ? [options.signal] : [])]);
        const upstream = original(model, context, { ...options, signal, maxRetries: 0,
          onPayload: async (payload, selected) => {
            guard.check();
            const transformed = await options?.onPayload?.(payload, selected), effective = transformed ?? payload;
            assert.ok(effective && typeof effective === 'object' && 'max_tokens' in effective && effective.max_tokens === reservation.output, 'Unverified provider output limit');
            await record('provider-input', { attempt: reservation.id, payload: effective }); return effective;
          },
          fetch: async (input, init) => {
            assert.equal(new URL(input instanceof Request ? input.url : String(input)).origin, expectedOrigin, 'Unexpected provider origin');
            guard.sent(reservation); await record('provider-request', { attempt: reservation.id, at: new Date().toISOString() });
            return (options?.fetch ?? globalThis.fetch)(input, { ...init, redirect: 'error', signal });
          },
        });
        for await (const event of upstream) {
          await record('provider-event', { attempt: reservation.id, event });
          if (event.type !== 'done' && event.type !== 'error') safe.push(event);
        }
        final = await upstream.result();
      } catch {
        guard.stop('provider_or_evidence_failure_no_retry');
      } finally {
        const accounting = guard.finish(reservation, final);
        try { await record('provider-accounting', accounting); }
        catch { guard.stop('evidence_write_failure'); }
        if (final && !guard.snapshot().stoppedReason) {
          safe.push({ type: 'done', reason: final.stopReason as 'stop' | 'toolUse', message: final });
        } else {
          // A fixed non-retryable error prevents Pi's transient-failure retries from spending again.
          const error: AssistantMessage = { role: 'assistant', api: model.api, provider: model.provider, model: model.id,
            content: [], timestamp: Date.now(), stopReason: 'error', errorMessage: 'Scenario probe stopped; inspect preserved evidence.',
            usage: final?.usage ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
          safe.push({ type: 'error', reason: 'error', error });
        }
      }
    })();
    return safe;
  };
}
