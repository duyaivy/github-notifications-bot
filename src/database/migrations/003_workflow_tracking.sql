CREATE TABLE IF NOT EXISTS workflow_runs (
  run_id INTEGER PRIMARY KEY,
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  workflow_name TEXT NOT NULL,
  branch TEXT,
  head_sha TEXT NOT NULL,
  run_number INTEGER,
  event TEXT,
  actor TEXT,
  status TEXT NOT NULL,
  conclusion TEXT,
  url TEXT NOT NULL,
  discord_thread_id TEXT,
  discord_message_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_lookup
  ON workflow_runs (owner, repo, run_id);

CREATE TABLE IF NOT EXISTS workflow_jobs (
  job_id INTEGER PRIMARY KEY,
  run_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  conclusion TEXT,
  started_at TEXT,
  completed_at TEXT,
  url TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_workflow_jobs_run
  ON workflow_jobs (run_id);
