import type { NotificationPayload, PushNotification, WorkflowRunNotification } from "./notification.types.js";

const discordEmbedDescriptionLimit = 4096;
const discordEmbedTitleLimit = 256;
const pushColor = 0x5865f2;
const createColor = 0x2da44e;
const forcePushColor = 0xfb8500;
const successColor = 0x2da44e;
const warningColor = 0xd29922;
const failureColor = 0xcf222e;
const neutralColor = 0x8c959f;

export interface FormattedNotificationMessage {
  embeds: Array<{
    title: string;
    url?: string;
    description: string;
    color: number;
    author: {
      name: string;
    };
  }>;
}

export function formatNotification(notification: NotificationPayload): FormattedNotificationMessage {
  if (notification.type === "github.push") {
    return formatPushNotification(notification);
  }

  return formatWorkflowRunNotification(notification);
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
  return value.replaceAll("@everyone", "@ everyone").replaceAll("@here", "@ here").replace(/\s+/g, " ").trim();
}

function truncationLine(total: number, included: number): string {
  const omitted = total - included;
  return omitted > 0 ? `...and ${omitted} more commit${omitted === 1 ? "" : "s"} omitted.` : "";
}

function pluralizeCommit(total: number): string {
  return total === 1 ? "commit" : "commits";
}

function trimToDiscordTitle(content: string): string {
  if (content.length <= discordEmbedTitleLimit) {
    return content;
  }

  return `${content.slice(0, discordEmbedTitleLimit - 3).trimEnd()}...`;
}

function trimToDiscordDescription(content: string): string {
  if (content.length <= discordEmbedDescriptionLimit) {
    return content;
  }

  return `${content.slice(0, discordEmbedDescriptionLimit - 13).trimEnd()}\n...truncated`;
}
