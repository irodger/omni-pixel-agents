import { useState } from 'react';

import type { OpaProjectSnapshot } from '../../../core/src/messages.js';
import { t } from '../i18n/index.js';
import type { OfficeLayout } from '../office/types.js';
import { ProjectEditor } from './ProjectEditor.js';
import type { useCampus } from './useCampus.js';

/** Project overrides are explicit saves; the shared office remains the design workshop. */
export function ProjectDecor({
  project,
  shared,
  campus,
  readOnly,
}: {
  project: OpaProjectSnapshot;
  shared: OfficeLayout;
  campus: ReturnType<typeof useCampus>;
  readOnly: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(layout: Record<string, unknown>, reset = false) {
    setBusy(true);
    setError('');
    try {
      await campus.saveLayout({
        type: 'saveLayout',
        projectPath: project.id,
        expectedRevision: project.layoutVersion ?? 0,
        layout,
        reset,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'LAYOUT_INVALID');
    } finally {
      setBusy(false);
    }
  }
  const disabled = readOnly || busy || campus.connection !== 'connected';
  return (
    <div className="opa-project-decor">
      <button className="opa-button" aria-expanded={open} onClick={() => setOpen(!open)}>
        {t('Office decor')}
      </button>
      {editing && (
        <ProjectEditor
          project={project}
          shared={shared}
          campus={campus}
          readOnly={readOnly}
          onClose={() => setEditing(false)}
        />
      )}
      {open && (
        <div>
          <p className="opa-muted">
            {t(project.layout ? 'Independent project layout' : 'Uses shared office layout')}
          </p>
          <p className="opa-muted">
            {t('Edit this project directly, copy the shared office, or import an exported layout.')}
          </p>
          <button className="opa-button" disabled={disabled} onClick={() => setEditing(true)}>
            {t('Edit project office')}
          </button>
          <button
            className="opa-button"
            disabled={disabled}
            onClick={() => void save(structuredClone(shared) as unknown as Record<string, unknown>)}
          >
            {t('Copy shared office')}
          </button>
          <label>
            {t('Import project layout')}
            <input
              type="file"
              accept=".json,application/json"
              disabled={disabled}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                try {
                  if (file.size > 2_000_000) throw new Error('LAYOUT_INVALID');
                  await save(JSON.parse(await file.text()) as Record<string, unknown>);
                } catch {
                  setError('LAYOUT_INVALID');
                }
              }}
            />
          </label>
          <button
            className="opa-button"
            disabled={disabled || !project.layout}
            onClick={() => {
              if (window.confirm(t('Reset only this project to the shared office?')))
                void save({}, true);
            }}
          >
            {t('Use shared office')}
          </button>
          {error && <p role="alert">{t(error)}</p>}
          {busy && <p role="status">{t('Saving…')}</p>}
        </div>
      )}
    </div>
  );
}
