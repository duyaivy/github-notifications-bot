import type { InStatement, ResultSet } from "@libsql/client";
import type { DatabaseClient } from "../../database/connection.js";
import type { EnqueueNotificationJobInput, QueueJob, QueueJobStatus } from "./queue.types.js";
import type { NotificationPayload } from "../notification/notification.types.js";

export interface DatabaseExecutor {
  execute(stmt: InStatement): Promise<ResultSet>;
}

interface QueueJobRow {
  id: number;
  type: NotificationPayload["type"];
  payload_json: string;
  status: QueueJobStatus;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  available_at: string;
  locked_at: string | null;
  locked_by: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function mapJob(row: QueueJobRow): QueueJob {
  return {
    id: row.id,
    type: row.type,
    payload: JSON.parse(row.payload_json) as NotificationPayload,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    lastError: row.last_error,
    availableAt: row.available_at,
    lockedAt: row.locked_at,
    lockedBy: row.locked_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at
  };
}

export class QueueRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public async enqueue(input: EnqueueNotificationJobInput, executor: DatabaseExecutor = this.db): Promise<number> {
    const now = nowIso();
    const result = await executor.execute({
      sql: `
        INSERT INTO notification_jobs (type, payload_json, status, attempts, max_attempts, available_at, created_at, updated_at)
        VALUES (?, ?, 'pending', 0, ?, ?, ?, ?)
      `,
      args: [input.type, JSON.stringify(input.payload), input.maxAttempts, input.availableAt, now, now]
    });

    return Number(result.lastInsertRowid);
  }

  public async claimAvailable(limit: number, workerId: string, now = nowIso()): Promise<QueueJob[]> {
    const transaction = await this.db.transaction("write");
    try {
      const rows = await transaction.execute({
        sql: `
          SELECT id
          FROM notification_jobs
          WHERE status = 'pending' AND available_at <= ?
          ORDER BY available_at ASC, created_at ASC
          LIMIT ?
        `,
        args: [now, limit]
      });

      if (rows.rows.length === 0) {
        await transaction.commit();
        return [];
      }

      const ids = rows.rows.map((row) => Number(row.id));
      const placeholders = ids.map(() => "?").join(",");
      await transaction.execute({
        sql: `
          UPDATE notification_jobs
          SET status = 'processing', locked_at = ?, locked_by = ?, updated_at = ?
          WHERE status = 'pending' AND id IN (${placeholders})
        `,
        args: [now, workerId, now, ...ids]
      });

      const claimedRows = await transaction.execute({
        sql: `
          SELECT id, type, payload_json, status, attempts, max_attempts, last_error, available_at,
                 locked_at, locked_by, created_at, updated_at, completed_at
          FROM notification_jobs
          WHERE locked_by = ? AND locked_at = ? AND status = 'processing'
          ORDER BY available_at ASC, created_at ASC
        `,
        args: [workerId, now]
      });

      await transaction.commit();
      return claimedRows.rows.map((row) => mapJob(toQueueJobRow(row)));
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  public async markCompleted(jobId: number): Promise<void> {
    const now = nowIso();
    await this.db.execute({
      sql: `
        UPDATE notification_jobs
        SET status = 'completed', completed_at = ?, locked_at = NULL, locked_by = NULL, updated_at = ?
        WHERE id = ?
      `,
      args: [now, now, jobId]
    });
  }

  public async markRetry(job: QueueJob, errorMessage: string, availableAt: string): Promise<void> {
    const now = nowIso();
    await this.db.execute({
      sql: `
        UPDATE notification_jobs
        SET status = 'pending',
            attempts = attempts + 1,
            last_error = ?,
            available_at = ?,
            locked_at = NULL,
            locked_by = NULL,
            updated_at = ?
        WHERE id = ? AND status = 'processing'
      `,
      args: [errorMessage, availableAt, now, job.id]
    });
  }

  public async markFailed(job: QueueJob, errorMessage: string): Promise<void> {
    const now = nowIso();
    await this.db.execute({
      sql: `
        UPDATE notification_jobs
        SET status = 'failed',
            attempts = attempts + 1,
            last_error = ?,
            locked_at = NULL,
            locked_by = NULL,
            updated_at = ?
        WHERE id = ? AND status = 'processing'
      `,
      args: [errorMessage, now, job.id]
    });
  }

  public async recoverStaleProcessing(staleBefore: string, availableAt: string): Promise<number> {
    const now = nowIso();
    const result = await this.db.execute({
      sql: `
        UPDATE notification_jobs
        SET status = CASE WHEN attempts < max_attempts THEN 'pending' ELSE 'failed' END,
            available_at = CASE WHEN attempts < max_attempts THEN ? ELSE available_at END,
            last_error = COALESCE(last_error, 'Recovered stale processing job'),
            locked_at = NULL,
            locked_by = NULL,
            updated_at = ?
        WHERE status = 'processing' AND locked_at IS NOT NULL AND locked_at <= ?
      `,
      args: [availableAt, now, staleBefore]
    });

    return result.rowsAffected;
  }
}

function toQueueJobRow(row: ResultSet["rows"][number]): QueueJobRow {
  return {
    id: Number(row.id),
    type: String(row.type) as NotificationPayload["type"],
    payload_json: String(row.payload_json),
    status: String(row.status) as QueueJobStatus,
    attempts: Number(row.attempts),
    max_attempts: Number(row.max_attempts),
    last_error: row.last_error === null ? null : String(row.last_error),
    available_at: String(row.available_at),
    locked_at: row.locked_at === null ? null : String(row.locked_at),
    locked_by: row.locked_by === null ? null : String(row.locked_by),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    completed_at: row.completed_at === null ? null : String(row.completed_at)
  };
}
