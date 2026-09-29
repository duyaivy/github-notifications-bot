import type { ResultSet } from "@libsql/client";
import type { DatabaseClient } from "../../database/connection.js";
import type {
  UpsertWorkflowJobInput,
  UpsertWorkflowRunInput,
  WorkflowJobRecord,
  WorkflowRunRecord
} from "./workflow.types.js";

export class WorkflowRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public async getWorkflowRun(runId: number): Promise<WorkflowRunRecord | null> {
    const result = await this.db.execute({
      sql: `
        SELECT run_id, owner, repo, workflow_name, branch, head_sha,
               run_number, event, actor, status, conclusion, url,
               discord_thread_id, discord_message_id, created_at, updated_at
        FROM workflow_runs
        WHERE run_id = ?
        LIMIT 1
      `,
      args: [runId]
    });

    const row = result.rows[0];
    return row ? toWorkflowRunRecord(row) : null;
  }

  public async upsertWorkflowRun(input: UpsertWorkflowRunInput): Promise<WorkflowRunRecord> {
    const now = new Date().toISOString();

    await this.db.execute({
      sql: `
        INSERT INTO workflow_runs (
          run_id, owner, repo, workflow_name, branch, head_sha,
          run_number, event, actor, status, conclusion, url,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (run_id) DO UPDATE SET
          workflow_name = excluded.workflow_name,
          branch = COALESCE(excluded.branch, workflow_runs.branch),
          head_sha = excluded.head_sha,
          run_number = COALESCE(excluded.run_number, workflow_runs.run_number),
          event = COALESCE(excluded.event, workflow_runs.event),
          actor = COALESCE(excluded.actor, workflow_runs.actor),
          status = excluded.status,
          conclusion = excluded.conclusion,
          url = excluded.url,
          updated_at = excluded.updated_at
      `,
      args: [
        input.runId,
        input.owner,
        input.repo,
        input.workflowName,
        input.branch ?? null,
        input.headSha,
        input.runNumber ?? null,
        input.event ?? null,
        input.actor ?? null,
        input.status,
        input.conclusion ?? null,
        input.url,
        now,
        now
      ]
    });

    const record = await this.getWorkflowRun(input.runId);
    if (!record) {
      throw new Error(`Failed to find upserted workflow run: ${input.runId}`);
    }
    return record;
  }

  public async updateDiscordMessage(runId: number, threadId: string, messageId: string): Promise<void> {
    const now = new Date().toISOString();
    await this.db.execute({
      sql: `
        UPDATE workflow_runs
        SET discord_thread_id = ?, discord_message_id = ?, updated_at = ?
        WHERE run_id = ?
      `,
      args: [threadId, messageId, now, runId]
    });
  }

  public async upsertWorkflowJob(input: UpsertWorkflowJobInput): Promise<void> {
    const now = new Date().toISOString();

    await this.db.execute({
      sql: `
        INSERT INTO workflow_jobs (
          job_id, run_id, name, status, conclusion, started_at, completed_at, url, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (job_id) DO UPDATE SET
          name = excluded.name,
          status = excluded.status,
          conclusion = excluded.conclusion,
          started_at = COALESCE(excluded.started_at, workflow_jobs.started_at),
          completed_at = COALESCE(excluded.completed_at, workflow_jobs.completed_at),
          url = COALESCE(excluded.url, workflow_jobs.url),
          updated_at = excluded.updated_at
      `,
      args: [
        input.jobId,
        input.runId,
        input.name,
        input.status,
        input.conclusion ?? null,
        input.startedAt ?? null,
        input.completedAt ?? null,
        input.url ?? null,
        now,
        now
      ]
    });
  }

  public async getJobsForRun(runId: number): Promise<WorkflowJobRecord[]> {
    const result = await this.db.execute({
      sql: `
        SELECT job_id, run_id, name, status, conclusion, started_at, completed_at, url, created_at, updated_at
        FROM workflow_jobs
        WHERE run_id = ?
        ORDER BY started_at ASC, job_id ASC
      `,
      args: [runId]
    });

    return result.rows.map(toWorkflowJobRecord);
  }
}

function toWorkflowRunRecord(row: ResultSet["rows"][number]): WorkflowRunRecord {
  return {
    runId: Number(row.run_id),
    owner: String(row.owner),
    repo: String(row.repo),
    workflowName: String(row.workflow_name),
    branch: row.branch === null ? null : String(row.branch),
    headSha: String(row.head_sha),
    runNumber: row.run_number === null ? null : Number(row.run_number),
    event: row.event === null ? null : String(row.event),
    actor: row.actor === null ? null : String(row.actor),
    status: String(row.status),
    conclusion: row.conclusion === null ? null : String(row.conclusion),
    url: String(row.url),
    discordThreadId: row.discord_thread_id === null ? null : String(row.discord_thread_id),
    discordMessageId: row.discord_message_id === null ? null : String(row.discord_message_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function toWorkflowJobRecord(row: ResultSet["rows"][number]): WorkflowJobRecord {
  return {
    jobId: Number(row.job_id),
    runId: Number(row.run_id),
    name: String(row.name),
    status: String(row.status),
    conclusion: row.conclusion === null ? null : String(row.conclusion),
    startedAt: row.started_at === null ? null : String(row.started_at),
    completedAt: row.completed_at === null ? null : String(row.completed_at),
    url: row.url === null ? null : String(row.url),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}
