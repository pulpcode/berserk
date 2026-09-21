/** A permit covers one provider stream, never a tool, retry delay or entire Agent run. */
export class ModelPermits {
  private active = 0;
  private readonly waiting: Array<{ signal: AbortSignal; grant: () => void; abort: () => void }> = [];
  constructor(private capacity = 2) { this.resize(capacity); }

  resize(capacity: number): void {
    if (!Number.isSafeInteger(capacity) || capacity < 1) throw new Error('模型并发数必须为正整数。');
    this.capacity = capacity;
    this.drain();
  }

  acquire(signal: AbortSignal): Promise<() => void> {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const entry = {
        signal,
        grant: () => {
          signal.removeEventListener('abort', entry.abort);
          this.active++;
          let released = false;
          resolve(() => { if (!released) { released = true; this.active--; this.drain(); } });
        },
        abort: () => {
          const index = this.waiting.indexOf(entry);
          if (index < 0) return;
          this.waiting.splice(index, 1);
          signal.removeEventListener('abort', entry.abort);
          reject(signal.reason);
          this.drain();
        },
      };
      signal.addEventListener('abort', entry.abort, { once: true });
      this.waiting.push(entry);
      this.drain();
    });
  }

  private drain(): void {
    while (this.active < this.capacity && this.waiting.length) {
      const entry = this.waiting.shift()!;
      entry.grant();
    }
  }
}
