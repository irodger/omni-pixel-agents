/**
 * FileStateAdapter: shared StateAdapter implementation for both VS Code and standalone.
 *
 * Settings (per adapter namespace) persist to
 *   ~/.pixel-agents/config.json  under keys "vscode" or "standalone".
 *
 * Agents + seats (per adapter) persist to
 *   ~/.pixel-agents/<namespace>-state.json
 *
 * Runtime visibility (which agents show in the office) is scope-controlled by the
 * runtime scanner + Watch All Sessions toggle, not by persistence. Both adapters
 * can observe the same ~/.claude/projects/ filesystem; each keeps its own local
 * agent IDs and seat mappings.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { ProjectLayouts, StateAdapter } from '../../core/src/adapter.js';
import type { OpaEventHistory } from '../../core/src/opa/history.js';
import type { OpaWorkData } from '../../core/src/opa/work.js';
import { isTask, isUsage } from '../../core/src/opa/work.js';
import type { PersistedAgent } from '../../core/src/schemas.js';
import type { AdapterSettingKey, AdapterSettings, ConfigNamespace } from './configPersistence.js';
import { ADAPTER_SETTING_KEYS, readConfig, writeConfig } from './configPersistence.js';
import { LAYOUT_FILE_DIR } from './constants.js';

const ADAPTER_SETTING_KEY_SET: ReadonlySet<string> = new Set(ADAPTER_SETTING_KEYS);

/** Strip leading "pixel-agents." prefix to match AdapterSettings field names. */
function settingNameOf(key: string): AdapterSettingKey | null {
  const bare = key.startsWith('pixel-agents.') ? key.slice('pixel-agents.'.length) : key;
  return ADAPTER_SETTING_KEY_SET.has(bare) ? (bare as AdapterSettingKey) : null;
}

interface AdapterState {
  projectLayouts?: ProjectLayouts;
  opaWork?: OpaWorkData;
  opaHistory?: OpaEventHistory;
  opaProjects?: string[];
  agents: PersistedAgent[];
  seats: Record<string, { palette?: number; hueShift?: number; seatId?: string }>;
}

const EMPTY_STATE: AdapterState = { agents: [], seats: {} };

export interface FileStateAdapterOptions {
  namespace: ConfigNamespace;
}

export class FileStateAdapter implements StateAdapter {
  private readonly namespace: ConfigNamespace;
  private stateReadFailed = false;
  private readonly stateFilePath: string;

  constructor(options: FileStateAdapterOptions) {
    this.namespace = options.namespace;
    this.stateFilePath = path.join(
      os.homedir(),
      LAYOUT_FILE_DIR,
      `${options.namespace}-state.json`,
    );
  }

  // ── Settings (shared config.json, per-namespace section) ────

  getSetting<T>(key: string, defaultValue: T): T {
    const field = settingNameOf(key);
    if (!field) return defaultValue;
    const config = readConfig();
    return config[this.namespace][field] as unknown as T;
  }

  setSetting<T>(key: string, value: T): void {
    const field = settingNameOf(key);
    if (!field) return;
    const config = readConfig();
    // Narrow by field to keep the union-safe write. Each entry is a boolean or string.
    (config[this.namespace] as unknown as Record<string, unknown>)[field] = value;
    writeConfig(config);
  }

  // ── Agents + seats (adapter-scoped file) ────────────────────

  loadAgents(): PersistedAgent[] {
    return this.readState().agents;
  }

  saveAgents(agents: PersistedAgent[]): void {
    const state = this.readState();
    state.agents = agents;
    this.writeState(state);
  }

  loadSeats(): Record<string, { palette?: number; hueShift?: number; seatId?: string }> {
    return this.readState().seats;
  }

  saveSeats(seats: Record<string, { palette?: number; hueShift?: number; seatId?: string }>): void {
    const state = this.readState();
    state.seats = seats;
    this.writeState(state);
  }

  // ── Internal state-file I/O ─────────────────────────────────

  loadProjectLayouts(): ProjectLayouts {
    return this.readState().projectLayouts ?? {};
  }
  saveProjectLayouts(data: ProjectLayouts): void {
    const state = this.readState();
    state.projectLayouts = data;
    this.writeState(state, true);
  }

  loadOpaProjects(): string[] {
    return this.readState().opaProjects ?? [];
  }
  loadOpaHistory(): OpaEventHistory | undefined {
    return this.readState(true).opaHistory;
  }
  saveOpaHistory(data: OpaEventHistory): void {
    const state = this.readState(true);
    state.opaHistory = data;
    this.writeState(state, true);
  }
  loadOpaWork(): OpaWorkData {
    return this.readState().opaWork ?? { tasks: [], usage: [] };
  }
  saveOpaWork(data: OpaWorkData): void {
    const state = this.readState();
    state.opaWork = data;
    this.writeState(state, true);
  }

  saveOpaProjects(paths: string[]): void {
    const state = this.readState();
    state.opaProjects = paths;
    this.writeState(state);
  }

  private readState(strict = false): AdapterState {
    try {
      if (!fs.existsSync(this.stateFilePath)) {
        this.stateReadFailed = false;
        return { agents: [], seats: {} };
      }
      const raw = fs.readFileSync(this.stateFilePath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<AdapterState>;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        throw new Error('Invalid adapter state root');
      this.stateReadFailed = false;
      return {
        projectLayouts: parsed.projectLayouts,
        opaHistory: parsed.opaHistory,
        opaWork: parsed.opaWork
          ? {
              ...parsed.opaWork,
              tasks: Array.isArray(parsed.opaWork.tasks) ? parsed.opaWork.tasks.filter(isTask) : [],
              usage: Array.isArray(parsed.opaWork.usage)
                ? parsed.opaWork.usage.filter(isUsage)
                : [],
            }
          : undefined,
        opaProjects: Array.isArray(parsed.opaProjects)
          ? parsed.opaProjects.filter((p): p is string => typeof p === 'string')
          : undefined,
        agents: Array.isArray(parsed.agents) ? (parsed.agents as PersistedAgent[]) : [],
        seats:
          parsed.seats && typeof parsed.seats === 'object'
            ? (parsed.seats as AdapterState['seats'])
            : {},
      };
    } catch (err) {
      this.stateReadFailed = true;
      console.error('[Pixel Agents] Failed to read adapter state:', err);
      if (strict) throw err;
      return { ...EMPTY_STATE };
    }
  }

  private writeState(state: AdapterState, strict = false): void {
    if (this.stateReadFailed) {
      const error = new Error('Refusing to overwrite unreadable adapter state');
      if (strict) throw error;
      console.error('[Pixel Agents]', error.message);
      return;
    }
    const dir = path.dirname(this.stateFilePath);
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const json = JSON.stringify(state, null, 2);
      const tmpPath = this.stateFilePath + '.tmp';
      fs.writeFileSync(tmpPath, json, 'utf-8');
      fs.renameSync(tmpPath, this.stateFilePath);
    } catch (err) {
      if (strict) throw err;
      console.error('[Pixel Agents] Failed to write adapter state:', err);
    }
  }
}

// Re-export for callers that want to construct AdapterSettings defaults directly.
/** @public */
export type { AdapterSettings, ConfigNamespace };
