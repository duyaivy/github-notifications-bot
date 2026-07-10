import { env } from "../../config/env.js";
import type { DiscordService } from "../discord/discord.service.js";
import type { RepoThreadRepository } from "./repo-thread.repository.js";
import type { RepoThread } from "./repo-thread.types.js";

export class RepoThreadService {
  public constructor(
    private readonly threads: RepoThreadRepository,
    private readonly discord: DiscordService
  ) {}

  public async findOrCreateThread(owner: string, repo: string): Promise<RepoThread> {
    const existing = await this.threads.findByRepository(owner, repo);
    if (existing) {
      return existing;
    }

    const thread = await this.discord.createThread({
      channelId: env.DISCORD_CHANNEL_ID,
      name: formatThreadName(owner, repo)
    });

    return this.threads.create(owner, repo, thread.id);
  }
}

function formatThreadName(owner: string, repo: string): string {
  const name = `${owner}/${repo}`.replace(/[\r\n\t]/g, " ").trim();
  return name.slice(0, 100) || "github-repository";
}
