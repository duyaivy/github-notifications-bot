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
import { AgentThreadRepository } from "./modules/agent-thread/agent-thread.repository.js";
import { AgentNotifyRepository } from "./modules/agent-notify/agent-notify.repository.js";
import { AgentNotifyService } from "./modules/agent-notify/agent-notify.service.js";
import { AgentNotifyController } from "./modules/agent-notify/agent-notify.controller.js";
import { createAgentNotifyRoutes } from "./modules/agent-notify/agent-notify.routes.js";
import { createAiDocsRoutes } from "./modules/ai-docs/ai-docs.routes.js";
import { createMcpRoutes } from "./modules/mcp/mcp.routes.js";
import { StaticBearerTokenVerifier } from "./modules/auth/bearer-token.verifier.js";
import { createAgentAuthMiddleware } from "./modules/auth/auth.middleware.js";
import { createRateLimitMiddleware } from "./modules/auth/rate-limit.middleware.js";
import type { AgentTokenVerifier } from "./modules/auth/auth.types.js";
import { env } from "./config/env.js";

export interface CreateAppOptions {
  tokenVerifier?: AgentTokenVerifier;
  rateLimitMax?: number;
  rateLimitWindowMs?: number;
}

export function createApp(db: DatabaseClient, options: CreateAppOptions = {}): express.Express {
  const app = express();

  const queue = new QueueService(new QueueRepository(db));
  const github = new GitHubService(db, queue);
  const githubController = new GitHubController(github);

  const agentNotify = new AgentNotifyService(
    db,
    queue,
    new AgentNotifyRepository(db),
    new AgentThreadRepository(db)
  );
  const agentNotifyController = new AgentNotifyController(agentNotify);

  const tokenVerifier = options.tokenVerifier ?? new StaticBearerTokenVerifier(env.AGENT_API_TOKENS);
  const agentMiddlewares = [
    createAgentAuthMiddleware({ verifier: tokenVerifier }),
    createRateLimitMiddleware({
      maxRequests: options.rateLimitMax ?? env.AGENT_RATE_LIMIT_MAX,
      windowMs: options.rateLimitWindowMs ?? env.AGENT_RATE_LIMIT_WINDOW_MS
    })
  ];

  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(requestLogger);
  app.use(createGitHubRoutes(githubController));
  app.use(createAiDocsRoutes());
  app.use(["/api/v1", "/mcp"], ...agentMiddlewares);
  app.use(express.json({ limit: "1mb" }));

  app.use(createAgentNotifyRoutes(agentNotifyController));
  app.use(createMcpRoutes(agentNotify));

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
  const isInvalidJson =
    error instanceof SyntaxError &&
    typeof (error as { status?: unknown }).status === "number" &&
    (error as { status?: number }).status === 400;

  const httpError = error instanceof HttpError ? error : isInvalidJson ? new HttpError(400, "Invalid JSON body") : null;
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
