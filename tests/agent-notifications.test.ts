import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type { Server } from "node:http";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "notify-bot-test-"));
const tempDbPath = path.join(tempDir, "test.db");

// Set env vars before importing modules that validate process.env at load time
process.env.NODE_ENV = "test";
process.env.HOST = "127.0.0.1";
process.env.PORT = "3000";
process.env.SQLITE_PATH = tempDbPath;
process.env.TURSO_DATABASE_URL = "";
process.env.TURSO_AUTH_TOKEN = "";
process.env.GITHUB_WEBHOOK_SECRET = "test-github-secret";
process.env.DISCORD_BOT_TOKEN = "test-discord-bot-token";
process.env.DISCORD_CHANNEL_ID = "100000000000000001";
process.env.DISCORD_GUILD_ID = "";
process.env.DISCORD_AGENT_CHANNEL_ID = "";
process.env.DISCORD_AGENT_CHANNEL_NAME = "ai-notifications";
process.env.AGENT_API_TOKENS = "muse:tok_muse,tok_shared";
process.env.PUBLIC_BASE_URL = "";
process.env.LOG_LEVEL = "silent";

const { createApp } = await import("../src/app.js");
const { configureDatabase, createDatabaseConnection } = await import("../src/database/connection.js");
const { runMigrations } = await import("../src/database/migrate.js");
const { AgentThreadRepository } = await import("../src/modules/agent-thread/agent-thread.repository.js");
const { AgentThreadService } = await import("../src/modules/agent-thread/agent-thread.service.js");
const { normalizeAgentKey, normalizeAgentStatus } = await import("../src/modules/agent-notify/agent-notify.types.js");
const { StaticBearerTokenVerifier } = await import("../src/modules/auth/bearer-token.verifier.js");
const { DiscordApiError } = await import("../src/modules/discord/discord.errors.js");
const { formatAgentNotification } = await import("../src/modules/notification/notification.formatter.js");
const { NotificationService } = await import("../src/modules/notification/notification.service.js");
const { QueueRepository } = await import("../src/modules/queue/queue.repository.js");
const { QueueService } = await import("../src/modules/queue/queue.service.js");
const { RepoThreadRepository } = await import("../src/modules/repo-thread/repo-thread.repository.js");
const { RepoThreadService } = await import("../src/modules/repo-thread/repo-thread.service.js");
const { WorkflowRepository } = await import("../src/modules/workflow/workflow.repository.js");
const { WorkflowService } = await import("../src/modules/workflow/workflow.service.js");

let db: ReturnType<typeof createDatabaseConnection>;
let server: Server;
let baseUrl: string;

before(async () => {
  await runMigrations();
  db = createDatabaseConnection();
  await configureDatabase(db);

  const app = createApp(db, {
    tokenVerifier: new StaticBearerTokenVerifier("muse:tok_muse,tok_shared"),
    rateLimitMax: 5,
    rateLimitWindowMs: 60_000
  });

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("canonical agent and status normalization prevents account variants from creating new threads", () => {
  assert.equal(normalizeAgentKey("Muse"), "muse");
  assert.equal(normalizeAgentKey("muse.ai"), "muse");
  assert.equal(normalizeAgentKey("Meta Muse"), "muse");
  assert.equal(normalizeAgentKey("muse-account-2"), "muse");

  assert.equal(normalizeAgentKey("ChatGPT"), "chatgpt");
  assert.equal(normalizeAgentKey("gpt-4o"), "chatgpt");
  assert.equal(normalizeAgentKey("OpenAI"), "chatgpt");
  assert.equal(normalizeAgentKey("chatgpt-plus-userB"), "chatgpt");

  assert.equal(normalizeAgentKey("Google Gemini"), "gemini");
  assert.equal(normalizeAgentKey("bard"), "gemini");
  assert.equal(normalizeAgentKey("Claude Code"), "claude");
  assert.equal(normalizeAgentKey("totally-unknown-bot"), null);

  assert.equal(normalizeAgentStatus("done"), "completed");
  assert.equal(normalizeAgentStatus("waiting_approval"), "needs_approval");
  assert.equal(normalizeAgentStatus("failed"), "error");
  assert.equal(normalizeAgentStatus("progress"), "info");
});

test("formatAgentNotification creates rich embed under Discord limits and neutralizes mentions", () => {
  const formatted = formatAgentNotification({
    type: "agent.notification",
    deliveryId: "d1",
    agent: "muse",
    status: "needs_approval",
    task: "Book SGN -> NRT",
    title: "Need @everyone approval for 7.82M VND",
    actionNeeded: "Click Allow in @here checkout",
    summary: "A".repeat(4500),
    fields: Array.from({ length: 10 }, (_, idx) => ({
      name: `Field ${idx}`,
      value: "V".repeat(450),
      inline: true
    })),
    accountHint: "muse-acc-2",
    occurredAt: new Date().toISOString()
  });

  const embed = formatted.embeds[0]!;
  assert.ok(embed.title?.startsWith("[CẦN DUYỆT] ⚠️"));
  assert.ok(!embed.title?.includes("@everyone"));
  assert.ok(!embed.description?.includes("@here"));
  assert.equal(embed.author?.name, "Muse AI");
  assert.equal(embed.footer?.text, "agent:muse • muse-acc-2");

  const totalEmbedChars =
    (embed.title?.length ?? 0) +
    (embed.description?.length ?? 0) +
    (embed.author?.name.length ?? 0) +
    (embed.footer?.text.length ?? 0) +
    (embed.fields?.reduce((sum, f) => sum + f.name.length + f.value.length, 0) ?? 0);
  assert.ok(totalEmbedChars < 6000, `embed chars ${totalEmbedChars} exceeded 6000`);
});

test("AgentThreadService reuses Discord channels and existing active/archived threads without creating duplicates", async () => {
  const createdChannels: string[] = [];
  const createdThreads: string[] = [];
  const unarchivedThreads: string[] = [];

  const mockDiscord = {
    async getChannel(channelId: string) {
      return { id: channelId, name: "github", type: 0, guildId: "guild-1", parentId: "cat-info" };
    },
    async listGuildChannels() {
      return [{ id: "100000000000000001", name: "github", type: 0, guildId: "guild-1", parentId: "cat-info" }];
    },
    async createGuildTextChannel(input: { guildId: string; name: string; parentId?: string | null }) {
      createdChannels.push(`${input.name}@${input.parentId}`);
      return { id: "chan-ai-1", name: input.name, type: 0, guildId: input.guildId, parentId: input.parentId ?? null };
    },
    async listActiveGuildThreads() {
      // Simulate existing chatgpt thread on Discord even when local DB is empty
      return [{ id: "thread-chatgpt-existing", name: "chatgpt", parentId: "chan-ai-1", archived: false, locked: false }];
    },
    async listPublicArchivedThreads() {
      // Simulate existing locked archived gemini thread on Discord
      return [{ id: "thread-gemini-archived", name: "gemini", parentId: "chan-ai-1", archived: true, locked: true }];
    },
    async unarchiveThread(threadId: string) {
      unarchivedThreads.push(threadId);
    },
    async createThread(input: { channelId: string; name: string }) {
      createdThreads.push(`${input.channelId}:${input.name}`);
      return { id: `thread-${input.name}-new`, name: input.name, parentId: input.channelId };
    }
  };

  const repo = new AgentThreadRepository(db);
  const service = new AgentThreadService(repo, mockDiscord as never, {
    githubChannelId: "100000000000000001",
    agentChannelName: "ai-notifications"
  });

  // 1. Concurrent first calls for "muse" create #ai-notifications once and create "muse" thread once
  const [m1, m2, m3] = await Promise.all([
    service.findOrCreateThread("muse"),
    service.findOrCreateThread("muse"),
    service.findOrCreateThread("muse")
  ]);
  assert.equal(m1.discordThreadId, "thread-muse-new");
  assert.equal(m2.discordThreadId, "thread-muse-new");
  assert.equal(m3.discordThreadId, "thread-muse-new");
  assert.deepEqual(createdChannels, ["ai-notifications@cat-info"]);
  assert.deepEqual(createdThreads, ["chan-ai-1:muse"]);

  // 2. Existing active Discord thread "chatgpt" is discovered and reused without createThread
  const gpt = await service.findOrCreateThread("chatgpt");
  assert.equal(gpt.discordThreadId, "thread-chatgpt-existing");
  assert.equal(createdThreads.length, 1);

  // 3. Existing archived+locked Discord thread "gemini" is discovered, unarchived, and reused
  const gem = await service.findOrCreateThread("gemini");
  assert.equal(gem.discordThreadId, "thread-gemini-archived");
  assert.deepEqual(unarchivedThreads, ["thread-gemini-archived"]);
  assert.equal(createdThreads.length, 1);
});

test("NotificationService self-heals when stored Discord thread returns 404", async () => {
  const repo = new AgentThreadRepository(db);
  await repo.upsert("claude", "chan-ai-1", "deleted-thread-id");

  const sentTo: string[] = [];
  const mockDiscord = {
    async getChannel(channelId: string) {
      return { id: channelId, name: "ai-notifications", type: 0, guildId: "guild-1", parentId: "cat-info" };
    },
    async listGuildChannels() {
      return [{ id: "chan-ai-1", name: "ai-notifications", type: 0, guildId: "guild-1", parentId: "cat-info" }];
    },
    async listActiveGuildThreads() {
      return [];
    },
    async listPublicArchivedThreads() {
      return [];
    },
    async createThread(input: { channelId: string; name: string }) {
      return { id: "thread-claude-recreated", name: input.name, parentId: input.channelId };
    },
    async sendMessage(input: { channelId: string }) {
      if (input.channelId === "deleted-thread-id") {
        throw new DiscordApiError("Discord API returned 404 for destination", { status: 404, retryable: false });
      }
      sentTo.push(input.channelId);
      return { id: "msg-1", channelId: input.channelId };
    }
  };

  const agentThreads = new AgentThreadService(repo, mockDiscord as never, {
    githubChannelId: "100000000000000001",
    agentChannelId: "chan-ai-1",
    agentChannelName: "ai-notifications"
  });

  const notificationService = new NotificationService(
    new RepoThreadService(new RepoThreadRepository(db), mockDiscord as never),
    mockDiscord as never,
    new WorkflowService(new WorkflowRepository(db), mockDiscord as never),
    agentThreads
  );

  await notificationService.process({
    id: 999,
    type: "agent.notification",
    payload: {
      type: "agent.notification",
      deliveryId: "d-404",
      agent: "claude",
      status: "completed",
      title: "Recovered delivery",
      occurredAt: new Date().toISOString()
    },
    status: "processing",
    attempts: 0,
    maxAttempts: 5,
    lastError: null,
    availableAt: new Date().toISOString(),
    lockedAt: null,
    lockedBy: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null
  });

  assert.deepEqual(sentTo, ["thread-claude-recreated"]);
});

test("Public AI docs, auth fail-closed/401, REST API, idempotency, MCP Streamable HTTP, and rate limit", async () => {
  // 1. Public AI docs endpoints
  const llmsRes = await fetch(`${baseUrl}/llms.txt`);
  assert.equal(llmsRes.status, 200);
  const llmsText = await llmsRes.text();
  assert.ok(llmsText.includes("/api/v1/notifications"));
  assert.ok(llmsText.includes("needs_approval"));

  const openapiRes = await fetch(`${baseUrl}/openapi.json`);
  assert.equal(openapiRes.status, 200);
  const openapi = (await openapiRes.json()) as { openapi: string; paths: Record<string, unknown> };
  assert.equal(openapi.openapi, "3.1.0");
  assert.ok("/api/v1/notifications" in openapi.paths);

  const docsHtmlRes = await fetch(`${baseUrl}/docs/ai`);
  assert.equal(docsHtmlRes.status, 200);
  assert.ok((await docsHtmlRes.text()).includes("Muse AI"));

  // 2. Unauthorized without token -> 401 + WWW-Authenticate
  const unauthRes = await fetch(`${baseUrl}/api/v1/notifications`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agent: "muse", title: "No auth" })
  });
  assert.equal(unauthRes.status, 401);
  assert.ok(unauthRes.headers.get("www-authenticate")?.includes("Bearer"));

  // 3. Invalid JSON -> 400 (not 500)
  const badJsonRes = await fetch(`${baseUrl}/api/v1/notifications`, {
    method: "POST",
    headers: {
      authorization: "Bearer tok_muse",
      "content-type": "application/json"
    },
    body: "{bad json"
  });
  assert.equal(badJsonRes.status, 400);

  // 4. Token-bound defaultAgent + Idempotency-Key deduplication
  const firstPost = await fetch(`${baseUrl}/api/v1/notifications`, {
    method: "POST",
    headers: {
      authorization: "Bearer tok_muse",
      "content-type": "application/json",
      "idempotency-key": "flight-task-001"
    },
    body: JSON.stringify({
      status: "done",
      task: "Flights SGN -> NRT",
      title: "Found Zipair fare 7.82M VND"
    })
  });
  assert.equal(firstPost.status, 202);
  const firstJson = (await firstPost.json()) as {
    accepted: boolean;
    duplicate: boolean;
    jobId: number;
    agent: string;
    status: string;
  };
  assert.equal(firstJson.accepted, true);
  assert.equal(firstJson.duplicate, false);
  assert.equal(firstJson.agent, "muse");
  assert.equal(firstJson.status, "completed");

  const dupPost = await fetch(`${baseUrl}/api/v1/notifications`, {
    method: "POST",
    headers: {
      authorization: "Bearer tok_muse",
      "content-type": "application/json",
      "idempotency-key": "flight-task-001"
    },
    body: JSON.stringify({
      status: "done",
      title: "Found Zipair fare 7.82M VND"
    })
  });
  assert.equal(dupPost.status, 202);
  const dupJson = (await dupPost.json()) as { duplicate: boolean; jobId: number };
  assert.equal(dupJson.duplicate, true);
  assert.equal(dupJson.jobId, firstJson.jobId);

  // 5. Status endpoint isolates agent jobs from GitHub jobs
  const queue = new QueueService(new QueueRepository(db));
  const githubJobId = await queue.enqueue({
    type: "github.push",
    deliveryId: "gh-1",
    repository: { owner: "o", name: "r", fullName: "o/r" },
    branch: "main",
    action: "pushed",
    pusher: "u",
    compareUrl: null,
    commits: [],
    occurredAt: new Date().toISOString()
  });

  const ghLookupRes = await fetch(`${baseUrl}/api/v1/notifications/${githubJobId}`, {
    headers: { authorization: "Bearer tok_muse" }
  });
  assert.equal(ghLookupRes.status, 404);

  // 6. Rate limiting triggers 429 on 6th authenticated request for tok_muse (limit=5; 4 requests used so far)
  const fifthRes = await fetch(`${baseUrl}/api/v1/threads`, {
    headers: { authorization: "Bearer tok_muse" }
  });
  assert.equal(fifthRes.status, 200);

  const sixthRes = await fetch(`${baseUrl}/api/v1/threads`, {
    headers: { authorization: "Bearer tok_muse" }
  });
  assert.equal(sixthRes.status, 429);
  assert.ok(Number(sixthRes.headers.get("retry-after")) >= 1);

  // 7. MCP Streamable HTTP (initialize -> tools/list -> tools/call -> GET 405) using tok_shared
  const mcpHeaders = {
    authorization: "Bearer tok_shared",
    "content-type": "application/json",
    accept: "application/json, text/event-stream"
  };

  const initRes = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: mcpHeaders,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" }
      }
    })
  });
  assert.equal(initRes.status, 200);
  const initPayload = (await initRes.json()) as { result: { serverInfo: { name: string } } };
  assert.equal(initPayload.result.serverInfo.name, "discord-notify-bot");

  const listToolsRes = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: mcpHeaders,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {}
    })
  });
  assert.equal(listToolsRes.status, 200);
  const toolsPayload = (await listToolsRes.json()) as {
    result: { tools: Array<{ name: string; annotations?: { readOnlyHint?: boolean } }> };
  };
  const toolNames = toolsPayload.result.tools.map((t) => t.name);
  assert.deepEqual(toolNames.sort(), ["get_notification_status", "list_agents", "send_notification"]);
  const listAgentsTool = toolsPayload.result.tools.find((t) => t.name === "list_agents");
  assert.equal(listAgentsTool?.annotations?.readOnlyHint, true);

  const callToolRes = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: mcpHeaders,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "send_notification",
        arguments: {
          agent: "chatgpt",
          status: "needs_approval",
          task: "Checkout review",
          title: "Waiting for bro approval",
          actionNeeded: "Confirm payment method"
        }
      }
    })
  });
  assert.equal(callToolRes.status, 200);
  const callPayload = (await callToolRes.json()) as {
    result: { isError?: boolean; content: Array<{ type: string; text: string }> };
  };
  assert.notEqual(callPayload.result.isError, true);
  const toolResult = JSON.parse(callPayload.result.content[0]!.text) as {
    accepted: boolean;
    agent: string;
    threadName: string;
    jobId: number;
  };
  assert.equal(toolResult.accepted, true);
  assert.equal(toolResult.agent, "chatgpt");
  assert.equal(toolResult.threadName, "chatgpt");

  const mcpStatusRes = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: mcpHeaders,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "get_notification_status",
        arguments: { jobId: toolResult.jobId }
      }
    })
  });
  assert.equal(mcpStatusRes.status, 200);
  const mcpStatusJson = JSON.parse(
    ((await mcpStatusRes.json()) as { result: { content: Array<{ text: string }> } }).result.content[0]!.text
  ) as { jobId: number; agent: string; notificationStatus: string };
  assert.equal(mcpStatusJson.jobId, toolResult.jobId);
  assert.equal(mcpStatusJson.agent, "chatgpt");
  assert.equal(mcpStatusJson.notificationStatus, "needs_approval");

  const getMcpRes = await fetch(`${baseUrl}/mcp`, {
    method: "GET",
    headers: { authorization: "Bearer tok_shared" }
  });
  assert.equal(getMcpRes.status, 405);
});

test("Auth middleware fails closed with 503 when AGENT_API_TOKENS is not configured", async () => {
  const unconfiguredApp = createApp(db, {
    tokenVerifier: new StaticBearerTokenVerifier(undefined)
  });

  const localServer = await new Promise<Server>((resolve) => {
    const s = unconfiguredApp.listen(0, "127.0.0.1", () => resolve(s));
  });

  try {
    const address = localServer.address();
    assert.ok(address && typeof address === "object");
    const res = await fetch(`http://127.0.0.1:${address.port}/api/v1/threads`, {
      headers: { authorization: "Bearer anything" }
    });
    assert.equal(res.status, 503);
  } finally {
    await new Promise<void>((resolve) => localServer.close(() => resolve()));
  }
});

test("Account switching delivers to the exact same Discord thread ID and auto-channel recovers on 404", async () => {
  const repo = new AgentThreadRepository(db);
  await repo.deleteByAgent("chatgpt");
  await repo.setSetting("agent_channel_id", "stale-deleted-channel");

  const deliveredChannels: string[] = [];
  let channelCreateCount = 0;
  let threadCreateCount = 0;

  const mockDiscord = {
    async getChannel(channelId: string) {
      return { id: channelId, name: "github", type: 0, guildId: "guild-1", parentId: "cat-info" };
    },
    async listGuildChannels() {
      return [];
    },
    async createGuildTextChannel(input: { guildId: string; name: string; parentId?: string | null }) {
      channelCreateCount += 1;
      return { id: "chan-ai-recovered", name: input.name, type: 0, guildId: input.guildId, parentId: input.parentId ?? null };
    },
    async listActiveGuildThreads() {
      return [];
    },
    async listPublicArchivedThreads(channelId: string) {
      if (channelId === "stale-deleted-channel") {
        throw new DiscordApiError("Discord API returned 404 for destination", { status: 404, retryable: false });
      }
      return [];
    },
    async createThread(input: { channelId: string; name: string }) {
      threadCreateCount += 1;
      return { id: `thread-${input.name}-single`, name: input.name, parentId: input.channelId };
    },
    async sendMessage(input: { channelId: string }) {
      deliveredChannels.push(input.channelId);
      return { id: `msg-${deliveredChannels.length}`, channelId: input.channelId };
    }
  };

  const agentThreads = new AgentThreadService(repo, mockDiscord as never, {
    githubChannelId: "100000000000000001",
    agentChannelName: "ai-notifications"
  });
  const notificationService = new NotificationService(
    new RepoThreadService(new RepoThreadRepository(db), mockDiscord as never),
    mockDiscord as never,
    new WorkflowService(new WorkflowRepository(db), mockDiscord as never),
    agentThreads
  );

  const now = new Date().toISOString();
  await notificationService.process({
    id: 1001,
    type: "agent.notification",
    payload: {
      type: "agent.notification",
      deliveryId: "acc1",
      agent: "chatgpt",
      status: "completed",
      title: "Account 1 finished",
      accountHint: "acc-1@example.com",
      occurredAt: now
    },
    status: "processing",
    attempts: 0,
    maxAttempts: 5,
    lastError: null,
    availableAt: now,
    lockedAt: null,
    lockedBy: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null
  });

  await notificationService.process({
    id: 1002,
    type: "agent.notification",
    payload: {
      type: "agent.notification",
      deliveryId: "acc2",
      agent: "chatgpt",
      status: "needs_approval",
      title: "Account 2 needs approval",
      accountHint: "acc-2@example.com",
      occurredAt: now
    },
    status: "processing",
    attempts: 0,
    maxAttempts: 5,
    lastError: null,
    availableAt: now,
    lockedAt: null,
    lockedBy: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null
  });

  assert.equal(channelCreateCount, 1);
  assert.equal(threadCreateCount, 1);
  assert.deepEqual(deliveredChannels, ["thread-chatgpt-single", "thread-chatgpt-single"]);
});

