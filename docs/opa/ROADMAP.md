# OPA roadmap and acceptance boundaries

This document separates delivered increments from future work. The product overview and native/ACP v1 adapters are already delivered; see [implemented adapter surfaces](ADAPTERS.md).

## Delivered: Office / Ambient and Kanban (2026-10-26)

- Ambient shows one selected project in a window-filling view, with optional browser fullscreen. Controls, connection state, attention counts and an explicit exit remain visible. Escape exits, focus returns to the entry button, and keyboard focus stays within the mode. Project switching and passive viewing neither acknowledge results nor send execution commands.
- Tasks have List/Board views, with a remembered browser preference and four status columns. Drag/drop and keyboard/touch status selectors use the same revision-checked passive `move` command. A move cannot change assignment, launch a run or cancel one. Running cards cannot move; their explicit Stop agent button retains cancellation control. Stale cards fail instead of overwriting newer work.
- Reconnecting WebSockets request a fresh snapshot without repeating already-sent task commands. Missing connection remains visible in Ambient.

Screenshots use labelled demo events/tasks, not live model runs: [Ambient](../images/ambient.png), [Kanban](../images/kanban.png).

## Next increments

| Increment              | Intended result                                             | Required acceptance before calling it done                                                                                                                       |
| ---------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project decoration     | Independent persistent layouts and decor                    | Stable project IDs; shared-layout migration fallback; edits and seats isolated across projects; restoring one room cannot overwrite another                      |
| Isolated parallel work | One Git worktree/branch per explicitly launched task        | Verify repository/cwd; retain dirty work; human reviews diff and chooses merge; conflicts remain visible; no automatic commit/push/merge or destructive cleanup  |
| Rest room              | A visual place for agents explicitly reporting a rate limit | Structured provider signal and provenance; reset time only when known; unknown deadlines have no fabricated countdown; retry/resume stays human initiated        |
| More agents            | Verified Copilot, Kilo, Gemini, Qwen and Pi contracts       | Official invocation/schema, captured fixtures and capability matrix; ACP only if actually supported; missing functionality stays unavailable rather than guessed |
| Portable history       | Independent producers/visualizers agree on OPA              | Versioned conformance fixtures, replay/idempotency checks and public RFC; no claim of an industry standard before independent implementations exist              |

The adapter boundary separates observations from commands. Replaying events, reading a result, moving a card or rendering an animation cannot grant permission or launch work. An unsupported transport fails visibly. Switching to another executor is a human decision, never a hidden second paid attempt.

Current execution policy is deliberately small: one OPA task at a time per project, explicit assignment launch, bounded output and local journals. A room is not a scheduler. Worktrees would add isolation before raising that concurrency limit. Existing agent permissions and authentication are not replaced by OPA.
