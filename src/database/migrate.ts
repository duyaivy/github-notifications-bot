import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { configureDatabase, createDatabaseConnection } from "./connection.js";
import { logger } from "../common/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const currentFile = fileURLToPath(import.meta.url);

export async function runMigrations(): Promise<void> {
  const db = createDatabaseConnection();
  await configureDatabase(db);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);

  const migrationsDir = path.join(__dirname, "migrations");
  const migrationFiles = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of migrationFiles) {
    const transaction = await db.transaction("write");
    try {
      const alreadyApplied = await transaction.execute({
        sql: "SELECT id FROM schema_migrations WHERE id = ?",
        args: [file]
      });

      if (alreadyApplied.rows.length > 0) {
        await transaction.commit();
        continue;
      }

      const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
      for (const statement of splitSqlStatements(sql)) {
        await transaction.execute(statement);
      }

      await transaction.execute({
        sql: "INSERT INTO schema_migrations (id) VALUES (?)",
        args: [file]
      });
      await transaction.commit();
      logger.info({ migration: file }, "applied database migration");
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  db.close();
}

if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  await runMigrations();
}

function splitSqlStatements(sql: string): string[] {
  return sql
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}
