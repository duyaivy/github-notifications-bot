import crypto from "node:crypto";
import type { RequestHandler } from "express";
import { logger } from "./logger.js";

export const requestLogger: RequestHandler = (req, res, next) => {
  const requestId = req.header("x-request-id") ?? crypto.randomUUID();
  const start = performance.now();
  res.setHeader("x-request-id", requestId);

  res.on("finish", () => {
    logger.info(
      {
        requestId,
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs: Math.round(performance.now() - start)
      },
      "http request completed"
    );
  });

  next();
};
