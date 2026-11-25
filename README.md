# GitHub to Discord Notify Bot

Backend for receiving GitHub App webhooks, persisting notification jobs in SQLite/libSQL, and sending formatted GitHub messages to Discord through the Discord Bot REST API.

## Architecture

The app runs the HTTP server and queue worker in one Node.js process. The HTTP server verifies GitHub webhook signatures, deduplicates delivery IDs, normalizes supported events, and persists jobs quickly. The in-process worker polls SQLite/libSQL, claims pending jobs in a transaction, creates or reuses a Discord thread for each GitHub repository inside the configured notification channel, sends messages to that thread, and records completion or retry state.

Folder layout:

```text
src/config            environment validation
src/database          SQLite/libSQL connection and migrations
src/common            logging, errors, request logging, shutdown helpers
src/modules/github
src/modules/queue
src/modules/repo-thread
src/modules/agent-thread
src/modules/agent-notify
src/modules/ai-docs
src/modules/auth
src/modules/mcp
src/modules/notification
src/modules/discord
```

## Requirements

- Node.js 22+
- npm
- Docker and Docker Compose for containerized local deployment
- A GitHub App webhook secret
- A Discord bot token

## Environment

Copy `.env.example` to `.env` and set real local values:

```dotenv
NODE_ENV=development
HOST=0.0.0.0
PORT=3000
SQLITE_PATH=./data/app.db
TURSO_DATABASE_URL=
TURSO_AUTH_TOKEN=
GITHUB_WEBHOOK_SECRET=replace_me
DISCORD_BOT_TOKEN=replace_me
DISCORD_CHANNEL_ID=replace_me
DISCORD_GUILD_ID=
DISCORD_AGENT_CHANNEL_ID=
DISCORD_AGENT_CHANNEL_NAME=ai-notifications
AGENT_API_TOKENS=
PUBLIC_BASE_URL=
AGENT_RATE_LIMIT_MAX=60
AGENT_RATE_LIMIT_WINDOW_MS=60000
WORKER_POLL_INTERVAL_MS=2000
WORKER_BATCH_SIZE=10
WORKER_MAX_ATTEMPTS=5
WORKER_STALE_JOB_TIMEOUT_MS=300000
LOG_LEVEL=info
```

For local development, leave `TURSO_DATABASE_URL` empty and the app uses `SQLITE_PATH`. For Render Free, set `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` so data is stored in Turso instead of Render's ephemeral filesystem. Secrets are read only from environment variables and are not logged.

## Local Run

```bash
npm install
npm run dev
```

Health check:

```bash
curl http://localhost:3000/health
```

## Docker

Set `GITHUB_WEBHOOK_SECRET`, `DISCORD_BOT_TOKEN`, and `DISCORD_CHANNEL_ID` in your shell or a local `.env`, then run:

```bash
docker compose up --build
```

The container runs migrations on startup, then starts both the HTTP server and queue worker in the same process. Local Docker Compose stores SQLite in the named Docker volume at `/data/app.db`. Render Free should use Turso via `TURSO_DATABASE_URL` instead of a local database file.

## Discord Setup

1. Create an application in the Discord Developer Portal.
2. Add a bot to the application.
3. Copy the bot token into `DISCORD_BOT_TOKEN`.
4. Invite the bot to the target server.
5. Grant the bot permission to view the target channel, create public threads, and send messages.
6. Enable Discord Developer Mode.
7. Right-click the target channel and copy its channel ID.
8. Set `DISCORD_CHANNEL_ID` to that channel ID.

The service creates one public thread per GitHub repository inside `DISCORD_CHANNEL_ID`, then sends repository notifications to that thread. Message sends use `allowed_mentions.parse = []` to prevent accidental mentions.

## Repository Threads

Repository threads are stored in SQLite/libSQL and matched by `owner + repo`. The first notification for a repository creates a public thread in `DISCORD_CHANNEL_ID`, stores its `discord_thread_id`, and sends the notification there. Later notifications for the same repository reuse the stored thread.

Thread names use the GitHub repository full name, for example `example-owner/example-repo`. Branch names are included in the notification message body, not used to choose a destination.

Example table row:

```sql
INSERT INTO repo_threads (
  owner,
  repo,
  discord_thread_id,
  created_at,
  updated_at
)
VALUES (
  'example-owner',
  'example-repo',
  '123456789012345678',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);
```

## GitHub Webhooks

Expose the local app:

```bash
ngrok http 3000
```

Configure the GitHub App webhook URL:

```text
https://generated-domain.example/webhooks/github
```

Set the GitHub App webhook secret to the same value as `GITHUB_WEBHOOK_SECRET`. The app rejects missing or invalid `X-Hub-Signature-256` signatures and verifies the HMAC over the exact raw JSON bytes.

To manually sign a payload for local testing:

```bash
node -e "const c=require('crypto'); const body=process.argv[1]; const secret=process.argv[2]; console.log('sha256='+c.createHmac('sha256', secret).update(Buffer.from(body)).digest('hex'))" '{"ref":"refs/heads/main","compare":null,"repository":{"full_name":"example-owner/example-repo","name":"example-repo","owner":{"login":"example-owner"}},"pusher":{"name":"octocat"},"sender":{"login":"octocat"},"commits":[],"head_commit":null}' 'replace_me'
```

Use the resulting signature with `X-GitHub-Event: push` and a unique `X-GitHub-Delivery` value.

## Processing Behavior

`webhook_deliveries.processed_at` means the webhook was accepted and the corresponding local action was persisted. For supported `push` events, delivery insertion and notification job insertion happen atomically in one SQLite/libSQL transaction. Duplicate GitHub delivery IDs return success without creating another job.

Jobs are persisted in `notification_jobs`, so they survive process and container restarts as long as the SQLite file, Docker volume, or Turso database remains. The worker claims jobs by selecting pending rows and marking them `processing` inside a transaction, which prevents normal multi-worker double-claiming.

Retryable failures include network errors, Discord rate limits, and Discord 5xx responses. Discord 403 and 404 responses are treated as permanent destination failures. Retries use bounded exponential backoff with jitter and respect Discord retry delay data when available. Exhausted jobs are marked `failed`.

If a worker exits after claiming a job, stale `processing` jobs older than `WORKER_STALE_JOB_TIMEOUT_MS` are returned to `pending` on worker startup and during polling when attempts remain. Otherwise they are marked `failed`.

## Extending Events

The controller only extracts HTTP input and returns responses. Add future GitHub event support in the GitHub service by adding an event-specific payload parser and normalizer under `src/modules/github`, then enqueue a normalized notification type consumed by the notification module.

Only `push`, `workflow_run`, and `workflow_job` are implemented for GitHub webhooks.

## AI Agent Notifications & MCP

The backend also exposes public AI-readable docs, a Bearer-protected REST API, and a stateless MCP Streamable HTTP endpoint so AI agents (Muse AI, ChatGPT, Gemini, Claude, Codex, Cursor) can send task completion (`completed`) and approval-needed (`needs_approval`) notifications to Discord.

### Discord Channel & Thread Behavior

- AI notifications go to a separate Discord channel (configured via `DISCORD_AGENT_CHANNEL_ID`, or auto-discovered/created as `#ai-notifications` in the same guild and category as `DISCORD_CHANNEL_ID` when `Manage Channels` is granted).
- Each AI platform uses **one canonical thread** (`muse`, `chatgpt`, `gemini`, `claude`, `codex`, `cursor`, `custom`), never split by user account or task.
- Before creating a new thread, the service checks both local `agent_threads` and Discord active/public-archived threads (requires `Read Message History` to inspect archived threads).

### Endpoints

- Public Docs (no auth):
  - `GET /llms.txt` — AI-readable integration guide
  - `GET /openapi.json` — OpenAPI 3.1 schema
  - `GET /docs/ai` — Human-readable setup page
- Authenticated Endpoints (`Authorization: Bearer <token>` from `AGENT_API_TOKENS`):
  - `POST /api/v1/notifications` — Queue a notification (`202 Accepted`)
  - `GET /api/v1/notifications/:jobId` — Check queue delivery status
  - `GET /api/v1/threads` — List canonical agent keys and Discord thread bindings
  - `POST /mcp` — Stateless MCP Streamable HTTP (`send_notification`, `list_agents`, `get_notification_status`)

`AGENT_API_TOKENS` supports comma-separated tokens and optional agent prefixes (e.g. `muse:tok_abc,tok_shared`), where prefixed tokens automatically default `agent` when omitted. If `AGENT_API_TOKENS` is unset, `/api/v1/*` and `/mcp` fail closed with `503`.

## CI/CD Deployment to Render

The repository includes a GitHub Actions workflow [deploy.yml](file:///.github/workflows/deploy.yml) that runs automatically when code is pushed to `main` (or triggered manually via `workflow_dispatch`):

1. **Validation**: Runs `npm run typecheck` and `npm run build` on Node.js 22 to ensure code integrity before deployment.
2. **Deploy Trigger**: Calls the Render Deploy Hook via POST request to trigger automatic redeployment.

### Setup Render Deploy Hook

1. Go to your **Render Dashboard** and select your Web Service (`github-discord-notify-bot`).
2. Navigate to **Settings** > scroll to **Deploy Hook**.
3. Click **Create Deploy Hook** (or copy your existing hook URL). It looks like:
   `https://api.render.com/deploy/srv-xxxxxx?key=yyyyyy`
4. In this GitHub repository, go to **Settings** > **Secrets and variables** > **Actions**.
5. Click **New repository secret**:
   - **Name**: `RENDER_DEPLOY_HOOK_URL`
   - **Value**: `<your-render-deploy-hook-url>`
6. *(Recommended)* In Render Service Settings > **Build & Deploy**, set **Auto-Deploy** to `No` so only passing GitHub Action builds trigger Render deployments.

