import { logger } from "../../common/logger.js";
import { toSafeError } from "../../common/errors.js";
import type { DiscordService } from "../discord/discord.service.js";
import type {
  WorkflowJobNotification,
  WorkflowRunNotification
} from "../notification/notification.types.js";
import type { FormattedNotificationMessage } from "../notification/notification.formatter.js";
import { fetchWorkflowRunJobs } from "./workflow.github-api.js";
import { formatWorkflowCard } from "./workflow.formatter.js";
import type { WorkflowRepository } from "./workflow.repository.js";
import type { WorkflowRunRecord } from "./workflow.types.js";

export class WorkflowService {
  public constructor(
    private readonly repository: WorkflowRepository,
    private readonly discord: DiscordService
  ) {}

  public async handleWorkflowRun(
    notification: WorkflowRunNotification,
    destinationId: string
  ): Promise<void> {
    const { workflow, repository } = notification;

    const run = await this.repository.upsertWorkflowRun({
      runId: workflow.id,
      owner: repository.owner,
      repo: repository.name,
      workflowName: workflow.name,
      branch: workflow.branch,
      headSha: workflow.headSha,
      runNumber: workflow.runNumber,
      event: workflow.event,
      actor: workflow.actor,
      status: workflow.status,
      conclusion: workflow.conclusion,
      url: workflow.url
    });

    let jobs = await this.repository.getJobsForRun(workflow.id);

    // If completed or if we have no jobs recorded yet, query GitHub API to get full job list
    if (workflow.status === "completed" || jobs.length === 0) {
      const apiJobs = await fetchWorkflowRunJobs(repository.owner, repository.name, workflow.id);
      if (apiJobs && apiJobs.length > 0) {
        for (const apiJob of apiJobs) {
          await this.repository.upsertWorkflowJob({
            jobId: apiJob.id,
            runId: workflow.id,
            name: apiJob.name,
            status: apiJob.status,
            conclusion: apiJob.conclusion,
            startedAt: apiJob.started_at,
            completedAt: apiJob.completed_at,
            url: apiJob.html_url
          });
        }
        jobs = await this.repository.getJobsForRun(workflow.id);
      }
    }

    const formatted = formatWorkflowCard(run, jobs);
    await this.postOrUpdateMessage(run, destinationId, formatted);
  }

  public async handleWorkflowJob(
    notification: WorkflowJobNotification,
    destinationId: string
  ): Promise<void> {
    const { job, repository } = notification;

    let run = await this.repository.getWorkflowRun(job.runId);
    if (!run) {
      run = await this.repository.upsertWorkflowRun({
        runId: job.runId,
        owner: repository.owner,
        repo: repository.name,
        workflowName: job.workflowName,
        branch: job.branch,
        headSha: job.headSha,
        actor: notification.sender,
        status: job.status === "completed" ? "in_progress" : job.status,
        url: `https://github.com/${repository.owner}/${repository.name}/actions/runs/${job.runId}`
      });
    }

    await this.repository.upsertWorkflowJob({
      jobId: job.id,
      runId: job.runId,
      name: job.name,
      status: job.status,
      conclusion: job.conclusion,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      url: job.url
    });

    const jobs = await this.repository.getJobsForRun(job.runId);
    const currentRun = (await this.repository.getWorkflowRun(job.runId)) ?? run;

    const formatted = formatWorkflowCard(currentRun, jobs);
    await this.postOrUpdateMessage(currentRun, destinationId, formatted);
  }

  private async postOrUpdateMessage(
    run: WorkflowRunRecord,
    destinationId: string,
    message: FormattedNotificationMessage
  ): Promise<void> {
    if (run.discordMessageId) {
      try {
        const editResult = await this.discord.editMessage({
          channelId: destinationId,
          messageId: run.discordMessageId,
          embeds: message.embeds
        });

        if (editResult !== null) {
          logger.info(
            { runId: run.runId, messageId: run.discordMessageId, destinationId },
            "updated existing workflow discord message"
          );
          return;
        }
      } catch (error) {
        logger.warn(
          { error: toSafeError(error), runId: run.runId, messageId: run.discordMessageId },
          "failed to edit discord message, creating new message"
        );
      }
    }

    const sent = await this.discord.sendMessage({
      channelId: destinationId,
      embeds: message.embeds
    });

    await this.repository.updateDiscordMessage(run.runId, destinationId, sent.id);

    logger.info(
      { runId: run.runId, messageId: sent.id, destinationId },
      "sent new workflow discord message"
    );
  }
}
