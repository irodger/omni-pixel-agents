import { createInterface } from 'node:readline';

import { isOpaEvent } from '../../../core/src/opa/events.js';
import { OpaNormalizer } from '../../../core/src/opa/normalize.js';

/** Read source JSONL, write portable OPA JSONL, optionally mirror to an office. */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const provider = args[0];
  if (!['codex', 'opencode', 'replay'].includes(provider)) {
    throw new Error(
      'Usage: node dist/opa-bridge.js codex|opencode|replay [--url http://127.0.0.1:3100] [--cwd /project]. Auth: OPA_TOKEN environment variable. JSONL stdin → OPA JSONL stdout.',
    );
  }
  let url: URL | undefined;
  let cwd = process.cwd();
  for (let i = 1; i < args.length; i += 2) {
    const value = args[i + 1];
    if (!value) throw new Error(`Missing value for ${args[i]}`);
    if (args[i] === '--url') url = new URL('/api/opa/events', value);
    else if (args[i] === '--cwd') cwd = value;
    else throw new Error(`Unknown option ${args[i]}`);
  }
  if (url && !process.env.OPA_TOKEN) throw new Error('Set OPA_TOKEN to the office URL token');
  const normalizer =
    provider === 'replay' ? undefined : new OpaNormalizer(provider as 'codex' | 'opencode', cwd);
  let lineNumber = 0;
  for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
    lineNumber++;
    if (!line.trim()) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      throw new Error(`Invalid JSON at line ${lineNumber}`);
    }
    const events = normalizer ? normalizer.normalize(raw) : isOpaEvent(raw) ? [raw] : undefined;
    if (!events) throw new Error(`Invalid OPA event at line ${lineNumber}`);
    for (const event of events) {
      const body = JSON.stringify(event);
      if (!process.stdout.write(body + '\n'))
        await new Promise<void>((resolve) => process.stdout.once('drain', resolve));
      if (url) {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${process.env.OPA_TOKEN}`,
          },
          body,
          signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) throw new Error(`Office rejected event: HTTP ${response.status}`);
      }
    }
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : 'OPA bridge failed');
  process.exitCode = 1;
});
