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

export type AgentKey = "muse" | "chatgpt" | "gemini" | "claude" | "codex" | "cursor" | "custom";

export type AgentNotificationStatus = "completed" | "needs_approval" | "error" | "info";

export interface AgentNotificationField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface AgentNotification {
  type: "agent.notification";
  deliveryId: string;
  agent: AgentKey;
  status: AgentNotificationStatus;
  task?: string;
  title: string;
  summary?: string;
  actionNeeded?: string;
  url?: string;
  fields?: AgentNotificationField[];
  accountHint?: string;
  occurredAt: string;
}

export type NotificationPayload =
  | PushNotification
  | WorkflowRunNotification
  | WorkflowJobNotification
  | AgentNotification;
