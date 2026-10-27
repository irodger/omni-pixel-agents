# Explicit task worktrees — PR9b

Completes the worktree setup/launch-binding step of [#18](https://github.com/irodger/omni-pixel-agents/issues/18), building on [Git observations](GIT_CONTEXT.md). This is local setup and execution control, not a remote Runner or increased parallelism.

## Human actions

Open a current task's **Task worktree** section. Inspect the project's Git context first. **Create worktree and bind** needs a new absolute folder, a new branch name and the full current project HEAD. The parent directory must exist outside any Git worktree. The target must not exist; branch collisions are rejected without force. Git checks out that exact commit into the new worktree, leaving dirty source files untouched. Setup does not start an agent.

**Attach existing worktree** needs its absolute root and exact current HEAD. It must be a different worktree of the same repository, identified by canonical common/per-worktree Git directories and a matching registered worktree path/HEAD/branch. Nested folders, another repository, unborn commits and submodules are rejected. Detached HEAD and dirty/conflicted work may be attached; files are never reset or normalized. A worktree can be bound to only one task at a time.

The browser confirms setup separately from the existing paid-provider Start confirmation. Both setup and Start use the current task revision. `opaWorktreeCommand` (create/attach/detach) is privileged in WebSocket and VS Code; observer messages cannot invoke it. The UI never resends it on reconnect. There is no new HTTP endpoint.

**Detach binding (keep files)** only removes task metadata. It never removes the branch, worktree registration or files. There is no automatic or destructive cleanup command. Changing setup while the task's process is running is rejected.

## Launch and evidence

Start and Start next re-read the canonical project and target directories, repository identity, branch and HEAD. They must match the binding's recorded source/root/common directory and target Git directory/base commit. Deleted, moved or changed contexts fail visibly. A changed branch or HEAD requires a new explicit attachment with the observed target commit and refreshed task revision; no fallback to the project directory is allowed. Dirty file changes alone do not authorize or trigger a rerun and are preserved during an explicit launch.

Native executors and ACP receive the canonical bound cwd. Each TaskRun retains its own cwd and binding/base-commit snapshot, plus start/end Git observations. Journal session events contain actual cwd. Event History metadata and office grouping retain the logical source task project, while event payloads retain actual cwd; this lets task/run Timeline and Inbox links remain stable. Usage projections group under the logical project without rewriting the retained source event. Saved-attempt IDE links use that attempt's cwd, even if the task is later rebound. Current task IDE links use the current binding.

Cancellation and restart do not modify Git data. Interrupted recovery retains recorded cwd and binding evidence and never resumes or reruns. Passive task observations retain the explicit binding. Unsupported/malformed binding metadata fails without overwriting it. Worktree isolation does not raise concurrency: OPA keeps one owned run per canonical project/repository, including aliases and linked-worktree project paths.

## Failures and boundaries

Work-file persistence and Git filesystem changes cannot be one atomic transaction. Git failure/timeout is **uncertain**, not proof that no branch or folder was created. If checkout succeeded but binding persistence failed, OPA reports `WORKTREE_CREATED_NOT_BOUND` and retains the filesystem result. Inspect Git's worktree list, folder and branch, refresh task state, then explicitly attach the existing worktree if appropriate. Repeating Create never overwrites an occupied path. No rollback, branch deletion, prune, hidden retry or automatic merge is performed.

Git setup uses fixed argv without a shell, a bounded subprocess timeout/output and disabled checkout hooks/fsmonitor. Repositories with configured clean/smudge/process filters are excluded from automatic creation; create them with native Git and explicitly attach instead. Attachment/observation disables configured filters and can report unknown dirty state. No arbitrary command field, installer or network exposure is introduced.

Canonical identities are rechecked before launch, but Git and filesystem reads are not a security sandbox or atomic directory-handle transaction. External processes can still alter files/refs during a run; these changes are observed afterward rather than rolled back. Directory permissions and external Git locks remain the user's responsibility. Branch merges, pushes and cleanup remain human decisions. PR10 adds diff viewing, PR11 actual quality gates, and PR12 optional local previews.

## Verification

Disposable repository/process fixtures exercise explicit creation and attachment, detached/dirty contexts, restart retention, alias pinning, foreign/nested/deleted contexts, stale revisions/commits, branch/path collisions, disabled hooks/filters, read-only authorization, storage failure with retained worktrees, actual native cwd/journal/history linkage, saved-attempt evidence, concurrency and dirty-file retention on cancellation. UI rendering checks cover setup-only actions, escaped paths and historical IDE links. These are fixture checks, not live/paid agent runs or cross-platform E2E claims.
