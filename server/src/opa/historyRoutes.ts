import type { FastifyInstance, preHandlerHookHandler } from 'fastify';

import type { AgentStateStore } from '../agentStateStore.js';
import { HistoryError, historyJsonl, historyPage } from './history.js';

export function registerEventHistoryRoute(
  app: FastifyInstance,
  store: AgentStateStore,
  authenticate: preHandlerHookHandler,
): void {
  app.get<{ Querystring: Record<string, unknown> }>(
    '/api/opa/history',
    { preHandler: authenticate },
    async (request, reply) => {
      try {
        const query = { ...request.query };
        for (const field of ['limit', 'before'])
          if (query[field] !== undefined)
            query[field] =
              typeof query[field] === 'string' && /^\d+$/.test(query[field] as string)
                ? Number(query[field])
                : NaN;
        if (query.format !== undefined && query.format !== 'jsonl' && query.format !== 'json')
          return reply.code(400).send({ error: 'EVENT_HISTORY_QUERY_INVALID' });
        const page = historyPage(store, query);
        return query.format === 'jsonl'
          ? reply.type('application/x-ndjson').send(historyJsonl(page))
          : page;
      } catch (error) {
        const code = error instanceof HistoryError ? error.message : 'EVENT_HISTORY_QUERY_INVALID';
        return reply
          .code(
            [
              'EVENT_HISTORY_INVALID',
              'EVENT_HISTORY_VERSION',
              'EVENT_HISTORY_STORAGE_FAILED',
            ].includes(code)
              ? 503
              : code === 'EVENT_HISTORY_CURSOR_EXPIRED'
                ? 409
                : 400,
          )
          .send({ error: code });
      }
    },
  );
}
