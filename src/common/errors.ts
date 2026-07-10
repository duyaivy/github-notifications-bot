export interface SafeError {
  name: string;
  message: string;
  stack?: string;
}

export class AppError extends Error {
  public readonly retryable: boolean;

  public constructor(message: string, options: { retryable?: boolean; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = new.target.name;
    this.retryable = options.retryable ?? false;
  }
}

export function toSafeError(error: unknown): SafeError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack ? { stack: error.stack } : {})
    };
  }

  return {
    name: "UnknownError",
    message: typeof error === "string" ? error : "Unknown error"
  };
}

export function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.slice(0, 1000);
  }

  return "Unknown error";
}
