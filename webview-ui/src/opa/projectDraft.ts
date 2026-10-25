import type { OpaProjectSnapshot, SaveLayout } from '../../../core/src/messages.js';
import type { OfficeLayout } from '../office/types.js';

/** The save revision is captured on entry, never refreshed by incoming snapshots. */
export function projectDraft(project: OpaProjectSnapshot, shared: OfficeLayout) {
  const projectPath = project.id;
  const expectedRevision = project.layoutVersion ?? 0;
  const layout = structuredClone((project.layout ?? shared) as unknown as OfficeLayout);
  return {
    layout,
    expectedRevision,
    command: (edited: OfficeLayout): Omit<SaveLayout, 'requestId'> => ({
      type: 'saveLayout',
      projectPath,
      expectedRevision,
      layout: structuredClone(edited) as unknown as Record<string, unknown>,
    }),
  };
}
