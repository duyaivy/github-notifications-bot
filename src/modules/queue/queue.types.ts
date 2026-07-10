import type { NotificationPayload } from "../notification/notification.types.js";

export type QueueJobStatus = "pending" | "processing" | "completed" | "failed";

export interface QueueJob {
  id: number;
  type: NotificationPayload["type"];
  payload: NotificationPayload;
  status: QueueJobStatus;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  availableAt: string;
  lockedAt: string | null;
  lockedBy: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface EnqueueNotificationJobInput {
  type: NotificationPayload["type"];
  payload: NotificationPayload;
  maxAttempts: number;
  availableAt: string;
}
