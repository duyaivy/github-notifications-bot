import express, { type Request, type Response } from "express";
import { buildAiDocsHtml, buildLlmsTxt, buildOpenApiSpec, resolvePublicBaseUrl } from "./ai-docs.content.js";

export function createAiDocsRoutes(): express.Router {
  const router = express.Router();

  router.get("/llms.txt", (req: Request, res: Response) => {
    const baseUrl = resolvePublicBaseUrl(req);
    res.type("text/plain; charset=utf-8").send(buildLlmsTxt(baseUrl));
  });

  router.get("/openapi.json", (req: Request, res: Response) => {
    const baseUrl = resolvePublicBaseUrl(req);
    res.json(buildOpenApiSpec(baseUrl));
  });

  router.get("/docs/ai", (req: Request, res: Response) => {
    const baseUrl = resolvePublicBaseUrl(req);
    res.type("text/html; charset=utf-8").send(buildAiDocsHtml(baseUrl));
  });

  return router;
}
