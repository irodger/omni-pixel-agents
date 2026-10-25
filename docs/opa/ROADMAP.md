# OPA roadmap and acceptance boundaries

This is a plan, not a feature inventory. The current increment is the four-language product README and extensible native/ACP v1 adapters; see [implemented adapter surfaces](ADAPTERS.md).

| Increment              | Intended result                                             | Required acceptance before calling it done                                                                                                                       |
| ---------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Office / Ambient       | A full-screen room for passive observation                  | Enter/exit and Escape work; controls remain reachable; connection/attention state stays truthful; no new execution side effects                                  |
| Kanban                 | Board over the existing durable tasks                       | Keyboard/touch alternatives; revision conflicts handled; a move changes status only; assignment/launch and cancellation remain explicit separate actions         |
| Project decoration     | Independent persistent layouts and decor                    | Stable project IDs; shared-layout migration fallback; edits and seats isolated across projects; restoring one room cannot overwrite another                      |
| Isolated parallel work | One Git worktree/branch per explicitly launched task        | Verify repository/cwd; retain dirty work; human reviews diff and chooses merge; conflicts remain visible; no automatic commit/push/merge or destructive cleanup  |
| Rest room              | A visual place for agents explicitly reporting a rate limit | Structured provider signal and provenance; reset time only when known; unknown deadlines have no fabricated countdown; retry/resume stays human initiated        |
| More agents            | Verified Copilot, Kilo, Gemini, Qwen and Pi contracts       | Official invocation/schema, captured fixtures and capability matrix; ACP only if actually supported; missing functionality stays unavailable rather than guessed |
| Portable history       | Independent producers/visualizers agree on OPA              | Versioned conformance fixtures, replay/idempotency checks and public RFC; no claim of an industry standard before independent implementations exist              |

The adapter boundary separates observations from commands. Replaying events, reading a result, moving a card or rendering an animation cannot grant permission or launch work. An unsupported transport fails visibly. Switching to another executor is a human decision, never a hidden second paid attempt.

Current execution policy is deliberately small: one OPA task at a time per project, explicit assignment launch, bounded output and local journals. A room is not a scheduler. Worktrees would add isolation before raising that concurrency limit. Existing agent permissions and authentication are not replaced by OPA.
