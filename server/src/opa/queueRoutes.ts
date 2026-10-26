import type { FastifyInstance, preHandlerHookHandler } from 'fastify';

import type { AgentStateStore } from '../agentStateStore.js';
import { executeQueueCommand } from './queue.js';
import { WorkError } from './work.js';
export function registerQueueRoute(
  app: FastifyInstance,
  store: AgentStateStore,
  authenticate: preHandlerHookHandler,
): void {
  app.post<{ Body: Record<string, unknown> }>(
    '/api/opa/queue',
    { preHandler: authenticate },
    async (request, reply) => {
      try {
        executeQueueCommand(store, request.body ?? {});
        return { accepted: true };
      } catch (error) {
        const code = error instanceof WorkError ? error.message : 'QUEUE_INVALID';
        return reply
          .code(code === 'STORAGE_FAILED' ? 503 : code === 'QUEUE_INVALID' ? 400 : 409)
          .send({ error: code });
      }
    },
  );
}
