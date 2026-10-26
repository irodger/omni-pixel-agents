# Attention v2 (PR8)

The Attention tab combines recorded task outcomes, permission requests, source events and queue-start failures. Campus, office and Ambient counters use the same active Inbox projection. Opening a card only navigates to the saved task attempt or Timeline; approvals remain on authenticated current-run task controls or in the source client.

## Facts and personal marks

Facts retain exact project/task/run/request identities and captured metadata. Answering a task permission records its decision alongside the work-state update; queue-start failures are recorded alongside their request receipt. No raw output, permission options, callbacks, tool arguments or arbitrary execution commands are copied into attention metadata. Terminal task outcomes reuse the retained TaskRun ledger; source observations reuse Event History. Duplicate result representations are joined only by exact project/provider/session/agent/event evidence and compatible supplied task/run context, never by title or nearby timestamps.

Current, resolved and stale permissions are reconciled separately from their recorded facts. A decision for one attempt cannot resolve another attempt's request with the same permission ID. Portable source requests lack individual approval IDs: reconciliation stays within the recorded stream and task/run episode. Older or ambiguous requests remain stale. If retention removes a still-owned pending task request, it remains visible as a live snapshot with unknown request time. Fixture evidence and live-only snapshots are labelled explicitly.

Read, snooze for ten minutes, dismiss and restore are personal presentation actions. They never approve, launch, retry, dequeue, merge or resolve a source fact. Current blocks cannot be marked read or dismissed; snoozing temporarily removes them from the active count while preserving their current-block status. They return when the delay expires. Resolved and stale blocks remain accessible under All. New attempts have independent identities.

Marks are stored under the persistent OPA host ID in this browser origin/profile's local storage, bounded to 2,000 entries, and synchronized between same-origin tabs. They are not shared with other users, devices, browser profiles or origins. Attention Lite's old marks have no host identity and are intentionally not migrated or erased. Unsupported/corrupt preferences remain untouched; a warning and in-memory marks are used until an explicit Reset personal marks. Clearing browser storage clears personal marks, not server facts.

## Retrieval and limits

`opaAttentionRequest` / `opaAttentionState` is an observer query available through WebSocket and the VS Code bridge. `GET /api/opa/attention?projectPath=…` provides the same passive read model under the existing HTTP bearer-auth policy. Neither path probes executor versions, discovers executors, dispatches work or answers permissions. Invalid filters fail; unsupported/corrupt work storage is not silently overwritten.

The work file has a versioned attention section, stable host ID and at most 2,000 immutable permission/queue facts with a dropped-fact counter. Attention reads the bounded Event History window and at most the last 2,000 TaskRun metadata records. The response is capped at 2,000 items with an explicit limited marker and retention counters; current blocks have priority, followed by errors and results, newest known observation first. Unknown timestamps remain unknown. The UI renders 100 matching cards at a time with Show more, supports project/type/status filters and project or task/attempt grouping. This is bounded local history, not an unlimited audit log.

Refresh and reconnect never mark entries read. Cached facts and local presentation remain usable offline; refresh failures are visible. While a v2 snapshot is unavailable, Attention Lite provides the current-state fallback. No system notifications, cloud Inbox, remote Runner or paid recovery are added.

## Check-result boundary

`OpaCheckObservation` defines the future PR11 evidence contract: exact task/run/worktree/head identity, process or fixture provenance, start time, and passed/failed/skipped/unknown/stale state. Passed requires an observed finish time and zero exit code; failed requires a finish time and reason. PR8 supplies no check executor or result-ingestion endpoint and produces no synthetic check results. PR11 must validate actual evidence before publishing check facts.

## Verification

Backend and UI tests cover durable request decisions and queue failures, atomic write failures, restart/retention, exact attempt identity, source-stream reconciliation, malformed versions, personal storage bounds, stale actions, snooze expiry, shared counters and escaped rendering. Local browser verification uses a disposable in-memory host with explicitly labelled fixture events; no live or paid AI agent is launched.
