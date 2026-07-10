import express, { type ErrorRequestHandler, type Request, type Response } from "express";
import { checkDatabaseReady, type DatabaseClient } from "./database/connection.js";
import { HttpError } from "./common/http-error.js";
import { asyncHandler } from "./common/async-handler.js";
import { requestLogger } from "./common/request-logger.js";
import { logger } from "./common/logger.js";
import { toSafeError } from "./common/errors.js";
import { QueueRepository } from "./modules/queue/queue.repository.js";
import { QueueService } from "./modules/queue/queue.service.js";
import { GitHubService } from "./modules/github/github.service.js";
import { GitHubController } from "./modules/github/github.controller.js";
import { createGitHubRoutes } from "./modules/github/github.routes.js";
import { env } from "./config/env.js";

export function createApp(db: DatabaseClient): express.Express {
  const app = express();

  const queue = new QueueService(new QueueRepository(db));
  const github = new GitHubService(db, queue);
  const githubController = new GitHubController(github);

  app.disable("x-powered-by");
  app.use(requestLogger);
  app.use(createGitHubRoutes(githubController));
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", asyncHandler(async (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      database: (await checkDatabaseReady(db)) ? "ready" : "unready"
    });
  }));

  app.get("/favicon.ico", (_req: Request, res: Response) => {
    res.status(204).end();
  });

  app.use((_req, _res, next) => {
    next(new HttpError(404, "Not found"));
  });

  app.use(errorHandler);

  return app;
}

const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  const httpError = error instanceof HttpError ? error : null;
  const statusCode = httpError?.statusCode ?? 500;
  const message = httpError?.expose ? httpError.message : "Internal server error";

  if (statusCode >= 500) {
    logger.error({ error: toSafeError(error), statusCode }, "request failed");
  } else if (statusCode === 404) {
    logger.info({ method: req.method, path: req.path, statusCode }, "request not found");
  } else {
    logger.warn({ error: toSafeError(error), statusCode }, "request rejected");
  }

  res.status(statusCode).json({
    error: {
      message,
      ...(env.NODE_ENV !== "production" && error instanceof Error ? { detail: error.message } : {})
    }
  });
};
