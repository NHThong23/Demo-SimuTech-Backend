export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
  setTimeout(fn: () => void, ms: number): unknown {
    return setTimeout(fn, ms);
  }
  clearTimeout(handle: unknown): void {
    clearTimeout(handle as NodeJS.Timeout);
  }
}

interface FakeTimer { id: number; at: number; fn: () => void; }

export class FakeClock implements Clock {
  private currentMs = 0;
  private timers: FakeTimer[] = [];
  private nextId = 1;

  now(): number {
    return this.currentMs;
  }

  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.timers.push({ id, at: this.currentMs + ms, fn });
    return id;
  }

  clearTimeout(handle: unknown): void {
    const id = handle as number;
    this.timers = this.timers.filter((t) => t.id !== id);
  }

  /** Tua đồng hồ tới, chạy mọi timer đến hạn (kể cả timer mới đặt ra trong lúc chạy). */
  advance(ms: number): void {
    this.currentMs += ms;
    let fired = true;
    while (fired) {
      fired = false;
      const due = this.timers.filter((t) => t.at <= this.currentMs).sort((a, b) => a.at - b.at);
      for (const t of due) {
        this.timers = this.timers.filter((x) => x.id !== t.id);
        t.fn();
        fired = true;
      }
    }
  }
}
