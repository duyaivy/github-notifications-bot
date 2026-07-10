import type { Transaction } from "@libsql/client";
import { env } from "../../config/env.js";
import type { DatabaseClient } from "../../database/connection.js";
import { HttpError } from "../../common/http-error.js";
import { logger } from "../../common/logger.js";
import { verifyGitHubSignature } from "./github.signature.js";
import { normalizePush, normalizeWorkflowRun, parseGitHubPushPayload, parseGitHubWorkflowRunPayload } from "./github.normalizer.js";
import type { GitHubWebhookHeaders, GitHubWebhookResult } from "./github.types.js";
import type { QueueService } from "../queue/queue.service.js";

export class GitHubService {
  public constructor(
    private readonly db: DatabaseClient,
    private readonly queue: QueueService
  ) {}

  public async handleWebhook(rawBody: Buffer, headers: GitHubWebhookHeaders): Promise<GitHubWebhookResult> {
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

  private async enqueueNotification(
    headers: GitHubWebhookHeaders,
    repositoryFullName: string,
    notification: ReturnType<typeof normalizePush> | ReturnType<typeof normalizeWorkflowRun>
  ): Promise<GitHubWebhookResult> {
    const transaction = await this.db.transaction("write");
    try {
      const inserted = await this.insertDelivery(transaction, headers, repositoryFullName);
      if (!inserted) {
        await transaction.commit();
        return {
          accepted: true,
          duplicate: true,
          eventName: headers.eventName,
          deliveryId: headers.deliveryId,
          jobId: null,
          message: "Duplicate delivery ignored"
        };
      }

      const jobId = await this.queue.enqueue(notification, transaction);
      await this.markDeliveryProcessed(transaction, headers.deliveryId);
      await transaction.commit();

      const result = {
        accepted: true,
        duplicate: false,
        eventName: headers.eventName,
        deliveryId: headers.deliveryId,
        jobId,
        message: "Webhook accepted"
      };

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
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  private parseJson(rawBody: Buffer): unknown {
    try {
      return JSON.parse(rawBody.toString("utf8")) as unknown;
    } catch {
      throw new HttpError(400, "Invalid JSON body");
    }
  }

  private async recordAcceptedDelivery(
    headers: GitHubWebhookHeaders,
    repositoryFullName: string | null,
    message: string | null,
    responseMessage: string
  ): Promise<GitHubWebhookResult> {
    const transaction = await this.db.transaction("write");
    try {
      const inserted = await this.insertDelivery(transaction, headers, repositoryFullName);
      if (inserted) {
        await this.markDeliveryProcessed(transaction, headers.deliveryId);
      }
      await transaction.commit();

      if (message) {
        logger.info({ githubDeliveryId: headers.deliveryId, message }, "github webhook delivery recorded");
      }

      return {
        accepted: true,
        duplicate: !inserted,
        eventName: headers.eventName,
        deliveryId: headers.deliveryId,
        jobId: null,
        message: inserted ? responseMessage : "Duplicate delivery ignored"
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  private async insertDelivery(
    executor: Transaction,
    headers: GitHubWebhookHeaders,
    repositoryFullName: string | null
  ): Promise<boolean> {
    const result = await executor.execute({
      sql: `
        INSERT OR IGNORE INTO webhook_deliveries (github_delivery_id, event_name, repository_full_name, created_at)
        VALUES (?, ?, ?, ?)
      `,
      args: [headers.deliveryId, headers.eventName, repositoryFullName, new Date().toISOString()]
    });

    return result.rowsAffected === 1;
  }

  private async markDeliveryProcessed(executor: Transaction, deliveryId: string): Promise<void> {
    await executor.execute({
      sql: "UPDATE webhook_deliveries SET processed_at = ? WHERE github_delivery_id = ?",
      args: [new Date().toISOString(), deliveryId]
    });
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
