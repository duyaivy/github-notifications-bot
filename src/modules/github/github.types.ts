export interface GitHubWebhookHeaders {
  eventName: string;
  deliveryId: string;
  signature256: string;
}

export interface GitHubPushPayload {
  ref: string;
  compare: string | null;
  created: boolean;
  deleted: boolean;
  forced: boolean;
  repository: {
    full_name: string;
    name: string;
    owner: {
      login: string;
    };
  };
  pusher: {
    name: string;
  };
  sender: {
    login: string;
  };
  commits: Array<{
    id: string;
    message: string;
    url: string;
    author: {
      name: string;
    };
  }>;
  head_commit: {
    id: string;
  } | null;
}

export interface GitHubWorkflowRunPayload {
  action: string;
  repository: {
    full_name: string;
    name: string;
    owner: {
      login: string;
    };
  };
  workflow_run: {
    id: number;
    name: string;
    html_url: string;
    status: string;
    conclusion: string | null;
    head_branch: string | null;
    head_sha: string;
    run_number: number;
    event: string;
    actor: {
      login: string;
    } | null;
  };
  sender: {
    login: string;
  };
}

export interface GitHubWorkflowJobPayload {
  action: string;
  repository: {
    full_name: string;
    name: string;
    owner: {
      login: string;
    };
  };
  workflow_job: {
    id: number;
    run_id: number;
    run_url?: string;
    run_attempt?: number;
    workflow_name: string | null;
    head_branch: string | null;
    head_sha: string;
    name: string;
    status: string;
    conclusion: string | null;
    started_at: string | null;
    completed_at: string | null;
    html_url: string;
    steps?: Array<{
      name: string;
      status: string;
      conclusion: string | null;
      number: number;
    }>;
  };
  sender: {
    login: string;
  };
}

export interface GitHubWebhookResult {
  accepted: boolean;
  duplicate: boolean;
  eventName: string;
  deliveryId: string;
  jobId: number | null;
  message: string;
}
