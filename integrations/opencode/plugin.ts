import { appendFile } from 'node:fs/promises';

import { OpaNormalizer } from '../../core/src/opa/normalize.js';

/** Local OpenCode plugin. No configuration is edited automatically. */
export const OpaPlugin = async ({ directory }: { directory: string }) => {
  const normalizer = new OpaNormalizer('opencode', directory);
  let queue = Promise.resolve();
  return {
    event: async ({ event }: { event: unknown }) => {
      const events = normalizer.normalize(event);
      queue = queue
        .then(async () => {
          for (const e of events) {
            const body = JSON.stringify(e);
            if (process.env.OPA_LOG)
              await appendFile(process.env.OPA_LOG, body + '\n', { mode: 0o600 });
            if (process.env.OPA_URL && process.env.OPA_TOKEN) {
              const response = await fetch(new URL('/api/opa/events', process.env.OPA_URL), {
                method: 'POST',
                headers: {
                  'content-type': 'application/json',
                  authorization: `Bearer ${process.env.OPA_TOKEN}`,
                },
                body,
                signal: AbortSignal.timeout(2000),
              });
              if (!response.ok) throw new Error(`OPA office returned HTTP ${response.status}`);
            }
          }
        })
        .catch((err: unknown) => {
          // An unavailable visualizer must not interrupt the coding agent.
          console.error(`[OPA] ${err instanceof Error ? err.message : 'Event delivery failed'}`);
        });
      await queue;
    },
  };
};
