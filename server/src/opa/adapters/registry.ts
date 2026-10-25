import { execFileSync } from 'node:child_process';
import { accessSync, constants, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';

import { nativeAdapters } from '../../../../core/src/opa/adapters/native.js';
import type {
  AdapterCapabilities,
  AdapterDescription,
} from '../../../../core/src/opa/adapters/types.js';
export interface ExecutorDefinition {
  id: string;
  name: string;
  command: string;
  args: string[];
  transport: 'native-jsonl' | 'acp-stdio';
  provider: string;
  versionArgs: string[];
}
const capabilities = (commands: boolean, permissions = false): AdapterCapabilities => ({
  observe: true,
  prompt: commands,
  cancel: commands,
  permissions,
  loadSession: false,
});
const native: ExecutorDefinition[] = nativeAdapters.map((adapter) => ({
  id: adapter.id,
  name: adapter.name,
  provider: adapter.id,
  command: adapter.executable,
  args: [],
  versionArgs: ['--version'],
  transport: 'native-jsonl',
}));
export function parseAcpConfig(raw: unknown): ExecutorDefinition[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('Invalid adapter configuration');
  const config = raw as Record<string, unknown>;
  if (config.version !== 1 || !Array.isArray(config.agents) || config.agents.length > 50)
    throw new Error('Expected adapter config version 1 and agents array (maximum 50)');
  const ids = new Set<string>();
  return config.agents.map((value) => {
    if (!value || typeof value !== 'object') throw new Error('Invalid ACP entry');
    const item = value as Record<string, unknown>;
    if (
      typeof item.id !== 'string' ||
      !/^[a-z0-9][a-z0-9-]{0,63}$/.test(item.id) ||
      ids.has(item.id) ||
      typeof item.name !== 'string' ||
      !item.name.trim() ||
      item.name.length > 100 ||
      typeof item.command !== 'string' ||
      !isAbsolute(item.command) ||
      !Array.isArray(item.args) ||
      !item.args.every((a) => typeof a === 'string') ||
      (item.versionArgs !== undefined &&
        (!Array.isArray(item.versionArgs) || !item.versionArgs.every((a) => typeof a === 'string')))
    )
      throw new Error(
        'Invalid or duplicate ACP entry; use an absolute command and argument arrays',
      );
    ids.add(item.id);
    return {
      id: `acp:${item.id}`,
      name: item.name,
      provider: `acp:${item.id}`,
      command: item.command,
      args: item.args as string[],
      versionArgs: (item.versionArgs as string[]) ?? ['--version'],
      transport: 'acp-stdio',
    };
  });
}
function configured(): { definitions: ExecutorDefinition[]; warning?: string } {
  try {
    return {
      definitions: parseAcpConfig(
        JSON.parse(readFileSync(join(homedir(), '.pixel-agents', 'opa-adapters.json'), 'utf8')),
      ),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { definitions: [] };
    return {
      definitions: [],
      warning: error instanceof Error ? error.message : 'Invalid ACP configuration',
    };
  }
}
const probes = new Map<string, { time: number; ok: boolean }>();
export function discoverAdapters(
  definitions?: ExecutorDefinition[],
  probe?: (executable: string, args: string[]) => boolean,
) {
  const config = definitions ? { definitions } : configured();
  const executors: (ExecutorDefinition & { executable: string })[] = [];
  const adapters: AdapterDescription[] = [];
  for (const definition of [...native, ...config.definitions]) {
    let executable: string | undefined;
    const paths = isAbsolute(definition.command)
      ? [definition.command]
      : (process.env.PATH ?? '')
          .split(delimiter)
          .filter(isAbsolute)
          .map((dir) =>
            join(
              dir,
              process.platform === 'win32' ? `${definition.command}.exe` : definition.command,
            ),
          );
    for (const path of paths) {
      try {
        accessSync(path, constants.X_OK);
        const key = JSON.stringify([path, definition.versionArgs]);
        let result = probes.get(key);
        if (probe) result = { time: Date.now(), ok: probe(path, definition.versionArgs) };
        else if (!result || Date.now() - result.time > 60000) {
          let ok = false;
          try {
            execFileSync(path, definition.versionArgs, {
              timeout: 3000,
              input: '',
              maxBuffer: 65536,
              stdio: ['pipe', 'pipe', 'pipe'],
            });
            ok = true;
          } catch {
            /* Unusable executable. */
          }
          result = { time: Date.now(), ok };
          probes.set(key, result);
        }
        if (result?.ok) {
          executable = path;
          break;
        }
      } catch {
        /* Next PATH entry. */
      }
    }
    if (executable) executors.push({ ...definition, executable });
    adapters.push({
      id: definition.id,
      name: definition.name,
      transport: definition.transport,
      status: executable ? 'available' : 'unavailable',
      capabilities: capabilities(
        !!executable,
        !!executable && definition.transport === 'acp-stdio',
      ),
      reason: executable
        ? undefined
        : 'Client missing or --version check failed; observation/replay remains available',
    });
  }
  adapters.push({
    id: 'claude',
    name: 'Claude Code',
    transport: 'claude-hooks',
    status: 'observe_only',
    capabilities: capabilities(false),
    reason:
      'Original hooks, transcripts and legacy launch UI retained; not dispatched by this task adapter',
  });
  for (const [id, name] of [
    ['copilot', 'GitHub Copilot'],
    ['kilo', 'Kilo'],
    ['gemini', 'Gemini'],
    ['qwen', 'Qwen'],
    ['pi', 'Pi'],
  ])
    adapters.push({
      id,
      name,
      transport: 'unconfigured',
      status: 'planned',
      capabilities: { ...capabilities(false), observe: false },
      reason: 'No verified native adapter; explicitly configure an ACP implementation if supported',
    });
  return { adapters, executors, warning: config.warning };
}
