import express from "express";
import { asyncHandler } from "../../common/async-handler.js";
import type { GitHubController } from "./github.controller.js";

export function createGitHubRoutes(controller: GitHubController): express.Router {
  const router = express.Router();
  router.post("/webhooks/github", express.raw({ type: "application/json", limit: "2mb" }), asyncHandler(controller.handleWebhook));
  return router;
}
