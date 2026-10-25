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
- No paid agent execution or real billing was used. Assignment does not dispatch work. VS Code transport compiles and shares the task services, but its native UI was not exercised.
- Screenshots: `/private/tmp/opa-tasks-ru.png`, `/private/tmp/opa-usage-ru.png`.
