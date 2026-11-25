import { AppError } from "../../common/errors.js";
import { logger } from "../../common/logger.js";
import { env } from "../../config/env.js";
import { DiscordApiError } from "../discord/discord.errors.js";
import type { DiscordService } from "../discord/discord.service.js";
import type { DiscordThread } from "../discord/discord.types.js";
import type { AgentThreadRepository } from "./agent-thread.repository.js";
import type { AgentThread, AgentThreadConfig } from "./agent-thread.types.js";

const agentChannelSettingKey = "agent_channel_id";
const guildSettingKey = "discord_guild_id";

export class AgentThreadService {
  private cachedChannelId: string | null = null;
  private cachedGuildId: string | null = null;
  private channelResolutionPromise: Promise<string> | null = null;
  private readonly pendingThreads = new Map<string, Promise<AgentThread>>();

  public constructor(
    private readonly threads: AgentThreadRepository,
    private readonly discord: DiscordService,
    private readonly config: AgentThreadConfig = {
      githubChannelId: env.DISCORD_CHANNEL_ID,
      guildId: env.DISCORD_GUILD_ID,
      agentChannelId: env.DISCORD_AGENT_CHANNEL_ID,
      agentChannelName: env.DISCORD_AGENT_CHANNEL_NAME
    }
  ) {}

  public async resolveAgentChannelId(): Promise<string> {
    if (this.config.agentChannelId) {
      return this.config.agentChannelId;
    }

    if (this.cachedChannelId) {
      return this.cachedChannelId;
    }

    if (!this.channelResolutionPromise) {
      this.channelResolutionPromise = this.doResolveAgentChannelId().finally(() => {
        this.channelResolutionPromise = null;
      });
    }

    return this.channelResolutionPromise;
  }

  public async findOrCreateThread(agentKey: string): Promise<AgentThread> {
    const existingPending = this.pendingThreads.get(agentKey);
    if (existingPending) {
      return existingPending;
    }

    const promise = this.doFindOrCreateThread(agentKey).finally(() => {
      this.pendingThreads.delete(agentKey);
    });
    this.pendingThreads.set(agentKey, promise);
    return promise;
  }

  public async invalidateThread(agentKey: string): Promise<void> {
    await this.threads.deleteByAgent(agentKey);
  }

  private async doResolveAgentChannelId(): Promise<string> {
    const storedChannelId = await this.threads.getSetting(agentChannelSettingKey);
    if (storedChannelId) {
      this.cachedChannelId = storedChannelId;
      return storedChannelId;
    }

    const baseChannel = await this.discord.getChannel(this.config.githubChannelId);
    const guildId = baseChannel.guildId ?? this.config.guildId ?? (await this.threads.getSetting(guildSettingKey));
    if (!guildId) {
      throw new AppError("Unable to determine Discord guild ID; set DISCORD_GUILD_ID", { retryable: false });
    }

    this.cachedGuildId = guildId;
    await this.threads.setSetting(guildSettingKey, guildId);

    const targetName = normalizeDiscordChannelName(this.config.agentChannelName);
    const channels = await this.discord.listGuildChannels(guildId);
    const textChannels = channels.filter((ch) => (ch.type === 0 || ch.type === 5) && ch.name.toLowerCase() === targetName);

    const matchedChannel =
      textChannels.find((ch) => (ch.parentId ?? null) === (baseChannel.parentId ?? null)) ?? textChannels[0];

    if (matchedChannel) {
      await this.threads.setSetting(agentChannelSettingKey, matchedChannel.id);
      this.cachedChannelId = matchedChannel.id;
      logger.info(
        { agentChannelId: matchedChannel.id, agentChannelName: matchedChannel.name, guildId },
        "reused existing Discord channel for AI notifications"
      );
      return matchedChannel.id;
    }

    const created = await this.discord.createGuildTextChannel({
      guildId,
      name: targetName,
      ...(baseChannel.parentId ? { parentId: baseChannel.parentId } : {}),
      topic: "AI agent notifications (one fixed thread per AI platform)"
    });

    await this.threads.setSetting(agentChannelSettingKey, created.id);
    this.cachedChannelId = created.id;
    logger.info(
      { agentChannelId: created.id, agentChannelName: created.name, parentId: baseChannel.parentId ?? null, guildId },
      "created Discord channel for AI notifications"
    );
    return created.id;
  }

  private async doFindOrCreateThread(agentKey: string, allowChannelRecovery = true): Promise<AgentThread> {
    const channelId = await this.resolveAgentChannelId();
    const existingRow = await this.threads.findByAgent(agentKey);
    if (existingRow && existingRow.discordChannelId === channelId) {
      return existingRow;
    }

    try {
      const existingDiscordThread = await this.findExistingDiscordThread(channelId, agentKey);
      if (existingDiscordThread) {
        if (existingDiscordThread.archived && existingDiscordThread.locked) {
          await this.discord.unarchiveThread(existingDiscordThread.id);
        }
        return this.threads.upsert(agentKey, channelId, existingDiscordThread.id);
      }

      const created = await this.discord.createThread({
        channelId,
        name: agentKey
      });

      return this.threads.upsert(agentKey, channelId, created.id);
    } catch (error) {
      // Recover if a cached auto-resolved channel was deleted on Discord
      if (allowChannelRecovery && !this.config.agentChannelId && error instanceof DiscordApiError && error.status === 404) {
        await this.invalidateAutoChannel();
        return this.doFindOrCreateThread(agentKey, false);
      }
      throw error;
    }
  }

  private async findExistingDiscordThread(channelId: string, agentKey: string): Promise<DiscordThread | null> {
    const guildId = await this.resolveGuildId(channelId);
    const activeThreads = await this.discord.listActiveGuildThreads(guildId);
    const activeMatch = activeThreads.find(
      (thread) => thread.parentId === channelId && normalizeThreadName(thread.name) === agentKey
    );
    if (activeMatch) {
      return activeMatch;
    }

    try {
      const archivedThreads = await this.discord.listPublicArchivedThreads(channelId);
      return archivedThreads.find((thread) => normalizeThreadName(thread.name) === agentKey) ?? null;
    } catch (error) {
      if (error instanceof DiscordApiError && error.status === 403) {
        logger.warn({ channelId, agentKey }, "bot lacks Read Message History to scan archived Discord threads");
        return null;
      }
      throw error;
    }
  }

  private async resolveGuildId(channelId: string): Promise<string> {
    if (this.cachedGuildId) {
      return this.cachedGuildId;
    }

    if (this.config.guildId) {
      this.cachedGuildId = this.config.guildId;
      return this.config.guildId;
    }

    const storedGuildId = await this.threads.getSetting(guildSettingKey);
    if (storedGuildId) {
      this.cachedGuildId = storedGuildId;
      return storedGuildId;
    }

    const channel = await this.discord.getChannel(channelId);
    if (!channel.guildId) {
      throw new AppError("Unable to determine Discord guild ID; set DISCORD_GUILD_ID", { retryable: false });
    }

    this.cachedGuildId = channel.guildId;
    await this.threads.setSetting(guildSettingKey, channel.guildId);
    return channel.guildId;
  }

  private async invalidateAutoChannel(): Promise<void> {
    this.cachedChannelId = null;
    await this.threads.deleteSetting(agentChannelSettingKey);
  }
}

export function normalizeDiscordChannelName(rawName: string): string {
  const slug = rawName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100);

  return slug || "ai-notifications";
}

function normalizeThreadName(name: string): string {
  return name.trim().toLowerCase();
}
