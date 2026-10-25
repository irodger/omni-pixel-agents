# OPA roadmap and acceptance boundaries

This document separates delivered increments from future work. The product overview and native/ACP v1 adapters are already delivered; see [implemented adapter surfaces](ADAPTERS.md).

## Delivered: Office / Ambient and Kanban (2026-10-26)

- Ambient shows one selected project in a window-filling view, with optional browser fullscreen. Controls, connection state, attention counts and an explicit exit remain visible. Escape exits, focus returns to the entry button, and keyboard focus stays within the mode. Project switching and passive viewing neither acknowledge results nor send execution commands.
- Tasks have List/Board views, with a remembered browser preference and four status columns. Drag/drop and keyboard/touch status selectors use the same revision-checked passive `move` command. A move cannot change assignment, launch a run or cancel one. Running cards cannot move; their explicit Stop agent button retains cancellation control. Stale cards fail instead of overwriting newer work.
- Reconnecting WebSockets request a fresh snapshot without repeating already-sent task commands. Missing connection remains visible in Ambient.

Screenshots use labelled demo events/tasks, not live model runs: [Ambient](../images/ambient.png), [Kanban](../images/kanban.png).

## Delivered: project layout persistence (2026-10-26)

Each project can pin a copy of the shared office, import an exported layout, or reset to the shared fallback. Overrides persist in the adapter state under canonical project paths, including separate revisions after resets. Saves reject stale revisions; resetting one project never writes the shared layout or another project's override. Campus and Ambient use the same override. Each scene retains its own engine and seat assignments.

## Delivered: direct project editor (2026-10-26)

Open **Office decor → Edit project office** to edit an isolated draft with the existing furniture, floor, wall, carpet and pet controls. Dragging, rotation, deletion and undo/redo operate on the draft. Save sends one revision-checked project command; closing asks before discarding dirty changes. Background campus updates never replace a draft or advance its base revision. Conflicts retain the draft and require reopening against the current layout. The native modal traps focus and returns it to the entry button. Read-only/offline state disables editing and saving.

Project editing has no live agent characters or directory-to-area assignment controls. Those remain outside this editor; editing a room cannot assign or launch agents.

## Next increments

| Increment              | Intended result                                             | Required acceptance before calling it done                                                                                                                       |
| ---------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Isolated parallel work | One Git worktree/branch per explicitly launched task        | Verify repository/cwd; retain dirty work; human reviews diff and chooses merge; conflicts remain visible; no automatic commit/push/merge or destructive cleanup  |
| Rest room              | A visual place for agents explicitly reporting a rate limit | Structured provider signal and provenance; reset time only when known; unknown deadlines have no fabricated countdown; retry/resume stays human initiated        |
| More agents            | Verified Copilot, Kilo, Gemini, Qwen and Pi contracts       | Official invocation/schema, captured fixtures and capability matrix; ACP only if actually supported; missing functionality stays unavailable rather than guessed |
| Portable history       | Independent producers/visualizers agree on OPA              | Versioned conformance fixtures, replay/idempotency checks and public RFC; no claim of an industry standard before independent implementations exist              |

The adapter boundary separates observations from commands. Replaying events, reading a result, moving a card or rendering an animation cannot grant permission or launch work. An unsupported transport fails visibly. Switching to another executor is a human decision, never a hidden second paid attempt.

Current execution policy is deliberately small: one OPA task at a time per project, explicit assignment launch, bounded output and local journals. A room is not a scheduler. Worktrees would add isolation before raising that concurrency limit. Existing agent permissions and authentication are not replaced by OPA.
