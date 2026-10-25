import type { SaveLayout } from '../../../core/src/messages.js';
import type { AgentStateStore } from '../agentStateStore.js';
import { toPathKey } from '../pathKey.js';
import { opaCampusSnapshot } from './campus.js';

export function saveProjectLayout(store: AgentStateStore, command: SaveLayout): void {
  const adapter = store.getAdapter();
  const id = toPathKey(command.projectPath ?? '');
  if (!opaCampusSnapshot(store).projects.some((p) => p.id === id))
    throw new Error('PROJECT_UNKNOWN');
  if (!adapter?.saveProjectLayouts) throw new Error('LAYOUT_STORAGE_UNAVAILABLE');
  const layouts = adapter.loadProjectLayouts?.() ?? {};
  const revision = layouts[id]?.revision ?? 0;
  if (command.expectedRevision !== revision) throw new Error('LAYOUT_CONFLICT');
  if (!command.reset) {
    const l = command.layout;
    const cols = l.cols as number,
      rows = l.rows as number;
    if (
      l.version !== 1 ||
      !Number.isInteger(cols) ||
      !Number.isInteger(rows) ||
      cols < 1 ||
      rows < 1 ||
      cols > 128 ||
      rows > 128 ||
      !Array.isArray(l.tiles) ||
      l.tiles.length !== cols * rows ||
      !l.tiles.every((v) => Number.isInteger(v) && ((v >= 0 && v <= 9) || v === 255)) ||
      !Array.isArray(l.furniture) ||
      l.furniture.length > 4096 ||
      !l.furniture.every(
        (v: unknown) =>
          typeof v === 'object' &&
          v !== null &&
          typeof (v as Record<string, unknown>).type === 'string' &&
          typeof (v as Record<string, unknown>).uid === 'string' &&
          Number.isInteger((v as Record<string, unknown>).col) &&
          Number.isInteger((v as Record<string, unknown>).row),
      )
    )
      throw new Error('LAYOUT_INVALID');
  }
  layouts[id] = {
    revision: revision + 1,
    ...(command.reset ? {} : { layout: structuredClone(command.layout) }),
  };
  adapter.saveProjectLayouts(layouts);
  store.broadcast({ ...opaCampusSnapshot(store) });
}
