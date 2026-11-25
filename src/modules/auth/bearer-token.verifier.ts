import crypto from "node:crypto";
import { InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { normalizeAgentKey } from "../agent-notify/agent-notify.types.js";
import type { AgentKey } from "../notification/notification.types.js";
import type { AgentTokenVerifier, AuthInfo } from "./auth.types.js";

interface ConfiguredBearerToken {
  digest: Buffer;
  tokenId: string;
  clientId: string;
  defaultAgent?: AgentKey;
}

export function parseAgentApiTokens(rawTokens: string | undefined): ConfiguredBearerToken[] {
  if (!rawTokens) {
    return [];
  }

  const parsed: ConfiguredBearerToken[] = [];
  for (const item of rawTokens.split(",")) {
    const trimmed = item.trim();
    if (!trimmed) {
      continue;
    }

    let token = trimmed;
    let defaultAgent: AgentKey | undefined;

    const colonIndex = trimmed.indexOf(":");
    if (colonIndex > 0 && colonIndex < trimmed.length - 1) {
      const prefix = trimmed.slice(0, colonIndex).trim();
      const remainder = trimmed.slice(colonIndex + 1).trim();
      const normalized = /^[a-zA-Z0-9._-]+$/.test(prefix) ? normalizeAgentKey(prefix) : null;
      if (normalized && remainder.length > 0) {
        defaultAgent = normalized;
        token = remainder;
      }
    }

    const digest = sha256Digest(token);
    const tokenId = digest.subarray(0, 8).toString("hex");
    parsed.push({
      digest,
      tokenId,
      clientId: defaultAgent ? `agent:${defaultAgent}` : "bearer-client",
      ...(defaultAgent ? { defaultAgent } : {})
    });
  }

  return parsed;
}

export class StaticBearerTokenVerifier implements AgentTokenVerifier {
  private readonly tokens: ConfiguredBearerToken[];

  public constructor(rawTokens: string | undefined) {
    this.tokens = parseAgentApiTokens(rawTokens);
  }

  public isConfigured(): boolean {
    return this.tokens.length > 0;
  }

  public async verifyAccessToken(token: string): Promise<AuthInfo> {
    if (!this.isConfigured()) {
      throw new InvalidTokenError("Agent API authentication is not configured");
    }

    const candidateDigest = sha256Digest(token);
    let matched: ConfiguredBearerToken | null = null;

    // Compare every configured token hash without short-circuiting.
    for (const entry of this.tokens) {
      if (candidateDigest.length === entry.digest.length && crypto.timingSafeEqual(candidateDigest, entry.digest)) {
        matched = entry;
      }
    }

    if (!matched) {
      throw new InvalidTokenError("Invalid bearer token");
    }

    return {
      token: matched.tokenId,
      clientId: matched.clientId,
      scopes: ["notify:write", "notify:read"],
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      extra: {
        tokenId: matched.tokenId,
        ...(matched.defaultAgent ? { defaultAgent: matched.defaultAgent } : {})
      }
    };
  }
}

function sha256Digest(value: string): Buffer {
  return crypto.createHash("sha256").update(value, "utf8").digest();
}
