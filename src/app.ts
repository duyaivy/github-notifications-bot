import express, { type ErrorRequestHandler, type Request, type Response } from "express";
import type Database from "better-sqlite3";
import { checkDatabaseReady } from "./database/connection.js";
import { HttpError } from "./common/http-error.js";
import { requestLogger } from "./common/request-logger.js";
import { logger } from "./common/logger.js";
import { toSafeError } from "./common/errors.js";
import { QueueRepository } from "./modules/queue/queue.repository.js";
import { QueueService } from "./modules/queue/queue.service.js";
import { GitHubService } from "./modules/github/github.service.js";
import { GitHubController } from "./modules/github/github.controller.js";
import { createGitHubRoutes } from "./modules/github/github.routes.js";
import { env } from "./config/env.js";

export function createApp(db: Database.Database): express.Express {
  const app = express();

  const queue = new QueueService(new QueueRepository(db));
  const github = new GitHubService(db, queue);
  const githubController = new GitHubController(github);

  app.disable("x-powered-by");
  app.use(requestLogger);
  app.use(createGitHubRoutes(githubController));
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      sqlite: checkDatabaseReady(db) ? "ready" : "unready"
    });
  });

  app.use((_req, _res, next) => {
    next(new HttpError(404, "Not found"));
  });

  app.use(errorHandler);

  return app;
}

const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  const httpError = error instanceof HttpError ? error : null;
  const statusCode = httpError?.statusCode ?? 500;
  const message = httpError?.expose ? httpError.message : "Internal server error";

  if (statusCode >= 500) {
    logger.error({ error: toSafeError(error), statusCode }, "request failed");
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
