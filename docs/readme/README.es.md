# Omni Pixel Agents

[English](../../README.md) · [Русский](README.ru.md) · [Deutsch](README.de.md) · [Español](README.es.md)

**Tus agentes de programación, en una oficina de píxeles con vida.**

Mira qué proyecto avanza, qué agente necesita tu atención y qué recursos consumió una tarea, sin imponer el mismo flujo a todos los agentes.

![OPA — project campus](../../docs/images/campus.png)

## Qué funciona hoy

- Una oficina por proyecto, con actividad de Codex y OpenCode en la misma vista.
- Solicitudes de permisos, errores y resultados sin leer. Las autorizaciones del agente de origen se responden en su propio cliente.
- Observa un proyecto en Office/Ambient, con pantalla completa opcional y salida con Escape.
- Organiza tareas en lista o kanban. Arrastrar o elegir un estado no inicia ni detiene agentes.
- Lista compartida de tareas: elige un ejecutor disponible y guarda la nueva asignación para iniciarlo. El resultado, la cancelación y el reintento explícito quedan en la tarea.
- Tokens y costes informados o estimados por proyecto y periodo. Exportación CSV; un precio ausente sigue siendo desconocido.
- Interfaz en inglés y ruso. Este README también está disponible en alemán y español.
- La oficina original de Pixel Agents, su editor y la integración de Claude siguen disponibles.

## Probar en local

Requiere Node.js 20+ y npm. Instala y autentica tu agente por separado. Abre la URL de gestión que imprime el servidor; sin token la interfaz es de solo lectura.

```sh
git clone https://github.com/irodger/omni-pixel-agents.git
cd omni-pixel-agents
npm ci
npm run build
node dist/cli.js --port 3100 --no-terminal
```

`--no-terminal` desactiva el terminal integrado; la ejecución de tareas sigue disponible.

## Antes de asignar

Una nueva asignación no vacía inicia una ejecución al guardarla. El título se usa como prompt en la carpeta del proyecto. Se utilizan tu cuenta y configuración de modelo; puede haber costes. Cambiar solo el estado o reproducir un diario no inicia agentes. Se ejecuta una tarea OPA por proyecto a la vez. Tras un fallo no hay reanudación automática.

## Conexiones

Codex usa su flujo JSON no interactivo; OpenCode admite eventos de plugin y JSON de tareas. Claude conserva sus hooks y transcripciones. La capa de adaptadores admite además agentes ACP v1 configurados explícitamente por stdio. ACP complementa las conexiones existentes; no convierte cualquier CLI en compatible.

Las solicitudes de permisos ACP se responden explícitamente en la tarea; las autorizaciones nativas siguen en su propio cliente.

[Guía de conexión](../../docs/opa/GETTING_STARTED.md) · [Adaptadores y ACP](../../docs/opa/ADAPTERS.md) · [Formato OPA](../../docs/opa/FORMAT.md)

## Capturas

Interfaz real de OPA capturada localmente con tareas de prueba y consumo sintético identificados. No representa sesiones de pago ni facturas. Las imágenes pueden mostrar una revisión anterior de la interfaz.

![OPA — Office / Ambient](../../docs/images/ambient.png)

![OPA — Kanban](../../docs/images/kanban.png)

![OPA — task execution fixture](../../docs/images/task-run.png)

![OPA — synthetic usage and costs](../../docs/images/usage.png)

## Proyecto temprano: límites

OPA es un fork local que se compila desde el código fuente. No hay publicación en npm/marketplace ni servicio alojado. El formato JSONL de OPA es un borrador, no un estándar consolidado. Los procesos se prueban con clientes de prueba; no se afirma una ejecución integral de pago. La interfaz es EN/RU; DE/ES solo traducen el README por ahora.

## Hoja de ruta

Diseños independientes editables; Git worktrees aislados con fusiones revisadas; sala de descanso con límites de uso fiables; adaptadores verificados para Copilot, Kilo, Gemini, Qwen y Pi. Son planes, no integraciones terminadas.

## Guías y desarrollo

[Validación](../../docs/opa/VALIDATION.md) · [Investigación](../../docs/opa/RESEARCH.md) · [Documentación original](../../README.upstream.md)

```sh
npm run build
npm test
```

## Créditos

Basado en [Pixel Agents](https://github.com/pixel-agents-hq/pixel-agents) de Pablo De Lucca y colaboradores, bajo la [MIT License](../../LICENSE). Se conservan los derechos de autor y créditos originales; véanse [recursos originales](../../README.upstream.md#office-assets). No se ha copiado código ni material gráfico de los forks comparados.
