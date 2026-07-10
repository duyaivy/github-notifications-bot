import "dotenv/config";
import { z } from "zod";

const optionalNonEmptyString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional()
);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3000),
  SQLITE_PATH: z.string().min(1).default("./data/app.db"),
  TURSO_DATABASE_URL: optionalNonEmptyString,
  TURSO_AUTH_TOKEN: optionalNonEmptyString,
  GITHUB_WEBHOOK_SECRET: z.string().min(1, "GITHUB_WEBHOOK_SECRET is required"),
  DISCORD_BOT_TOKEN: z.string().min(1, "DISCORD_BOT_TOKEN is required"),
  DISCORD_CHANNEL_ID: z.string().min(1, "DISCORD_CHANNEL_ID is required"),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(2000),
  WORKER_BATCH_SIZE: z.coerce.number().int().positive().max(100).default(10),
  WORKER_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  WORKER_STALE_JOB_TIMEOUT_MS: z.coerce.number().int().positive().default(300000),
  LOG_LEVEL: z.string().min(1).default("info")
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const messages = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  throw new Error(`Invalid environment configuration: ${messages.join("; ")}`);
}

export const env = parsed.data;
export type Env = typeof env;
