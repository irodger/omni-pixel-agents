# Omni Pixel Agents (OPA)

A pixel office for Codex, OpenCode and a portable agent activity history.

OPA builds on [Pixel Agents](https://github.com/pixel-agents-hq/pixel-agents). The office, assets, layout editor, browser/VS Code transports and Claude integration come from upstream. OPA adds a provider-independent JSONL event format, Codex JSON-stream normalization, an OpenCode plugin, authenticated ingestion and replay.

This is an early fork maintained at [irodger/omni-pixel-agents](https://github.com/irodger/omni-pixel-agents). No npm or marketplace release has been published. The package remains private until a separate release identity is configured. Existing `pixel-agents` command/settings identifiers and `~/.pixel-agents` storage remain for compatibility; do not run OPA and upstream against the same persisted settings simultaneously.

## Run the office

Requires Node.js 20+.

```sh
npm install
npm run build
node dist/cli.js --port 3100 --no-terminal
```

Open the URL printed by the server. Its token is used by the event bridge. `--no-terminal` makes this an observation-only office; Codex and OpenCode run in your existing terminal.

## Project campus and attention

The app opens on **Campus**. Each observed OPA working directory gets its own office with independent seats, characters and movement. Codex and OpenCode sessions in the same directory share that office. The project list is retained on disk for the current host; an office remains after its last session ends. Empty offices do not resurrect old sessions — replay their journals to restore activity after restarting the server.

**Needs you** lists permission requests first, then failed and completed turns you have not viewed. Requests show elapsed waiting time and are highlighted after two minutes. Opening a completed result marks it read in this browser; opening a permission request cannot approve it. Respond in Codex/OpenCode. A new turn clears the previous result; errors remain distinguishable from successful completion.

Use the project selector to focus one office, or **Back to office** for the original editor and controls. **Campus** returns to the overview. The campus currently uses the existing office layout as the starting design for every project. Individual campus layout editing and desktop notifications remain future features.

Project paths live in `opaProjects` in the host's existing `~/.pixel-agents/<namespace>-state.json`. Read marks are local browser preferences, capped at 2,000 result IDs. Agent activity remains recoverable from the OPA JSONL journal. Only OPA-connected agents appear in Campus; the original office continues to show upstream Claude sessions.

## Language, tasks and expenses

Switch between English and Russian in the header; this browser remembers the choice. User content, paths and source messages retain their original language.

**Tasks** stores a shared project backlog: title, assignee label and status (open, in progress, done, cancelled). Select a project before creating a task. Assignment records ownership; it does not launch an agent. Changes are acknowledged after storage and protected against overwriting a newer revision. The management URL printed by the server enables editing; tokenless connections are read-only.

**Usage & costs** filters observations by project and calendar period, totals tokens, separates source-reported amounts from estimates, and exports CSV. Missing prices remain unknown, including Codex token-only records. A reported amount is source data, not proof of an invoice. Current monetary records use USD; no price table or currency conversion is inferred.

Tasks and usage persist in `opaWork` alongside the project registry. Replaying the same normalized usage journal replaces observations by durable source key instead of adding charges. The draft v0.2 format extends v0.1 with `usage.reported` and `task.upserted`; lifecycle events remain readable as v0.1.

## Codex

Codex's documented `exec --json` output is the supported source. This does not discover existing interactive Codex Desktop/CLI chats.

```sh
export OPA_TOKEN='token-from-the-office-url'
set -o pipefail
codex exec --json 'Summarize this repository' \
  | node dist/opa-bridge.js codex --url http://127.0.0.1:3100 \
  > agent-history.opa.jsonl
```

The bridge writes normalized history to stdout and mirrors it to the office. Source failures map to `turn.failed`; shell `pipefail` also preserves the source command's nonzero exit status. To normalize a saved Codex stream without running an agent:

```sh
node dist/opa-bridge.js codex --cwd /path/to/project < codex.jsonl > agent-history.opa.jsonl
```

## OpenCode

After building, copy `dist/integrations/opa-opencode.mjs` into your project's `.opencode/plugins/opa.ts` (create that directory if needed). This is an explicit project opt-in; OPA does not modify global OpenCode settings.

```sh
export OPA_URL=http://127.0.0.1:3100
export OPA_TOKEN='token-from-the-office-url'
export OPA_LOG="$PWD/agent-history.opa.jsonl"
opencode
```

The plugin observes session, tool, idle, error, permission and completed assistant-message usage events. `OPA_LOG` and live delivery are independently optional. The history file's parent directory must exist. Tool arguments, command output and source payloads are omitted. Delivery errors are reported without interrupting the agent; replay the journal to recover events after an outage. There is no automatic retry or historical catch-up.

For a captured OpenCode plugin event stream (one `{type, properties}` object per line), use `node dist/opa-bridge.js opencode` with the same options as Codex. OpenCode CLI `run --format json` is a different format and is not accepted by this adapter.

## Replay and format

```sh
node dist/opa-bridge.js replay --url http://127.0.0.1:3100 < agent-history.opa.jsonl
```

Replay sends events in file order, without timing delays. The running server ignores previously applied sequence numbers from the same stream. Restart the office for a fresh replay. Journals are the restore source for OPA agents; they are not persisted as Claude transcript sessions.

- [OPA v0.2 format and extension rules](docs/opa/FORMAT.md)
- [Machine-readable JSON Schema](docs/opa/event.schema.json)
- [Fork comparison and borrowing decisions](docs/opa/RESEARCH.md)
- [Sample Codex stream](examples/opa/codex.jsonl)
- [Original upstream documentation](README.upstream.md)

The protocol is a draft, not an established industry standard. The current office shows activity and provider labels. Role/parent metadata is portable but does not yet create role-specific sprites or parent-child visual links. Messages remain in the journal rather than a chat/history panel; the campus shows turn errors in agent details. The `+ Agent` browser action still launches the upstream Claude integration; Codex/OpenCode use the connections above.

## Checks

```sh
npm run check-types
npm run lint
npm test
```

## Attribution and license

Based on Pixel Agents by Pablo De Lucca and contributors, under the [MIT License](LICENSE). Existing copyright and asset credits are preserved. See [upstream asset documentation](README.upstream.md#office-assets). No code or artwork from the compared forks has been copied into this first OPA implementation.
