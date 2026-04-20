/**
 * A semaphore-based pool that limits the number of concurrently running agents.
 * `acquire()` resolves to a `release` callback when a slot is available,
 * blocking if the pool is at capacity. Releases are idempotent; queue is FIFO.
 */
export class AgentPool {
  private active = 0;
  private queue: Array<() => void> = [];

  constructor(private readonly max: number) {}

  acquire(): Promise<() => void> {
    if (this.active < this.max) {
      this.active++;
      return Promise.resolve(this.makeRelease());
    }
    return new Promise<() => void>(resolve => {
      this.queue.push(() => {
        this.active++;
        resolve(this.makeRelease());
      });
    });
  }

  private makeRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      this.drain();
    };
  }

  private drain(): void {
    while (this.active < this.max && this.queue.length > 0) {
      this.queue.shift()!();
    }
  }
}
