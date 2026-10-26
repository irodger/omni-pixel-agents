# TaskRun history (PR4)

Task attempts are now stored independently of the task's current/latest `execution`. Each version-1 record has project/task/run identity, the title captured on first record, and execution evidence. A retry appends a new attempt; it does not overwrite an earlier result. Active records may receive host updates until terminal. Completed, failed, cancelled and interrupted records reject changes; an identical repeated write is idempotent. Read responses are copies, so callers cannot mutate stored evidence. No history deletion/retention job is added: active and completed attempts are retained.

## Persistence and recovery

History lives in `opaWork.runs` alongside tasks/usage in the existing namespaced host state, with `runHistoryVersion: 1`. Both standalone and VS Code use the shared file adapter. Task and run updates are committed together before snapshots are published. Adapter saves for seats/projects preserve the ledger.

On first load, a legacy latest execution becomes one attempt with only its recorded fields. Earlier overwritten attempts cannot be recovered and are not invented. `titleFromLegacyTask: true` flags the current task title retained during migration; the UI treats the original launch title as unknown instead of claiming that a later edit was the old prompt. Existing `running` markers become durably `interrupted`; missing finish times stay unknown. Transient permission options are stripped from history and stale recovery state. Recovery never launches, retries, approves or kills an agent. If a run loses its live host owner, read projections show it as interrupted; the next run update/restart persists that recovery state. An older terminal record cannot be resumed by reusing its ID.

Unknown ledger versions, malformed/duplicate records and failed migration writes produce explicit errors without replacing the saved history with an empty ledger. Use one host writer per adapter namespace, as for the existing task store. Older builds that predate the ledger must not write the migrated state. This increment preserves all records in local JSON; storage compaction/export and an event-level journal/index are later work (PR5).

## Read API and UI

Authenticated `GET /api/opa/task-runs` requires `projectPath` and `taskId`. Optional `limit` is 1–50 (default 20), `before` is the last run ID from the preceding page, and `runId` retrieves one exact attempt. `before` and `runId` are mutually exclusive. Lists are newest-recorded-first metadata; they omit output/error/usage. An exact run query returns its recorded evidence, including the existing bounded output/usage fields. Invalid cursors fail rather than silently selecting a different page. Scoping applies to both cursor and run lookup. No arbitrary filesystem journal path can be requested.

WebSocket and embedded clients use `opaTaskRunsRequest` with a bounded `requestId`; replies are `opaTaskRunsPage` with `runs`, optional `nextCursor` or an error. This is an explicit observer query under the same local visibility as task snapshots, including tokenless observer WebSockets. It never enters the task-command dispatcher. Other anonymous commands remain denied. REST retains bearer authentication.

Open **Run history** on a task to retrieve metadata pages. Select an attempt to load its evidence and captured title. `#opa?v=1&view=tasks&project=…&task=…&run=…` pins that attempt across reload, browser history and copying a credential-free link. The current task status is labelled as current, not historical. Saved-attempt views hide live task edit/assignment/status/retry/cancel/permission controls; **Return to latest** restores them. An active selected run updates its evidence when the latest snapshot reports a state transition. No attempt selection marks an Inbox result read. Missing runs show an explicit error, with no fallback to a different result.

History pages are loaded on demand, not broadcast as full arrays with every snapshot. Pagination uses append order, not potentially skewed source timestamps. Refresh explicitly fetches the latest page; new attempts do not shift an existing cursor. Previously loaded results remain browsable offline, while host retrieval is unavailable. Full event playback, Timeline and durable Attention reconciliation remain separate increments.

## Verification

Tests cover real file-adapter reloads, two fixture process attempts, immutable/idempotent records, legacy migration, durable interruption without fabricated timestamps, permission stripping, write failures, cursor boundaries, metadata/detail responses, project scoping and HTTP/WebSocket observation privileges. The fixture-only browser scenario covers 21 attempts across two pages, stable selected-run links after reload, unknown/missing run handling, a live-to-terminal update, hidden current permission controls and no execution messages. No paid/live model run is claimed.
