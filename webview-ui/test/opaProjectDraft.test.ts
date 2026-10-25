import { describe, expect, it } from 'vitest';

import type { OpaProjectSnapshot } from '../../core/src/messages.js';
import type { OfficeLayout } from '../src/office/types.js';
import { projectDraft } from '../src/opa/projectDraft.js';

const shared: OfficeLayout = { version: 1, cols: 1, rows: 1, tiles: [1], furniture: [] };
const project: OpaProjectSnapshot = {
  id: '/a/same',
  name: 'same',
  path: '/a/same',
  agents: [],
  layoutVersion: 4,
};
describe('project editor draft boundary', () => {
  it('isolates edits from shared office and another project, including nested arrays', () => {
    const a = projectDraft(project, shared);
    const b = projectDraft({ ...project, id: '/b/same' }, shared);
    a.layout.tiles[0] = 2;
    expect(shared.tiles).toEqual([1]);
    expect(b.layout.tiles).toEqual([1]);
  });
  it('captures the original revision so incoming changes cannot authorize a stale save', () => {
    const snapshot = structuredClone(project);
    const draft = projectDraft(snapshot, shared);
    snapshot.layoutVersion = 5;
    const command = draft.command(draft.layout);
    expect(command.expectedRevision).toBe(4);
    expect(command.projectPath).toBe('/a/same');
    draft.layout.tiles[0] = 3;
    expect(command.layout.tiles).toEqual([1]);
    expect(command).not.toHaveProperty('assignee');
    expect(command).not.toHaveProperty('launch');
  });
  it('starts with the project override and keeps a reset revision on shared fallback', () => {
    const override = { ...shared, tiles: [2] };
    const draft = projectDraft(
      { ...project, layout: override as unknown as Record<string, unknown> },
      shared,
    );
    expect(draft.layout.tiles).toEqual([2]);
    draft.layout.tiles[0] = 3;
    expect(override.tiles).toEqual([2]);
    expect(projectDraft(project, shared).expectedRevision).toBe(4);
    expect(projectDraft({ ...project, layoutVersion: undefined }, shared).expectedRevision).toBe(0);
  });
});
