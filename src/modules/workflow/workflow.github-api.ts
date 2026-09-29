import { env } from "../../config/env.js";
import { logger } from "../../common/logger.js";

export interface GitHubApiJob {
  id: number;
  run_id: number;
  name: string;
  status: string;
  conclusion: string | null;
  started_at: string | null;
  completed_at: string | null;
  html_url: string;
}

interface GitHubJobsResponse {
  jobs?: GitHubApiJob[];
}

export async function fetchWorkflowRunJobs(
  owner: string,
  repo: string,
  runId: number
): Promise<GitHubApiJob[] | null> {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs/${runId}/jobs?per_page=100`;

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "github-discord-notify-bot"
  };

  if (env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
  }

  try {
    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(6000)
    });

    if (!response.ok) {
      logger.debug(
        { owner, repo, runId, status: response.status },
        "github api fetch jobs non-ok response"
      );
      return null;
    }

    const data = (await response.json()) as GitHubJobsResponse;
    if (Array.isArray(data.jobs)) {
      return data.jobs;
    }

    return null;
  } catch (error) {
    logger.debug({ owner, repo, runId, error }, "github api fetch jobs failed or timed out");
    return null;
  }
}
