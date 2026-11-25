import express, { type RequestHandler } from "express";
import { asyncHandler } from "../../common/async-handler.js";
import type { AgentNotifyController } from "./agent-notify.controller.js";

export function createAgentNotifyRoutes(
  controller: AgentNotifyController,
  middlewares: RequestHandler[] = []
): express.Router {
  const router = express.Router();

  router.post("/api/v1/notifications", ...middlewares, asyncHandler(controller.createNotification));
  router.get("/api/v1/notifications/:jobId", ...middlewares, asyncHandler(controller.getNotificationStatus));
  router.get("/api/v1/threads", ...middlewares, asyncHandler(controller.listThreads));

  return router;
}
