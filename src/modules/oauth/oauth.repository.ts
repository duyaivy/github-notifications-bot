import { createHash, randomBytes } from "node:crypto";
import type { DatabaseClient } from "../../database/connection.js";

const CODE_TTL = 600;
const ACCESS_TTL = 3600;
const REFRESH_TTL = 30 * 24 * 3600;

export const oauthScope = "mcp";
export const hash = (value: string) => createHash("sha256").update(value).digest("base64url");
const randomToken = () => randomBytes(32).toString("base64url");
const nowInSeconds = () => Math.floor(Date.now() / 1000);

export class OAuthRepository {
  constructor(private readonly db: DatabaseClient, private readonly resource: string) {}

  async registerClient(redirectUris: string[]): Promise<string> {
    const clientId = randomToken();
    await this.db.execute({
      sql: "INSERT INTO oauth_clients (client_id, redirect_uris) VALUES (?, ?)",
      args: [clientId, JSON.stringify(redirectUris)]
    });
    return clientId;
  }

  async hasRedirect(clientId: string, redirectUri: string): Promise<boolean> {
    const { rows } = await this.db.execute({
      sql: "SELECT redirect_uris FROM oauth_clients WHERE client_id = ?",
      args: [clientId]
    });
    const redirects = rows[0]?.redirect_uris;
    return typeof redirects === "string" && (JSON.parse(redirects) as string[]).includes(redirectUri);
  }

  async issueCode(clientId: string, redirectUri: string, challenge: string): Promise<string> {
    const code = randomToken();
    const now = nowInSeconds();
    await this.db.batch([
      { sql: "DELETE FROM oauth_grants WHERE expires_at <= ?", args: [now] },
      {
        sql: `INSERT INTO oauth_grants (id, client_id, redirect_uri, resource, challenge, code_hash, expires_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [randomToken(), clientId, redirectUri, this.resource, challenge, hash(code), now + CODE_TTL]
      }
    ], "write");
    return code;
  }

  async exchange(clientId: string, grant: { code: string; redirectUri: string; verifier: string } | { refreshToken: string }) {
    const accessToken = randomToken();
    const refreshToken = randomToken();
    const now = nowInSeconds();
    // A single conditional update consumes the credential even with simultaneous requests.
    const byCode = "code" in grant;
    const { rowsAffected } = await this.db.execute({
      sql: `UPDATE oauth_grants
            SET code_hash = NULL, access_hash = ?, refresh_hash = ?, access_expires_at = ?, expires_at = ?
            WHERE client_id = ? AND resource = ? AND expires_at > ? AND ${byCode
              ? "code_hash = ? AND redirect_uri = ? AND challenge = ?"
              : "refresh_hash = ?"}`,
      args: [
        hash(accessToken), hash(refreshToken), now + ACCESS_TTL, now + REFRESH_TTL,
        clientId, this.resource, now,
        ...(byCode ? [hash(grant.code), grant.redirectUri, hash(grant.verifier)] : [hash(grant.refreshToken)])
      ]
    });
    if (rowsAffected !== 1) return null;
    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: "Bearer",
      expires_in: ACCESS_TTL,
      scope: oauthScope
    };
  }

  async findAccessToken(token: string) {
    const { rows } = await this.db.execute({
      sql: `SELECT client_id, access_expires_at FROM oauth_grants
            WHERE access_hash = ? AND resource = ? AND access_expires_at > ?`,
      args: [hash(token), this.resource, nowInSeconds()]
    });
    return rows[0];
  }
}
