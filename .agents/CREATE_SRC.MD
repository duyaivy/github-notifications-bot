Create a clean and scalable backend scaffold for a GitHub-to-Discord notification service.

## Technology stack

- Node.js
- Express
- TypeScript
- SQLite
- Docker
- Persistent local queue backed by SQLite
- Pino logger
- No automated test setup for now

Use the built-in Node.js `fetch` API for Discord HTTP requests unless there is a strong reason to introduce another HTTP client.

## Main objective

The backend receives GitHub App webhook events, verifies the webhook signature, deduplicates the webhook delivery, and stores notification jobs in a persistent SQLite-backed queue.

A separate worker process polls and claims queued jobs, resolves repository routing configuration, formats a Discord message, and sends it through the Discord Bot API.

The webhook HTTP request must never wait for Discord message delivery.

## Execution instructions

Before modifying the repository:

1. Inspect the existing files and package configuration.
2. Produce a concise implementation plan.
3. Identify conflicts between the existing repository and this specification.
4. Preserve useful existing code where appropriate.

Then implement the project completely.

Do not stop after generating interfaces, empty files, TODO comments, pseudocode, or partial placeholders.

After implementation:

1. Install dependencies if the environment permits it.
2. Run the database migrations.
3. Run TypeScript type checking.
4. Run the production build.
5. Fix all errors caused by the implementation.
6. Review the final code against the acceptance criteria.
7. Summarize the files created or changed and any important design decisions.

Do not add automated tests yet.

## Architectural requirements

Keep the code modular and easy to extend.

Use a layered structure:

- `routes` and `controllers`: HTTP-specific behavior only
- `services`: application and business logic
- `repositories`: database access
- `queue`: enqueue, claim, complete, retry, and recovery logic
- `workers`: background processing loops
- `integrations`: GitHub and Discord-specific external API behavior
- `common`: shared utilities and infrastructure

Do not put business logic, SQL queries, Discord API calls, or notification formatting directly inside Express route handlers.

The GitHub webhook endpoint must return quickly after:

1. Reading the raw body
2. Verifying the signature
3. Parsing and validating the required payload subset
4. Deduplicating the delivery
5. Persisting the notification job

Do not send Discord messages inside the webhook request.

## Suggested folder structure

```text
src/
  app.ts
  server.ts
  worker.ts

  config/
    env.ts

  database/
    connection.ts
    migrate.ts
    migrations/
      001_init.sql

  modules/
    github/
      github.routes.ts
      github.controller.ts
      github.service.ts
      github.signature.ts
      github.types.ts
      github.normalizer.ts

    discord/
      discord.service.ts
      discord.types.ts
      discord.errors.ts

    notification/
      notification.service.ts
      notification.formatter.ts
      notification.types.ts

    queue/
      queue.service.ts
      queue.repository.ts
      queue.worker.ts
      queue.types.ts

    repo-route/
      repo-route.repository.ts
      repo-route.service.ts
      repo-route.types.ts

  common/
    logger.ts
    errors.ts
    async-handler.ts
    http-error.ts
    request-logger.ts
    shutdown.ts
```

The exact structure may be adjusted when there is a clear architectural benefit, but preserve the same separation of responsibilities.

## Initial features

Implement:

- `GET /health`
- `POST /webhooks/github`
- GitHub webhook signature verification using `X-Hub-Signature-256`
- Support for the GitHub `push` event
- GitHub push payload normalization into an internal notification type
- SQLite-backed persistent notification jobs
- Worker loop that polls pending jobs
- Discord Bot API message delivery
- Repository routing configuration stored in SQLite
- Pino application logging
- HTTP request logging middleware
- Centralized error handling
- Graceful shutdown for both the HTTP server and worker

Do not implement:

- Authentication
- Administration dashboard
- GitHub App installation flow
- Discord slash commands
- Discord message listeners
- Discord gateway connection
- Automated tests
- Additional GitHub event types

## Repository routing

Store routing configuration in the `repo_routes` table.

Each route must include:

- `id`
- `owner`
- `repo`
- `branch`
- `discord_channel_id`
- `discord_thread_id`, nullable
- `enabled`
- `created_at`
- `updated_at`

A route should be uniquely identified by:

```text
owner + repo + branch
```

Add an appropriate unique constraint or index.

For a GitHub push:

1. Resolve the repository owner and name.
2. Normalize the Git ref into a branch name.
3. Find a matching enabled route.
4. Require the configured branch to match.
5. Skip Discord delivery when no enabled route matches.

When `discord_thread_id` is present, send the message to that thread ID.

Otherwise, send the message to `discord_channel_id`.

A Discord thread is also a Discord channel resource, so the final destination ID can be resolved as:

```text
discordThreadId ?? discordChannelId
```

## GitHub webhook behavior

Implement `POST /webhooks/github` with the following behavior:

1. Read the exact raw request body as a `Buffer`.
2. Read `X-Hub-Signature-256`.
3. Verify the HMAC SHA-256 signature using `GITHUB_WEBHOOK_SECRET`.
4. Reject missing or invalid signatures with an appropriate 4xx response.
5. Parse the JSON body only after signature verification succeeds.
6. Read `X-GitHub-Event`.
7. Read `X-GitHub-Delivery`.
8. Reject requests missing required headers.
9. Deduplicate using `X-GitHub-Delivery`.
10. For a supported `push` event, normalize and enqueue a notification job.
11. Return a successful response immediately after persistence.

Use a timing-safe signature comparison.

Apply raw-body middleware specifically to the GitHub webhook route.

Do not allow a global JSON body parser to transform the webhook body before signature verification.

The rest of the application may use normal JSON parsing.

## Deduplication and transaction behavior

Use the `webhook_deliveries` table for delivery deduplication.

The following operations must occur atomically in one SQLite transaction:

1. Insert the GitHub delivery record.
2. Insert the corresponding notification job.

If the `github_delivery_id` already exists:

- Do not create another job.
- Return a successful idempotent response.
- Do not treat the duplicate as an internal server error.

This prevents a delivery record from being persisted without its corresponding job, or vice versa.

## Supported GitHub push payload subset

Create strict TypeScript interfaces for only the required subset of the GitHub push payload.

Include at least:

- `ref`
- `compare`
- `repository.full_name`
- `repository.name`
- `repository.owner.login`
- `pusher.name`
- `sender.login`
- `commits[].id`
- `commits[].message`
- `commits[].url`
- `commits[].author.name`
- `head_commit`, nullable when applicable

Avoid typing the entire GitHub webhook payload when only a subset is required.

Do not use `any`.

Use `unknown` at external input boundaries and narrow it safely.

## Normalized notification

Create a normalized internal notification type for GitHub pushes.

It should contain data similar to:

```ts
interface PushNotification {
  type: "github.push";
  deliveryId: string;
  repository: {
    owner: string;
    name: string;
    fullName: string;
  };
  branch: string;
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
```

The rest of the application should depend on this internal format rather than the raw GitHub payload.

## Discord integration

Send messages using the Discord Bot REST API:

```text
POST https://discord.com/api/v10/channels/{channelId}/messages
```

Use the authorization header:

```text
Authorization: Bot <DISCORD_BOT_TOKEN>
```

Use a JSON request body containing at least:

```json
{
  "content": "message content"
}
```

Create a typed input such as:

```ts
interface DiscordSendMessageInput {
  channelId: string;
  content: string;
}
```

The Discord service must:

- Keep the bot token in environment variables only
- Never log the token
- Send JSON requests
- Handle non-2xx API responses
- Capture useful response status and safe error details
- Distinguish retryable and non-retryable failures where practical
- Respect Discord's 2,000-character message limit
- Never log authorization headers

Do not use `discord.js` or establish a Discord Gateway connection for this scaffold.

Only REST message sending is required.

## Discord push message format

Format GitHub push notifications similar to:

```text
🚀 New push

Repo: owner/repo
Branch: main
Pusher: username
Commits: N

1. First commit message
2. Second commit message

Compare: https://github.com/owner/repo/compare/...
```

Formatting requirements:

- Keep messages within Discord's 2,000-character limit.
- Use only the first line of each commit message.
- Escape or sanitize unexpected content where needed.
- Include as many commit summaries as safely fit.
- Add a truncation indicator when commits are omitted.
- Handle zero-commit payloads safely.
- Omit the compare line when no compare URL is available.
- Avoid Discord-wide mentions such as `@everyone` or `@here` from untrusted commit content.
- Consider using Discord `allowed_mentions` with an empty parse array to prevent accidental mentions.

A suitable request body may contain:

```json
{
  "content": "formatted message",
  "allowed_mentions": {
    "parse": []
  }
}
```

## Queue behavior

The queue must be persisted in SQLite.

Notification jobs must survive:

- Application restart
- Worker restart
- Docker container restart, provided the SQLite volume remains available

The worker should:

1. Poll for available pending jobs.
2. Atomically claim one or more jobs.
3. Mark claimed jobs as `processing`.
4. Resolve the matching repository route.
5. Format the Discord message.
6. Send the message through the Discord service.
7. Mark the job as `completed` after successful delivery.
8. Retry retryable failures using backoff.
9. Mark a job as permanently `failed` after reaching `max_attempts`.
10. Store a safe error message in `last_error`.

Do not keep the authoritative queue state in memory.

In-memory values may only be used for the current polling iteration.

## Safe job claiming

Job claiming must be concurrency-safe.

Use a SQLite transaction when selecting and marking jobs as `processing`.

Prevent two worker processes from successfully claiming the same pending job.

Prefer a design that can later support multiple workers, even though the initial Docker setup may run only one worker.

Add useful indexes for queue polling, particularly around:

- `status`
- `available_at`
- `created_at`

## Retry behavior

Each job must include:

- `attempts`
- `max_attempts`
- `last_error`
- `available_at`

Use bounded exponential backoff, for example:

```text
delay = min(baseDelay * 2^(attempts - 1), maximumDelay)
```

Add a small amount of jitter if it can be implemented cleanly.

Retry failures such as:

- Network errors
- Discord HTTP 429 responses
- Discord HTTP 5xx responses

Treat clearly permanent errors such as invalid destination permissions or an unknown channel as non-retryable when practical.

When Discord responds with rate-limit information, respect the returned retry delay when available.

## Stale processing job recovery

A worker may terminate after marking a job as `processing`.

Add a recovery mechanism for stale processing jobs.

The schema should include a processing timestamp or lease field such as:

- `locked_at`
- `locked_by`, nullable

At worker startup and periodically during polling:

- Find jobs that have remained `processing` beyond a configurable or documented timeout.
- Return them to `pending` when they still have retry attempts available.
- Set an appropriate `available_at`.
- Preserve useful error context.

Document this behavior in the README.

## Database migrations

Create SQL migrations for:

1. `repo_routes`
2. `webhook_deliveries`
3. `notification_jobs`

### `repo_routes`

Include:

- `id`
- `owner`
- `repo`
- `branch`
- `discord_channel_id`
- `discord_thread_id`, nullable
- `enabled`
- `created_at`
- `updated_at`

### `webhook_deliveries`

Include:

- `id`
- `github_delivery_id`, unique
- `event_name`
- `repository_full_name`, nullable when unavailable
- `processed_at`, nullable
- `created_at`

Clarify in the implementation what `processed_at` means.

Prefer using it for successful webhook acceptance and job persistence, not successful Discord delivery.

### `notification_jobs`

Include:

- `id`
- `type`
- `payload_json`
- `status`
- `attempts`
- `max_attempts`
- `last_error`, nullable
- `available_at`
- `locked_at`, nullable
- `locked_by`, nullable
- `created_at`
- `updated_at`
- `completed_at`, nullable

Allowed statuses:

- `pending`
- `processing`
- `completed`
- `failed`

Use SQLite-compatible constraints where appropriate.

Store timestamps consistently, preferably as UTC ISO-8601 strings.

## Environment configuration

Use `dotenv` and `zod`.

Provide a `.env.example`.

Required or supported environment variables:

```dotenv
NODE_ENV=development
PORT=3000
SQLITE_PATH=./data/app.db
GITHUB_WEBHOOK_SECRET=replace_me
DISCORD_BOT_TOKEN=replace_me
WORKER_POLL_INTERVAL_MS=2000
WORKER_BATCH_SIZE=10
WORKER_MAX_ATTEMPTS=5
WORKER_STALE_JOB_TIMEOUT_MS=300000
LOG_LEVEL=info
```

Validate environment values at startup.

Fail fast with a clear safe error when required values are missing or invalid.

Never include secret values in validation errors or logs.

## TypeScript requirements

Enable strict TypeScript settings.

At minimum, enable:

```json
{
  "strict": true,
  "noUncheckedIndexedAccess": true,
  "exactOptionalPropertyTypes": true,
  "noImplicitOverride": true
}
```

Adjust individual options only when a library creates a documented compatibility issue.

Avoid `any`.

Use `unknown` for untrusted input and narrow it explicitly.

Create clear types or interfaces for:

- GitHub webhook headers
- GitHub push payload subset
- Normalized push notification
- Queue job
- Queue job status
- Repository route
- Discord send-message input
- Environment configuration

## Error handling

Implement:

- A reusable async Express handler
- Typed application errors
- An HTTP error type
- A centralized Express error handler
- Safe conversion of unknown errors into loggable error information

HTTP clients should receive safe error responses.

Detailed internal errors may be logged, but secrets and authorization data must never be logged.

## Logging

Use:

- `pino`
- `pino-pretty` in local development

Log meaningful structured fields such as:

- GitHub delivery ID
- GitHub event name
- Repository full name
- Queue job ID
- Queue job type
- Attempt number
- Discord destination ID
- Processing duration
- Final job status

Do not log:

- GitHub webhook secret
- Discord bot token
- Authorization headers
- Full environment configuration
- Raw webhook signatures
- Entire untrusted payloads by default

Implement Express request logging with:

- Method
- Path
- Status code
- Duration
- Request ID when practical

## Health endpoint

Implement:

```text
GET /health
```

Return a small JSON response indicating that the HTTP process is alive.

Include a lightweight SQLite readiness check if it can be done without making the endpoint unnecessarily expensive.

Do not report the worker as healthy merely because the HTTP process is healthy.

Document that the app and worker are separate processes.

## Graceful shutdown

The HTTP server must gracefully handle at least:

- `SIGINT`
- `SIGTERM`

On shutdown:

- Stop accepting new connections.
- Close the HTTP server.
- Close the SQLite connection.
- Flush or finish logger operations where applicable.

The worker must gracefully handle at least:

- `SIGINT`
- `SIGTERM`

On worker shutdown:

- Stop polling for new jobs.
- Allow the currently executing job to finish within a reasonable shutdown flow.
- Close the SQLite connection.
- Avoid claiming additional jobs.

Do not immediately terminate while a job is being updated unless unavoidable.

## npm scripts

Add at least:

```json
{
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "dev:worker": "tsx watch src/worker.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/server.js",
    "start:worker": "node dist/worker.js",
    "migrate": "tsx src/database/migrate.ts",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  }
}
```

Add a lint script only when a proper lint configuration is also included.

Do not add a broken placeholder lint script.

## Docker requirements

Create a production-oriented multi-stage `Dockerfile`.

Create `docker-compose.yml` with separate services:

- `app`
- `worker`

Both services must:

- Use the same application image
- Receive the required environment variables
- Mount the same persistent SQLite data volume
- Use the same `SQLITE_PATH`

The `app` service runs:

```text
npm run start
```

The `worker` service runs:

```text
npm run start:worker
```

Run database migrations before starting the application processes.

This may be handled using:

- A dedicated migration service, or
- A safe startup command

Avoid allowing both app and worker to run conflicting migrations simultaneously.

Persist the SQLite database using a named Docker volume.

The complete local setup must run with:

```bash
docker compose up --build
```

## README requirements

Create a clear README containing:

1. Project purpose
2. Architecture overview
3. Request-to-worker processing flow
4. Folder structure
5. Required software
6. Environment configuration
7. How to install dependencies
8. How to run migrations
9. How to run the app locally
10. How to run the worker locally
11. How to run with Docker
12. How to create a Discord bot
13. Required Discord bot permissions
14. How to obtain a Discord channel ID
15. How to insert a sample repository route
16. How to expose the local webhook endpoint using ngrok or a similar tunnel
17. How to configure the GitHub App webhook URL and secret
18. How to validate a webhook delivery
19. Retry and stale-job recovery behavior
20. Where to add additional GitHub event handlers later

Include example commands where useful.

## Discord setup documentation

The README should explain that the user must:

1. Create a Discord application in the Discord Developer Portal.
2. Add a bot to the application.
3. copy the bot token into `DISCORD_BOT_TOKEN`.
4. Invite the bot to the target Discord server.
5. Grant only the permissions needed to view the target channel and send messages.
6. Enable Discord Developer Mode.
7. Copy the target channel ID.
8. Insert a matching row into `repo_routes`.

Do not hardcode a real bot token or channel ID.

## Sample repository route

Provide a documented SQL example such as:

```sql
INSERT INTO repo_routes (
  owner,
  repo,
  branch,
  discord_channel_id,
  discord_thread_id,
  enabled,
  created_at,
  updated_at
)
VALUES (
  'example-owner',
  'example-repo',
  'main',
  '123456789012345678',
  NULL,
  1,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);
```

Adjust the timestamps to match the final schema.

## Local GitHub webhook testing

Document a flow using ngrok or an equivalent tunnel.

Example:

```bash
ngrok http 3000
```

Configure the GitHub App webhook URL as:

```text
https://generated-domain.example/webhooks/github
```

The README must explain that manually constructing a request requires generating a valid HMAC SHA-256 signature over the exact raw JSON bytes.

Include either:

- A small development-only signing script, or
- A documented Node.js command or snippet

Do not weaken signature verification for local development.

Do not add an environment option that disables signature validation.

## Future GitHub events

Design GitHub event dispatch so additional events can later be added without putting a large switch statement directly in the controller.

The controller should remain limited to HTTP input extraction and response behavior.

The GitHub service may dispatch supported events to event-specific normalizers or handlers.

Only implement the `push` event now.

## Security requirements

- Never log secrets.
- Never commit real secrets.
- Validate required environment variables.
- Verify the GitHub signature against the exact raw body.
- Use a timing-safe comparison.
- Reject invalid signatures.
- Keep the Discord bot token only in environment variables.
- Keep the GitHub webhook secret only in environment variables.
- Prevent accidental Discord mentions from commit content.
- Use parameterized SQL statements.
- Do not expose internal stack traces in production HTTP responses.
- Do not provide a development bypass for webhook verification.

## Acceptance criteria

The implementation is complete only when all of the following are true:

1. `GET /health` returns a successful JSON response.
2. Invalid GitHub signatures are rejected.
3. A valid GitHub push webhook is accepted.
4. The exact raw request bytes are used for signature verification.
5. Duplicate `X-GitHub-Delivery` values do not create duplicate jobs.
6. Delivery insertion and job insertion are atomic.
7. The webhook route does not send Discord messages directly.
8. A matching push creates a persistent SQLite job.
9. Jobs remain present after restarting the process.
10. The worker safely claims pending jobs.
11. Multiple workers cannot normally claim the same job.
12. A matching enabled repository route causes a Discord message to be sent.
13. A missing, disabled, or branch-mismatched route causes the job to be safely skipped or completed without sending.
14. Successful delivery marks the job as completed.
15. Retryable failures update attempts, last error, and available time.
16. Exhausted retries mark the job as failed.
17. Stale processing jobs can be recovered.
18. Discord messages remain within the platform content limit.
19. Untrusted commit text cannot trigger broad Discord mentions.
20. Environment configuration is validated.
21. Secrets are not logged.
22. App and worker support graceful shutdown.
23. `npm run migrate` succeeds.
24. `npm run typecheck` succeeds.
25. `npm run build` succeeds.
26. `docker compose up --build` starts the app and worker with persistent SQLite storage.
27. The README explains the complete setup and local webhook testing flow.

When a design choice is not specified, choose the simplest solution that preserves correctness, strict typing, persistence, modularity, and future extensibility. Document meaningful assumptions rather than silently expanding the scope.
