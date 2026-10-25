# Omni Pixel Agents

[English](README.md) · [Русский](docs/readme/README.ru.md) · [Deutsch](docs/readme/README.de.md) · [Español](docs/readme/README.es.md)

**Your coding agents, in one living pixel office.**

See which project is moving, which agent needs you, and what a task used — without changing every agent to the same workflow.

![OPA — project campus](docs/images/campus.png)

## What you can do today

- Give each project its own office, with Codex and OpenCode activity in the same view.
- Spot permission requests, failures and unread results; answer source-agent approvals in their own client.
- Watch a selected project in Office/Ambient, optionally full screen; Escape returns you to Campus.
- Organize tasks as a kanban board or list. Drag or select a status without starting or stopping an agent.
- Keep a shared task list, choose an available executor, and start it by saving a new assignment. Results, cancellation and explicit retries stay with the task.
- Inspect tokens and source-reported or estimated costs by project and period. Export CSV; missing prices stay unknown.
- Switch the interface between English and Russian. This README also has German and Spanish editions.
- Keep using the original Pixel Agents office, editor and Claude integration.

## Try it locally

Build from source. Node.js 20+ and npm are required. Install and authenticate your chosen agent separately. Open the management URL printed by the server; tokenless pages are read-only.

```sh
git clone https://github.com/irodger/omni-pixel-agents.git
cd omni-pixel-agents
npm ci
npm run build
node dist/cli.js --port 3100 --no-terminal
```

`--no-terminal`: no embedded terminal; task execution remains available.

## Before you assign a task

A new nonempty executor assignment starts a run after you save it. The task title becomes the prompt, in the selected project folder. The agent uses your existing account/model settings and may incur costs. Status changes alone and journal replay do not launch agents. One OPA task per project runs at a time. After a crash, runs require an explicit decision; they never silently resume.

## How it connects

Codex uses its noninteractive JSON stream; OpenCode supports a plugin and task-run JSON; Claude retains the upstream hooks/transcript path. The adapter layer also accepts explicitly configured ACP v1 agents over stdio. ACP is an additional transport, not a replacement or a promise that every CLI speaks ACP.

ACP permission requests are answered explicitly in the task card; native source approvals remain in their own client.

[Connection guide](docs/opa/GETTING_STARTED.md) · [Adapters & ACP](docs/opa/ADAPTERS.md) · [OPA format](docs/opa/FORMAT.md)

## Screenshots

Real OPA UI captured locally with labelled fixture tasks/events and synthetic usage. They demonstrate the interface, not paid live sessions or invoices. Screenshots may use an earlier UI revision.

![OPA — Office / Ambient](docs/images/ambient.png)

![OPA — Kanban](docs/images/kanban.png)

![OPA — task execution fixture](docs/images/task-run.png)

![OPA — synthetic usage and costs](docs/images/usage.png)

## Early project, clear limits

OPA is a local, source-built fork. No npm/marketplace release or hosted service is offered. The OPA JSONL format is a draft, not an established standard. Native task execution has fixture coverage; a real paid end-to-end run is not claimed. The UI is EN/RU; DE/ES currently apply to the README only.

## What is still on the roadmap

Separate editable project layouts; isolated Git worktrees with reviewed merges; a reliable rate-limit rest room; verified adapters for Copilot, Kilo, Gemini, Qwen and Pi. These are plans, not current integrations.

## Guides & development

[Validation](docs/opa/VALIDATION.md) · [Research](docs/opa/RESEARCH.md) · [Upstream documentation](README.upstream.md)

```sh
npm run build
npm test
```

## Credits

Based on [Pixel Agents](https://github.com/pixel-agents-hq/pixel-agents) by Pablo De Lucca and contributors, under the [MIT License](LICENSE). Original copyright and asset credits are preserved; see [upstream assets](README.upstream.md#office-assets). No code or artwork from the compared forks has been copied.
