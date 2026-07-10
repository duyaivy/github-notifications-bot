import { env } from "../../config/env.js";
import { DiscordApiError } from "./discord.errors.js";
import type {
  DiscordCreateThreadBody,
  DiscordCreateThreadInput,
  DiscordSendMessageBody,
  DiscordSendMessageInput,
  DiscordThread
} from "./discord.types.js";

const discordApiBaseUrl = "https://discord.com/api/v10";
const discordContentLimit = 2000;

export class DiscordService {
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
    if (!isDiscordThread(parsed)) {
      throw new DiscordApiError("Discord API returned an invalid thread response", { retryable: true, cause: parsed });
    }

    return parsed;
  }

  public async sendMessage(input: DiscordSendMessageInput): Promise<void> {
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

    await this.request(`${discordApiBaseUrl}/channels/${encodeURIComponent(input.channelId)}/messages`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body)
    });
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

function isDiscordThread(value: unknown): value is DiscordThread {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof (value as { id?: unknown }).id === "string" &&
    "name" in value &&
    typeof (value as { name?: unknown }).name === "string"
  );
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
