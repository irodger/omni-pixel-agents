# Omni Pixel Agents

Projekte können eigene Grundrisse speichern: gemeinsames Büro kopieren, Layout importieren oder nur dieses Projekt zurücksetzen. Möbel, Böden und Wände können direkt im Projekt bearbeitet werden, mit getrenntem Entwurf, Rückgängig/Wiederholen und explizitem Speichern.

[English](../../README.md) · [Русский](README.ru.md) · [Deutsch](README.de.md) · [Español](README.es.md)

**Deine Coding-Agenten in einem lebendigen Pixelbüro.**

Sieh, welches Projekt vorankommt, welcher Agent dich braucht und welche Ressourcen eine Aufgabe verbraucht — ohne allen Agenten denselben Arbeitsablauf aufzuzwingen.

## Unterstützte Agenten

| Agent                 | Verbindung mit OPA                                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🤖 **Codex**          | Aktivität und Aufgabenausführung über `codex exec --json`. Bestehende Codex-Desktop- oder interaktive CLI-Chats werden nicht automatisch erkannt. |
| 🧩 **OpenCode**       | Live-Ereignisse über das OPA-Plugin; Aufgabenausführung über `opencode run --format json`.                                                        |
| ✳️ **Claude Code**    | Ursprüngliches Pixel-Agents-Büro, Hooks/Transkripte und bisherige Startfunktionen. Noch kein Eintrag in der OPA-Aufgabenzuweisung.                |
| 🔌 **ACP-v1-Agenten** | Zusätzlicher stdio-Adapter für einen ausdrücklich konfigurierten kompatiblen Agenten. Prompts, Abbruch und menschliche Freigaben.                 |

Den gewählten Client separat installieren und anmelden. Die Aufgabenliste zeigt startfähige Clients auf dem OPA-Rechner. Siehe [Verbindungsanleitung](../../docs/opa/GETTING_STARTED.md) und [Adapterdetails](../../docs/opa/ADAPTERS.md).

**Nur Roadmap:** Copilot, Kilo, Gemini, Qwen und Pi haben noch keine geprüften integrierten Adapter. Eine ausdrücklich konfigurierte ACP-Implementierung ist eine separate Verbindung, keine automatische Unterstützung beliebiger CLIs.

![OPA — project campus](../../docs/images/campus.png)

## Was heute funktioniert

- Ein eigenes Büro pro Projekt, mit Codex- und OpenCode-Aktivität in einer Ansicht.
- Berechtigungsanfragen, Fehler und ungelesene Ergebnisse erkennen. Freigaben des ursprünglichen Agenten erfolgen in dessen Client.
- Ein Projekt in Office/Ambient beobachten, optional im Vollbild; Escape führt zum Campus zurück.
- Aufgaben als Liste oder Kanban anzeigen. Verschieben oder Statuswahl startet oder stoppt keinen Agenten.
- Gemeinsame Aufgabenliste: einen verfügbaren Agenten wählen und die neue Zuweisung zum Start speichern. Ergebnis, Abbruch und bewusster Neustart bleiben an der Aufgabe.
- Token und gemeldete oder geschätzte Kosten nach Projekt und Zeitraum ansehen. CSV exportieren; fehlende Preise bleiben unbekannt.
- Die Oberfläche zwischen Englisch und Russisch umschalten. Dieses README gibt es auch auf Deutsch und Spanisch.
- Das ursprüngliche Pixel-Agents-Büro, den Editor und die Claude-Integration weiterverwenden.

## Lokal ausprobieren

Node.js 20+ und npm sind erforderlich. Den gewünschten Agenten separat installieren und anmelden. Die vom Server ausgegebene Verwaltungsadresse öffnen; ohne Token ist die Oberfläche schreibgeschützt.

```sh
git clone https://github.com/irodger/omni-pixel-agents.git
cd omni-pixel-agents
npm ci
npm run build
node dist/cli.js --port 3100 --no-terminal
```

`--no-terminal` deaktiviert das eingebettete Terminal; Aufgaben können weiterhin ausgeführt werden.

## Vor der Zuweisung

Eine neue Agentenzuweisung startet nach dem Speichern einen Lauf im gewählten Projektordner. Der Aufgabentitel dient als Prompt. Vorhandene Konto- und Modelleinstellungen gelten; Kosten können entstehen. Reine Statusänderungen und Journal-Wiedergaben starten nichts. Pro Projekt läuft eine OPA-Aufgabe gleichzeitig. Nach einem Absturz gibt es keine automatische Fortsetzung.

## Verbindungen

Codex nutzt den nichtinteraktiven JSON-Stream; OpenCode unterstützt Plugin-Ereignisse und Task-JSON. Claude behält die bisherigen Hooks und Transkripte. Der Adapter unterstützt zusätzlich explizit konfigurierte ACP-v1-Agenten über stdio. ACP ersetzt die bestehenden Wege nicht; nicht jeder CLI unterstützt ACP.

ACP-Berechtigungsanfragen werden ausdrücklich in der Aufgabenkarte beantwortet; native Freigaben bleiben im jeweiligen Client.

[Verbindungsanleitung](../../docs/opa/GETTING_STARTED.md) · [Adapter & ACP](../../docs/opa/ADAPTERS.md) · [OPA-Format](../../docs/opa/FORMAT.md)

## Screenshots

Echte, lokal aufgenommene OPA-Oberfläche mit gekennzeichneten Testaufgaben und synthetischen Verbrauchsdaten. Keine bezahlten Live-Sitzungen oder Rechnungen. Die Bilder können einen früheren UI-Stand zeigen.

![OPA — Office / Ambient](../../docs/images/ambient.png)

![OPA — Kanban](../../docs/images/kanban.png)

![OPA — task execution fixture](../../docs/images/task-run.png)

![OPA — synthetic usage and costs](../../docs/images/usage.png)

## Frühes Projekt: Grenzen

OPA ist ein lokaler Fork zum Selbstbauen. Keine npm-/Marketplace-Veröffentlichung und kein gehosteter Dienst. Das OPA-JSONL-Format ist ein Entwurf, kein etablierter Standard. Prozessstarts sind mit Test-Clients geprüft; ein bezahlter End-to-End-Lauf wird nicht behauptet. Die Oberfläche ist EN/RU; DE/ES gelten derzeit nur für das README.

## Roadmap

Getrennte bearbeitbare Raumlayouts; isolierte Git-Worktrees mit geprüften Merges; ein zuverlässiger Ruhebereich bei Rate Limits; geprüfte Adapter für Copilot, Kilo, Gemini, Qwen und Pi. Das sind Pläne, keine fertigen Integrationen.

## Anleitungen und Entwicklung

[Prüfungen](../../docs/opa/VALIDATION.md) · [Recherche](../../docs/opa/RESEARCH.md) · [Originaldokumentation](../../README.upstream.md)

```sh
npm run build
npm test
```

## Danksagung

Basiert auf [Pixel Agents](https://github.com/pixel-agents-hq/pixel-agents) von Pablo De Lucca und Mitwirkenden, unter der [MIT License](../../LICENSE). Ursprüngliche Urheber- und Grafiknachweise bleiben erhalten; siehe [Originalgrafiken](../../README.upstream.md#office-assets). Aus den verglichenen Forks wurden weder Code noch Grafiken kopiert.
