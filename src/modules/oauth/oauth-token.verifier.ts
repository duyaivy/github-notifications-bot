import { InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { AgentTokenVerifier, AuthInfo } from "../auth/auth.types.js";
import { OAuthRepository, oauthScope } from "./oauth.repository.js";

export class OAuthAccessTokenVerifier implements AgentTokenVerifier {
  constructor(
    private readonly repository: OAuthRepository,
    private readonly fallback: AgentTokenVerifier,
    private readonly resource: URL
  ) {}

  isConfigured(): boolean {
    return true;
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    if (this.fallback.isConfigured()) {
      try {
        return await this.fallback.verifyAccessToken(token);
      } catch (error) {
        if (!(error instanceof InvalidTokenError)) throw error;
      }
    }
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
      throw new InvalidTokenError("Invalid bearer token");
    }
    const grant = await this.repository.findAccessToken(token).catch(() => {
      throw new Error("OAuth access token lookup failed");
    });
    if (!grant) {
      throw new InvalidTokenError("Invalid bearer token");
    }

    const clientId = String(grant.client_id);
    return {
      token,
      clientId,
      scopes: [oauthScope],
      resource: this.resource,
      expiresAt: Number(grant.access_expires_at),
      extra: { defaultAgent: "chatgpt", tokenId: `oauth:${clientId}` }
    };
  }
}
