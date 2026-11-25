import type { RequestHandler } from "express";
import { InsufficientScopeError, InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { AgentTokenVerifier } from "./auth.types.js";

export interface AgentAuthMiddlewareOptions {
  verifier: AgentTokenVerifier;
  requiredScopes?: string[];
  resourceMetadataUrl?: string;
}

export function createAgentAuthMiddleware({
  verifier,
  requiredScopes = [],
  resourceMetadataUrl
}: AgentAuthMiddlewareOptions): RequestHandler {
  return async (req, res, next) => {
    if (!verifier.isConfigured()) {
      res.status(503).json({
        error: {
          message: "Agent API authentication is not configured"
        }
      });
      return;
    }

    try {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        throw new InvalidTokenError("Missing Authorization header");
      }

      const parts = authHeader.trim().split(/\s+/);
      if (parts.length !== 2 || parts[0]?.toLowerCase() !== "bearer" || !parts[1]) {
        throw new InvalidTokenError("Invalid Authorization header format; expected Bearer token");
      }

      const authInfo = await verifier.verifyAccessToken(parts[1]);

      if (typeof authInfo.expiresAt === "number" && authInfo.expiresAt < Date.now() / 1000) {
        throw new InvalidTokenError("Token has expired");
      }

      if (requiredScopes.length > 0) {
        const hasAllScopes = requiredScopes.every((scope) => authInfo.scopes.includes(scope));
        if (!hasAllScopes) {
          throw new InsufficientScopeError("Insufficient scope");
        }
      }

      req.auth = authInfo;
      next();
    } catch (error) {
      if (error instanceof InvalidTokenError) {
        res.set("WWW-Authenticate", buildWwwAuthenticate("invalid_token", error.message, requiredScopes, resourceMetadataUrl));
        res.status(401).json({ error: { message: error.message } });
        return;
      }

      if (error instanceof InsufficientScopeError) {
        res.set("WWW-Authenticate", buildWwwAuthenticate("insufficient_scope", error.message, requiredScopes, resourceMetadataUrl));
        res.status(403).json({ error: { message: error.message } });
        return;
      }

      next(error);
    }
  };
}

function buildWwwAuthenticate(
  errorCode: string,
  description: string,
  scopes: string[],
  resourceMetadataUrl?: string
): string {
  const safeDescription = description.replace(/["\\\r\n]/g, "");
  let header = `Bearer realm="notify-bot", error="${errorCode}", error_description="${safeDescription}"`;
  if (scopes.length > 0) {
    header += `, scope="${scopes.join(" ")}"`;
  }
  if (resourceMetadataUrl) {
    header += `, resource_metadata="${resourceMetadataUrl}"`;
  }
  return header;
}
