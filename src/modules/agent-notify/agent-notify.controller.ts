import type { Request, Response } from "express";
import { HttpError } from "../../common/http-error.js";
import { extractDefaultAgent } from "../auth/auth.types.js";
import type { AgentNotifyService } from "./agent-notify.service.js";

export class AgentNotifyController {
  public constructor(private readonly service: AgentNotifyService) {}

  public createNotification = async (req: Request, res: Response): Promise<void> => {
    const headerIdempotencyKey = req.header("idempotency-key")?.trim() || undefined;
    const defaultAgent = extractDefaultAgent(req.auth);

    const result = await this.service.enqueueNotification(req.body, {
      defaultAgent,
      headerIdempotencyKey
    });

    res.status(202).json(result);
  };

  public getNotificationStatus = async (req: Request, res: Response): Promise<void> => {
    const rawId = req.params.jobId;
    const jobId = typeof rawId === "string" ? Number(rawId) : NaN;
    if (!Number.isInteger(jobId) || jobId <= 0) {
      throw new HttpError(400, "jobId must be a positive integer");
    }

    const status = await this.service.getJobStatus(jobId);
    if (!status) {
      throw new HttpError(404, "Notification job not found");
    }

    res.status(200).json(status);
  };

  public listThreads = async (_req: Request, res: Response): Promise<void> => {
    const result = await this.service.listAgents();
    res.status(200).json(result);
  };
}
