import express, { type Request, type RequestHandler, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { asyncHandler } from "../../common/async-handler.js";
import { logger } from "../../common/logger.js";
import { toSafeError } from "../../common/errors.js";
import type { AgentNotifyService } from "../agent-notify/agent-notify.service.js";
import { createNotifyMcpServer } from "./mcp.server.js";

export function createMcpRoutes(
  agentNotify: AgentNotifyService,
  middlewares: RequestHandler[] = []
): express.Router {
  const router = express.Router();

  router.post(
    "/mcp",
    ...middlewares,
    asyncHandler(async (req: Request, res: Response) => {
      const server = createNotifyMcpServer(agentNotify);
      const transport = new StreamableHTTPServerTransport({
        enableJsonResponse: true
      });

      let cleaned = false;
      const cleanup = () => {
        if (cleaned) {
          return;
        }
        cleaned = true;
        res.off("close", cleanup);
        void transport.close().catch(() => {});
        void server.close().catch(() => {});
      };

      res.once("close", cleanup);

      try {
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
      } catch (error) {
        logger.error({ error: toSafeError(error) }, "mcp request handling failed");
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: "2.0",
            error: {
              code: -32603,
              message: "Internal server error"
            },
            id: null
          });
        }
      } finally {
        if (res.writableEnded) {
          cleanup();
        }
      }
    })
  );

  const methodNotAllowed: RequestHandler = (_req, res) => {
    res.setHeader("Allow", "POST");
    res.status(405).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed in stateless MCP mode. Use POST /mcp."
      },
      id: null
    });
  };

  router.get("/mcp", ...middlewares, methodNotAllowed);
  router.delete("/mcp", ...middlewares, methodNotAllowed);

  return router;
}
