import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { env } from "../config/env.js";

export function createDatabaseConnection(sqlitePath = env.SQLITE_PATH): Database.Database {
  const directory = path.dirname(sqlitePath);
  if (directory && directory !== ".") {
    fs.mkdirSync(directory, { recursive: true });
  }

  const db = new Database(sqlitePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  return db;
}

export function checkDatabaseReady(db: Database.Database): boolean {
  const row = db.prepare("SELECT 1 AS ok").get() as { ok: number } | undefined;
  return row?.ok === 1;
}
