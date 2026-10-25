# OPA event history v0.2 (draft)

OPA separates the producer (Codex, OpenCode, future agents) from the consumer (pixel office, timeline, another visualizer). UTF-8 JSONL is the exchange file: one complete JSON object per line, in append order. Suggested filename: `agent-history.opa.jsonl`. Writers must serialize appends; readers may ignore an incomplete final line while tailing a live file. The batch bridge treats malformed/incomplete JSON as an error with a line number.

## Envelope

| Field         | Meaning                                                                     |
| ------------- | --------------------------------------------------------------------------- |
| `specVersion` | Exact protocol version, `0.1` or `0.2`; new work events require `0.2`       |
| `id`          | Unique event ID, UUID in bundled adapters                                   |
| `streamId`    | Unique producer-instance ID; changes when adapter process restarts          |
| `sequence`    | Nonnegative safe integer, strictly increasing within a stream; gaps allowed |
| `timestamp`   | RFC 3339 timestamp with timezone; bundled adapters use UTC                  |
| `provider`    | Stable source identifier, e.g. `codex`, `opencode`                          |
| `sessionId`   | Source session identifier                                                   |
| `agentId`     | Source agent identifier; equals session ID for current adapters             |
| `type`        | Event discriminator                                                         |

Identity is `(provider, sessionId, agentId)`. `streamId` scopes sequence ordering and lets a restarted adapter continue an existing session. Consumers must not merge agents merely because providers reuse a session ID. Source timestamps are not used to reorder events. Bundled lifecycle adapters timestamp observation time; usage records preserve the source completion timestamp when available. One ordered writer per logical agent is required; competing streams for the same agent are not reconciled.

## Events

| Type                                          | Additional fields                                          |
| --------------------------------------------- | ---------------------------------------------------------- |
| `session.started`                             | `cwd`; optional `name`, `role`, `parentAgentId`            |
| `session.ended`                               | none                                                       |
| `turn.started`, `turn.completed`              | none                                                       |
| `turn.failed`                                 | `message`                                                  |
| `tool.started`                                | `toolId`, `name`, `activity`: `read`, `write` or `execute` |
| `tool.completed`                              | `toolId`; optional boolean `failed`                        |
| `permission.requested`, `permission.resolved` | none                                                       |
| `message`                                     | `role`: `user` or `assistant`, `text`                      |

`session.started` must precede all activity for that agent. Repeated starts are idempotent for an existing agent. Completion-only source operations may be expanded into adjacent start/completed events. Tools correlate by `toolId`, never by “most recent tool.” Turn completion/failure clears outstanding tools. Idle between turns is not session termination: Codex exec's `turn.completed` leaves its character visible. Session termination removes the character.

Role values are open strings (coder, tester, designer, reviewer, documentation, operations, etc.). Parent IDs reference the same provider/session namespace; adapters must not invent subagents from tool names. OpenCode session parents may be in separate sessions, so its `parentAgentId` currently preserves source metadata for future consumers; the office does not resolve it yet.

## Validation and ingestion

[JSON Schema](event.schema.json) is the portable contract. Server runtime validation checks required fields/types, version and event payloads. Unknown envelope fields are tolerated for additive extensions. Unknown event types and unsupported versions are rejected. Fields beyond the specified contract must not be required by a consumer; breaking semantic/shape changes need a new version.

`POST /api/opa/events` accepts one event per request with `Authorization: Bearer <office-token>`. Missing/invalid auth returns 401, malformed events 400, activity before session start 409, accepted events 200 with `{ "accepted": true }`. Duplicate or stale per-agent/per-stream sequences return `{ "accepted": false }`. The existing server body limit applies. Lifecycle projections are in memory; replay restores active agents. Tasks and usage are durable host state, independently of session lifecycle. The server does not write a second event journal.

Deduplication and stream/agent sequence bookkeeping currently last for the server process lifetime and are not bounded/compacted. This is a local MVP, not a hosted multi-tenant event collector. Live bridge requests have a five-second timeout; the OpenCode plugin uses two seconds. Neither automatically retries. The producer journal remains the recoverable source.

## Data policy and coverage

The built-in adapters omit raw tool arguments, command lines, outputs and reasoning summaries. Codex assistant messages and source errors are retained. Treat history as project data; do not assume it is anonymized. OpenCode text deltas/messages are omitted. Completed-message token/cost observations are supported. File diffs, approval IDs, inter-agent messages and richer delegation remain future schema work.

Read/execute classification is explicit at the adapter boundary; arbitrary shell commands are not guessed to be reads. The office maps these categories to the existing read/write/command animations. The campus distinguishes failed turns from successful completion and shows source error messages in agent details. The legacy character view still uses the waiting animation for either outcome.

## Source contracts

- [Codex non-interactive JSON events](https://learn.chatgpt.com/docs/non-interactive-mode)
- [OpenCode plugin events](https://opencode.ai/docs/plugins/)
- [OpenCode server events](https://opencode.ai/docs/server/)

Codex `exec --json`, Codex interactive session files, Codex App Server notifications and OpenCode CLI JSON are distinct source contracts. This implementation supports the first and OpenCode plugin events only. Other adapters should be added with captured fixtures and independent tests.

## Campus projection (UI protocol, not new journal events)

The host projects v0.1 events into `opaCampusState` on WebSocket/embedded connections. The canonical wire schemas live in `core/asyncapi.yaml`; reconnecting clients receive a full snapshot after layout/assets and existing agent state. Each project has a canonical host filesystem path and a list of agents. Each agent carries its provider, optional display name/role, status (`idle`, `working`, `blocked`, `done`, `error`), active tool labels, optional `blockedSince`, `completedAt`, `attentionId` and error detail.

A project's identity is its resolved cwd (case-normalized on Windows), not the folder basename or agent provider. Paths are not symlink-resolved or translated across remote machines; two spellings through symlinks or different worktrees remain separate offices. The host's project registry persists in adapter state. Live agent state is replayed from journals, not stored as Claude transcripts. The campus is OPA-only; upstream Claude sessions still use the original office.

A repeated permission request does not reset its waiting clock. Permission resolution clears the block; completion/failure ends it; new work clears the previous unread result. Waiting duration and result time come from event observation timestamps (future timestamps are clamped to receipt time), so replay preserves how long a request has waited. The v0.1 permission contract is per-agent, without individual approval IDs; it cannot independently track several pending approvals inside one agent.

Unread results are a presentation preference scoped to the browser and event ID, capped at 2,000 IDs. Reading a result is not a workflow command. Reading an approval is not approval resolution. No new execution, permission-answering or notification capability is granted by campus snapshots. Elapsed time/highlighting is visible in-app; this pass does not add operating-system notifications.

## v0.2 tasks and usage

`usage.reported` contains `usage`: `usageId`, `projectPath`, `provider`, `sessionId`, `timestamp`, `inputTokens`, `outputTokens`, optional `model`, `cachedInputTokens`, `cacheWriteTokens`, `reasoningTokens`, and `cost`. Nested provider/session/timestamp must match the envelope. Counts are nonnegative safe integers. Cached read plus cache write tokens are subsets of input; reasoning tokens are a subset of output. Do not add these subsets to the totals again.

`cost` is optional: `{amount: 0.0123, currency: "USD", kind: "estimated"}`. Amounts are finite and nonnegative. `reported` preserves a source-reported amount; `estimated` identifies an estimate. Neither certifies an invoice. Absent cost means unknown, distinct from a known zero. The UI separates the two kinds and exposes unknown coverage. No model price inference is applied.

Usage is durable by `(provider, sessionId, usageId)`, independent of ephemeral sequence tracking. A correction replaces the observation; an older timestamp is ignored. A key cannot move to another project. Replaying the same normalized journal is safe across server restarts. Re-normalizing raw Codex input creates a new stream and therefore new usage IDs; it is a new observation and can duplicate accounting. Keep and replay the normalized journal.

Codex `turn.completed.usage` supplies tokens, without an invented price/model. OpenCode completed assistant `message.updated` supplies a stable message ID, `time.completed`, model, tokens and optional cost. The official `@opencode-ai/sdk` 1.19.4 declaration was checked: source input plus cache read/write becomes OPA total input; output plus reasoning becomes total output. OpenCode cost is classified as estimated. Sources must provide per-observation counts, not repeatedly append cumulative session totals.

`task.upserted` carries `cwd`, `taskId` (1–200 characters), `title` (1–2,000 characters), `status` (`open`, `in_progress`, `done`, `cancelled`) and optional `assignee` (up to 200 characters). IDs/titles must contain non-whitespace text. The host stores creation/update times and a revision. Older source updates cannot overwrite newer human edits. In journal events assignment is metadata; replay never dispatches execution. Cancellation retains history; deletion is not exposed.

### Shared task API

Authenticated `GET /api/opa/tasks?projectPath=/absolute/project` reads tasks (omit the filter for all). `POST /api/opa/tasks` uses the same bearer token as event ingestion:

```json
{
  "action": "create",
  "requestId": "unique-request-id",
  "projectPath": "/absolute/project",
  "title": "Review adapters",
  "assignee": "codex"
}
```

For updates send `action: "update"`, `taskId`, `expectedRevision`, a unique `requestId`, `projectPath` and changed title/assignee/status. Empty assignee clears ownership. Repeating the same create request is idempotent. Invalid commands return 400, revision conflicts 409 and storage failures 503. WebSocket clients use `opaTaskCommand`/`opaTaskResult` and receive complete `opaWorkState` snapshots on connect and changes. Tokenless clients may observe but cannot change tasks. No MCP setup is installed. Authenticated task commands with a new nonempty assignment (`codex` or `opencode`) dispatch a local run; journal ingestion never does. `opaWorkState.executors` lists installed runnable clients. Explicit retries use `launch: true` and the current revision. A task record optionally includes `execution` with runId, state, journal, timestamps, bounded output/error. Status edits do not rerun tasks; cancelled status stops an active process. Server restart exposes stale running markers as interrupted without relaunch.

The file adapter persists `opaWork` in the existing host state JSON, preserving seats and projects. Arrays and full snapshots are currently unbounded: pagination, ledger compaction and budgets remain future work. Language and read marks are browser-local; tasks and usage are shared host data. Date filters use the viewing browser's local calendar. CSV leaves unknown costs empty and escapes spreadsheet formulas in text cells.
