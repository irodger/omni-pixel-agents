# Read-only Diff Viewer — PR10

Open **Git diff** on a current task attempt or a selected saved attempt. Loading and refreshing are explicit read actions; they never stage, commit, merge, answer permissions, retry work or execute quality checks. No external viewer dependency is installed.

## Two distinct observations

**Recorded commit diff** compares the launch observation's HEAD with the recorded end observation's HEAD. Both must belong to the exact captured cwd/root/common Git directory/per-worktree Git directory. Missing start/end evidence, unborn HEAD, missing objects or deleted/moved/replaced worktrees fail visibly. The current task's newer binding is never substituted for the selected attempt. The worktree must still exist even when commit objects are available elsewhere.

**Current changes** compares the selected attempt's still-matching worktree against its currently observed HEAD, including staged and unstaged tracked changes. Untracked names are listed separately; their contents are not read. This is today's mutable observation, never a reconstruction of the attempt's historical dirty files. Historical dirty contents were not retained by prior increments and remain explicitly unavailable. Unrelated/manual edits can appear in either range; a commit range is not proof that an agent authored each change.

Current HEAD/branch differences from the saved attempt are labelled stale. An old committed range remains anchored to its captured commits; refresh does not replace either endpoint. The base/head and cwd are displayed. Git identity is checked before and after reading. Working text patches and untracked names are sampled twice; changes cause a refresh error rather than a mixed result.

## File list and snapshots

The viewer returns file paths, added/deleted line counts, binary markers and bounded rename detection. Selecting a file includes the list's SHA-256 snapshot token; a changed context/list/text projection rejects the selection. Literal pathspecs prevent filenames from becoming Git patterns. Relative traversal, invalid paths and arbitrary repository/ref inputs are rejected. The server obtains all paths and commit IDs from the selected saved attempt and verified Git observations.

The token fingerprints the bounded textual projection, observed Git identity and list metadata. It does **not** fingerprint binary bytes or untracked file contents, and it is not a quality-gate evidence token. No claim of an atomic filesystem snapshot is made: external edits that change and then restore bytes between reads can escape detection. PR11 must capture its own actual check evidence.

Binary entries have no text preview. Untracked contents are unavailable. A selected text patch is limited to 128 Ki characters with an explicit truncation label. Aggregate reads are capped at 2 MiB and 200 entries; excessive diffs fail with an instruction to use local Git. Rename detection has a bounded candidate limit and subprocess timeouts. The UI keeps patches in memory, escapes them as text and does not persist them in local storage or public links.

**Open current file in VS Code** is offered only when the server verifies a current regular file's canonical path stays inside the captured repository root. Deleted files and external symlink targets have no link. The label deliberately refers to the current file, not a historical blob. Canonical containment is a read-time check, not protection against later external filesystem changes.

## Access and command boundaries

`opaDiffRequest` / `opaDiffState` is supported by the authenticated standalone WebSocket and the VS Code bridge. File contents require the host control token; tokenless observer links receive `READ_ONLY`. There is no new HTTP endpoint. Reconnect/rendering does not request a diff automatically, and stale request/attempt identities are ignored by the UI.

Git uses fixed argv without a shell, optional locks disabled, bounded time/output and disabled hooks/fsmonitor/untracked-cache/clean/process filters. `--no-ext-diff` and `--no-textconv` prevent repository-configured rendering commands. Raw comparison with disabled filters is labelled; it need not match normal filtered Git status. Submodule contents are not traversed. No fetch, checkout, write, staging, commit, push, merge or arbitrary command is provided.

## Verification

Disposable Git fixtures cover two-worktree isolation, committed rename/stats, changed HEAD and dirty snapshots, literal filename handling, missing historical evidence/deleted worktrees, binary/untracked behavior, external symlink containment, large patches, filter/textconv/external-diff suppression, index preservation, authorization and edits racing with reads. Rendering/contract tests cover escaped paths/patches, stale/current labels, binary absence, bounded responses and passive initial rendering. No live/paid model, browser E2E or cross-platform completion is implied by those local checks.
