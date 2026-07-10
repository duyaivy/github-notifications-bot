export interface PushNotification {
  type: "github.push";
  deliveryId: string;
  repository: {
    owner: string;
    name: string;
    fullName: string;
  };
  branch: string;
  action: "created" | "deleted" | "forced" | "pushed";
  pusher: string;
  compareUrl: string | null;
  commits: Array<{
    id: string;
    shortId: string;
    message: string;
    url: string;
    authorName: string;
  }>;
  occurredAt: string;
}

export interface WorkflowRunNotification {
  type: "github.workflow_run";
  deliveryId: string;
  repository: {
    owner: string;
    name: string;
    fullName: string;
  };
  workflow: {
    id: number;
    name: string;
    url: string;
    status: string;
    conclusion: string | null;
    branch: string | null;
    headSha: string;
    runNumber: number;
    event: string;
    actor: string;
  };
  occurredAt: string;
}

export type NotificationPayload = PushNotification | WorkflowRunNotification;
