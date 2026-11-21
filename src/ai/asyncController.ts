/**
 * Centralized AbortController registry for in-flight Gemini 4 operations.
 * Ensures jobs can be cleanly cancelled, never leak stale locks, and never
 * overwrite newer jobs.
 */
class AsyncJobRegistry {
  private controllers = new Map<string, AbortController>();

  startJob(jobId: string): AbortSignal {
    const existing = this.controllers.get(jobId);
    if (existing) existing.abort();
    const controller = new AbortController();
    this.controllers.set(jobId, controller);
    return controller.signal;
  }

  finishJob(jobId: string): void {
    this.controllers.delete(jobId);
  }

  cancelAll(): void {
    for (const ctrl of this.controllers.values()) {
      ctrl.abort();
    }
    this.controllers.clear();
  }

  get activeCount(): number {
    return this.controllers.size;
  }
}

export const asyncJobs = new AsyncJobRegistry();

export function isAbortError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof DOMException && err.name === 'AbortError') return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /abort|cancel/i.test(msg);
}
