export class HttpError extends Error {
  public readonly statusCode: number;
  public readonly expose: boolean;

  public constructor(statusCode: number, message: string, expose = statusCode < 500) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.expose = expose;
  }
}
