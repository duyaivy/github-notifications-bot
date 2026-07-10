import { setTimeout as sleep } from "node:timers/promises";
import { env } from "../../config/env.js";
import { AppError, safeErrorMessage, toSafeError } from "../../common/errors.js";
import { logger } from "../../common/logger.js";
import { DiscordApiError } from "../discord/discord.errors.js";
import type { NotificationService } from "../notification/notification.service.js";
import type { QueueService } from "./queue.service.js";
import type { QueueJob } from "./queue.types.js";

export class QueueWorker {
  private stopping = false;

  public constructor(
    private readonly queue: QueueService,
    private readonly notifications: NotificationService
  ) {}

  public requestStop(): void {
    this.stopping = true;
  }

  public async run(): Promise<void> {
    logger.info({ workerId: this.queue.workerId }, "queue worker started");

    while (!this.stopping) {
      const recovered = await this.queue.recoverStaleJobs();
      if (recovered > 0) {
        logger.warn({ recovered }, "recovered stale processing jobs");
      }

      const jobs = await this.queue.claimAvailable();
      if (jobs.length === 0) {
        await sleep(env.WORKER_POLL_INTERVAL_MS);
        continue;
      }

      for (const job of jobs) {
        if (this.stopping) {
          break;
        }
        await this.processJob(job);
      }
    }

    logger.info({ workerId: this.queue.workerId }, "queue worker stopped");
  }

  private async processJob(job: QueueJob): Promise<void> {
    const start = performance.now();
    try {
      await this.notifications.process(job);
      await this.queue.complete(job);
      logger.info(
        {
          queueJobId: job.id,
          queueJobType: job.type,
          attempt: job.attempts + 1,
          durationMs: Math.round(performance.now() - start),
          finalJobStatus: "completed"
        },
        "queue job completed"
      );
    } catch (error) {
      const retryable = isRetryable(error);
      const errorMessage = safeErrorMessage(error);

      if (retryable && this.queue.hasAttemptsRemaining(job)) {
        await this.queue.retry(job, errorMessage, retryAfterMs(error));
        logger.warn(
          {
            queueJobId: job.id,
            queueJobType: job.type,
            attempt: job.attempts + 1,
            error: toSafeError(error),
            finalJobStatus: "pending"
          },
          "queue job scheduled for retry"
        );
        return;
      }

      await this.queue.fail(job, errorMessage);
      logger.error(
        {
          queueJobId: job.id,
          queueJobType: job.type,
          attempt: job.attempts + 1,
          error: toSafeError(error),
          finalJobStatus: "failed"
        },
        "queue job failed permanently"
      );
    }
  }
}

function isRetryable(error: unknown): boolean {
  if (error instanceof AppError) {
    return error.retryable;
  }
  return true;
}

function retryAfterMs(error: unknown): number | undefined {
  if (error instanceof DiscordApiError) {
    return error.retryAfterMs;
  }
  return undefined;
}
