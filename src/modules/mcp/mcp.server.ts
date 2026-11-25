import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { safeErrorMessage } from "../../common/errors.js";
import {
  AGENT_STATUSES,
  agentFieldSchema,
  CANONICAL_AGENTS
} from "../agent-notify/agent-notify.types.js";
import type { AgentNotifyService } from "../agent-notify/agent-notify.service.js";
import { extractDefaultAgent } from "../auth/auth.types.js";

export function createNotifyMcpServer(agentNotify: AgentNotifyService): McpServer {
  const server = new McpServer({
    name: "discord-notify-bot",
    version: "0.1.0"
  });

  server.registerTool(
    "send_notification",
    {
      title: "Send Discord Notification",
      description:
        "Queue a Discord notification into the fixed thread for an AI platform (e.g. 'muse', 'chatgpt', 'gemini', 'claude'). Always pass your canonical platform name as 'agent' and never include user account names or task names in 'agent'.",
      inputSchema: {
        agent: z
          .enum(CANONICAL_AGENTS)
          .optional()
          .describe("Canonical AI platform name. Always keep constant across user accounts."),
        status: z
          .enum(AGENT_STATUSES)
          .default("completed")
          .describe("Use 'completed' when finished, 'needs_approval' when paused awaiting user action/approval, 'error' when blocked/failed, 'info' for updates."),
        title: z.string().trim().min(1).max(200).describe("Short headline for the Discord embed."),
        task: z.string().trim().min(1).max(150).optional().describe("Optional task label shown inside the embed."),
        actionNeeded: z
          .string()
          .trim()
          .min(1)
          .max(500)
          .optional()
          .describe("Exact action the user should take right now (especially for needs_approval)."),
        summary: z.string().trim().min(1).max(3000).optional().describe("Detailed findings, prices, or result summary."),
        url: z.string().trim().url().max(1000).optional().describe("Optional http(s) reference URL."),
        fields: z.array(agentFieldSchema).max(10).optional().describe("Optional structured key-value fields."),
        accountHint: z.string().trim().min(1).max(80).optional().describe("Optional display label for embed footer only."),
        idempotencyKey: z.string().trim().min(1).max(160).optional().describe("Optional deduplication key for retries.")
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (args, extra) => {
      try {
        const result = await agentNotify.enqueueNotification(args, {
          defaultAgent: extractDefaultAgent(extra.authInfo)
        });
        return {
          content: [{ type: "text", text: JSON.stringify(result) }]
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: JSON.stringify({ error: safeErrorMessage(error) }) }]
        };
      }
    }
  );

  server.registerTool(
    "list_agents",
    {
      title: "List Canonical AI Agents",
      description: "List supported canonical AI agent identifiers and any bound Discord threads.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async () => {
      const result = await agentNotify.listAgents();
      return {
        content: [{ type: "text", text: JSON.stringify(result) }]
      };
    }
  );

  server.registerTool(
    "get_notification_status",
    {
      title: "Get Notification Delivery Status",
      description: "Check queue delivery status ('pending', 'processing', 'completed', 'failed') for an enqueued jobId.",
      inputSchema: {
        jobId: z.number().int().positive().describe("Numeric jobId returned by send_notification.")
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ jobId }) => {
      const status = await agentNotify.getJobStatus(jobId);
      if (!status) {
        return {
          isError: true,
          content: [{ type: "text", text: JSON.stringify({ error: "Notification job not found", jobId }) }]
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify(status) }]
      };
    }
  );

  return server;
}
