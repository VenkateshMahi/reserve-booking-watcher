import { sleep } from "./duration.js";

export interface RetryOptions {
  retries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  factor: number;
  jitter: boolean;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
}

export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= options.retries + 1; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      const canRetry =
        attempt <= options.retries && (options.shouldRetry?.(error, attempt) ?? true);
      if (!canRetry) {
        break;
      }

      const exponentialDelay = Math.min(
        options.maxDelayMs,
        options.initialDelayMs * options.factor ** (attempt - 1)
      );
      const jitter = options.jitter ? Math.round(Math.random() * exponentialDelay * 0.25) : 0;
      await sleep(exponentialDelay + jitter);
    }
  }

  throw lastError;
}
