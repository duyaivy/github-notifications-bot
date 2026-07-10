import type Database from "better-sqlite3";
import type { EnqueueNotificationJobInput, QueueJob, QueueJobStatus } from "./queue.types.js";
import type { NotificationPayload } from "../notification/notification.types.js";

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
  public constructor(private readonly db: Database.Database) {}

  public enqueue(input: EnqueueNotificationJobInput): number {
    const result = this.db
      .prepare(
        `
        INSERT INTO notification_jobs (type, payload_json, status, attempts, max_attempts, available_at, created_at, updated_at)
        VALUES (?, ?, 'pending', 0, ?, ?, ?, ?)
      `
      )
      .run(input.type, JSON.stringify(input.payload), input.maxAttempts, input.availableAt, nowIso(), nowIso());

    return Number(result.lastInsertRowid);
  }

  public claimAvailable(limit: number, workerId: string, now = nowIso()): QueueJob[] {
    return this.db.transaction(() => {
      const rows = this.db
        .prepare(
          `
          SELECT id
          FROM notification_jobs
          WHERE status = 'pending' AND available_at <= ?
          ORDER BY available_at ASC, created_at ASC
          LIMIT ?
        `
        )
        .all(now, limit) as Array<{ id: number }>;

      if (rows.length === 0) {
        return [];
      }

      const ids = rows.map((row) => row.id);
      const placeholders = ids.map(() => "?").join(",");
      this.db
        .prepare(
          `
          UPDATE notification_jobs
          SET status = 'processing', locked_at = ?, locked_by = ?, updated_at = ?
          WHERE status = 'pending' AND id IN (${placeholders})
        `
        )
        .run(now, workerId, now, ...ids);

      const claimedRows = this.db
        .prepare(
          `
          SELECT id, type, payload_json, status, attempts, max_attempts, last_error, available_at,
                 locked_at, locked_by, created_at, updated_at, completed_at
          FROM notification_jobs
          WHERE locked_by = ? AND locked_at = ? AND status = 'processing'
          ORDER BY available_at ASC, created_at ASC
        `
        )
        .all(workerId, now) as QueueJobRow[];

      return claimedRows.map(mapJob);
    })();
  }

  public markCompleted(jobId: number): void {
    const now = nowIso();
    this.db
      .prepare(
        `
        UPDATE notification_jobs
        SET status = 'completed', completed_at = ?, locked_at = NULL, locked_by = NULL, updated_at = ?
        WHERE id = ?
      `
      )
      .run(now, now, jobId);
  }

  public markRetry(job: QueueJob, errorMessage: string, availableAt: string): void {
    const now = nowIso();
    this.db
      .prepare(
        `
        UPDATE notification_jobs
        SET status = 'pending',
            attempts = attempts + 1,
            last_error = ?,
            available_at = ?,
            locked_at = NULL,
            locked_by = NULL,
            updated_at = ?
        WHERE id = ? AND status = 'processing'
      `
      )
      .run(errorMessage, availableAt, now, job.id);
  }

  public markFailed(job: QueueJob, errorMessage: string): void {
    const now = nowIso();
    this.db
      .prepare(
        `
        UPDATE notification_jobs
        SET status = 'failed',
            attempts = attempts + 1,
            last_error = ?,
            locked_at = NULL,
            locked_by = NULL,
            updated_at = ?
        WHERE id = ? AND status = 'processing'
      `
      )
      .run(errorMessage, now, job.id);
  }

  public recoverStaleProcessing(staleBefore: string, availableAt: string): number {
    const now = nowIso();
    const result = this.db
      .prepare(
        `
        UPDATE notification_jobs
        SET status = CASE WHEN attempts < max_attempts THEN 'pending' ELSE 'failed' END,
            available_at = CASE WHEN attempts < max_attempts THEN ? ELSE available_at END,
            last_error = COALESCE(last_error, 'Recovered stale processing job'),
            locked_at = NULL,
            locked_by = NULL,
            updated_at = ?
        WHERE status = 'processing' AND locked_at IS NOT NULL AND locked_at <= ?
      `
      )
      .run(availableAt, now, staleBefore);

    return result.changes;
  }
}
