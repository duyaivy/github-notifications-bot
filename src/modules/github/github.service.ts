import type Database from "better-sqlite3";
import { env } from "../../config/env.js";
import { HttpError } from "../../common/http-error.js";
import { logger } from "../../common/logger.js";
import { verifyGitHubSignature } from "./github.signature.js";
import { normalizePush, normalizeWorkflowRun, parseGitHubPushPayload, parseGitHubWorkflowRunPayload } from "./github.normalizer.js";
import type { GitHubWebhookHeaders, GitHubWebhookResult } from "./github.types.js";
import type { QueueService } from "../queue/queue.service.js";

export class GitHubService {
  public constructor(
    private readonly db: Database.Database,
    private readonly queue: QueueService
  ) {}

  public handleWebhook(rawBody: Buffer, headers: GitHubWebhookHeaders): GitHubWebhookResult {
    if (!verifyGitHubSignature(rawBody, headers.signature256, env.GITHUB_WEBHOOK_SECRET)) {
      throw new HttpError(401, "Invalid GitHub webhook signature");
    }

    const parsedPayload = this.parseJson(rawBody);
    const repositoryFullName = this.getRepositoryFullName(parsedPayload);

    if (headers.eventName === "workflow_run") {
      const workflowRunPayload = parseGitHubWorkflowRunPayload(parsedPayload);
      const notification = normalizeWorkflowRun(workflowRunPayload, headers.deliveryId);
      return this.enqueueNotification(headers, notification.repository.fullName, notification);
    }

    if (headers.eventName !== "push") {
      return this.recordAcceptedDelivery(headers, repositoryFullName, null, "Event accepted but not supported yet");
    }

    const pushPayload = parseGitHubPushPayload(parsedPayload);
    const notification = normalizePush(pushPayload, headers.deliveryId);

    return this.enqueueNotification(headers, notification.repository.fullName, notification);
  }

  private enqueueNotification(
    headers: GitHubWebhookHeaders,
    repositoryFullName: string,
    notification: ReturnType<typeof normalizePush> | ReturnType<typeof normalizeWorkflowRun>
  ): GitHubWebhookResult {
    const result = this.db.transaction(() => {
      const inserted = this.insertDelivery(headers, repositoryFullName);
      if (!inserted) {
        return {
          accepted: true,
          duplicate: true,
          eventName: headers.eventName,
          deliveryId: headers.deliveryId,
          jobId: null,
          message: "Duplicate delivery ignored"
        };
      }

      const jobId = this.queue.enqueue(notification);
      this.markDeliveryProcessed(headers.deliveryId);
      return {
        accepted: true,
        duplicate: false,
        eventName: headers.eventName,
        deliveryId: headers.deliveryId,
        jobId,
        message: "Webhook accepted"
      };
    })();

    logger.info(
      {
        githubDeliveryId: headers.deliveryId,
        githubEventName: headers.eventName,
        repositoryFullName,
        queueJobId: result.jobId,
        duplicate: result.duplicate
      },
      "github webhook handled"
    );

    return result;
  }

  private parseJson(rawBody: Buffer): unknown {
    try {
      return JSON.parse(rawBody.toString("utf8")) as unknown;
    } catch {
      throw new HttpError(400, "Invalid JSON body");
    }
  }

  private recordAcceptedDelivery(
    headers: GitHubWebhookHeaders,
    repositoryFullName: string | null,
    message: string | null,
    responseMessage: string
  ): GitHubWebhookResult {
    const result = this.db.transaction(() => {
      const inserted = this.insertDelivery(headers, repositoryFullName);
      if (inserted) {
        this.markDeliveryProcessed(headers.deliveryId);
      }

      return {
        accepted: true,
        duplicate: !inserted,
        eventName: headers.eventName,
        deliveryId: headers.deliveryId,
        jobId: null,
        message: inserted ? responseMessage : "Duplicate delivery ignored"
      };
    })();

    if (message) {
      logger.info({ githubDeliveryId: headers.deliveryId, message }, "github webhook delivery recorded");
    }

    return result;
  }

  private insertDelivery(headers: GitHubWebhookHeaders, repositoryFullName: string | null): boolean {
    const result = this.db
      .prepare(
        `
        INSERT OR IGNORE INTO webhook_deliveries (github_delivery_id, event_name, repository_full_name, created_at)
        VALUES (?, ?, ?, ?)
      `
      )
      .run(headers.deliveryId, headers.eventName, repositoryFullName, new Date().toISOString());

    return result.changes === 1;
  }

  private markDeliveryProcessed(deliveryId: string): void {
    this.db
      .prepare("UPDATE webhook_deliveries SET processed_at = ? WHERE github_delivery_id = ?")
      .run(new Date().toISOString(), deliveryId);
  }

  private getRepositoryFullName(payload: unknown): string | null {
    if (typeof payload !== "object" || payload === null || !("repository" in payload)) {
      return null;
    }
    const repository = (payload as { repository?: unknown }).repository;
    if (typeof repository !== "object" || repository === null || !("full_name" in repository)) {
      return null;
    }
    const fullName = (repository as { full_name?: unknown }).full_name;
    return typeof fullName === "string" ? fullName : null;
  }
}
