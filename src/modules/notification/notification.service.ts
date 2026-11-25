import { logger } from "../../common/logger.js";
import type { AgentThreadService } from "../agent-thread/agent-thread.service.js";
import type { DiscordService } from "../discord/discord.service.js";
import { DiscordApiError } from "../discord/discord.errors.js";
import type { QueueJob } from "../queue/queue.types.js";
import type { RepoThreadService } from "../repo-thread/repo-thread.service.js";
import type { WorkflowService } from "../workflow/workflow.service.js";
import { formatNotification } from "./notification.formatter.js";
import type { AgentNotification } from "./notification.types.js";

export class NotificationService {
  public constructor(
    private readonly threads: RepoThreadService,
    private readonly discord: DiscordService,
    private readonly workflows: WorkflowService,
    private readonly agentThreads?: AgentThreadService
  ) {}

  public async process(job: QueueJob): Promise<void> {
    if (job.payload.type === "agent.notification") {
      await this.processAgentNotification(job.id, job.payload);
      return;
    }

    const thread = await this.threads.findOrCreateThread(job.payload.repository.owner, job.payload.repository.name);
    const destinationId = thread.discordThreadId;

    try {
      if (job.payload.type === "github.workflow_run") {
        await this.workflows.handleWorkflowRun(job.payload, destinationId);
      } else if (job.payload.type === "github.workflow_job") {
        await this.workflows.handleWorkflowJob(job.payload, destinationId);
      } else {
        const message = formatNotification(job.payload);
        await this.discord.sendMessage({ channelId: destinationId, ...message });
      }
    } catch (error) {
      if (error instanceof DiscordApiError) {
        logger.warn(
          {
            queueJobId: job.id,
            discordDestinationId: destinationId,
            status: error.status,
            retryable: error.retryable
          },
          "discord message delivery failed"
        );
      }
      throw error;
    }

    logger.info(
      {
        queueJobId: job.id,
        discordDestinationId: destinationId,
        repositoryFullName: job.payload.repository.fullName,
        branch: notificationBranch(job.payload)
      },
      "discord message processed"
    );
  }

  private async processAgentNotification(jobId: number, payload: AgentNotification): Promise<void> {
    if (!this.agentThreads) {
      throw new Error("AgentThreadService is required to process agent notifications");
    }

    const message = formatNotification(payload);
    let thread = await this.agentThreads.findOrCreateThread(payload.agent);
    let destinationId = thread.discordThreadId;

    try {
      await this.discord.sendMessage({ channelId: destinationId, ...message });
    } catch (error) {
      if (error instanceof DiscordApiError && error.status === 404) {
        logger.warn(
          { queueJobId: jobId, agent: payload.agent, staleThreadId: destinationId },
          "stored Discord agent thread missing; re-resolving thread"
        );
        await this.agentThreads.invalidateThread(payload.agent);
        thread = await this.agentThreads.findOrCreateThread(payload.agent);
        destinationId = thread.discordThreadId;
        await this.discord.sendMessage({ channelId: destinationId, ...message });
      } else {
        if (error instanceof DiscordApiError) {
          logger.warn(
            {
              queueJobId: jobId,
              agent: payload.agent,
              discordDestinationId: destinationId,
              status: error.status,
              retryable: error.retryable
            },
            "discord agent message delivery failed"
          );
        }
        throw error;
      }
    }

    logger.info(
      {
        queueJobId: jobId,
        discordDestinationId: destinationId,
        agent: payload.agent,
        status: payload.status
      },
      "discord agent message processed"
    );
  }
}

function notificationBranch(payload: Exclude<QueueJob["payload"], AgentNotification>): string | null {
  if (payload.type === "github.push") {
    return payload.branch;
  }
  if (payload.type === "github.workflow_job") {
    return payload.job.branch;
  }
  return payload.workflow.branch;
}
