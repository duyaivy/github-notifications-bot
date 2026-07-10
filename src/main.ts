import { env } from "./config/env.js";
import { createApp } from "./app.js";
import { logger } from "./common/logger.js";
import { toSafeError } from "./common/errors.js";
import { createDatabaseConnection } from "./database/connection.js";
import { runMigrations } from "./database/migrate.js";
import { DiscordService } from "./modules/discord/discord.service.js";
import { NotificationService } from "./modules/notification/notification.service.js";
import { QueueRepository } from "./modules/queue/queue.repository.js";
import { QueueService } from "./modules/queue/queue.service.js";
import { QueueWorker } from "./modules/queue/queue.worker.js";
import { RepoThreadRepository } from "./modules/repo-thread/repo-thread.repository.js";
import { RepoThreadService } from "./modules/repo-thread/repo-thread.service.js";

runMigrations();

const db = createDatabaseConnection();
const app = createApp(db);

const queue = new QueueService(new QueueRepository(db));
const discord = new DiscordService();
const threads = new RepoThreadService(new RepoThreadRepository(db), discord);
const notifications = new NotificationService(threads, discord);
const worker = new QueueWorker(queue, notifications);

let shuttingDown = false;
let closeServerPromise: Promise<void> | null = null;

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, "http server listening");
});

const workerRun = worker.run().catch((error) => {
  logger.error({ error: toSafeError(error) }, "queue worker crashed");
  process.exitCode = 1;
  shutdown("SIGTERM");
});

function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  logger.info({ signal }, "application shutdown requested");
  worker.requestStop();
  void closeServer();
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

await workerRun;
await closeServer();

db.close();
logger.info("application shutdown complete");

function closeServer(): Promise<void> {
  if (closeServerPromise) {
    return closeServerPromise;
  }

  closeServerPromise = new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }

    server.close((error) => {
      if (error) {
        logger.error({ error: toSafeError(error) }, "error while closing http server");
        process.exitCode = 1;
      }
      resolve();
    });
  });

  return closeServerPromise;
}
