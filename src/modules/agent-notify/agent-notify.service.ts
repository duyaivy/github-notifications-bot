import crypto from "node:crypto";
import { HttpError } from "../../common/http-error.js";
import { logger } from "../../common/logger.js";
import type { DatabaseClient } from "../../database/connection.js";
import type { AgentThreadRepository } from "../agent-thread/agent-thread.repository.js";
import type { AgentKey, AgentNotification } from "../notification/notification.types.js";
import type { QueueService } from "../queue/queue.service.js";
import type { AgentNotifyRepository } from "./agent-notify.repository.js";
import {
  agentNotificationInputSchema,
  CANONICAL_AGENTS,
  normalizeAgentKey,
  normalizeAgentStatus,
  type AgentJobStatusResult,
  type AgentListEntry,
  type EnqueueAgentNotificationResult
} from "./agent-notify.types.js";

export interface EnqueueAgentNotificationOptions {
  defaultAgent?: AgentKey | undefined;
  headerIdempotencyKey?: string | undefined;
}

export class AgentNotifyService {
  public constructor(
    private readonly db: DatabaseClient,
    private readonly queue: QueueService,
    private readonly repository: AgentNotifyRepository,
    private readonly agentThreads: AgentThreadRepository
  ) {}

  public async enqueueNotification(
    rawInput: unknown,
    options: EnqueueAgentNotificationOptions = {}
  ): Promise<EnqueueAgentNotificationResult> {
    const parsed = agentNotificationInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      const details = parsed.error.issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`);
      throw new HttpError(400, `Invalid notification payload: ${details.join("; ")}`);
    }

    const input = parsed.data;
    const rawAgent = input.agent ?? options.defaultAgent;
    if (!rawAgent) {
      throw new HttpError(400, `agent is required. Valid values: ${CANONICAL_AGENTS.join(", ")}`);
    }

    const agent = normalizeAgentKey(rawAgent);
    if (!agent) {
      throw new HttpError(400, `Unsupported agent "${rawAgent}". Valid values: ${CANONICAL_AGENTS.join(", ")}`);
    }

    const status = normalizeAgentStatus(input.status);
    if (!status) {
      throw new HttpError(400, `Unsupported status "${input.status}". Valid values: completed, needs_approval, error, info`);
    }

    const idempotencyKey = input.idempotencyKey ?? options.headerIdempotencyKey;
    const deliveryId = idempotencyKey ?? crypto.randomUUID();
    const notification: AgentNotification = {
      type: "agent.notification",
      deliveryId,
      agent,
      status,
      title: input.title,
      ...(input.task !== undefined ? { task: input.task } : {}),
      ...(input.summary !== undefined ? { summary: input.summary } : {}),
      ...(input.actionNeeded !== undefined ? { actionNeeded: input.actionNeeded } : {}),
      ...(input.url !== undefined ? { url: input.url } : {}),
      ...(input.fields !== undefined
        ? {
            fields: input.fields.map((field) => ({
              name: field.name,
              value: field.value,
              ...(field.inline !== undefined ? { inline: field.inline } : {})
            }))
          }
        : {}),
      ...(input.accountHint !== undefined ? { accountHint: input.accountHint } : {}),
      occurredAt: new Date().toISOString()
    };

    if (!idempotencyKey) {
      const jobId = await this.queue.enqueue(notification);
      logger.info({ queueJobId: jobId, agent, status }, "agent notification enqueued");
      return {
        accepted: true,
        duplicate: false,
        jobId,
        agent,
        threadName: agent,
        status,
        queueStatus: "pending"
      };
    }

    const transaction = await this.db.transaction("write");
    try {
      const inserted = await this.repository.insertDeliveryIfNew(transaction, agent, idempotencyKey);
      if (!inserted) {
        const existingJobId = await this.repository.findDeliveryJobId(transaction, agent, idempotencyKey);
        await transaction.commit();
        const existingJob = existingJobId !== null ? await this.repository.getAgentJobStatus(existingJobId) : null;
        return {
          accepted: true,
          duplicate: true,
          jobId: existingJobId,
          agent,
          threadName: agent,
          status: existingJob?.notificationStatus ?? status,
          queueStatus: existingJob?.status ?? "pending"
        };
      }

      const jobId = await this.queue.enqueue(notification, transaction);
      await this.repository.setDeliveryJobId(transaction, agent, idempotencyKey, jobId);
      await transaction.commit();

      logger.info({ queueJobId: jobId, agent, status, idempotent: true }, "agent notification enqueued");
      return {
        accepted: true,
        duplicate: false,
        jobId,
        agent,
        threadName: agent,
        status,
        queueStatus: "pending"
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  public async getJobStatus(jobId: number): Promise<AgentJobStatusResult | null> {
    return this.repository.getAgentJobStatus(jobId);
  }

  public async listAgents(): Promise<{ agents: AgentListEntry[] }> {
    const threads = await this.agentThreads.listAll();
    const byKey = new Map(threads.map((thread) => [thread.agentKey, thread]));

    const agents: AgentListEntry[] = CANONICAL_AGENTS.map((agentKey) => {
      const bound = byKey.get(agentKey);
      return {
        agent: agentKey,
        threadName: agentKey,
        discordChannelId: bound?.discordChannelId ?? null,
        discordThreadId: bound?.discordThreadId ?? null,
        updatedAt: bound?.updatedAt ?? null
      };
    });

    return { agents };
  }
}
