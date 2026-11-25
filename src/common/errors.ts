export interface SafeError {
  name: string;
  message: string;
  cause?: string;
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
    const cause = formatSafeCause(error.cause);
    return {
      name: error.name,
      message: error.message,
      ...(cause ? { cause } : {}),
      ...(error.stack ? { stack: error.stack } : {})
    };
  }

  return {
    name: "UnknownError",
    message: typeof error === "string" ? error : "Unknown error"
  };
}

function formatSafeCause(cause: unknown): string | undefined {
  if (typeof cause === "string" && cause.length > 0) {
    return cause.slice(0, 500);
  }
  if (cause instanceof Error) {
    return cause.message.slice(0, 500);
  }
  return undefined;
}

export function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.slice(0, 1000);
  }

  return "Unknown error";
}
