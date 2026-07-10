import type { Request, Response } from "express";
import { HttpError } from "../../common/http-error.js";
import type { GitHubService } from "./github.service.js";
import type { GitHubWebhookHeaders } from "./github.types.js";

export class GitHubController {
  public constructor(private readonly github: GitHubService) {}

  public handleWebhook = async (req: Request, res: Response): Promise<void> => {
    if (!Buffer.isBuffer(req.body)) {
      throw new HttpError(400, "Expected raw request body");
    }

    const headers = this.extractHeaders(req);
    const result = await this.github.handleWebhook(req.body, headers);
    res.status(202).json(result);
  };

  private extractHeaders(req: Request): GitHubWebhookHeaders {
    const eventName = req.header("x-github-event");
    const deliveryId = req.header("x-github-delivery");
    const signature256 = req.header("x-hub-signature-256");

    if (!eventName) {
      throw new HttpError(400, "Missing X-GitHub-Event header");
    }
    if (!deliveryId) {
      throw new HttpError(400, "Missing X-GitHub-Delivery header");
    }
    if (!signature256) {
      throw new HttpError(401, "Missing X-Hub-Signature-256 header");
    }

    return { eventName, deliveryId, signature256 };
  }
}
