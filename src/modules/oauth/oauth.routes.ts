import { createHash, timingSafeEqual } from "node:crypto";
import express, { type ErrorRequestHandler } from "express";
import { z } from "zod";
import { asyncHandler } from "../../common/async-handler.js";
import { logger } from "../../common/logger.js";
import { createRateLimitMiddleware } from "../auth/rate-limit.middleware.js";
import { hash, OAuthRepository, oauthScope } from "./oauth.repository.js";
import { ownerFormStyles } from "./owner-form.styles.js";

const protectedResourcePath = "/.well-known/oauth-protected-resource";
export const mcpMetadataPath = `${protectedResourcePath}/mcp`;
const authorizationPath = "/oauth/authorize";
const oauthCsp = "default-src 'none'; frame-ancestors 'none'; form-action 'self' https://chatgpt.com";
const ownerFormCsp = `${oauthCsp}; style-src 'sha256-${createHash("sha256").update(ownerFormStyles).digest("base64")}'`;
const grants = ["authorization_code", "refresh_token"] as const;
type ApprovalDenial = "origin_mismatch" | "secret_missing" | "secret_mismatch";
const nonempty = z.string().min(1).max(2048);
const registration = z.object({
  redirect_uris: z.array(z.string().regex(
    /^https:\/\/chatgpt\.com\/(?:connector_platform_oauth_redirect|connector\/oauth\/[A-Za-z0-9_-]+)$/
  )).min(1).max(10),
  token_endpoint_auth_method: z.literal("none").default("none"),
  grant_types: z.array(z.enum(grants)).min(1).max(2).default([...grants])
    .refine((types) => types.includes("authorization_code")),
  response_types: z.tuple([z.literal("code")]).default(["code"]),
  scope: z.literal(oauthScope).optional()
});
const authorizationClient = z.object({
  client_id: nonempty,
  redirect_uri: nonempty,
  state: nonempty.optional()
});
const authorization = z.object({
  response_type: z.literal("code"),
  code_challenge_method: z.literal("S256"),
  code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  resource: nonempty.optional(),
  scope: z.literal(oauthScope).optional()
});
const tokenRequest = z.discriminatedUnion("grant_type", [
  z.object({
    grant_type: z.literal("authorization_code"),
    client_id: nonempty,
    code: nonempty,
    redirect_uri: nonempty,
    code_verifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
    resource: nonempty.optional()
  }),
  z.object({
    grant_type: z.literal("refresh_token"),
    client_id: nonempty,
    refresh_token: nonempty,
    resource: nonempty.optional(),
    scope: z.literal(oauthScope).optional()
  })
]);

export function createOAuthRoutes(repository: OAuthRepository, issuer: string, resource: string, ownerSecret: string) {
  const router = express.Router();
  const ownerHash = Buffer.from(hash(ownerSecret.trim()));
  const scopes = [oauthScope];

  router.get([protectedResourcePath, mcpMetadataPath], (_req, res) => {
    res.json({
      resource,
      authorization_servers: [issuer],
      scopes_supported: scopes,
      bearer_methods_supported: ["header"]
    });
  });
  router.get("/.well-known/oauth-authorization-server", (_req, res) => {
    res.json({
      issuer,
      authorization_endpoint: issuer + authorizationPath,
      token_endpoint: issuer + "/oauth/token",
      registration_endpoint: issuer + "/oauth/register",
      response_types_supported: ["code"],
      response_modes_supported: ["query"],
      grant_types_supported: grants,
      token_endpoint_auth_methods_supported: ["none"],
      code_challenge_methods_supported: ["S256"],
      authorization_response_iss_parameter_supported: true,
      scopes_supported: scopes
    });
  });

  router.use("/oauth", (_req, res, next) => {
    res.set({
      "Cache-Control": "no-store",
      "Pragma": "no-cache",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": oauthCsp
    });
    next();
  });

  router.post("/oauth/register", limit(30), express.json({ limit: "8kb" }), asyncHandler(async (req, res) => {
    const client = registration.safeParse(req.body);
    if (!client.success) {
      const redirectIssue = client.error.issues.find((issue) => issue.path[0] === "redirect_uris");
      const error = redirectIssue ? "invalid_redirect_uri" : "invalid_client_metadata";
      logger.warn({ reason: error, field: (redirectIssue ?? client.error.issues[0])?.path }, "OAuth registration rejected");
      res.status(400).json({ error });
      return;
    }
    // The server supports both grants for every public client.
    const clientId = await repository.registerClient(client.data.redirect_uris);
    res.status(201).json({ ...client.data, client_id: clientId, grant_types: grants, response_types: ["code"], scope: oauthScope });
  }));

  const authorize = asyncHandler(async (req, res) => {
    const params = req.method === "POST" ? req.body : req.query;
    const client = authorizationClient.safeParse(params);
    if (!client.success) {
      logger.warn({ reason: "invalid_request", field: client.error.issues[0]?.path[0] }, "OAuth authorization rejected");
      res.status(400).json({ error: "invalid_request" });
      return;
    }
    if (!await repository.hasRedirect(client.data.client_id, client.data.redirect_uri)) {
      logger.warn({ reason: "invalid_request", field: "client_id/redirect_uri" }, "OAuth authorization rejected");
      res.status(400).json({ error: "invalid_request" });
      return;
    }

    const callback = new URL(client.data.redirect_uri);
    callback.searchParams.set("iss", issuer);
    if (client.data.state !== undefined) callback.searchParams.set("state", client.data.state);

    const request = authorization.safeParse(params);
    if (!request.success || !matchesResource(request.data.resource, resource)) {
      const field = request.success ? "resource" : request.error.issues[0]?.path[0];
      const error = field === "resource" ? "invalid_target" : field === "scope" ? "invalid_scope" : "invalid_request";
      logger.warn({ reason: error, field }, "OAuth authorization rejected");
      callback.searchParams.set("error", error);
      res.redirect(303, callback.href);
      return;
    }
    if (req.method === "GET") {
      const fields = { ...client.data, ...request.data };
      // Browsers serialize the form's POST Origin as "null" under no-referrer.
      res.set({ "Content-Security-Policy": ownerFormCsp, "Referrer-Policy": "strict-origin" })
        .type("html").send(ownerForm(fields));
      return;
    }

    const origin = req.get("origin");
    const rawSecret: unknown = req.body?.owner_secret;
    const logApproval = (reason: ApprovalDenial | "approved") => logger.warn({
      requestId: res.getHeader("x-request-id"),
      reason,
      origin: originForLog(origin),
      issuer,
      secretLength: typeof rawSecret === "string" ? rawSecret.length : 0
    }, "OAuth owner approval");
    const denyApproval = (reason: ApprovalDenial) => {
      logApproval(reason);
      res.status(403).type("text").send("Approval denied. Return to ChatGPT to try again.");
    };
    if (origin && origin !== issuer) {
      return denyApproval("origin_mismatch");
    }
    const secret = nonempty.safeParse(typeof rawSecret === "string" ? rawSecret.trim() : rawSecret);
    if (!secret.success) {
      return denyApproval("secret_missing");
    }
    if (!timingSafeEqual(ownerHash, Buffer.from(hash(secret.data)))) {
      return denyApproval("secret_mismatch");
    }

    const code = await repository.issueCode(client.data.client_id, client.data.redirect_uri, request.data.code_challenge);
    callback.searchParams.set("code", code);
    logApproval("approved");
    res.redirect(303, callback.href);
  });
  router.get(authorizationPath, limit(30), authorize);
  router.post(authorizationPath, limit(15), formParser(), authorize);

  router.post("/oauth/token", limit(120), formParser(), asyncHandler(async (req, res) => {
    const grantType: unknown = req.body?.grant_type;
    const grant_type = grants.find((grant) => grant === grantType) ?? null;
    const invalidClientField = req.get("authorization") ? "authorization" :
      req.body?.client_secret !== undefined ? "client_secret" : undefined;
    if (invalidClientField) {
      logger.warn({ reason: "invalid_client", field: invalidClientField, grant_type }, "OAuth token request rejected");
      res.status(400).json({ error: "invalid_client" });
      return;
    }
    const parsed = tokenRequest.safeParse(req.body);
    if (!parsed.success) {
      const error = typeof grantType === "string" && grant_type === null
        ? "unsupported_grant_type" : "invalid_request";
      logger.warn({ reason: error, field: parsed.error.issues[0]?.path[0], grant_type }, "OAuth token request rejected");
      res.status(400).json({ error });
      return;
    }
    const request = parsed.data;
    if (!matchesResource(request.resource, resource)) {
      logger.warn({ reason: "invalid_target", field: "resource", grant_type }, "OAuth token request rejected");
      res.status(400).json({ error: "invalid_target" });
      return;
    }
    const tokens = await repository.exchange(request.client_id, request.grant_type === "authorization_code"
      ? { code: request.code, redirectUri: request.redirect_uri, verifier: request.code_verifier }
      : { refreshToken: request.refresh_token });
    if (!tokens) {
      logger.warn({ reason: "invalid_grant", field: "grant", grant_type }, "OAuth token request rejected");
      res.status(400).json({ error: "invalid_grant" });
      return;
    }
    res.json(tokens);
  }));

  const handleError: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error.status >= 400 && error.status < 500) {
      logger.warn({ reason: "invalid_request", field: "body" }, "OAuth request rejected");
      res.status(error.status).json({ error: "invalid_request" });
      return;
    }
    logger.error("OAuth request failed");
    res.status(500).json({ error: "server_error" });
  };
  router.use("/oauth", handleError);
  return router;
}

function originForLog(origin: string | undefined): string | null {
  if (origin === undefined) return null;
  if (origin === "null" || (URL.canParse(origin) && new URL(origin).origin === origin)) return origin;
  return "invalid";
}

function limit(maxRequests: number) {
  return createRateLimitMiddleware({ maxRequests, windowMs: 60_000 });
}

function formParser() {
  return express.urlencoded({ extended: false, limit: "8kb", parameterLimit: 20 });
}

function matchesResource(requested: string | undefined, resource: string) {
  return requested === undefined || requested === resource;
}

function ownerForm(fields: Record<string, string | undefined>): string {
  const hidden = Object.entries(fields).filter(([, value]) => value !== undefined)
    .map(([name, value]) => `<input type="hidden" name="${name}" value="${escapeAttribute(value ?? "")}">`).join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Approve ChatGPT access</title>
<style>${ownerFormStyles}</style>
</head>
<body>
<main class="approval">
  <header>
    <p class="brand"><span class="brand-mark" aria-hidden="true">N</span> Notify Bot</p>
    <h1>Approve ChatGPT access</h1>
    <p class="intro">Connect ChatGPT to your Notify Bot workspace.</p>
  </header>
  <section class="permissions" aria-labelledby="permissions-title">
    <h2 id="permissions-title">Discord permissions</h2>
    <ul>
      <li>Queue Discord notifications</li>
      <li>Read notification status</li>
    </ul>
  </section>
  <form action="${authorizationPath}" method="post">
    ${hidden}
    <label for="owner-secret">Owner secret</label>
    <input id="owner-secret" type="password" name="owner_secret" required autocomplete="off">
    <button type="submit">Approve access <span aria-hidden="true">→</span></button>
  </form>
</main>
</body>
</html>`;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
