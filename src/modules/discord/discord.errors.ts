import { AppError } from "../../common/errors.js";

export class DiscordApiError extends AppError {
  public readonly status: number | null;
  public readonly retryAfterMs: number | undefined;

  public constructor(message: string, options: { status?: number; retryable: boolean; retryAfterMs?: number; cause?: unknown }) {
    super(message, { retryable: options.retryable, cause: options.cause });
    this.status = options.status ?? null;
    this.retryAfterMs = options.retryAfterMs;
  }
}
