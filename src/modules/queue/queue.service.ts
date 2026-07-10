import crypto from "node:crypto";
import { env } from "../../config/env.js";
import type { NotificationPayload } from "../notification/notification.types.js";
import type { DatabaseExecutor, QueueRepository } from "./queue.repository.js";
import type { QueueJob } from "./queue.types.js";

export class QueueService {
  public readonly workerId = `worker-${process.pid}-${crypto.randomUUID()}`;

  public constructor(private readonly repository: QueueRepository) {}

  public enqueue(payload: NotificationPayload, executor?: DatabaseExecutor): Promise<number> {
    return this.repository.enqueue({
      type: payload.type,
      payload,
      maxAttempts: env.WORKER_MAX_ATTEMPTS,
      availableAt: new Date().toISOString()
    }, executor);
  }

  public claimAvailable(): Promise<QueueJob[]> {
    return this.repository.claimAvailable(env.WORKER_BATCH_SIZE, this.workerId);
  }

  public complete(job: QueueJob): Promise<void> {
    return this.repository.markCompleted(job.id);
  }

  public retry(job: QueueJob, errorMessage: string, retryAfterMs?: number): Promise<void> {
    const delayMs = retryAfterMs ?? this.computeBackoffMs(job.attempts + 1);
    const availableAt = new Date(Date.now() + delayMs).toISOString();
    return this.repository.markRetry(job, errorMessage, availableAt);
  }

  public fail(job: QueueJob, errorMessage: string): Promise<void> {
    return this.repository.markFailed(job, errorMessage);
  }

  public recoverStaleJobs(): Promise<number> {
    const staleBefore = new Date(Date.now() - env.WORKER_STALE_JOB_TIMEOUT_MS).toISOString();
    return this.repository.recoverStaleProcessing(staleBefore, new Date().toISOString());
  }

  public hasAttemptsRemaining(job: QueueJob): boolean {
    return job.attempts + 1 < job.maxAttempts;
  }

  private computeBackoffMs(attemptNumber: number): number {
    const baseDelayMs = 1000;
    const maxDelayMs = 60_000;
    const exponential = Math.min(baseDelayMs * 2 ** Math.max(attemptNumber - 1, 0), maxDelayMs);
    const jitter = Math.floor(Math.random() * 500);
    return exponential + jitter;
  }
}
