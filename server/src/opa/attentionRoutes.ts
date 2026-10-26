import type { FastifyInstance, preHandlerHookHandler } from 'fastify';

import type { AgentStateStore } from '../agentStateStore.js';
import { attentionSnapshot } from './attention.js';
export function registerAttentionRoute(
  app: FastifyInstance,
  store: AgentStateStore,
  authenticate: preHandlerHookHandler,
): void {
  app.get<{ Querystring: { projectPath?: string } }>(
    '/api/opa/attention',
    { preHandler: authenticate },
    async (request, reply) => {
      const project = request.query.projectPath;
      if (
        project !== undefined &&
        (typeof project !== 'string' || !project.trim() || project.length > 8192)
      )
        return reply.code(400).send({ error: 'ATTENTION_QUERY_INVALID' });
      try {
        return attentionSnapshot(store, project);
      } catch (error) {
        return reply
          .code(503)
          .send({ error: error instanceof Error ? error.message : 'ATTENTION_UNAVAILABLE' });
      }
    },
  );
}
