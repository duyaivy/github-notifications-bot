import { HttpError } from "../../common/http-error.js";
import type { PushNotification, WorkflowJobNotification, WorkflowRunNotification } from "../notification/notification.types.js";
import type { GitHubPushPayload, GitHubWorkflowJobPayload, GitHubWorkflowRunPayload } from "./github.types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw new HttpError(400, `Invalid GitHub push payload: ${key} must be a string`);
  }
  return value;
}

function nullableString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new HttpError(400, `Invalid GitHub push payload: ${key} must be a string or null`);
  }
  return value;
}

function nullableRecord(record: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = record[key];
  if (value === null) {
    return null;
  }
  if (!isRecord(value)) {
    throw new HttpError(400, `Invalid GitHub payload: ${key} must be an object or null`);
  }
  return value;
}

function requireNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== "number") {
    throw new HttpError(400, `Invalid GitHub payload: ${key} must be a number`);
  }
  return value;
}

function optionalBoolean(record: Record<string, unknown>, key: string): boolean {
  const value = record[key];
  if (value === undefined) {
    return false;
  }
  if (typeof value !== "boolean") {
    throw new HttpError(400, `Invalid GitHub payload: ${key} must be a boolean`);
  }
  return value;
}

function requireRecord(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = record[key];
  if (!isRecord(value)) {
    throw new HttpError(400, `Invalid GitHub push payload: ${key} must be an object`);
  }
  return value;
}

export function parseGitHubPushPayload(input: unknown): GitHubPushPayload {
  if (!isRecord(input)) {
    throw new HttpError(400, "Invalid GitHub push payload");
  }

  const repository = requireRecord(input, "repository");
  const owner = requireRecord(repository, "owner");
  const pusher = requireRecord(input, "pusher");
  const sender = requireRecord(input, "sender");
  const commitsValue = input.commits;

  if (!Array.isArray(commitsValue)) {
    throw new HttpError(400, "Invalid GitHub push payload: commits must be an array");
  }

  const commits = commitsValue.map((commitValue) => {
    if (!isRecord(commitValue)) {
      throw new HttpError(400, "Invalid GitHub push payload: commit must be an object");
    }
    const author = requireRecord(commitValue, "author");
    return {
      id: requireString(commitValue, "id"),
      message: requireString(commitValue, "message"),
      url: requireString(commitValue, "url"),
      author: {
        name: requireString(author, "name")
      }
    };
  });

  const headCommitValue = input.head_commit;
  const head_commit = headCommitValue === null ? null : isRecord(headCommitValue) ? { id: requireString(headCommitValue, "id") } : null;
  if (headCommitValue !== null && !isRecord(headCommitValue)) {
    throw new HttpError(400, "Invalid GitHub push payload: head_commit must be an object or null");
  }

  return {
    ref: requireString(input, "ref"),
    compare: nullableString(input, "compare"),
    created: optionalBoolean(input, "created"),
    deleted: optionalBoolean(input, "deleted"),
    forced: optionalBoolean(input, "forced"),
    repository: {
      full_name: requireString(repository, "full_name"),
      name: requireString(repository, "name"),
      owner: {
        login: requireString(owner, "login")
      }
    },
    pusher: {
      name: requireString(pusher, "name")
    },
    sender: {
      login: requireString(sender, "login")
    },
    commits,
    head_commit
  };
}

export function normalizePush(payload: GitHubPushPayload, deliveryId: string): PushNotification {
  return {
    type: "github.push",
    deliveryId,
    repository: {
      owner: payload.repository.owner.login,
      name: payload.repository.name,
      fullName: payload.repository.full_name
    },
    branch: normalizeBranch(payload.ref),
    action: normalizePushAction(payload),
    pusher: payload.pusher.name || payload.sender.login,
    compareUrl: payload.compare,
    commits: payload.commits.map((commit) => ({
      id: commit.id,
      shortId: commit.id.slice(0, 7),
      message: commit.message,
      url: commit.url,
      authorName: commit.author.name
    })),
    occurredAt: new Date().toISOString()
  };
}

function normalizePushAction(payload: GitHubPushPayload): PushNotification["action"] {
  if (payload.deleted) {
    return "deleted";
  }
  if (payload.created) {
    return "created";
  }
  if (payload.forced) {
    return "forced";
  }
  return "pushed";
}

export function parseGitHubWorkflowRunPayload(input: unknown): GitHubWorkflowRunPayload {
  if (!isRecord(input)) {
    throw new HttpError(400, "Invalid GitHub workflow_run payload");
  }

  const repository = requireRecord(input, "repository");
  const owner = requireRecord(repository, "owner");
  const workflowRun = requireRecord(input, "workflow_run");
  const actor = nullableRecord(workflowRun, "actor");
  const sender = requireRecord(input, "sender");

  return {
    action: requireString(input, "action"),
    repository: {
      full_name: requireString(repository, "full_name"),
      name: requireString(repository, "name"),
      owner: {
        login: requireString(owner, "login")
      }
    },
    workflow_run: {
      id: requireNumber(workflowRun, "id"),
      name: requireString(workflowRun, "name"),
      html_url: requireString(workflowRun, "html_url"),
      status: requireString(workflowRun, "status"),
      conclusion: nullableString(workflowRun, "conclusion"),
      head_branch: nullableString(workflowRun, "head_branch"),
      head_sha: requireString(workflowRun, "head_sha"),
      run_number: requireNumber(workflowRun, "run_number"),
      event: requireString(workflowRun, "event"),
      actor: actor
        ? {
            login: requireString(actor, "login")
          }
        : null
    },
    sender: {
      login: requireString(sender, "login")
    }
  };
}

export function normalizeWorkflowRun(payload: GitHubWorkflowRunPayload, deliveryId: string): WorkflowRunNotification {
  return {
    type: "github.workflow_run",
    deliveryId,
    repository: {
      owner: payload.repository.owner.login,
      name: payload.repository.name,
      fullName: payload.repository.full_name
    },
    workflow: {
      id: payload.workflow_run.id,
      name: payload.workflow_run.name,
      url: payload.workflow_run.html_url,
      status: payload.workflow_run.status,
      conclusion: payload.workflow_run.conclusion,
      branch: payload.workflow_run.head_branch,
      headSha: payload.workflow_run.head_sha,
      runNumber: payload.workflow_run.run_number,
      event: payload.workflow_run.event,
      actor: payload.workflow_run.actor?.login ?? payload.sender.login
    },
    occurredAt: new Date().toISOString()
  };
}

export function parseGitHubWorkflowJobPayload(input: unknown): GitHubWorkflowJobPayload {
  if (!isRecord(input)) {
    throw new HttpError(400, "Invalid GitHub workflow_job payload");
  }

  const repository = requireRecord(input, "repository");
  const owner = requireRecord(repository, "owner");
  const workflowJob = requireRecord(input, "workflow_job");
  const sender = requireRecord(input, "sender");

  const stepsValue = workflowJob.steps;
  const steps = Array.isArray(stepsValue)
    ? stepsValue
        .filter((step): step is Record<string, unknown> => isRecord(step))
        .map((step) => ({
          name: typeof step.name === "string" ? step.name : "Step",
          status: typeof step.status === "string" ? step.status : "unknown",
          conclusion: typeof step.conclusion === "string" ? step.conclusion : null,
          number: typeof step.number === "number" ? step.number : 0
        }))
    : undefined;

  return {
    action: requireString(input, "action"),
    repository: {
      full_name: requireString(repository, "full_name"),
      name: requireString(repository, "name"),
      owner: {
        login: requireString(owner, "login")
      }
    },
    workflow_job: {
      id: requireNumber(workflowJob, "id"),
      run_id: requireNumber(workflowJob, "run_id"),
      workflow_name: nullableString(workflowJob, "workflow_name"),
      head_branch: nullableString(workflowJob, "head_branch"),
      head_sha: requireString(workflowJob, "head_sha"),
      name: requireString(workflowJob, "name"),
      status: requireString(workflowJob, "status"),
      conclusion: nullableString(workflowJob, "conclusion"),
      started_at: nullableString(workflowJob, "started_at"),
      completed_at: nullableString(workflowJob, "completed_at"),
      html_url: requireString(workflowJob, "html_url"),
      ...(steps !== undefined ? { steps } : {})
    },
    sender: {
      login: requireString(sender, "login")
    }
  };
}

export function normalizeWorkflowJob(payload: GitHubWorkflowJobPayload, deliveryId: string): WorkflowJobNotification {
  return {
    type: "github.workflow_job",
    deliveryId,
    repository: {
      owner: payload.repository.owner.login,
      name: payload.repository.name,
      fullName: payload.repository.full_name
    },
    job: {
      id: payload.workflow_job.id,
      runId: payload.workflow_job.run_id,
      workflowName: payload.workflow_job.workflow_name ?? "Workflow",
      name: payload.workflow_job.name,
      url: payload.workflow_job.html_url,
      status: payload.workflow_job.status,
      conclusion: payload.workflow_job.conclusion,
      branch: payload.workflow_job.head_branch ? normalizeBranch(payload.workflow_job.head_branch) : null,
      headSha: payload.workflow_job.head_sha,
      startedAt: payload.workflow_job.started_at,
      completedAt: payload.workflow_job.completed_at,
      ...(payload.workflow_job.steps !== undefined ? { steps: payload.workflow_job.steps } : {})
    },
    sender: payload.sender.login,
    occurredAt: new Date().toISOString()
  };
}

export function normalizeBranch(ref: string): string {
  const prefix = "refs/heads/";
  return ref.startsWith(prefix) ? ref.slice(prefix.length) : ref;
}
