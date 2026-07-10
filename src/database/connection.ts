import fs from "node:fs";
import path from "node:path";
import { createClient, type Client } from "@libsql/client";
import { env } from "../config/env.js";

export type DatabaseClient = Client;

export function createDatabaseConnection(): DatabaseClient {
  const url = env.TURSO_DATABASE_URL ?? toLocalFileUrl(env.SQLITE_PATH);
  return createClient({
    url,
    ...(env.TURSO_AUTH_TOKEN ? { authToken: env.TURSO_AUTH_TOKEN } : {})
  });
}

export async function configureDatabase(db: DatabaseClient): Promise<void> {
  await db.execute("PRAGMA foreign_keys = ON");
}

export async function checkDatabaseReady(db: DatabaseClient): Promise<boolean> {
  const result = await db.execute("SELECT 1 AS ok");
  return Number(result.rows[0]?.ok) === 1;
}

function toLocalFileUrl(sqlitePath: string): string {
  const directory = path.dirname(sqlitePath);
  if (directory && directory !== ".") {
    fs.mkdirSync(directory, { recursive: true });
  }

  return sqlitePath.startsWith("file:") ? sqlitePath : `file:${sqlitePath}`;
}
