import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
process.env.PUBLIC_BASE_URL = "https://notify.example.test/";
process.env.OAUTH_OWNER_SECRET = "test-only-owner-secret-for-oauth";
process.env.LOG_LEVEL = "silent";

const { createApp } = await import("../src/app.js");
const { configureDatabase, createDatabaseConnection } = await import("../src/database/connection.js");
const { runMigrations } = await import("../src/database/migrate.js");
const { AgentThreadRepository } = await import("../src/modules/agent-thread/agent-thread.repository.js");
const { AgentThreadService } = await import("../src/modules/agent-thread/agent-thread.service.js");
const { normalizeAgentKey, normalizeAgentStatus } = await import("../src/modules/agent-notify/agent-notify.types.js");
const { toSafeError } = await import("../src/common/errors.js");
const { StaticBearerTokenVerifier } = await import("../src/modules/auth/bearer-token.verifier.js");
const { DiscordApiError } = await import("../src/modules/discord/discord.errors.js");
const { DiscordService } = await import("../src/modules/discord/discord.service.js");
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
    tokenVerifier: new StaticBearerTokenVerifier("muse:tok_muse,tok_shared,codex:tok_oauth_regression"),
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
  assert.ok(embed.title?.startsWith("Need "));
  assert.equal(embed.color, 0xfb8500);
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

test("AgentThreadService falls back to DISCORD_CHANNEL_ID when createGuildTextChannel fails with 403 and upgrades later when dedicated channel appears", async () => {
  const repo = new AgentThreadRepository(db);
  await repo.deleteByAgent("muse");
  await repo.deleteSetting("agent_channel_id");
  await repo.deleteSetting("discord_guild_id");

  let createChannelAttempts = 0;
  let dedicatedChannelExists = false;

  const mockDiscord = {
    async getChannel(channelId: string) {
      return { id: channelId, name: "github", type: 0, guildId: "guild-1", parentId: "cat-info" };
    },
    async listGuildChannels() {
      const base = [{ id: "100000000000000001", name: "github", type: 0, guildId: "guild-1", parentId: "cat-info" }];
      if (dedicatedChannelExists) {
        base.push({ id: "chan-ai-manual", name: "ai-notifications", type: 0, guildId: "guild-1", parentId: "cat-info" });
      }
      return base;
    },
    async createGuildTextChannel() {
      createChannelAttempts += 1;
      throw new DiscordApiError("Discord API returned 403 for destination (code 50013: Missing Permissions)", {
        status: 403,
        discordCode: 50013,
        retryable: false,
        cause: '{"message":"Missing Permissions","code":50013}'
      });
    },
    async listActiveGuildThreads() {
      return [];
    },
    async listPublicArchivedThreads() {
      return [];
    },
    async createThread(input: { channelId: string; name: string }) {
      return { id: `thread-${input.channelId}-${input.name}`, name: input.name, parentId: input.channelId };
    }
  };

  const service = new AgentThreadService(repo, mockDiscord as never, {
    githubChannelId: "100000000000000001",
    agentChannelName: "ai-notifications"
  });

  const fallbackThread = await service.findOrCreateThread("muse");
  assert.equal(fallbackThread.discordChannelId, "100000000000000001");
  assert.equal(fallbackThread.discordThreadId, "thread-100000000000000001-muse");
  assert.equal(await repo.getSetting("agent_channel_id"), null);

  // Second call in same process uses cached fallback without hammering createGuildTextChannel
  await service.findOrCreateThread("codex");
  assert.equal(createChannelAttempts, 1);

  // After user creates #ai-notifications manually and service restarts, threads migrate cleanly
  dedicatedChannelExists = true;
  const restartedService = new AgentThreadService(repo, mockDiscord as never, {
    githubChannelId: "100000000000000001",
    agentChannelName: "ai-notifications"
  });
  const dedicatedThread = await restartedService.findOrCreateThread("muse");
  assert.equal(dedicatedThread.discordChannelId, "chan-ai-manual");
  assert.equal(dedicatedThread.discordThreadId, "thread-chan-ai-manual-muse");
  assert.equal(await repo.getSetting("agent_channel_id"), "chan-ai-manual");
});

test("DiscordService surfaces Discord error code and message while toSafeError preserves cause", async () => {
  const discord = new DiscordService();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ message: "Missing Permissions", code: 50013 }), {
      status: 403,
      headers: { "content-type": "application/json" }
    });

  try {
    await assert.rejects(
      () => discord.sendMessage({ channelId: "123", content: "hello" }),
      (error: unknown) => {
        assert.ok(error instanceof DiscordApiError);
        assert.equal(error.status, 403);
        assert.equal(error.discordCode, 50013);
        assert.equal(error.retryable, false);
        assert.ok(error.message.includes("50013"), `unexpected message: ${error.message}`);
        assert.ok(error.message.includes("Missing Permissions"), `unexpected message: ${error.message}`);

        const safe = toSafeError(error);
        assert.ok(safe.cause?.includes("50013"), `unexpected safe.cause: ${safe.cause}`);
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});



test("ChatGPT OAuth discovery, PKCE, MCP default agent, refresh, audience, and static REST compatibility", async () => {
  const issuer = "https://notify.example.test";
  const resource = issuer + "/mcp";
  const metadataPath = "/.well-known/oauth-protected-resource";
  for (const endpoint of [metadataPath, metadataPath + "/mcp"]) {
    const response = await fetch(baseUrl + endpoint);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      resource,
      authorization_servers: [issuer],
      scopes_supported: ["mcp"],
      bearer_methods_supported: ["header"]
    });
  }
  const discovery = await fetch(baseUrl + "/.well-known/oauth-authorization-server");
  assert.equal(discovery.status, 200);
  const metadata = await discovery.json();
  assert.equal(metadata.issuer, issuer);
  assert.equal(metadata.authorization_endpoint, issuer + "/oauth/authorize");
  assert.equal(metadata.token_endpoint, issuer + "/oauth/token");
  assert.equal(metadata.registration_endpoint, issuer + "/oauth/register");
  assert.deepEqual(metadata.code_challenge_methods_supported, ["S256"]);
  assert.deepEqual(metadata.grant_types_supported, ["authorization_code", "refresh_token"]);
  assert.deepEqual(metadata.token_endpoint_auth_methods_supported, ["none"]);
  assert.equal(metadata.authorization_response_iss_parameter_supported, true);

  const postJson = (endpoint: string, body: object, token?: string) => fetch(baseUrl + endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(body)
  });
  const postForm = (endpoint: string, fields: Record<string, string>, origin = issuer) => fetch(baseUrl + endpoint, {
    method: "POST",
    headers: { origin },
    redirect: "manual",
    body: new URLSearchParams(fields)
  });

  const redirectUri = "https://chatgpt.com/connector_platform_oauth_redirect";
  const registration = {
    redirect_uris: [redirectUri, "https://chatgpt.com/connector/oauth/test-callback_id"],
    grant_types: ["authorization_code", "refresh_token"],
    token_endpoint_auth_method: "none"
  };
  const badRegistration = await postJson("/oauth/register", { redirect_uris: [redirectUri + "?extra=1"] });
  assert.equal(badRegistration.status, 400);
  assert.equal((await badRegistration.json()).error, "invalid_redirect_uri");
  const registered = await postJson("/oauth/register", registration);
  assert.equal(registered.status, 201);
  const client = await registered.json();
  assert.equal(typeof client.client_id, "string");
  assert.deepEqual(client.redirect_uris, registration.redirect_uris);

  const verifier = "a".repeat(43);
  const authorization = {
    client_id: client.client_id as string,
    redirect_uri: redirectUri,
    response_type: "code",
    code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    state: 'example "<state>"',
    resource,
    scope: "mcp"
  };
  const authorize = (params: Record<string, string>) => fetch(
    baseUrl + "/oauth/authorize?" + new URLSearchParams(params), { redirect: "manual" }
  );
  const deniedRedirect = await authorize({ ...authorization, redirect_uri: "https://chatgpt.com/connector/oauth/unregistered" });
  assert.equal(deniedRedirect.status, 400);
  assert.equal(deniedRedirect.headers.get("location"), null);
  const plain = await authorize({ ...authorization, code_challenge_method: "plain" });
  assert.equal(plain.status, 303);
  const plainCallback = new URL(plain.headers.get("location")!);
  assert.equal(plainCallback.searchParams.get("error"), "invalid_request");
  assert.equal(plainCallback.searchParams.get("iss"), issuer);
  assert.equal(plainCallback.searchParams.has("code"), false);
  const consent = await authorize(authorization);
  assert.equal(consent.status, 200);
  assert.equal(consent.headers.get("cache-control"), "no-store");
  assert.match(await consent.text(), /example &quot;&lt;state&gt;&quot;/);
  const wrongSecret = await postForm("/oauth/authorize", { ...authorization, owner_secret: "wrong" });
  assert.equal(wrongSecret.status, 403);
  const approval = { ...authorization, owner_secret: process.env.OAUTH_OWNER_SECRET! };
  assert.equal((await postForm("/oauth/authorize", approval, "https://other.example")).status, 403);
  const approved = await postForm("/oauth/authorize", approval);
  assert.equal(approved.status, 303);
  const callback = new URL(approved.headers.get("location")!);
  assert.equal(callback.origin + callback.pathname, redirectUri);
  assert.equal(callback.searchParams.get("state"), authorization.state);
  assert.equal(callback.searchParams.get("iss"), issuer);
  const code = callback.searchParams.get("code");
  assert.ok(code);

  const exchange = {
    grant_type: "authorization_code",
    client_id: authorization.client_id,
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
    resource
  };
  const approvedAgain = await postForm("/oauth/authorize", approval);
  assert.equal(approvedAgain.status, 303);
  const expiredCode = new URL(approvedAgain.headers.get("location")!).searchParams.get("code");
  assert.ok(expiredCode);
  const expiredCodeHash = createHash("sha256").update(expiredCode).digest("base64url");
  const codeExpiry = await db.execute({
    sql: "SELECT expires_at FROM oauth_grants WHERE code_hash = ?",
    args: [expiredCodeHash]
  });
  const remaining = Number(codeExpiry.rows[0]?.expires_at) - Math.floor(Date.now() / 1000);
  assert.ok(remaining > 0 && remaining <= 600);
  await db.execute({ sql: "UPDATE oauth_grants SET expires_at = 0 WHERE code_hash = ?", args: [expiredCodeHash] });
  const expiredExchange = await postForm("/oauth/token", { ...exchange, code: expiredCode });
  assert.equal(expiredExchange.status, 400);
  assert.equal((await expiredExchange.json()).error, "invalid_grant");

  const wrongVerifier = await postForm("/oauth/token", { ...exchange, code_verifier: "b".repeat(43) });
  assert.equal(wrongVerifier.status, 400);
  assert.equal((await wrongVerifier.json()).error, "invalid_grant");
  const wrongTarget = await postForm("/oauth/token", { ...exchange, resource: issuer });
  assert.equal(wrongTarget.status, 400);
  assert.equal((await wrongTarget.json()).error, "invalid_target");
  const exchanges = await Promise.all([postForm("/oauth/token", exchange), postForm("/oauth/token", exchange)]);
  const accepted = exchanges.find((response) => response.ok);
  const replay = exchanges.find((response) => !response.ok);
  assert.equal(accepted?.status, 200);
  assert.equal(accepted.headers.get("cache-control"), "no-store");
  assert.equal(replay?.status, 400);
  assert.equal((await replay.json()).error, "invalid_grant");
  const tokens = await accepted.json();
  assert.equal(tokens.token_type, "Bearer");
  assert.equal(tokens.expires_in, 3600);

  const initialize = {
    jsonrpc: "2.0", id: 1, method: "initialize",
    params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "oauth-test", version: "1" } }
  };
  const assertChallenge = async (token?: string) => {
    const unauthorized = await postJson("/mcp", initialize, token);
    assert.equal(unauthorized.status, 401);
    assert.match(unauthorized.headers.get("www-authenticate") ?? "", /^Bearer /);
    assert.ok(unauthorized.headers.get("www-authenticate")?.includes(`resource_metadata="${issuer}${metadataPath}/mcp"`));
  };
  await assertChallenge();
  await assertChallenge("x".repeat(43));

  const initialized = await postJson("/mcp", initialize, tokens.access_token);
  assert.equal(initialized.status, 200);
  assert.equal((await initialized.json()).result.serverInfo.name, "discord-notify-bot");
  const sent = await postJson("/mcp", {
    jsonrpc: "2.0", id: 2, method: "tools/call",
    params: { name: "send_notification", arguments: { title: "OAuth integration test" } }
  }, tokens.access_token);
  assert.equal(sent.status, 200);
  const tool = (await sent.json()).result;
  assert.notEqual(tool.isError, true);
  const notification = JSON.parse(tool.content[0].text);
  assert.equal(notification.accepted, true);
  assert.equal(notification.agent, "chatgpt");
  assert.equal(notification.threadName, "chatgpt");
  assert.equal((await postJson("/api/v1/notifications", { title: "OAuth REST" }, tokens.access_token)).status, 401);
  const legacy = await postJson("/api/v1/notifications", { title: "Legacy REST", status: "info" }, "tok_oauth_regression");
  assert.equal(legacy.status, 202);
  assert.equal((await legacy.json()).agent, "codex");

  await db.execute({ sql: "UPDATE oauth_grants SET resource = ? WHERE client_id = ?", args: [issuer, client.client_id] });
  await assertChallenge(tokens.access_token);
  await db.execute({
    sql: "UPDATE oauth_grants SET resource = ?, access_expires_at = 0 WHERE client_id = ?",
    args: [resource, client.client_id]
  });
  await assertChallenge(tokens.access_token);

  const refresh = { grant_type: "refresh_token", client_id: authorization.client_id, refresh_token: tokens.refresh_token, resource };
  const refreshed = await postForm("/oauth/token", refresh);
  assert.equal(refreshed.status, 200);
  const rotated = await refreshed.json();
  assert.notEqual(rotated.refresh_token, tokens.refresh_token);
  assert.equal((await postForm("/oauth/token", refresh)).status, 400);
  for (let count = 0; count < 3; count++) {
    const response = await postJson("/mcp", initialize, rotated.access_token);
    assert.equal(response.status, 200);
    await response.json();
  }
  assert.equal((await postJson("/mcp", initialize, rotated.access_token)).status, 429);
});
