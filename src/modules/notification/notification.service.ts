import { logger } from "../../common/logger.js";
import type { DiscordService } from "../discord/discord.service.js";
import { DiscordApiError } from "../discord/discord.errors.js";
import type { QueueJob } from "../queue/queue.types.js";
import type { RepoThreadService } from "../repo-thread/repo-thread.service.js";
import { formatNotification } from "./notification.formatter.js";

export class NotificationService {
  public constructor(
    private readonly threads: RepoThreadService,
    private readonly discord: DiscordService
  ) {}

  public async process(job: QueueJob): Promise<void> {
    const thread = await this.threads.findOrCreateThread(job.payload.repository.owner, job.payload.repository.name);
    const destinationId = thread.discordThreadId;
    const message = formatNotification(job.payload);

    try {
      await this.discord.sendMessage({ channelId: destinationId, ...message });
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
      "discord message delivered"
    );
  }
}

function notificationBranch(payload: QueueJob["payload"]): string | null {
  if (payload.type === "github.push") {
    return payload.branch;
  }

  return payload.workflow.branch;
}
