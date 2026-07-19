import { sleep } from "./duration.js";

export class RateLimiter {
  private nextAvailableAt = 0;
  private queue = Promise.resolve();

  constructor(private readonly minDelayMs: number) {}

  schedule<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const now = Date.now();
      const delay = Math.max(0, this.nextAvailableAt - now);
      if (delay > 0) {
        await sleep(delay);
      }

      this.nextAvailableAt = Date.now() + this.minDelayMs;
      return task();
    });

    this.queue = run.then(
      () => undefined,
      () => undefined
    );

    return run;
  }
}
