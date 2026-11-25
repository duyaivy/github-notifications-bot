import { z } from "zod";
import type { AgentKey, AgentNotificationStatus } from "../notification/notification.types.js";
import type { QueueJobStatus } from "../queue/queue.types.js";

export const CANONICAL_AGENTS = [
  "muse",
  "chatgpt",
  "gemini",
  "claude",
  "codex",
  "cursor",
  "custom"
] as const satisfies readonly AgentKey[];

export const AGENT_STATUSES = [
  "completed",
  "needs_approval",
  "error",
  "info"
] as const satisfies readonly AgentNotificationStatus[];

const agentAliases: Record<string, AgentKey> = {
  muse: "muse",
  "muse-ai": "muse",
  museai: "muse",
  "meta-muse": "muse",
  metamuse: "muse",
  hatch: "muse",
  chatgpt: "chatgpt",
  gpt: "chatgpt",
  "chat-gpt": "chatgpt",
  "chatgpt-web": "chatgpt",
  "chatgpt-plus": "chatgpt",
  openai: "chatgpt",
  "openai-chatgpt": "chatgpt",
  gpt4: "chatgpt",
  "gpt-4": "chatgpt",
  "gpt-4o": "chatgpt",
  "gpt-5": "chatgpt",
  o3: "chatgpt",
  gemini: "gemini",
  "google-gemini": "gemini",
  "gemini-web": "gemini",
  "gemini-pro": "gemini",
  "gemini-ai": "gemini",
  google: "gemini",
  bard: "gemini",
  claude: "claude",
  "claude-code": "claude",
  "claude-web": "claude",
  "claude-ai": "claude",
  anthropic: "claude",
  "claude-desktop": "claude",
  codex: "codex",
  "openai-codex": "codex",
  cursor: "cursor",
  "cursor-ai": "cursor",
  custom: "custom",
  agent: "custom",
  bot: "custom",
  default: "custom",
  other: "custom"
};

const agentPrefixMap: Array<[prefix: string, canonical: AgentKey]> = [
  ["muse-", "muse"],
  ["chatgpt-", "chatgpt"],
  ["gpt-", "chatgpt"],
  ["openai-", "chatgpt"],
  ["gemini-", "gemini"],
  ["claude-", "claude"],
  ["codex-", "codex"],
  ["cursor-", "cursor"]
];

const statusAliases: Record<string, AgentNotificationStatus> = {
  completed: "completed",
  complete: "completed",
  done: "completed",
  success: "completed",
  succeeded: "completed",
  finished: "completed",
  ok: "completed",
  needs_approval: "needs_approval",
  "needs-approval": "needs_approval",
  approval: "needs_approval",
  waiting_approval: "needs_approval",
  awaiting_approval: "needs_approval",
  pending_approval: "needs_approval",
  action_required: "needs_approval",
  confirm: "needs_approval",
  needs_confirmation: "needs_approval",
  error: "error",
  failed: "error",
  failure: "error",
  blocked: "error",
  timeout: "error",
  timed_out: "error",
  info: "info",
  update: "info",
  progress: "info",
  in_progress: "info",
  working: "info"
};

export function normalizeAgentKey(raw: string): AgentKey | null {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[\s_./]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (!normalized) {
    return null;
  }

  const exact = agentAliases[normalized];
  if (exact) {
    return exact;
  }

  for (const [prefix, canonical] of agentPrefixMap) {
    if (normalized.startsWith(prefix)) {
      return canonical;
    }
  }

  return null;
}

export function normalizeAgentStatus(raw: string): AgentNotificationStatus | null {
  const normalized = raw.trim().toLowerCase().replace(/\s+/g, "_");
  return statusAliases[normalized] ?? null;
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export const agentFieldSchema = z.object({
  name: z.string().trim().min(1).max(100),
  value: z.string().trim().min(1).max(500),
  inline: z.boolean().optional()
});

export const agentNotificationInputSchema = z.object({
  agent: z.string().trim().min(1).max(80).optional(),
  status: z.string().trim().min(1).max(40).default("completed"),
  task: z.string().trim().min(1).max(150).optional(),
  title: z.string().trim().min(1).max(200),
  summary: z.string().trim().min(1).max(3000).optional(),
  actionNeeded: z.string().trim().min(1).max(500).optional(),
  url: z.string().trim().max(1000).refine(isHttpUrl, "url must be a valid http(s) URL").optional(),
  fields: z.array(agentFieldSchema).max(10).optional(),
  accountHint: z.string().trim().min(1).max(80).optional(),
  idempotencyKey: z.string().trim().min(1).max(160).optional()
});

export interface EnqueueAgentNotificationResult {
  accepted: true;
  duplicate: boolean;
  jobId: number | null;
  agent: AgentKey;
  threadName: AgentKey;
  status: AgentNotificationStatus;
  queueStatus: QueueJobStatus;
}

export interface AgentJobStatusResult {
  jobId: number;
  status: QueueJobStatus;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  agent: AgentKey;
  notificationStatus: AgentNotificationStatus;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface AgentListEntry {
  agent: AgentKey;
  threadName: AgentKey;
  discordChannelId: string | null;
  discordThreadId: string | null;
  updatedAt: string | null;
}
