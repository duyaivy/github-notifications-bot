import type { ResultSet } from "@libsql/client";
import type { DatabaseClient } from "../../database/connection.js";
import type { RepoThread } from "./repo-thread.types.js";

interface RepoThreadRow {
  id: number;
  owner: string;
  repo: string;
  discord_thread_id: string;
  created_at: string;
  updated_at: string;
}

function mapThread(row: RepoThreadRow): RepoThread {
  return {
    id: row.id,
    owner: row.owner,
    repo: row.repo,
    discordThreadId: row.discord_thread_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class RepoThreadRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public async findByRepository(owner: string, repo: string): Promise<RepoThread | null> {
    const result = await this.db.execute({
      sql: `
        SELECT id, owner, repo, discord_thread_id, created_at, updated_at
        FROM repo_threads
        WHERE owner = ? AND repo = ?
        LIMIT 1
      `,
      args: [owner, repo]
    });

    const row = result.rows[0];
    return row ? mapThread(toRepoThreadRow(row)) : null;
  }

  public async create(owner: string, repo: string, discordThreadId: string): Promise<RepoThread> {
    const now = new Date().toISOString();

    await this.db.execute({
      sql: `
        INSERT INTO repo_threads (owner, repo, discord_thread_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `,
      args: [owner, repo, discordThreadId, now, now]
    });

    const thread = await this.findByRepository(owner, repo);
    if (!thread) {
      throw new Error("Failed to create repository thread mapping");
    }

    return thread;
  }
}

function toRepoThreadRow(row: ResultSet["rows"][number]): RepoThreadRow {
  return {
    id: Number(row.id),
    owner: String(row.owner),
    repo: String(row.repo),
    discord_thread_id: String(row.discord_thread_id),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at)
  };
}
