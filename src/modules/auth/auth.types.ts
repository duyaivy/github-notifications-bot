import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { OAuthTokenVerifier } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AgentKey } from "../notification/notification.types.js";

export type { AuthInfo, OAuthTokenVerifier };

declare module "express-serve-static-core" {
  interface Request {
    auth?: AuthInfo;
  }
}

export interface AgentTokenVerifier extends OAuthTokenVerifier {
  isConfigured(): boolean;
}

export function extractDefaultAgent(authInfo: AuthInfo | undefined): AgentKey | undefined {
  const candidate = authInfo?.extra?.defaultAgent;
  return typeof candidate === "string" ? (candidate as AgentKey) : undefined;
}
