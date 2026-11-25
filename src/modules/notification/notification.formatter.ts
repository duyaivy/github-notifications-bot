import type { DiscordEmbed, DiscordEmbedField } from "../discord/discord.types.js";
import type {
  AgentKey,
  AgentNotification,
  AgentNotificationStatus,
  NotificationPayload,
  PushNotification,
  WorkflowJobNotification,
  WorkflowRunNotification
} from "./notification.types.js";

const discordEmbedDescriptionLimit = 4096;
const discordEmbedTitleLimit = 256;
const discordFieldNameLimit = 256;
const discordFieldValueLimit = 1024;
const pushColor = 0x5865f2;
const createColor = 0x2da44e;
const forcePushColor = 0xfb8500;
const successColor = 0x2da44e;
const warningColor = 0xd29922;
const approvalColor = 0xfb8500;
const failureColor = 0xcf222e;
const neutralColor = 0x8c959f;

export interface FormattedNotificationMessage {
  embeds: DiscordEmbed[];
}

export function formatNotification(notification: NotificationPayload): FormattedNotificationMessage {
  if (notification.type === "github.push") {
    return formatPushNotification(notification);
  }
  if (notification.type === "github.workflow_job") {
    return formatWorkflowJobNotification(notification);
  }
  if (notification.type === "agent.notification") {
    return formatAgentNotification(notification);
  }

  return formatWorkflowRunNotification(notification);
}

export function formatAgentNotification(notification: AgentNotification): FormattedNotificationMessage {
  const statusDisplay = agentStatusDisplay(notification.status);
  const lines: string[] = [];

  if (notification.actionNeeded) {
    lines.push(`**Cần làm ngay:** ${sanitizeMultiline(notification.actionNeeded)}`);
  }
  if (notification.task) {
    lines.push(`**Task:** ${sanitizeLine(notification.task)}`);
  }
  if (notification.summary) {
    if (lines.length > 0) {
      lines.push("");
    }
    lines.push(sanitizeMultiline(notification.summary));
  }
  if (lines.length === 0) {
    lines.push(`**Trạng thái:** ${statusDisplay.label}`);
  }

  const fields: DiscordEmbedField[] = (notification.fields ?? []).slice(0, 10).map((field) => ({
    name: trimToLimit(sanitizeLine(field.name), discordFieldNameLimit),
    value: trimToLimit(sanitizeMultiline(field.value), discordFieldValueLimit),
    ...(field.inline !== undefined ? { inline: field.inline } : {})
  }));

  const fieldsChars = fields.reduce((sum, field) => sum + field.name.length + field.value.length, 0);
  const descriptionBudget = Math.max(400, Math.min(discordEmbedDescriptionLimit, 5200 - fieldsChars));
  const footerText = notification.accountHint
    ? `agent:${notification.agent} • ${sanitizeLine(notification.accountHint)}`
    : `agent:${notification.agent}`;

  return {
    embeds: [
      {
        title: trimToDiscordTitle(sanitizeLine(notification.title)),
        ...(notification.url ? { url: sanitizeLine(notification.url) } : {}),
        description: trimToLimit(lines.join("\n"), descriptionBudget, "\n...truncated"),
        color: statusDisplay.color,
        author: {
          name: agentDisplayName(notification.agent)
        },
        ...(fields.length > 0 ? { fields } : {}),
        footer: {
          text: trimToLimit(footerText, 256)
        },
        timestamp: notification.occurredAt
      }
    ]
  };
}

function agentStatusDisplay(status: AgentNotificationStatus): { label: string; color: number } {
  switch (status) {
    case "completed":
      return { label: "Hoàn thành", color: successColor };
    case "needs_approval":
      return { label: "Cần bro duyệt / xác nhận", color: approvalColor };
    case "error":
      return { label: "Lỗi hoặc bị chặn", color: failureColor };
    case "info":
      return { label: "Cập nhật tiến độ", color: pushColor };
  }
}

function agentDisplayName(agent: AgentKey): string {
  switch (agent) {
    case "muse":
      return "Muse AI";
    case "chatgpt":
      return "ChatGPT";
    case "gemini":
      return "Gemini";
    case "claude":
      return "Claude";
    case "codex":
      return "Codex";
    case "cursor":
      return "Cursor";
    case "custom":
      return "AI Agent";
  }
}

export function formatWorkflowJobNotification(notification: WorkflowJobNotification): FormattedNotificationMessage {
  const branch = notification.job.branch ?? "unknown";
  const sha = notification.job.headSha.slice(0, 7);
  const statusLabel = notification.job.conclusion ?? notification.job.status;
  const description = [
    `Workflow: ${sanitizeLine(notification.job.workflowName)}`,
    `Job: ${sanitizeLine(notification.job.name)}`,
    `Branch: ${sanitizeLine(branch)}`,
    `Commit: ${sanitizeLine(sha)}`,
    `Status: ${sanitizeLine(statusLabel)}`,
    `Actor: ${sanitizeLine(notification.sender)}`
  ].join("\n");

  const isSuccess = notification.job.conclusion === "success";
  const isFailure = notification.job.conclusion === "failure";
  const color = isSuccess ? successColor : isFailure ? failureColor : warningColor;

  return {
    embeds: [
      {
        title: trimToDiscordTitle(
          `[${notification.repository.name}:${branch}] ${notification.job.workflowName} - ${notification.job.name} ${statusLabel}`
        ),
        url: sanitizeLine(notification.job.url),
        description: trimToDiscordDescription(description),
        color,
        author: {
          name: sanitizeLine(notification.sender)
        }
      }
    ]
  };
}

export function formatPushNotification(notification: PushNotification): FormattedNotificationMessage {
  const pushResult = pushActionResult(notification);
  const lines: string[] = [];

  if (notification.commits.length === 0) {
    lines.push("No commits were included in this push payload.");
  } else {
    let included = 0;
    for (const commit of notification.commits) {
      const line = `[${sanitizeLine(commit.shortId)}](${sanitizeLine(commit.url)}) ${sanitizeLine(firstLine(commit.message))} - ${sanitizeLine(commit.authorName)}`;
      const withCandidate = [...lines, line, truncationLine(notification.commits.length, included + 1)]
        .filter((value): value is string => Boolean(value))
        .join("\n");

      if (withCandidate.length > discordEmbedDescriptionLimit) {
        break;
      }

      lines.push(line);
      included += 1;
    }

    if (included < notification.commits.length) {
      lines.push(truncationLine(notification.commits.length, included));
    }
  }

  return {
    embeds: [
      {
        title: trimToDiscordTitle(
          `[${notification.repository.name}:${notification.branch}] ${pushResult.title}`
        ),
        ...(notification.compareUrl ? { url: sanitizeLine(notification.compareUrl) } : {}),
        description: trimToDiscordDescription(lines.join("\n")),
        color: pushResult.color,
        author: {
          name: sanitizeLine(notification.pusher)
        }
      }
    ]
  };
}

function pushActionResult(notification: PushNotification): { title: string; color: number } {
  switch (notification.action) {
    case "created":
      return { title: "branch created", color: createColor };
    case "deleted":
      return { title: "branch deleted", color: failureColor };
    case "forced":
      return { title: `force-pushed ${notification.commits.length} ${pluralizeCommit(notification.commits.length)}`, color: forcePushColor };
    case "pushed":
      return { title: `${notification.commits.length} new ${pluralizeCommit(notification.commits.length)}`, color: pushColor };
  }
}

export function formatWorkflowRunNotification(notification: WorkflowRunNotification): FormattedNotificationMessage {
  const result = workflowResult(notification);
  const branch = notification.workflow.branch ?? "unknown";
  const sha = notification.workflow.headSha.slice(0, 7);
  const description = [
    `Workflow: ${sanitizeLine(notification.workflow.name)}`,
    `Branch: ${sanitizeLine(branch)}`,
    `Commit: ${sanitizeLine(sha)}`,
    `Event: ${sanitizeLine(notification.workflow.event)}`,
    `Actor: ${sanitizeLine(notification.workflow.actor)}`
  ].join("\n");

  return {
    embeds: [
      {
        title: trimToDiscordTitle(
          `[${notification.repository.name}:${branch}] ${notification.workflow.name} #${notification.workflow.runNumber} ${result.label}`
        ),
        url: sanitizeLine(notification.workflow.url),
        description: trimToDiscordDescription(description),
        color: result.color,
        author: {
          name: sanitizeLine(notification.workflow.actor)
        }
      }
    ]
  };
}

function workflowResult(notification: WorkflowRunNotification): { label: string; color: number } {
  if (notification.workflow.status !== "completed") {
    return { label: sanitizeLine(notification.workflow.status), color: warningColor };
  }

  switch (notification.workflow.conclusion) {
    case "success":
      return { label: "passed", color: successColor };
    case "failure":
    case "timed_out":
    case "action_required":
      return { label: notification.workflow.conclusion.replaceAll("_", " "), color: failureColor };
    case "cancelled":
    case "skipped":
      return { label: notification.workflow.conclusion, color: neutralColor };
    default:
      return { label: notification.workflow.conclusion ?? "completed", color: neutralColor };
  }
}

function firstLine(value: string): string {
  return value.split(/\r?\n/, 1)[0] ?? "";
}

function sanitizeLine(value: string): string {
  return neutralizeMentions(value).replace(/\s+/g, " ").trim();
}

function sanitizeMultiline(value: string): string {
  return neutralizeMentions(value)
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function neutralizeMentions(value: string): string {
  return value.replaceAll("@everyone", "@ everyone").replaceAll("@here", "@ here");
}

function trimToLimit(content: string, maxLength: number, suffix = "..."): string {
  if (content.length <= maxLength) {
    return content;
  }

  return `${content.slice(0, Math.max(0, maxLength - suffix.length)).trimEnd()}${suffix}`;
}

function truncationLine(total: number, included: number): string {
  const omitted = total - included;
  return omitted > 0 ? `...and ${omitted} more commit${omitted === 1 ? "" : "s"} omitted.` : "";
}

function pluralizeCommit(total: number): string {
  return total === 1 ? "commit" : "commits";
}

function trimToDiscordTitle(content: string): string {
  return trimToLimit(content, discordEmbedTitleLimit);
}

function trimToDiscordDescription(content: string): string {
  return trimToLimit(content, discordEmbedDescriptionLimit, "\n...truncated");
}
