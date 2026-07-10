import pino from "pino";
import { env } from "../config/env.js";

const loggerOptions: pino.LoggerOptions = {
  level: env.LOG_LEVEL,
  redact: {
    paths: ["authorization", "headers.authorization", "DISCORD_BOT_TOKEN", "GITHUB_WEBHOOK_SECRET"],
    censor: "[redacted]"
  }
};

if (env.NODE_ENV === "development") {
  loggerOptions.transport = {
    target: "pino-pretty",
    options: {
      colorize: true,
      singleLine: true
    }
  };
}

export const logger = pino(loggerOptions);
