import type Database from "better-sqlite3";
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
  public constructor(private readonly db: Database.Database) {}

  public findByRepository(owner: string, repo: string): RepoThread | null {
    const row = this.db
      .prepare(
        `
        SELECT id, owner, repo, discord_thread_id, created_at, updated_at
        FROM repo_threads
        WHERE owner = ? AND repo = ?
        LIMIT 1
      `
      )
      .get(owner, repo) as RepoThreadRow | undefined;

    return row ? mapThread(row) : null;
  }

  public create(owner: string, repo: string, discordThreadId: string): RepoThread {
    const now = new Date().toISOString();

    this.db
      .prepare(
        `
        INSERT INTO repo_threads (owner, repo, discord_thread_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `
      )
      .run(owner, repo, discordThreadId, now, now);

    const thread = this.findByRepository(owner, repo);
    if (!thread) {
      throw new Error("Failed to create repository thread mapping");
    }

    return thread;
  }
}
