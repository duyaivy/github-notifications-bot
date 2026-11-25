import type { ResultSet } from "@libsql/client";
import type { DatabaseClient } from "../../database/connection.js";
import type { AgentThread } from "./agent-thread.types.js";

interface AgentThreadRow {
  id: number;
  agent_key: string;
  discord_channel_id: string;
  discord_thread_id: string;
  created_at: string;
  updated_at: string;
}

function mapThread(row: AgentThreadRow): AgentThread {
  return {
    id: row.id,
    agentKey: row.agent_key,
    discordChannelId: row.discord_channel_id,
    discordThreadId: row.discord_thread_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class AgentThreadRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public async getSetting(key: string): Promise<string | null> {
    const result = await this.db.execute({
      sql: "SELECT value FROM app_settings WHERE key = ? LIMIT 1",
      args: [key]
    });

    const row = result.rows[0];
    return row ? String(row.value) : null;
  }

  public async setSetting(key: string, value: string): Promise<void> {
    const now = new Date().toISOString();
    await this.db.execute({
      sql: `
        INSERT INTO app_settings (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `,
      args: [key, value, now]
    });
  }

  public async deleteSetting(key: string): Promise<void> {
    await this.db.execute({
      sql: "DELETE FROM app_settings WHERE key = ?",
      args: [key]
    });
  }

  public async findByAgent(agentKey: string): Promise<AgentThread | null> {
    const result = await this.db.execute({
      sql: `
        SELECT id, agent_key, discord_channel_id, discord_thread_id, created_at, updated_at
        FROM agent_threads
        WHERE agent_key = ?
        LIMIT 1
      `,
      args: [agentKey]
    });

    const row = result.rows[0];
    return row ? mapThread(toAgentThreadRow(row)) : null;
  }

  public async listAll(): Promise<AgentThread[]> {
    const result = await this.db.execute(`
      SELECT id, agent_key, discord_channel_id, discord_thread_id, created_at, updated_at
      FROM agent_threads
      ORDER BY agent_key ASC
    `);

    return result.rows.map((row) => mapThread(toAgentThreadRow(row)));
  }

  public async upsert(agentKey: string, discordChannelId: string, discordThreadId: string): Promise<AgentThread> {
    const now = new Date().toISOString();
    await this.db.execute({
      sql: `
        INSERT INTO agent_threads (agent_key, discord_channel_id, discord_thread_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(agent_key) DO UPDATE SET
          discord_channel_id = excluded.discord_channel_id,
          discord_thread_id = excluded.discord_thread_id,
          updated_at = excluded.updated_at
      `,
      args: [agentKey, discordChannelId, discordThreadId, now, now]
    });

    const thread = await this.findByAgent(agentKey);
    if (!thread) {
      throw new Error("Failed to store agent thread mapping");
    }

    return thread;
  }

  public async deleteByAgent(agentKey: string): Promise<void> {
    await this.db.execute({
      sql: "DELETE FROM agent_threads WHERE agent_key = ?",
      args: [agentKey]
    });
  }
}

function toAgentThreadRow(row: ResultSet["rows"][number]): AgentThreadRow {
  return {
    id: Number(row.id),
    agent_key: String(row.agent_key),
    discord_channel_id: String(row.discord_channel_id),
    discord_thread_id: String(row.discord_thread_id),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at)
  };
}
