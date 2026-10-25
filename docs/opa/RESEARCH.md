# Что взять в Omni Pixel Agents

Проверено 25 октября 2026. Сравнивались README, LICENSE и исходники в указанных снимках. Это оценка пригодности, а не заявление о функциональной совместимости или полный аудит каждого форка.

## Решение

Основой остаётся свежий [pixel-agents-hq/pixel-agents](https://github.com/pixel-agents-hq/pixel-agents/tree/b1bafd02896d90d83457266575a1e8e5011ce997). В нём уже есть standalone CLI, Fastify/WebSocket, общий `core`, провайдерный интерфейс, импорт ассетов, редактор офиса, команды/субагенты и несколько сред запуска. Перетаскивать старый backend из форка означало бы заново решать уже решённые задачи.

Отличие OPA: независимая, версионируемая история событий и адаптеры Codex/OpenCode. Внутренний `AgentEvent` upstream полезен для отображения, но не является полноценным форматом истории: нет общего envelope с timestamp, stream/event ID, sequence и идентичностью провайдера/агента. Поэтому OPA добавляет обменный формат и отдельную проекцию в существующий офис.

## Сравнение

| Источник                                                                                                              | Что подтверждено                                                                                                                       | Что брать в OPA                                                                             | Решение сейчас                                                                                                                                        |
| --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ZEP](https://github.com/zep-us/zep-pixel-agents/tree/e4e4a934eec32134349b528b594bd4d2bf1f749e)                       | VS Code/Claude, ребрендинг, оформление офиса; в README заявлены worktrees, agent definitions и другие CLI как roadmap                  | Идею тем/паков и отдельных определений персонажей                                           | Использовать уже имеющийся upstream asset pipeline; ZEP-картинки не копировать                                                                        |
| [Standalone](https://github.com/rolandal/pixel-agents-standalone/tree/a8c73c091fa67b908594295af39c038db3ba92f0)       | Express/WebSocket, watcher JSONL Claude, браузерный офис, cmux auto-start hook                                                         | Независимость от IDE, небольшую команду запуска и health check                              | Браузерный режим уже есть в свежем upstream; Express backend и shell-hook не переносить                                                               |
| [Copilot / JetBrains](https://github.com/JirakJ/copilot-pixel-agents/tree/1dc2b83c85e3f0dc675caeef3b37d5d5e083012d)   | Kotlin backend, JCEF, JS bridge с вариантами VS Code/JCEF/browser, монитор Copilot                                                     | Разделение среды запуска и визуализатора; будущий тонкий JetBrains-клиент                   | Архитектурный ориентир. Не переносить монитор Copilot как точный источник событий                                                                     |
| [Pro](https://github.com/Samirkamalsk/pixel-agents-pro/tree/b1124e832e3aabea6bf8dff1f6a8f57e6d8269f4)                 | В снимке структура старого upstream и browser-preview transport; README сохраняет бренд исходного проекта                              | Предпросмотр/фикстуры для разработки визуализатора                                          | В просмотренных файлах нет подтверждённой отдельной pro-функции, ради которой стоит менять базу                                                       |
| [Kiro #6240](https://github.com/kirodotdev/Kiro/issues/6240)                                                          | Запрос на визуализацию ролей и субагентов; обсуждение закрытия как дубля                                                               | Роли coder/tester/designer/docs/operations и явные связи агентов в формате                  | Требования к схеме, не готовый адаптер. Закрытый issue не доказывает реализацию                                                                       |
| [Agent Campus / mateovalle](https://github.com/mateovalle/agent-campus/tree/850c2fea8f6dc9fc68d0ac252280475236f1d876) | Electron-приложение: campus по проектам, SDK-чат, задачи через MCP, usage ledger, attention tracker, роли, расписания и шаблоны комнат | Multi-office, общий backlog, уведомления об ожидании, ролевые образы, разделение usage/cost | Самый содержательный дополнительный источник из просмотренных; переносить отдельными слоями через OPA, не заменять провайдерный backend на Claude SDK |

## Детали, влияющие на реализацию

### Standalone

[`scripts/cmux-hook.sh`](https://github.com/rolandal/pixel-agents-standalone/blob/a8c73c091fa67b908594295af39c038db3ba92f0/scripts/cmux-hook.sh) проверяет доступность сервера, хранит PID и запускает процесс. Полезна идея автозапуска, но конкретный скрипт содержит путь/порт и завершает процесс по сохранённому PID. В OPA пока явный запуск сервера. Автозапуск можно добавить отдельно с проверкой идентичности процесса и собственным состоянием OPA.

### Copilot

[`CopilotMonitorService.kt`](https://github.com/JirakJ/copilot-pixel-agents/blob/1dc2b83c85e3f0dc675caeef3b37d5d5e083012d/src/main/kotlin/com/jirakj/pixelagents/services/CopilotMonitorService.kt) считает хеш границ/числа дочерних UI-компонентов и по изменениям/таймеру переключает active/idle. Это эвристика интерфейса. Из неё нельзя надёжно получить название инструмента, результат, ошибку или реальный дочерний агент. Для общего журнала такой источник должен явно объявлять ограниченные возможности, а не выдумывать события.

[`webview-ui/src/bridge/`](https://github.com/JirakJ/copilot-pixel-agents/tree/1dc2b83c85e3f0dc675caeef3b37d5d5e083012d/webview-ui/src/bridge) показывает полезное отделение транспорта. Текущий upstream уже разделяет браузерный и VS Code transport. Возможный JetBrains frontend должен читать тот же OPA-протокол, не содержать отдельную копию нормализаторов.

### Pro

Название репозитория не является доказательством дополнительных возможностей. В просмотренном снимке есть dev-preview, но нет подтверждённой самостоятельной реализации Codex/OpenCode, token-health, Kanban или общего журнала. Эти функции не следует приписывать форку по его названию. Проверка ограничена текущим default-branch snapshot; другие ветки/релизы не исследованы.

### Kiro

[Комментарии](https://github.com/kirodotdev/Kiro/issues/6240#issuecomment-4020357789) показывают автоматическое закрытие как дубля, возражение автора и последующий вопрос о переоткрытии. Поэтому статус `closed/completed` здесь не подтверждает работающую интеграцию. Из запроса можно взять предметную модель: роль, родитель, сессия, активность, ожидание разрешения. В OPA v0.1 добавлены роль/parent metadata; визуальное отображение и точный multi-agent mapping ещё впереди.

### Agent Campus (бывший mateovalle/pixel-agents)

[Старая ссылка](https://github.com/mateovalle/pixel-agents) теперь ведёт на маленький redirect-репозиторий: README прямо сообщает о переезде в [mateovalle/agent-campus](https://github.com/mateovalle/agent-campus). Исследован снимок `850c2fea8f6dc9fc68d0ac252280475236f1d876`, package version `0.3.0`. Приложение не устанавливалось и не запускалось; выводы ниже основаны на коде, а не на рекламном описании.

Подтверждены отдельные подсистемы:

- **Несколько офисов.** [`campusState.ts`](https://github.com/mateovalle/agent-campus/blob/850c2fea8f6dc9fc68d0ac252280475236f1d876/webview-ui/src/office/engine/campusState.ts) владеет отдельным `OfficeState` для каждого workspace, хранит override планировки и располагает офисы на общей карте. [`workspaces.ts`](https://github.com/mateovalle/agent-campus/blob/850c2fea8f6dc9fc68d0ac252280475236f1d876/electron/workspaces.ts) сохраняет реестр проектов. Для OPA: независимая от provider привязка agent → project → office, отдельная планировка на проект.
- **Backlog человека и агента.** [`todos.ts`](https://github.com/mateovalle/agent-campus/blob/850c2fea8f6dc9fc68d0ac252280475236f1d876/electron/todos.ts) хранит задачи по workspace; [`chatAgent.ts`](https://github.com/mateovalle/agent-campus/blob/850c2fea8f6dc9fc68d0ac252280475236f1d876/electron/chatAgent.ts) предоставляет агенту MCP-инструменты `list_tasks`, `add_task`, `complete_task`. [`main.ts`](https://github.com/mateovalle/agent-campus/blob/850c2fea8f6dc9fc68d0ac252280475236f1d876/electron/main.ts) содержит campus-ассистента с инструментами статуса, задач и создания агентов. Для OPA: общий task store плюс отдельные команды управления; наблюдаемый журнал сам по себе не должен разрешать запуск агента.
- **Внимание пользователя.** [`attention.ts`](https://github.com/mateovalle/agent-campus/blob/850c2fea8f6dc9fc68d0ac252280475236f1d876/electron/attention.ts) — чистая state machine без импорта Electron: pending request IDs, blockedSince, unread, acknowledge и однократное уведомление о затянувшемся ожидании. Это хороший кандидат на независимую модель OPA; браузерные/desktop уведомления будут отдельными consumers. Не следует считать завершённый ход блокировкой на разрешении.
- **История usage и стоимости.** [`usage.ts`](https://github.com/mateovalle/agent-campus/blob/850c2fea8f6dc9fc68d0ac252280475236f1d876/electron/usage.ts) пишет JSONL и агрегирует по проектам/дням. Код прямо оговаривает API-equivalent estimate, а не платёжный документ; это уточняет обещание «exact costs» из README. В `chatAgent.ts` предусмотрен расчёт дельты накопленной суммы. Для OPA будущие usage-события должны различать токены, reported/estimated cost, валюту, окно измерения и cumulative/delta; неизвестная стоимость не должна превращаться в ноль.
- **Образы ролей, комнаты и поведение.** [`shared/protocol.ts`](https://github.com/mateovalle/agent-campus/blob/850c2fea8f6dc9fc68d0ac252280475236f1d876/shared/protocol.ts) описывает role skins, room templates и взаимодействия мебели `use`/`look`. В `scripts/asset-gen/` есть генераторы, экспортеры и превью, а в UI — room-template tooling. Можно адаптировать как отдельный пак к текущим manifests OPA; автоматическая совместимость форматов ассетов не проверена.
- **Расписания.** [`schedules.ts`](https://github.com/mateovalle/agent-campus/blob/850c2fea8f6dc9fc68d0ac252280475236f1d876/electron/schedules.ts) хранит daily/weekly/interval dispatch. Это возможный поздний этап оркестрации, а не требование к базовому визуализатору.

**Приоритет переноса в OPA:** (1) multi-office/project identity, (2) attention tracker и история ожиданий, (3) общий backlog и task events, (4) usage ledger с явной семантикой метрик, (5) комнаты/ролевые паки, (6) чат, ассистент и расписания через capabilities конкретных провайдеров. Это план кандидатов, не уже реализованные функции.

**Архитектурная граница:** UI, projections и presentation-паки можно переиспользовать после адаптации. `electron/chatAgent.ts`, авторизация, управление сессиями и MCP registration связаны с Claude Agent SDK; прямой перенос этого backend не даёт поддержку Codex/OpenCode. Для OPA журнал наблюдений остаётся отдельным от control API (создать/остановить агента, отправить сообщение, ответить на approval). В существующий v0.1 новые event families не добавлялись: сначала нужны fixtures и согласование семантики, затем следующая версия.

**Лицензия:** [LICENSE](https://github.com/mateovalle/agent-campus/blob/850c2fea8f6dc9fc68d0ac252280475236f1d876/LICENSE) — MIT, Copyright Pablo De Lucca; README также заявляет оригинальные MIT-ассеты. Перед фактическим переносом конкретных файлов сохранить notices, ссылку на Agent Campus и проверить относящиеся к паку credits. В этом проходе код и изображения Agent Campus не копировались в OPA, дополнено только исследование.

## Лицензии и происхождение

Четыре первоначальных code-репозитория содержат MIT LICENSE; пятый, Agent Campus, рассмотрен отдельно выше:

- [ZEP LICENSE](https://github.com/zep-us/zep-pixel-agents/blob/e4e4a934eec32134349b528b594bd4d2bf1f749e/LICENSE): Pablo De Lucca.
- [Standalone LICENSE](https://github.com/rolandal/pixel-agents-standalone/blob/a8c73c091fa67b908594295af39c038db3ba92f0/LICENSE): Pablo De Lucca, Roland Ligtenberg.
- [Copilot LICENSE](https://github.com/JirakJ/copilot-pixel-agents/blob/1dc2b83c85e3f0dc675caeef3b37d5d5e083012d/LICENSE): JirakJ; README также ссылается на исходный Pixel Agents.
- [Pro LICENSE](https://github.com/Samirkamalsk/pixel-agents-pro/blob/b1124e832e3aabea6bf8dff1f6a8f57e6d8269f4/LICENSE): Pablo De Lucca.

При переносе кода нужны сохранённые notices соответствующих авторов. Лицензия кода не заменяет лицензию внешних картинок: ZEP и Standalone отдельно описывают покупаемый Donarg tileset. Поэтому из этих форков в первую реализацию не копировались код или ассеты. Используется upstream с его существующими LICENSE и credits; его README сохранён целиком как `README.upstream.md`.

## Что реализовано в этом проходе

1. OPA v0.1: JSONL, JSON Schema, runtime validation, event/stream identity, sequence, tool correlation, session/turn/permission lifecycle и message/error records.
2. Codex `exec --json` → OPA → офис; OpenCode plugin events → OPA → офис; batch/replay bridge.
3. Аутентифицированный HTTP ingress с проверкой структуры и порядка, разделение агентов разных провайдеров, подавление повторов.
4. OPA push-агенты отделены от Claude transcript scanning/persistence. При переподключении браузер получает сохранённые активные tool IDs через существующий resend-механизм.
5. Бренд Omni Pixel Agents в названии расширения, browser title/manifest, приветствии и CLI banner; alias `opa`. Внутренние upstream settings/command IDs сохранены для совместимости.

## Следующие самостоятельные этапы

- Выбор Codex/OpenCode в UI запуска, отдельные настройки/хранилище OPA и удалённый GitHub fork с собственным release identity.
- Read-only адаптер для уже запущенных интерактивных Codex-сессий: отдельная проверка source contract, а не обещание совместимости с `exec`.
- История/таймлайн, различимые ошибки, фильтры provider/project/role, реальные parent-child линии.
- Usage/budget events, file-change summaries, delegation/inter-agent messages, формальное определение capabilities.
- Conformance fixtures/validator как отдельный пакет, политика совместимости и публичный RFC. Сначала несколько независимых производителей/потребителей, потом заявление о стандарте.

## Реализация первого этапа Agent Campus → OPA

Реализованы первые два направления: отдельные офисы по рабочим каталогам и учёт внимания. Код написан поверх текущего движка OPA; исходники и изображения Agent Campus не копировались.

- Каждый проект владеет отдельным `OfficeState`; места и персонажи проектов не конкурируют между собой. Начальный дизайн берётся из существующей планировки, отдельное редактирование дизайна каждого кампусного офиса пока не добавлено.
- `opaCampusState` передаёт полный снимок проектов и статусов при изменениях и переподключении. В JSONL v0.1 новые типы событий не вводились.
- Реестр офисов сохраняется в реальном файловом адаптере. Поддерживаются одинаковые имена папок с разными путями и разные провайдеры внутри одного проекта.
- Различаются работа, ожидание разрешения, успешный результат и ошибка; есть время ожидания, выделение после двух минут и отметки прочитанного по event ID.
- Запрос разрешения остаётся до ответа в исходном агенте. Кампус не подменяет control API; desktop notifications, backlog, usage и оркестратор остались следующими этапами.

## Второй этап: язык, задачи и расходы

Добавлены переключение RU/EN, общий постоянный backlog проекта, исполнитель-метка, статусы и защита правок по revision. Назначение не запускает агента. HTTP API позволяет подключать производителей без привязки к конкретному клиенту.

OPA v0.2 расширяет журнал событиями задач и usage, сохраняя чтение v0.1. Учёт токенов/денег хранится отдельно от живых персонажей, повтор журнала не удваивает расходы. Неизвестная цена отличается от нуля, оценки — от сумм источника; есть периоды, проекты и CSV. Бюджеты, счета и автоматическое выполнение задач остаются следующими этапами. Код и ассеты сравниваемых форков не копировались.
