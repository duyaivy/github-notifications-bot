import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabaseConnection } from "./connection.js";
import { logger } from "../common/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const currentFile = fileURLToPath(import.meta.url);

export function runMigrations(): void {
  const db = createDatabaseConnection();
  db.exec(`
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

  const migration = db.transaction((file: string) => {
    const alreadyApplied = db
      .prepare("SELECT id FROM schema_migrations WHERE id = ?")
      .get(file);
    if (alreadyApplied) {
      return false;
    }

    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    db.exec(sql);
    db.prepare("INSERT INTO schema_migrations (id) VALUES (?)").run(file);
    return true;
  });

  for (const file of migrationFiles) {
    const applied = migration(file);
    if (applied) {
      logger.info({ migration: file }, "applied database migration");
    }
  }

  db.close();
}

if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  runMigrations();
}
