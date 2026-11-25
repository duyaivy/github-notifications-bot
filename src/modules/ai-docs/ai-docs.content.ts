import type { Request } from "express";
import { env } from "../../config/env.js";
import { AGENT_STATUSES, CANONICAL_AGENTS } from "../agent-notify/agent-notify.types.js";

export function resolvePublicBaseUrl(req: Request): string {
  if (env.PUBLIC_BASE_URL) {
    return env.PUBLIC_BASE_URL.replace(/\/$/, "");
  }

  const hostHeader = req.get("host")?.trim();
  if (hostHeader && /^[a-zA-Z0-9.-]+(?::\d{1,5})?$/.test(hostHeader)) {
    const protocol = req.protocol === "https" ? "https" : "http";
    return `${protocol}://${hostHeader}`;
  }

  return `http://localhost:${env.PORT}`;
}

export function buildLlmsTxt(baseUrl: string): string {
  return `# Discord Notify Bot — AI Agent API

> Send task completion, approval-needed, and status notifications from AI agents (Muse, ChatGPT, Gemini, Claude, Codex, Cursor) to dedicated Discord threads.

## Routing Rule (Important)
- Every AI platform has ONE fixed Discord thread in the AI notifications channel (for example: \`muse\`, \`chatgpt\`, \`gemini\`).
- ALWAYS pass your canonical platform name in \`agent\`: ${CANONICAL_AGENTS.map((a) => `\`${a}\``).join(", ")}.
- NEVER include your user account name, email, session ID, or task name inside \`agent\`. Put task details in \`task\`, \`title\`, \`summary\`, \`actionNeeded\`, and \`fields\`. This guarantees notifications stay in the same thread even when the user switches accounts.

## Authentication
All notification and MCP endpoints require a Bearer token:
\`\`\`
Authorization: Bearer <YOUR_AGENT_TOKEN>
\`\`\`
If the server issued an agent-bound token (for example bound to \`muse\`), \`agent\` may be omitted and defaults to that bound platform.

## Base URL
\`${baseUrl}\`

## REST Endpoints

### 1. Send Notification
\`POST ${baseUrl}/api/v1/notifications\`
Headers:
- \`Authorization: Bearer <YOUR_AGENT_TOKEN>\`
- \`Content-Type: application/json\`
- Optional \`Idempotency-Key: <unique-key>\`

Request Body Fields:
- \`agent\` (string, required unless token-bound): One of ${CANONICAL_AGENTS.join(", ")}
- \`status\` (string, optional, default \`"completed"\`):
  - \`"completed"\`: Task finished
  - \`"needs_approval"\`: Paused waiting for user approval, confirmation, login, or payment
  - \`"error"\`: Failed or blocked (e.g. CAPTCHA, timeout)
  - \`"info"\`: Progress update
- \`title\` (string, required, max 200): Short headline shown in Discord
- \`task\` (string, optional, max 150): Task name (shown inside embed, never creates a new thread)
- \`actionNeeded\` (string, optional, max 500): What the user needs to click/approve right now
- \`summary\` (string, optional, max 3000): Detailed findings, prices, links, or next steps
- \`url\` (string, optional): Relevant http/https link
- \`fields\` (array, optional, max 10): \`[{ "name": "Price", "value": "7.820.000 VND", "inline": true }]\`
- \`idempotencyKey\` (string, optional, max 160): Prevents duplicate Discord messages on retries

Example (Task Completed):
\`\`\`json
{
  "agent": "muse",
  "status": "completed",
  "task": "Flight search SGN -> NRT (Dec 12-18)",
  "title": "Found cheapest round-trip fare: 7.82M VND",
  "summary": "Zipair ZG52 is cheapest including 20kg baggage.",
  "fields": [
    { "name": "Airline", "value": "Zipair ZG52", "inline": true },
    { "name": "Total", "value": "7,820,000 VND", "inline": true }
  ],
  "idempotencyKey": "flight-20261125-done"
}
\`\`\`

Example (Needs Approval):
\`\`\`json
{
  "agent": "muse",
  "status": "needs_approval",
  "task": "Flight booking SGN -> NRT",
  "title": "Waiting for approval before checkout",
  "actionNeeded": "Open Muse and click Allow on checkout confirmation",
  "summary": "Selected ZG52, 7.82M VND total. Paused before payment.",
  "idempotencyKey": "flight-20261125-approve"
}
\`\`\`

Response (\`202 Accepted\`):
\`\`\`json
{
  "accepted": true,
  "duplicate": false,
  "jobId": 42,
  "agent": "muse",
  "threadName": "muse",
  "status": "completed",
  "queueStatus": "pending"
}
\`\`\`

### 2. Check Delivery Status
\`GET ${baseUrl}/api/v1/notifications/{jobId}\`

### 3. List Canonical Agents & Bound Threads
\`GET ${baseUrl}/api/v1/threads\`

## MCP Endpoint (Streamable HTTP)
- Endpoint: \`POST ${baseUrl}/mcp\`
- Auth: \`Authorization: Bearer <YOUR_AGENT_TOKEN>\`
- Tools:
  - \`send_notification\`: Queue a notification to Discord
  - \`list_agents\`: List canonical agents and active Discord thread bindings
  - \`get_notification_status\`: Check delivery status for a queued \`jobId\`

## Machine-Readable Schema
- OpenAPI 3.1: \`${baseUrl}/openapi.json\`
- Human Docs: \`${baseUrl}/docs/ai\`
`;
}

export function buildOpenApiSpec(baseUrl: string): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: {
      title: "Discord Notify Bot — AI Agent API",
      version: "1.0.0",
      description:
        "Queue task completion, approval-needed, and status notifications from AI agents into fixed per-AI Discord threads."
    },
    servers: [{ url: baseUrl }],
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description: "Bearer token configured in AGENT_API_TOKENS"
        }
      },
      schemas: {
        AgentKey: {
          type: "string",
          enum: [...CANONICAL_AGENTS],
          description: "Canonical AI platform key. Must stay constant across user accounts."
        },
        AgentStatus: {
          type: "string",
          enum: [...AGENT_STATUSES],
          default: "completed"
        },
        NotificationField: {
          type: "object",
          required: ["name", "value"],
          properties: {
            name: { type: "string", minLength: 1, maxLength: 100 },
            value: { type: "string", minLength: 1, maxLength: 500 },
            inline: { type: "boolean" }
          }
        },
        CreateAgentNotificationRequest: {
          type: "object",
          required: ["title"],
          properties: {
            agent: { $ref: "#/components/schemas/AgentKey" },
            status: { $ref: "#/components/schemas/AgentStatus" },
            task: { type: "string", minLength: 1, maxLength: 150 },
            title: { type: "string", minLength: 1, maxLength: 200 },
            summary: { type: "string", minLength: 1, maxLength: 3000 },
            actionNeeded: { type: "string", minLength: 1, maxLength: 500 },
            url: { type: "string", format: "uri", maxLength: 1000 },
            fields: {
              type: "array",
              maxItems: 10,
              items: { $ref: "#/components/schemas/NotificationField" }
            },
            accountHint: { type: "string", minLength: 1, maxLength: 80 },
            idempotencyKey: { type: "string", minLength: 1, maxLength: 160 }
          }
        },
        EnqueueAgentNotificationResponse: {
          type: "object",
          properties: {
            accepted: { type: "boolean" },
            duplicate: { type: "boolean" },
            jobId: { type: ["integer", "null"] },
            agent: { $ref: "#/components/schemas/AgentKey" },
            threadName: { $ref: "#/components/schemas/AgentKey" },
            status: { $ref: "#/components/schemas/AgentStatus" },
            queueStatus: { type: "string", enum: ["pending", "processing", "completed", "failed"] }
          }
        },
        AgentJobStatusResponse: {
          type: "object",
          properties: {
            jobId: { type: "integer" },
            status: { type: "string", enum: ["pending", "processing", "completed", "failed"] },
            attempts: { type: "integer" },
            maxAttempts: { type: "integer" },
            lastError: { type: ["string", "null"] },
            agent: { $ref: "#/components/schemas/AgentKey" },
            notificationStatus: { $ref: "#/components/schemas/AgentStatus" },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
            completedAt: { type: ["string", "null"], format: "date-time" }
          }
        },
        ErrorResponse: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: {
                message: { type: "string" }
              }
            }
          }
        }
      }
    },
    paths: {
      "/api/v1/notifications": {
        post: {
          summary: "Queue an AI agent notification for Discord delivery",
          operationId: "sendNotification",
          parameters: [
            {
              name: "Idempotency-Key",
              in: "header",
              required: false,
              schema: { type: "string", maxLength: 160 }
            }
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CreateAgentNotificationRequest" }
              }
            }
          },
          responses: {
            "202": {
              description: "Notification accepted and queued for Discord delivery",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/EnqueueAgentNotificationResponse" }
                }
              }
            },
            "400": {
              description: "Validation error",
              content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } }
            },
            "401": {
              description: "Missing or invalid bearer token",
              content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } }
            },
            "429": {
              description: "Rate limit exceeded",
              content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } }
            }
          }
        }
      },
      "/api/v1/notifications/{jobId}": {
        get: {
          summary: "Get delivery status for a queued AI notification",
          operationId: "getNotificationStatus",
          parameters: [
            {
              name: "jobId",
              in: "path",
              required: true,
              schema: { type: "integer", minimum: 1 }
            }
          ],
          responses: {
            "200": {
              description: "Notification job status",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/AgentJobStatusResponse" }
                }
              }
            },
            "404": {
              description: "Job not found",
              content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } }
            }
          }
        }
      },
      "/api/v1/threads": {
        get: {
          summary: "List canonical AI agent keys and bound Discord threads",
          operationId: "listAgentThreads",
          responses: {
            "200": {
              description: "Canonical agents and their Discord thread IDs"
            }
          }
        }
      }
    }
  };
}

export function buildAiDocsHtml(baseUrl: string): string {
  const safeBase = escapeHtml(baseUrl);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Discord Notify Bot — AI Agent Docs</title>
  <style>
    :root { color-scheme: light dark; font-family: system-ui, -apple-system, sans-serif; line-height: 1.5; }
    body { max-width: 860px; margin: 2rem auto; padding: 0 1rem; }
    pre { overflow-x: auto; padding: 1rem; border-radius: 8px; background: rgba(127, 127, 127, 0.14); }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9em; }
    .links { display: flex; gap: 1rem; flex-wrap: wrap; margin: 1rem 0; }
    .links a { padding: 0.4rem 0.75rem; border-radius: 6px; border: 1px solid rgba(127, 127, 127, 0.35); text-decoration: none; color: inherit; }
  </style>
</head>
<body>
  <h1>Discord Notify Bot — AI Agent Integration</h1>
  <p>Send task completion (<code>completed</code>) and approval requests (<code>needs_approval</code>) to fixed per-AI Discord threads (<code>muse</code>, <code>chatgpt</code>, <code>gemini</code>, <code>claude</code>).</p>
  <div class="links">
    <a href="/llms.txt">/llms.txt (AI Instructions)</a>
    <a href="/openapi.json">/openapi.json (OpenAPI 3.1)</a>
  </div>
  <h2>Quick cURL Test</h2>
  <pre><code>curl -X POST "${safeBase}/api/v1/notifications" \\
  -H "Authorization: Bearer &lt;YOUR_AGENT_TOKEN&gt;" \\
  -H "Content-Type: application/json" \\
  -d '{
    "agent": "muse",
    "status": "needs_approval",
    "task": "Flight search SGN -&gt; NRT",
    "title": "Found 7.82M VND fare — waiting for approval",
    "actionNeeded": "Open Muse and approve checkout",
    "summary": "Zipair ZG52 includes 20kg checked bag."
  }'</code></pre>
  <h2>Prompt Snippet for Muse AI</h2>
  <pre><code>Read ${safeBase}/llms.txt first. When you finish this task or pause waiting for my approval, send a Discord notification to ${safeBase}/api/v1/notifications using Authorization: Bearer &lt;YOUR_AGENT_TOKEN&gt; and agent="muse".</code></pre>
  <h2>MCP Streamable HTTP Config (Claude Code / Codex / Cursor)</h2>
  <pre><code>{
  "mcpServers": {
    "discord-notify": {
      "type": "http",
      "url": "${safeBase}/mcp",
      "headers": {
        "Authorization": "Bearer &lt;YOUR_AGENT_TOKEN&gt;"
      }
    }
  }
}</code></pre>
</body>
</html>
`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
