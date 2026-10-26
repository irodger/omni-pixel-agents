import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import Fastify from 'fastify';

import { isOpaEvent } from '../../core/src/opa/events.js';
import type { AgentRuntime } from './agentRuntime.js';
import type { AgentStateStore } from './agentStateStore.js';
import type {
  AssetCache,
  ReloadAssetsSideEffect,
  SetHooksEnabledSideEffect,
} from './clientMessageHandler.js';
import { handleClientMessage } from './clientMessageHandler.js';
import {
  HOOK_API_PREFIX,
  MAX_HOOK_BODY_SIZE,
  WS_CLOSE_FORBIDDEN_ORIGIN,
  WS_CLOSE_UNAUTHORIZED,
} from './constants.js';
import { discoverAdapters } from './opa/adapters/registry.js';
import { opaCampusSnapshot } from './opa/campus.js';
import { executeTaskCommand, stopTaskExecutions } from './opa/execution.js';
import { registerEventHistoryRoute } from './opa/historyRoutes.js';
import { OpaOffice } from './opa/office.js';
import { opaWorkSnapshot, taskRunsPage, WorkError } from './opa/work.js';
import { toPathKey } from './pathKey.js';
import type { PtySessionManager } from './terminal/ptySessionManager.js';
import { registerTerminalRoutes } from './terminal/terminalRoutes.js';
import type { AgentState } from './types.js';
import {
  bearerTokenValid,
  isAllowedWebSocketOrigin,
  privilegedHostnames,
  redactTokenQuery,
  standaloneHandshakeVerdict,
} from './wsAuth.js';

/** Options for creating the HTTP + WebSocket server. */
export interface HttpServerOptions {
  /** true = VS Code embedded mode (ephemeral port, no static, quiet logging) */
  embedded: boolean;
  /** Host to bind to. Default: '127.0.0.1' */
  host?: string;
  /** Port to listen on. Default: 0 (auto-assign) */
  port?: number;
  /** Bearer auth token for hook and WebSocket endpoints */
  token: string;
  /** AgentStateStore for WebSocket broadcast piping */
  store: AgentStateStore;
  /** Shared agent lifecycle core (for toggle side effects + standalone restore). Optional in embedded mode. */
  runtime?: AgentRuntime;
  /** Path to SPA dist directory for static serving (standalone only) */
  staticDir?: string;
  /** Cached assets loaded at startup (standalone only) */
  assetCache?: AssetCache;
  /** Callback when a hook event is received */
  onHookEvent?: (providerId: string, event: Record<string, unknown>) => void;
  /** Invoked when setHooksEnabled is toggled via WebSocket. Standalone installs/uninstalls hooks here. */
  onSetHooksEnabled?: SetHooksEnabledSideEffect;
  /** Invoked when an external asset directory is added/removed. Standalone reloads + re-broadcasts assets here. */
  onReloadAssets?: ReloadAssetsSideEffect;
  /** PTY terminals for standalone-launched agents. Absent = terminal feature off
   *  (VS Code embedded mode, where the editor owns terminals). */
  ptyManager?: PtySessionManager;
  /** Extra Host names (beyond loopback and a specific bind address) a
   *  privileged standalone handshake may arrive under -- e.g. a reverse proxy's
   *  public name. See wsAuth.privilegedHostnames. */
  allowedHosts?: readonly string[];
}

/** Result of createHttpServer(). */
export interface HttpServerHandle {
  app: FastifyInstance;
  port: number;
}

const startTime = Date.now();

/**
 * Create a Fastify server with hook endpoint, health check, and WebSocket support.
 *
 * All Fastify-specific code lives in this file. The rest of the server layer is
 * framework-agnostic. If Fastify is ever replaced, only this file changes.
 */
export async function createHttpServer(options: HttpServerOptions): Promise<HttpServerHandle> {
  const app = Fastify({
    // Standalone logs every request. The privilege token rides `/ws?token=`
    // and `/terminal/:id?token=` handshakes, so the url is redacted before it
    // is written -- otherwise every (re)connect would put the secret in stdout
    // and any log file (see wsAuth.redactTokenQuery).
    logger: options.embedded ? false : { serializers: { req: serializeRequestForLog } },
    bodyLimit: MAX_HOOK_BODY_SIZE,
  });

  await app.register(fastifyCors, { origin: true });
  await app.register(fastifyWebsocket);

  // Static SPA serving (standalone mode only)
  if (!options.embedded && options.staticDir) {
    await app.register(fastifyStatic, {
      root: options.staticDir,
      prefix: '/',
    });
    // HTML5 history fallback: serve index.html for unmatched routes
    app.setNotFoundHandler((_req, reply) => {
      reply.sendFile('index.html');
    });
  }

  // ── Routes ──────────────────────────────────────────────────

  const host = options.host ?? '127.0.0.1';
  const allowedHostnames = privilegedHostnames(host, options.allowedHosts ?? []);

  app.addHook('onClose', async () => {
    stopTaskExecutions(options.store);
  });
  registerHealthRoute(app);
  app.get('/api/opa/adapters', { preHandler: bearerAuth(options.token) }, async () => {
    const { adapters, warning } = discoverAdapters();
    return { adapters, warning };
  });
  app.get<{ Querystring: { projectPath?: string } }>(
    '/api/opa/tasks',
    { preHandler: bearerAuth(options.token) },
    async (request, reply) => {
      if (request.query.projectPath !== undefined && typeof request.query.projectPath !== 'string')
        return reply.code(400).send({ error: 'TASK_INVALID' });
      const tasks = opaWorkSnapshot(options.store).tasks;
      return {
        tasks: request.query.projectPath
          ? tasks.filter((t) => t.projectPath === toPathKey(request.query.projectPath!))
          : tasks,
      };
    },
  );
  registerEventHistoryRoute(app, options.store, bearerAuth(options.token));
  app.get<{ Querystring: Record<string, unknown> }>(
    '/api/opa/task-runs',
    { preHandler: bearerAuth(options.token) },
    async (request, reply) => {
      try {
        const query = { ...request.query };
        if (query.limit !== undefined)
          query.limit =
            typeof query.limit === 'string' && /^\d+$/.test(query.limit)
              ? Number(query.limit)
              : NaN;
        return taskRunsPage(options.store, query);
      } catch (error) {
        const code = error instanceof WorkError ? error.message : 'RUNS_INVALID';
        return reply
          .code(
            ['STORAGE_FAILED', 'HISTORY_UNSUPPORTED', 'HISTORY_INVALID'].includes(code)
              ? 503
              : ['TASK_NOT_FOUND', 'RUN_NOT_FOUND'].includes(code)
                ? 404
                : 400,
          )
          .send({ error: code });
      }
    },
  );
  app.post<{ Body: Record<string, unknown> }>(
    '/api/opa/tasks',
    { preHandler: bearerAuth(options.token) },
    async (request, reply) => {
      try {
        const task = executeTaskCommand(options.store, request.body ?? {});
        options.store.broadcast({ ...opaCampusSnapshot(options.store) });
        return { task };
      } catch (error) {
        const code = error instanceof WorkError ? error.message : 'TASK_INVALID';
        return reply
          .code(code === 'STORAGE_FAILED' ? 503 : code === 'TASK_INVALID' ? 400 : 409)
          .send({ error: code });
      }
    },
  );
  const opaOffice = new OpaOffice(options.store);
  app.post('/api/opa/events', { preHandler: bearerAuth(options.token) }, async (request, reply) => {
    if (!isOpaEvent(request.body))
      return reply.code(400).send({ error: 'Invalid OPA v0.1/v0.2 event' });
    try {
      return { accepted: opaOffice.accept(request.body) };
    } catch (err) {
      return reply
        .code(409)
        .send({ error: err instanceof Error ? err.message : 'Invalid event order' });
    }
  });
  registerHookRoute(app, options);
  registerWebSocketRoute(app, options, allowedHostnames);
  registerTerminalRoutes(app, {
    token: options.token,
    allowedHostnames,
    ptyManager: options.ptyManager,
  });

  // ── Listen ──────────────────────────────────────────────────

  await app.listen({ host, port: options.port ?? 0 });
  const address = app.server.address();
  const port = typeof address === 'object' ? (address?.port ?? 0) : 0;

  return { app, port };
}

// ── Health ──────────────────────────────────────────────────────

function registerHealthRoute(app: FastifyInstance): void {
  app.get('/api/health', async () => ({
    status: 'ok',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    pid: process.pid,
  }));
}

// ── Hook Events ────────────────────────────────────────────────

function registerHookRoute(app: FastifyInstance, options: HttpServerOptions): void {
  app.post<{
    Params: { providerId: string };
    Body: Record<string, unknown>;
  }>(
    `${HOOK_API_PREFIX}/:providerId`,
    {
      preHandler: bearerAuth(options.token),
      schema: {
        params: {
          type: 'object',
          properties: {
            providerId: { type: 'string', pattern: '^[a-z0-9-]+$' },
          },
          required: ['providerId'],
        },
      },
    },
    async (request, reply) => {
      const { providerId } = request.params;
      const event = request.body;

      if (event.session_id && event.hook_event_name) {
        options.onHookEvent?.(providerId, event);
      }

      reply.send('ok');
    },
  );
}

// ── WebSocket ──────────────────────────────────────────────────

function registerWebSocketRoute(
  app: FastifyInstance,
  options: HttpServerOptions,
  allowedHostnames: ReadonlySet<string>,
): void {
  app.get('/ws', { websocket: true }, (socket, request) => {
    // CONNECTION gate. Embedded (VS Code) requires the Bearer token. Standalone
    // requires a same-origin handshake instead (isAllowedWebSocketOrigin), so a
    // non-browser local client with no Origin can still watch the office. What
    // may be DONE over an accepted connection is a separate question, decided
    // below.
    if (options.embedded) {
      if (!bearerTokenValid(request.headers.authorization, options.token)) {
        socket.close(WS_CLOSE_UNAUTHORIZED, 'unauthorized');
        return;
      }
    } else if (!isAllowedWebSocketOrigin(request.headers.origin, request.headers.host)) {
      socket.close(WS_CLOSE_FORBIDDEN_ORIGIN, 'forbidden origin');
      return;
    }

    // Both modes prove privilege with the SAME out-of-band secret, differently
    // carried: embedded sends the Bearer token it was handed in-process;
    // standalone sends the `?token=` the CLI printed in the local URL and the
    // SPA forwarded on this handshake, and it must arrive under an allowed Host
    // -- the same verdict the terminal socket applies. A network POSITION
    // never grants privilege, because every position is reproducible by a
    // forwarder; the Host allowlist can only take it away.
    let privileged = options.embedded;
    if (!options.embedded) {
      const verdict = standaloneHandshakeVerdict(
        request.url,
        request.headers.host,
        options.token,
        allowedHostnames,
      );
      privileged = verdict === 'privileged';
      if (verdict === 'untrusted-host') {
        // The operator has the right URL but reached us under a name they never
        // listed (typically a reverse proxy). Say how to fix it, or the session
        // silently stays watch-only.
        console.warn(
          `[Pixel Agents] Tokened connection via Host "${request.headers.host ?? ''}" is read-only: restart with --allowed-host <that name> to allow changes from it.`,
        );
      }
    }

    const { store } = options;

    // Pipe store events to WebSocket client
    const onAgentAdded = (id: number, agent: AgentState) => {
      safeSend(socket, {
        type: 'agentCreated',
        id,
        directoryName: agent.directoryName,
        isExternal: agent.isExternal || undefined,
        isTeammate: agent.leadAgentId !== undefined || undefined,
        teammateName: agent.agentName,
        parentAgentId: agent.leadAgentId,
        teamName: agent.teamName,
        hooksOnly: agent.hooksOnly || undefined,
        palette: agent.palette,
        hueShift: agent.hueShift,
      });
    };

    const onAgentRemoved = (id: number) => {
      safeSend(socket, { type: 'agentClosed', id });
      safeSend(socket, { ...opaCampusSnapshot(store) });
    };

    const onBroadcast = (message: Record<string, unknown>) => {
      safeSend(socket, message);
    };

    store.on('agentAdded', onAgentAdded);
    store.on('agentRemoved', onAgentRemoved);
    store.on('broadcast', onBroadcast);

    // Handle incoming client messages
    socket.on('message', (data: Buffer | string) => {
      try {
        const msg = JSON.parse(data.toString()) as Record<string, unknown>;
        if (!options.embedded && msg.type) {
          console.log('[Pixel Agents] WS client message:', msg.type);
        }
        handleClientMessage(msg, (m) => safeSend(socket, m), {
          store,
          runtime: options.runtime,
          cache: options.assetCache ?? null,
          onSetHooksEnabled: options.onSetHooksEnabled,
          onReloadAssets: options.onReloadAssets,
          privileged,
          ptyManager: options.ptyManager,
        });
      } catch {
        // Malformed JSON, ignore
      }
    });

    socket.on('close', () => {
      store.off('agentAdded', onAgentAdded);
      store.off('agentRemoved', onAgentRemoved);
      store.off('broadcast', onBroadcast);
    });
  });
}

// ── Auth Helper ────────────────────────────────────────────────

function bearerAuth(expectedToken: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!bearerTokenValid(request.headers.authorization, expectedToken)) {
      reply.code(401).send('unauthorized');
    }
  };
}

// ── Logging ────────────────────────────────────────────────────

/** Fastify's default request serializer, minus the token query. Exported so a
 *  test can pin that the secret never reaches the log line. */
export function serializeRequestForLog(request: FastifyRequest): Record<string, unknown> {
  return {
    method: request.method,
    url: redactTokenQuery(request.url),
    hostname: request.hostname,
    remoteAddress: request.ip,
    remotePort: request.socket.remotePort,
  };
}

// ── Utilities ──────────────────────────────────────────────────

function safeSend(
  socket: { send: (data: string) => void; readyState: number },
  message: Record<string, unknown>,
): void {
  // WebSocket.OPEN = 1
  if (socket.readyState === 1) {
    socket.send(JSON.stringify(message));
  }
}
