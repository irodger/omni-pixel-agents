/**
 * Pluggable persistence backend for agent state and user settings.
 *
 * Today both VS Code and the standalone CLI use FileStateAdapter, which
 * persists everything under ~/.pixel-agents/ as plain JSON. The interface
 * exists so future hosts (JetBrains plugin, browser-only mock for tests)
 * can swap in alternate backends without touching the rest of the code.
 *
 * Layout persistence (~/.pixel-agents/layout.json) is NOT part of this
 * interface -- it's already host-agnostic (plain fs I/O in layoutPersistence.ts).
 */

import type { OpaEventHistory } from './opa/history.js';
import type { OpaWorkData } from './opa/work.js';
import type { PersistedAgent } from './schemas.js';

export type ProjectLayouts = Record<string, { revision: number; layout?: Record<string, unknown> }>;

export interface StateAdapter {
  loadProjectLayouts?(): ProjectLayouts;
  saveProjectLayouts?(data: ProjectLayouts): void;
  // ── Per-adapter persisted state (agents + seats) ────────────────────

  loadAgents(): PersistedAgent[];
  saveAgents(agents: PersistedAgent[]): void;

  loadSeats(): Record<string, { palette?: number; hueShift?: number; seatId?: string }>;
  saveSeats(seats: Record<string, { palette?: number; hueShift?: number; seatId?: string }>): void;

  /** Optional project registry for OPA campus. Contains paths, never live sessions. */
  loadOpaProjects?(): string[];
  saveOpaProjects?(paths: string[]): void;
  loadOpaHistory?(): OpaEventHistory | undefined;
  saveOpaHistory?(data: OpaEventHistory): void;
  loadOpaWork?(): OpaWorkData;
  saveOpaWork?(data: OpaWorkData): void;

  // ── User-level settings (shared file, namespaced per adapter) ─────

  getSetting<T>(key: string, defaultValue: T): T;
  setSetting<T>(key: string, value: T): void;
}
