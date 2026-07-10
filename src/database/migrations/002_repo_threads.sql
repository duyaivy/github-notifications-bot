CREATE TABLE IF NOT EXISTS repo_threads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  discord_thread_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (owner, repo)
);

CREATE INDEX IF NOT EXISTS idx_repo_threads_lookup
  ON repo_threads (owner, repo);
