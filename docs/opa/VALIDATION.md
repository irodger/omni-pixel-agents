# OPA validation

Checked 2026-10-25.

- `npm run build`: passed type checking, lint, extension/CLI/bridge/plugin bundling and webview production build. Upstream retains one React hook dependency warning and a large-bundle advisory.
- Final full server suite: 748 passed (41 files). This includes OPA event ingestion, project separation, durable file-adapter registry storage, waiting time on replay, approval handling and reconnect snapshots.
- Full webview suite: 204 passed (22 files). After the final translation/CSV shortcuts, the four i18n/usage tests and final production build passed again.
- Package contract suite: seven passed. No package was published.
- Batch Codex fixture normalization → JSONL → replay: byte-identical history.
- Built replay bridge → authenticated local HTTP route → browser office: eight demo events delivered.
- Built OpenCode plugin invoked with representative session/status/tool events: journal writing and authenticated delivery verified.
- Browser observation: two demo characters rendered; refreshing restored their state. This uses representative events, not a paid live Codex/OpenCode agent run. Actual OpenCode startup discovery of the installed project plugin remains unverified.
- `git diff --check`: passed.

Local browser previews use isolated temporary homes under `/private/tmp/opa-preview-home` and `/private/tmp/opa-campus-home`, no embedded terminal, and no installed Claude hooks. It does not change the user's normal agent configuration.

`npm audit` reports 12 inherited dependency findings (2 moderate, 9 high, 1 critical). Dependency remediation was not mixed into this integration change. Review/update the inherited lockfile before a public release; a passing functional suite is not a clean dependency audit.

Not run: the full upstream Playwright/VS Code end-to-end suite, a public deployment, a marketplace/npm release, real user session monitoring or a real OpenCode plugin startup. These are not implied by the demo verification.

## Campus browser verification

- Three project offices and four representative Codex/OpenCode agents rendered with independent seats and simulations.
- Working, blocked, successful and failed turns were distinguishable. A permission block older than two minutes was highlighted.
- Opening a successful result reduced the unread count; reloading retained the read mark. Opening a blocked agent did not clear or approve its request.
- After restarting the actual preview server, all three offices were still present with zero active agents. Replaying the 11-event demo history restored the four agents, the original waiting duration and the browser's read marks.
- The campus rendered without hidden legacy-office controls; the original editor remained available through Back to office. Legacy editor keyboard shortcuts are suspended while Campus is open.
- A connection-state race found during browser verification was fixed: initial connection is read again when subscribing, so a connected campus no longer incorrectly says Connecting.
- Office thumbnails fit occupied tiles rather than unused expansion rows. Both narrow and wider in-app layouts were inspected.

Preview: `http://127.0.0.1:3101/`, with demonstration events only. No real user coding tasks were launched. The campus has in-app attention highlighting, not OS notifications, and currently starts every project from the existing shared layout. Individual campus layout editing remains future work.

## Tasks, accounting and language verification

- RU/EN switching updates the page without reload; browser reload preserves the selection. Main campus, task/accounting screens and existing editor/settings labels are localized. Source/user content retains its language.
- Created a Russian demo task through the browser, assigned an ownership label, changed status to in progress. Restarted the actual preview server: task, owner, revision and status survived; the office shortcut showed one active task.
- Three explicitly synthetic usage observations cover Codex unknown price, an OpenCode estimate and a source-reported amount. Project filtering showed 16,000 input / 1,800 output tokens; all-project view showed 17,500 / 2,100. Missing cost remained unknown (1/3), separate from estimated USD 0.0123 and reported USD 0.004.
- After server restart all three observations and Russian language remained visible. Durable replay/replacement, revision conflicts, storage failure acknowledgements, authenticated REST and tokenless WebSocket denial are covered by tests. File adapter tests reopen the actual saved state alongside seats/projects.
- No paid agent execution or real billing was used. At that stage assignment was metadata; the executor-dispatch increment below adds explicit launch on new assignment. VS Code transport compiles and shares the task services, but its native UI was not exercised.
- Screenshots: `/private/tmp/opa-tasks-ru.png`, `/private/tmp/opa-usage-ru.png`.

## Executor dispatch

- 753 server tests (42 files) and 204 UI tests passed; final focused execution/CLI/client-handler tests: 87 passed. Build passes with the inherited hook dependency and chunk-size warnings.
- Five process fixtures verify assignment launches, idempotent create, per-project exclusion, result/usage ingestion and journals, failed exit/retry, cancellation, missing directories/executors and the separate OpenCode run JSON translation. No paid model call is used.
- Executor discovery checks host PATH and a successful `--version`; authentication/quota is checked by the actual client at launch. In this environment the installed OpenCode binary exited with signal 9 during manual help, so it must not be represented as a verified live integration.
- CLI `--no-terminal` now describes embedded terminals only; authenticated task dispatch is a separate process capability. Source journal task events remain inert metadata and do not dispatch on replay.

- Browser dispatch verification used a separate server on port 3102 and an explicit fake Codex executable, isolated home/project, no model calls. Selecting Codex and saving the task changed it to in progress, then done; the returned fixture text was visible in the task. Screenshot: `/private/tmp/opa-auto-assignment.png`. The regular port 3101 preview retains real executable discovery.

## Adapter layer and product documentation (2026-10-25)

- README is a product overview with real, labelled fixture screenshots and separate EN/RU/DE/ES editions. All local Markdown targets were checked. DE/ES are documentation localizations; application UI remains EN/RU. Pixel Agents attribution and original README remain present.
- Build passed (95 generated models), with the inherited React dependency warning and large-chunk advisory. Full server suite: 767 tests / 43 files. Full UI suite: 204 tests / 22 files.
- Adapter tests cover executable discovery, conservative capabilities, malformed config/native fallback, no automatic paid fallback, ACP v1/v2 version mismatch, text/tool normalization, privacy exclusions and cumulative-usage omission, request timeouts/close, unadvertised reverse methods, explicit permission selection/cancellation. Existing native fixtures still pass.
- An actual subprocess fixture exercises ACP initialization → new session → prompt → reverse permission → explicit user reply → result → task completion and portable journal. Stale run/permission decisions are rejected. No third-party live ACP model session was launched.
- Browser verification on isolated port 3102: custom ACP executor appeared alongside Codex; task remained blocked until clicking its explicit allow-once option. It then finished and displayed the fixture result. No model or paid API was called. Screenshot `docs/images/acp-permission.png`; result `/private/tmp/opa-acp-result.png`.
- Native hooks/plugin paths remain intact. Additional CLIs are planned descriptors, not advertised working integrations. ACP HTTP, optional media/modes/session loading, worktree orchestration, rate-limit recovery and UI DE/ES are not claimed.

## Office / Ambient and passive kanban (2026-10-26)

- Build/type/lint passed, retaining only the inherited App hook dependency warning and bundle-size advisory. Full server suite: 769 tests / 43 files. Final full UI suite: 210 tests / 24 files.
- New command-boundary tests verify that moving an assigned card never launches a process, cannot carry title/assignment/launch/permission changes, retains revision checks and cannot cancel a live process. A separate explicit stop still cancels it. UI drag tests cover project identity, stale/deleted/malformed payloads and running-card guards.
- Browser: entered Ambient, tabbed within its controls, switched projects, entered actual browser fullscreen, exited via Escape and regained focus on the launch button. Attention counts stayed unchanged by passive viewing. No permission was answered or result marked read by entering the mode.
- Browser: dragged the demo task Open → In progress, then selected Done using the keyboard. The focus followed the moved card. All four demo statuses and the Board preference survived reload/server restart. These were passive manual task statuses, not live executions.
- Browser on narrow viewport: columns scroll horizontally and native status selectors provide a touch/keyboard alternative. Board's task form opens separately and no task is created by opening it. Screenshots are labelled demo data: `docs/images/ambient.png` and `docs/images/kanban.png`.
- Connection-loss verification found and fixed a missing reconnect handshake in the existing WebSocket transport. Reconnect requests only a fresh `webviewReady` snapshot, never replays already-sent task commands. Two transport fixtures cover this and duplicate/absent initialization. Actual server stop/restart restored Ambient connection and activity without reloading the page.
- No paid agents/models were launched. Project-specific layout editing, worktree isolation/merge and rate-limit room remain on the roadmap. Native touch hardware and every browser's fullscreen denial mode were not exercised; the existing window-filling view remains the fallback.

## 2026-10-26: project layout persistence

- Server: 770 tests across 43 files pass; UI: 210 tests across 24 files pass.
- Added real-file coverage: same basename/different project paths, isolated reset, restart restoration, revision conflict after reset, malformed layout rejection, persistence through agents/seats writes, and no writes to the shared layout file.
- Shared main-office editor remains the design workshop; direct in-project canvas editing is explicitly a future increment.
- Full build and 7 package-contract tests pass. Browser smoke check on isolated demo data: pin shared layout, receive success state, reload and confirm restored project override. Screenshot: `docs/images/project-layout.png`.
