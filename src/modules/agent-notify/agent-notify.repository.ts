import type { ResultSet } from "@libsql/client";
import type { DatabaseClient } from "../../database/connection.js";
import type { DatabaseExecutor } from "../queue/queue.repository.js";
import type { QueueJobStatus } from "../queue/queue.types.js";
import type { AgentNotification } from "../notification/notification.types.js";
import type { AgentJobStatusResult } from "./agent-notify.types.js";

export class AgentNotifyRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public async insertDeliveryIfNew(
    executor: DatabaseExecutor,
    agentKey: string,
    idempotencyKey: string
  ): Promise<boolean> {
    const result = await executor.execute({
      sql: `
        INSERT OR IGNORE INTO agent_deliveries (agent_key, idempotency_key, created_at)
        VALUES (?, ?, ?)
      `,
      args: [agentKey, idempotencyKey, new Date().toISOString()]
    });

    return result.rowsAffected === 1;
  }

  public async setDeliveryJobId(
    executor: DatabaseExecutor,
    agentKey: string,
    idempotencyKey: string,
    jobId: number
  ): Promise<void> {
    await executor.execute({
      sql: `
        UPDATE agent_deliveries
        SET job_id = ?
        WHERE agent_key = ? AND idempotency_key = ?
      `,
      args: [jobId, agentKey, idempotencyKey]
    });
  }

  public async findDeliveryJobId(
    executor: DatabaseExecutor,
    agentKey: string,
    idempotencyKey: string
  ): Promise<number | null> {
    const result = await executor.execute({
      sql: `
        SELECT job_id
        FROM agent_deliveries
        WHERE agent_key = ? AND idempotency_key = ?
        LIMIT 1
      `,
      args: [agentKey, idempotencyKey]
    });

    const row = result.rows[0];
    if (!row || row.job_id === null || row.job_id === undefined) {
      return null;
    }

    return Number(row.job_id);
  }

  public async getAgentJobStatus(jobId: number): Promise<AgentJobStatusResult | null> {
    const result = await this.db.execute({
      sql: `
        SELECT id, payload_json, status, attempts, max_attempts, last_error, created_at, updated_at, completed_at
        FROM notification_jobs
        WHERE id = ? AND type = 'agent.notification'
        LIMIT 1
      `,
      args: [jobId]
    });

    const row = result.rows[0];
    return row ? mapJobStatusRow(row) : null;
  }
}

function mapJobStatusRow(row: ResultSet["rows"][number]): AgentJobStatusResult {
  const payload = JSON.parse(String(row.payload_json)) as AgentNotification;
  return {
    jobId: Number(row.id),
    status: String(row.status) as QueueJobStatus,
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    lastError: row.last_error === null ? null : String(row.last_error),
    agent: payload.agent,
    notificationStatus: payload.status,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    completedAt: row.completed_at === null ? null : String(row.completed_at)
  };
}
