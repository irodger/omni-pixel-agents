import { type RefObject, useEffect, useRef, useState } from 'react';

import type { OpaProjectSnapshot } from '../../../core/src/messages.js';
import { t } from '../i18n/index.js';
import type { OfficeLayout } from '../office/types.js';
import { ProjectCanvas } from './ProjectCanvas.js';

/** Observation only: this surface cannot dispatch commands or acknowledge results. */
export function AmbientOffice({
  projects,
  projectId,
  layout,
  connection,
  attentionCount,
  onProject,
  onExit,
  onTasks,
  returnFocus,
}: {
  projects: OpaProjectSnapshot[];
  projectId: string;
  layout: OfficeLayout;
  connection: string;
  attentionCount: number;
  onProject: (id: string) => void;
  onExit: () => void;
  onTasks: () => void;
  returnFocus: RefObject<HTMLButtonElement | null>;
}) {
  const root = useRef<HTMLElement>(null);
  const exitButton = useRef<HTMLButtonElement>(null);
  const ownedFullscreen = useRef(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState(false);
  const project = projects.find((p) => p.id === projectId) ?? projects[0];
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = root.current;
    const returnButton = returnFocus.current;
    exitButton.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Tab') {
        const controls = Array.from(
          element?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), select:not(:disabled), [tabindex="0"]',
          ) ?? [],
        ).filter((control) => control.offsetParent !== null);
        const first = controls[0],
          last = controls.at(-1);
        if (
          event.shiftKey &&
          (document.activeElement === first || !element?.contains(document.activeElement))
        ) {
          event.preventDefault();
          last?.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last || !element?.contains(document.activeElement))
        ) {
          event.preventDefault();
          first?.focus();
        }
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onExit();
      }
    };
    const changed = () => {
      const active = document.fullscreenElement === element;
      setFullscreen(active);
      if (ownedFullscreen.current && !active) onExit();
      ownedFullscreen.current = active;
    };
    document.addEventListener('keydown', keydown, true);
    document.addEventListener('fullscreenchange', changed);
    return () => {
      document.removeEventListener('keydown', keydown, true);
      document.removeEventListener('fullscreenchange', changed);
      if (document.fullscreenElement === element) void document.exitFullscreen().catch(() => {});
      requestAnimationFrame(() => {
        if (returnButton?.isConnected) returnButton.focus();
        else if (previous?.isConnected) previous.focus();
      });
    };
  }, [onExit, returnFocus]);
  return (
    <section
      ref={root}
      className="opa-ambient"
      role="dialog"
      aria-modal="true"
      aria-label={t('Office / Ambient')}
    >
      <header className="opa-ambient-controls">
        <div>
          <span className="opa-eyebrow">OMNI PIXEL AGENTS</span>
          <h1>{t('Office / Ambient')}</h1>
        </div>
        <label>
          {t('Project')}{' '}
          <select
            aria-label={t('Ambient project')}
            value={project?.id ?? ''}
            onChange={(e) => onProject(e.target.value)}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {p.path}
              </option>
            ))}
          </select>
        </label>
        <button className="opa-button" onClick={onTasks}>
          {t('Review tasks')}
        </button>
        {typeof document.documentElement.requestFullscreen === 'function' && (
          <button
            className="opa-button"
            aria-pressed={fullscreen}
            onClick={async () => {
              try {
                setFullscreenError(false);
                if (document.fullscreenElement === root.current) await document.exitFullscreen();
                else {
                  await root.current?.requestFullscreen();
                  ownedFullscreen.current = true;
                }
              } catch {
                setFullscreenError(true);
              }
            }}
          >
            {fullscreen ? t('Exit full screen') : t('Full screen')}
          </button>
        )}
        <button ref={exitButton} className="opa-button" onClick={onExit}>
          {t('Exit Ambient')} · Esc
        </button>
      </header>
      <div className="opa-ambient-status" role="status" aria-live="polite">
        <span className={`opa-dot ${connection === 'connected' ? 'opa-working' : 'opa-blocked'}`} />
        <span>
          {connection === 'connected'
            ? t('Connected')
            : t('Connection lost — activity updates are paused.')}
        </span>
        <span>
          {t('Needs attention')}: {attentionCount}
        </span>
        {project && (
          <>
            <span>
              {t('Working')}: {project.agents.filter((a) => a.status === 'working').length}
            </span>
            <span>
              {t('Needs permission')}: {project.agents.filter((a) => a.status === 'blocked').length}
            </span>
            <span>
              {t('Failed')}: {project.agents.filter((a) => a.status === 'error').length}
            </span>
          </>
        )}
      </div>
      {fullscreenError && (
        <p className="opa-notice" role="status">
          {t('Browser full screen is unavailable. Ambient still fills this window.')}
        </p>
      )}
      {project ? (
        <div className="opa-ambient-stage">
          <ProjectCanvas key={project.id} project={project} layout={layout} />
          <div className="opa-ambient-caption">
            <strong>{project.name}</strong>
            <span>{project.path}</span>
            {!project.agents.length && (
              <span>{t('No active sessions. This office is ready for your next visit.')}</span>
            )}
          </div>
        </div>
      ) : (
        <p>{t('No projects available.')}</p>
      )}
    </section>
  );
}
