# Explicit local task queue (PR7)

Saving, editing, assigning and moving a task are passive. **Start task**, **Retry task**, and **Start next task** are the only launch actions; the UI presents the exact current task title, executor and project and asks for confirmation of possible provider costs. Saving an unavailable executor is permitted for preparation; launching it fails visibly, with no fallback to a different paid provider.

Choose a single project in Tasks to see its persisted queue. Add prepared open/in-progress tasks, move an item earlier, remove it, pause or resume the queue. Pause prevents Start next; it does not cancel an already-running process. Resume never dispatches. A task can belong to the pending queue only once. Closed/cancelled items must be explicitly reopened before queued launch. Editing a queued task changes its current prepared configuration; Start next binds to the task revision shown for confirmation. A status move does not dequeue, launch or cancel work.

Only one task can run in a project. Completion/failure/cancellation does not drain the queue. Reload and restart do not dispatch anything. Existing assigned tasks are not automatically enqueued or started during migration. Different projects have separate queue revisions. Queue storage stays in the existing single-writer local state; there is no distributed scheduler/runner or cross-host locking. Worktree isolation/concurrency remains a future increment.

## UI/API migration

`POST /api/opa/tasks` and `opaTaskCommand` retain passive `create`, `update`, `move` and existing explicit `permission` handling. **Breaking safety change:** create-with-assignee or changed assignment no longer launches. Legacy `launch: true` fails with `EXPLICIT_START_REQUIRED` instead of silently starting or retrying. Save first, then send:

```json
{
  "action": "start",
  "requestId": "unique-human-start",
  "projectPath": "/project",
  "taskId": "task-id",
  "expectedRevision": 3
}
```

Start cannot carry title, status, assignee, permission or launch fields. It uses the captured revision of the saved task and reopens it for this explicit attempt. Queued tasks reject direct Start with `TASK_QUEUED`; use Start next or remove the pending item first. Stale task revisions cannot dispatch twice. Existing explicit stop and permission decisions remain scoped to the live owner/run.

`POST /api/opa/queue` accepts the same queue body as a privileged `opaQueueCommand` (the socket envelope also has `type: opaQueueCommand`). The task-result message acknowledges completion or reports an error. All mutation routes retain bearer/token privileges; observers cannot modify queues. Queue read models arrive in `opaWorkState.queues`, with `projectPath`, `revision`, `paused`, and ordered `taskIds`. A project with no saved queue has revision zero and no pending items. Internal idempotency receipts are not sent to observers.

```json
{"action":"enqueue","requestId":"enqueue-1","projectPath":"/project","expectedRevision":0,"taskId":"task-id","expectedTaskRevision":3}
{"action":"start-next","requestId":"start-1","projectPath":"/project","expectedRevision":1,"taskId":"task-id","expectedTaskRevision":3}
```

Other actions are `remove` with taskId, `reorder` with an exact permutation in taskIds, and `pause`/`resume`. Every command needs expectedRevision; enqueue and Start next also need the current task revision. Start next names the actual queue head, preventing a stale client from starting a newly reordered task.

## Durability, limits and uncertain outcomes

Version-1 queue state is saved alongside tasks, runs and usage. Each queue holds at most 200 pending task IDs and the latest 128 mutation request fingerprints. Unsupported/corrupt queue state fails visibly rather than starting from an empty queue. Failed writes do not publish or launch.

Preflight verifies task/queue revision, head identity, pause, executor, project directory and project ownership. Start next then atomically removes the head and records the request fingerprint **before** dispatching one task. Exact replay of passive commands is a no-op; conflicting reuse of an ID fails. A recorded Start next is never repeated, including after restart: it returns `QUEUE_START_ALREADY_RECORDED`, directing the caller to the current task/run history. Older receipts may be evicted; their old queue revision still rejects stale replay. Direct Start advances the task revision before spawning, so stale resubmission cannot launch twice.

A crash or launch/storage failure between reservation and process creation can leave the task removed but not running. This is an uncertain or failed attempt, not permission to repeat it. Inspect TaskRun history and local host/process state, then explicitly enqueue/start again with current revisions and a new human request. No automatic requeue, retry, process discovery/resume, or paid fallback is provided. If acknowledgement is lost, refresh the read model; the UI never resends execution commands on reconnect.

Attention v2 also records valid Start next preflight failures as immutable metadata. The request receipt and queue revision advance atomically with the failure fact, while the head remains queued. Replaying that failed request returns `QUEUE_START_ALREADY_RECORDED`; correcting availability requires a new explicit request with refreshed revisions. Invalid/stale command identities are rejected before this recording step. Failure to persist the receipt/fact does not dispatch work. See [Attention v2](ATTENTION_V2.md).

Fixtures test the command boundary with local disposable executables, not live models. Event replay and Timeline viewing have no queue dispatch path. Git worktree/cwd binding and a durable unified failure Inbox follow in later increments.
