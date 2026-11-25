import { env } from "../../config/env.js";
import { DiscordApiError } from "./discord.errors.js";
import type {
  DiscordChannelInfo,
  DiscordCreateGuildChannelInput,
  DiscordCreateThreadBody,
  DiscordCreateThreadInput,
  DiscordEditMessageInput,
  DiscordMessage,
  DiscordSendMessageBody,
  DiscordSendMessageInput,
  DiscordThread
} from "./discord.types.js";

const discordApiBaseUrl = "https://discord.com/api/v10";
const discordContentLimit = 2000;
const maxArchivedThreadPages = 20;

export class DiscordService {
  public async getChannel(channelId: string): Promise<DiscordChannelInfo> {
    const response = await this.request(`${discordApiBaseUrl}/channels/${encodeURIComponent(channelId)}`, {
      method: "GET",
      headers: this.headers()
    });

    const parsed = (await response.json()) as unknown;
    const channel = parseDiscordChannel(parsed);
    if (!channel) {
      throw new DiscordApiError("Discord API returned an invalid channel response", { retryable: true, cause: parsed });
    }

    return channel;
  }

  public async listGuildChannels(guildId: string): Promise<DiscordChannelInfo[]> {
    const response = await this.request(`${discordApiBaseUrl}/guilds/${encodeURIComponent(guildId)}/channels`, {
      method: "GET",
      headers: this.headers()
    });

    const parsed = (await response.json()) as unknown;
    if (!Array.isArray(parsed)) {
      throw new DiscordApiError("Discord API returned an invalid guild channels response", {
        retryable: true,
        cause: parsed
      });
    }

    return parsed.map(parseDiscordChannel).filter((channel): channel is DiscordChannelInfo => channel !== null);
  }

  public async createGuildTextChannel(input: DiscordCreateGuildChannelInput): Promise<DiscordChannelInfo> {
    const body = {
      name: input.name,
      type: 0,
      ...(input.parentId ? { parent_id: input.parentId } : {}),
      ...(input.topic ? { topic: input.topic } : {})
    };

    const response = await this.request(`${discordApiBaseUrl}/guilds/${encodeURIComponent(input.guildId)}/channels`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body)
    });

    const parsed = (await response.json()) as unknown;
    const channel = parseDiscordChannel(parsed);
    if (!channel) {
      throw new DiscordApiError("Discord API returned an invalid created channel response", {
        retryable: true,
        cause: parsed
      });
    }

    return channel;
  }

  public async listActiveGuildThreads(guildId: string): Promise<DiscordThread[]> {
    const response = await this.request(`${discordApiBaseUrl}/guilds/${encodeURIComponent(guildId)}/threads/active`, {
      method: "GET",
      headers: this.headers()
    });

    const parsed = (await response.json()) as unknown;
    if (typeof parsed !== "object" || parsed === null || !("threads" in parsed) || !Array.isArray(parsed.threads)) {
      throw new DiscordApiError("Discord API returned an invalid active threads response", {
        retryable: true,
        cause: parsed
      });
    }

    return parsed.threads.map(parseDiscordThread).filter((thread): thread is DiscordThread => thread !== null);
  }

  public async listPublicArchivedThreads(channelId: string): Promise<DiscordThread[]> {
    const collected: DiscordThread[] = [];
    let before: string | undefined;

    for (let page = 0; page < maxArchivedThreadPages; page += 1) {
      const query = new URLSearchParams({ limit: "100" });
      if (before) {
        query.set("before", before);
      }

      const response = await this.request(
        `${discordApiBaseUrl}/channels/${encodeURIComponent(channelId)}/threads/archived/public?${query.toString()}`,
        {
          method: "GET",
          headers: this.headers()
        }
      );

      const parsed = (await response.json()) as unknown;
      if (typeof parsed !== "object" || parsed === null || !("threads" in parsed) || !Array.isArray(parsed.threads)) {
        throw new DiscordApiError("Discord API returned an invalid archived threads response", {
          retryable: true,
          cause: parsed
        });
      }

      const threads = parsed.threads.map(parseDiscordThread).filter((thread): thread is DiscordThread => thread !== null);
      collected.push(...threads);

      const hasMore = "has_more" in parsed && parsed.has_more === true;
      const nextBefore = threads.at(-1)?.archiveTimestamp;
      if (!hasMore || threads.length === 0 || !nextBefore || nextBefore === before) {
        break;
      }

      before = nextBefore;
    }

    return collected;
  }

  public async unarchiveThread(threadId: string): Promise<void> {
    await this.request(`${discordApiBaseUrl}/channels/${encodeURIComponent(threadId)}`, {
      method: "PATCH",
      headers: this.headers(),
      body: JSON.stringify({ archived: false })
    });
  }

  public async createThread(input: DiscordCreateThreadInput): Promise<DiscordThread> {
    const body: DiscordCreateThreadBody = {
      name: input.name,
      auto_archive_duration: 10080,
      type: 11
    };

    const response = await this.request(`${discordApiBaseUrl}/channels/${encodeURIComponent(input.channelId)}/threads`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body)
    });

    const parsed = (await response.json()) as unknown;
    const thread = parseDiscordThread(parsed);
    if (!thread) {
      throw new DiscordApiError("Discord API returned an invalid thread response", { retryable: true, cause: parsed });
    }

    return thread;
  }

  public async sendMessage(input: DiscordSendMessageInput): Promise<DiscordMessage> {
    if (!input.content && (!input.embeds || input.embeds.length === 0)) {
      throw new DiscordApiError("Discord message requires content or embeds", { retryable: false });
    }

    if (input.content && input.content.length > discordContentLimit) {
      throw new DiscordApiError("Discord message exceeds 2000 characters", { retryable: false });
    }

    const body: DiscordSendMessageBody = {
      ...(input.content ? { content: input.content } : {}),
      ...(input.embeds ? { embeds: input.embeds } : {}),
      allowed_mentions: {
        parse: []
      }
    };

    const response = await this.request(`${discordApiBaseUrl}/channels/${encodeURIComponent(input.channelId)}/messages`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body)
    });

    const parsed = (await response.json()) as { id: string; channel_id: string };
    return {
      id: String(parsed.id),
      channelId: String(parsed.channel_id)
    };
  }

  public async editMessage(input: DiscordEditMessageInput): Promise<DiscordMessage | null> {
    if (!input.content && (!input.embeds || input.embeds.length === 0)) {
      throw new DiscordApiError("Discord message requires content or embeds", { retryable: false });
    }

    if (input.content && input.content.length > discordContentLimit) {
      throw new DiscordApiError("Discord message exceeds 2000 characters", { retryable: false });
    }

    const body = {
      ...(input.content !== undefined ? { content: input.content } : {}),
      ...(input.embeds !== undefined ? { embeds: input.embeds } : {}),
      allowed_mentions: {
        parse: []
      }
    };

    try {
      const response = await this.request(
        `${discordApiBaseUrl}/channels/${encodeURIComponent(input.channelId)}/messages/${encodeURIComponent(input.messageId)}`,
        {
          method: "PATCH",
          headers: this.headers(),
          body: JSON.stringify(body)
        }
      );

      const parsed = (await response.json()) as { id: string; channel_id: string };
      return {
        id: String(parsed.id),
        channelId: String(parsed.channel_id)
      };
    } catch (error) {
      if (error instanceof DiscordApiError && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  private headers(): Record<string, string> {
    return {
      authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
      "content-type": "application/json"
    };
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      throw new DiscordApiError("Discord network request failed", { retryable: true, cause: error });
    }

    if (!response.ok) {
      const safeBody = await readSafeResponseBody(response);
      const retryAfterMs = getRetryAfterMs(response, safeBody);
      const retryable = response.status === 429 || response.status >= 500;
      const permanentPermissionFailure = response.status === 403 || response.status === 404;

      throw new DiscordApiError(`Discord API returned ${response.status}${permanentPermissionFailure ? " for destination" : ""}`, {
        status: response.status,
        retryable,
        ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
        cause: safeBody
      });
    }

    return response;
  }
}

function parseDiscordChannel(value: unknown): DiscordChannelInfo | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.type !== "number") {
    return null;
  }

  return {
    id: record.id,
    name: typeof record.name === "string" ? record.name : "",
    type: record.type,
    ...(typeof record.guild_id === "string" ? { guildId: record.guild_id } : {}),
    ...(record.parent_id === null || typeof record.parent_id === "string" ? { parentId: record.parent_id } : {})
  };
}

function parseDiscordThread(value: unknown): DiscordThread | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.name !== "string") {
    return null;
  }

  const metadata =
    typeof record.thread_metadata === "object" && record.thread_metadata !== null
      ? (record.thread_metadata as Record<string, unknown>)
      : null;

  return {
    id: record.id,
    name: record.name,
    ...(record.parent_id === null || typeof record.parent_id === "string" ? { parentId: record.parent_id } : {}),
    ...(typeof metadata?.archived === "boolean" ? { archived: metadata.archived } : {}),
    ...(typeof metadata?.locked === "boolean" ? { locked: metadata.locked } : {}),
    ...(typeof metadata?.archive_timestamp === "string" ? { archiveTimestamp: metadata.archive_timestamp } : {})
  };
}

async function readSafeResponseBody(response: Response): Promise<string> {
  const text = await response.text();
  return text.slice(0, 1000);
}

function getRetryAfterMs(response: Response, body: string): number | undefined {
  const retryAfterHeader = response.headers.get("retry-after");
  if (retryAfterHeader) {
    const seconds = Number(retryAfterHeader);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.ceil(seconds * 1000);
    }
  }

  try {
    const parsed = JSON.parse(body) as unknown;
    if (typeof parsed === "object" && parsed !== null && "retry_after" in parsed) {
      const retryAfter = (parsed as { retry_after?: unknown }).retry_after;
      if (typeof retryAfter === "number" && Number.isFinite(retryAfter) && retryAfter > 0) {
        return Math.ceil(retryAfter * 1000);
      }
    }
  } catch {
    return undefined;
  }

  return undefined;
}
