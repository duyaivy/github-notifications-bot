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
};

export interface WorkflowJobNotification {
  type: "github.workflow_job";
  deliveryId: string;
  repository: {
    owner: string;
    name: string;
    fullName: string;
  };
  job: {
    id: number;
    runId: number;
    workflowName: string;
    name: string;
    url: string;
    status: string;
    conclusion: string | null;
    branch: string | null;
    headSha: string;
    startedAt: string | null;
    completedAt: string | null;
    steps?: Array<{
      name: string;
      status: string;
      conclusion: string | null;
      number: number;
    }>;
  };
  sender: string;
  occurredAt: string;
}

export type NotificationPayload = PushNotification | WorkflowRunNotification | WorkflowJobNotification;
