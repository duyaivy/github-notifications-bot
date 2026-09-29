import type { FormattedNotificationMessage } from "../notification/notification.formatter.js";
import type { WorkflowJobRecord, WorkflowRunRecord } from "./workflow.types.js";

const discordEmbedTitleLimit = 256;
const discordEmbedDescriptionLimit = 4096;

const successColor = 0x2da44e;
const failureColor = 0xcf222e;
const warningColor = 0xd29922;
const neutralColor = 0x8c959f;

export function formatWorkflowCard(
  run: WorkflowRunRecord,
  jobs: WorkflowJobRecord[]
): FormattedNotificationMessage {
  const statusInfo = getRunStatusInfo(run.status, run.conclusion);
  const branchName = run.branch ?? "unknown";
  const runNumStr = run.runNumber ? ` #${run.runNumber}` : "";
  const title = `[${run.repo}:${branchName}] ${run.workflowName}${runNumStr} ${statusInfo.label}`;

  const lines: string[] = [];
  lines.push(`**Workflow:** ${sanitize(run.workflowName)}`);
  lines.push(`**Branch:** \`${sanitize(branchName)}\``);
  const shortSha = run.headSha.slice(0, 7);
  const commitUrl = `https://github.com/${run.owner}/${run.repo}/commit/${run.headSha}`;
  lines.push(`**Commit:** [\`${shortSha}\`](${commitUrl})`);
  if (run.event) {
    lines.push(`**Event:** \`${sanitize(run.event)}\``);
  }
  if (run.actor) {
    lines.push(`**Actor:** **${sanitize(run.actor)}**`);
  }

  if (jobs.length > 0) {
    lines.push("");
    lines.push("**Pipeline Stages:**");

    for (const job of jobs) {
      const icon = getJobIcon(job.status, job.conclusion);
      const duration = formatDuration(job.startedAt, job.completedAt);
      const durText = duration ? ` \`(${duration})\`` : "";
      const jobLink = job.url
        ? `[${sanitize(job.name)}](${job.url})`
        : `**${sanitize(job.name)}**`;
      lines.push(`${icon} ${jobLink}${durText}`);
    }

    if (run.status === "completed") {
      const totalDuration = computeTotalDuration(jobs);
      if (totalDuration) {
        lines.push("");
        lines.push(`⏱️ **Duration:** \`${totalDuration}\``);
      }
    }
  }

  return {
    embeds: [
      {
        title: trimToDiscordTitle(title),
        url: sanitize(run.url),
        description: trimToDiscordDescription(lines.join("\n")),
        color: statusInfo.color,
        author: {
          name: sanitize(run.actor ?? run.owner)
        }
      }
    ]
  };
}

function getRunStatusInfo(status: string, conclusion: string | null): { label: string; color: number } {
  if (status !== "completed") {
    if (status === "in_progress") {
      return { label: "in_progress 🔄", color: warningColor };
    }
    if (status === "queued") {
      return { label: "queued ⏳", color: neutralColor };
    }
    return { label: `${sanitize(status)} 🔄`, color: warningColor };
  }

  switch (conclusion) {
    case "success":
      return { label: "passed ✅", color: successColor };
    case "failure":
      return { label: "failed ❌", color: failureColor };
    case "timed_out":
      return { label: "timed out ⏰", color: failureColor };
    case "cancelled":
      return { label: "cancelled ⏹️", color: neutralColor };
    case "skipped":
      return { label: "skipped ⏭️", color: neutralColor };
    case "action_required":
      return { label: "action required ⚠️", color: failureColor };
    default:
      return { label: sanitize(conclusion ?? "completed"), color: neutralColor };
  }
}

function getJobIcon(status: string, conclusion: string | null): string {
  if (conclusion === "success") return "✅";
  if (conclusion === "failure") return "❌";
  if (conclusion === "cancelled") return "⏹️";
  if (conclusion === "skipped") return "⏭️";
  if (conclusion === "timed_out") return "⏰";
  if (status === "in_progress") return "🔄";
  if (status === "queued" || status === "waiting") return "⏳";
  return "⚪";
}

export function formatDuration(startedAt: string | null, completedAt: string | null): string {
  if (!startedAt) return "";
  if (!completedAt) return "running...";

  const diffMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (diffMs <= 0) return "< 1s";

  const totalSec = Math.round(diffMs / 1000);
  if (totalSec < 60) return `${totalSec}s`;

  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min < 60) return `${min}m ${sec}s`;

  const hr = Math.floor(min / 60);
  const remainingMin = min % 60;
  return `${hr}h ${remainingMin}m`;
}

function computeTotalDuration(jobs: WorkflowJobRecord[]): string | null {
  const startedTimes = jobs
    .map((j) => (j.startedAt ? new Date(j.startedAt).getTime() : null))
    .filter((t): t is number => t !== null && !Number.isNaN(t));

  const completedTimes = jobs
    .map((j) => (j.completedAt ? new Date(j.completedAt).getTime() : null))
    .filter((t): t is number => t !== null && !Number.isNaN(t));

  if (startedTimes.length === 0 || completedTimes.length === 0) {
    return null;
  }

  const minStart = Math.min(...startedTimes);
  const maxEnd = Math.max(...completedTimes);

  if (maxEnd <= minStart) {
    return null;
  }

  const totalSec = Math.round((maxEnd - minStart) / 1000);
  if (totalSec < 60) return `${totalSec}s`;

  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min < 60) return `${min}m ${sec}s`;

  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  return `${hr}h ${remMin}m`;
}

function sanitize(value: string): string {
  return value
    .replaceAll("@everyone", "@ everyone")
    .replaceAll("@here", "@ here")
    .replace(/\s+/g, " ")
    .trim();
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
