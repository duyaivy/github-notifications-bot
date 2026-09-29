export interface WorkflowRunRecord {
  runId: number;
  owner: string;
  repo: string;
  workflowName: string;
  branch: string | null;
  headSha: string;
  runNumber: number | null;
  event: string | null;
  actor: string | null;
  status: string;
  conclusion: string | null;
  url: string;
  discordThreadId: string | null;
  discordMessageId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowJobRecord {
  jobId: number;
  runId: number;
  name: string;
  status: string;
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
  url: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertWorkflowRunInput {
  runId: number;
  owner: string;
  repo: string;
  workflowName: string;
  branch?: string | null;
  headSha: string;
  runNumber?: number | null;
  event?: string | null;
  actor?: string | null;
  status: string;
  conclusion?: string | null;
  url: string;
}

export interface UpsertWorkflowJobInput {
  jobId: number;
  runId: number;
  name: string;
  status: string;
  conclusion?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  url?: string | null;
}
