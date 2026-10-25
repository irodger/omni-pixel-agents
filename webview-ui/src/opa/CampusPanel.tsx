import './campus.css';

import { useCallback, useRef, useState } from 'react';

import type { OpaAgentSnapshot, OpaProjectSnapshot } from '../../../core/src/messages.js';
import { countNoun } from '../i18n/catalog.js';
import { t, useLanguage } from '../i18n/index.js';
import { LanguageSelect } from '../i18n/LanguageSelect.js';
import type { OfficeLayout } from '../office/types.js';
import { AmbientOffice } from './AmbientOffice.js';
import { ATTENTION_DELAY_MS, attentionRows, needsAttention, waitingLabel } from './attention.js';
import { ProjectCanvas } from './ProjectCanvas.js';
import type { useCampus } from './useCampus.js';
import { WorkPanel } from './WorkPanel.js';

const labels = {
  idle: 'Ready',
  working: 'Working',
  blocked: 'Needs permission',
  done: 'Done',
  error: 'Failed',
};

export function CampusPanel({
  campus,
  layout,
  onClose,
  readOnly,
}: {
  campus: ReturnType<typeof useCampus>;
  layout: OfficeLayout;
  onClose: () => void;
  readOnly: boolean;
}) {
  const { projects, seen, now, acknowledge } = campus;
  const { language } = useLanguage();
  const [projectId, setProjectId] = useState<string | null>(null);
  const [ambientId, setAmbientId] = useState<string | null>(null);
  const ambientButton = useRef<HTMLButtonElement>(null);
  const exitAmbient = useCallback(() => setAmbientId(null), []);
  const [agentId, setAgentId] = useState<number | null>(null);
  const [view, setView] = useState<'overview' | 'tasks' | 'usage'>('overview');
  const rows = attentionRows(projects, seen);
  const agents = projects.flatMap((p) => p.agents);
  const selected = agents.find((a) => a.id === agentId);
  const visible = projectId ? projects.filter((p) => p.id === projectId) : projects;
  const openAgent = (project: OpaProjectSnapshot, agent: OpaAgentSnapshot) => {
    setProjectId(project.id);
    setAgentId(agent.id);
    acknowledge(agent);
  };
  return (
    <section className="opa-campus" aria-label={t('OPA Campus')}>
      <div hidden={ambientId !== null} inert={ambientId !== null}>
        <header className="opa-campus-header">
          <div>
            <span className="opa-eyebrow">OMNI PIXEL AGENTS</span>
            <h1>{t('Campus')}</h1>
            <p>{t('A place for every project. A clear view of who needs you.')}</p>
          </div>
          <div className="opa-header-actions">
            <LanguageSelect />
            <button
              className="opa-button"
              ref={ambientButton}
              disabled={!projects.length}
              onClick={() => setAmbientId(projectId ?? projects[0].id)}
            >
              {t('Office / Ambient')}
            </button>
            <button className="opa-button" onClick={onClose}>
              {t('Back to office')}
            </button>
          </div>
        </header>
        {campus.connection !== 'connected' && (
          <p className="opa-connection" role="status">
            {campus.connection === 'reconnecting' ? t('Reconnecting') : t('Connecting')}{' '}
            {' ' + t('— activity updates are paused.')}
          </p>
        )}
        <div className="opa-stats" aria-label={t('Campus summary')}>
          <span>
            <strong>{projects.length}</strong> {countNoun(projects.length, 'offices', language)}
          </span>
          <span>
            <strong>{agents.filter((a) => a.status === 'working').length}</strong> {t('working')}
          </span>
          <span>
            <strong>{agents.filter((a) => a.status === 'blocked').length}</strong>{' '}
            {' ' + t('waiting for you')}
          </span>
          <span>
            <strong>{rows.filter(({ agent }) => agent.status !== 'blocked').length}</strong>{' '}
            {countNoun(
              rows.filter(({ agent }) => agent.status !== 'blocked').length,
              'unread results',
              language,
            )}
          </span>
        </div>
        <nav className="opa-view-tabs" aria-label={t('View')}>
          {(['overview', 'tasks', 'usage'] as const).map((item) => (
            <button
              key={item}
              className="opa-button"
              aria-pressed={view === item}
              onClick={() => setView(item)}
            >
              {t(item === 'overview' ? 'Overview' : item === 'tasks' ? 'Tasks' : 'Usage & costs')}
            </button>
          ))}
        </nav>
        <div className={`opa-campus-body ${view !== 'overview' ? 'opa-wide' : ''}`}>
          <main className="opa-offices">
            <div className="opa-section-heading">
              <h2>{t('Your offices')}</h2>
              <label>
                {t('Show')}{' '}
                <select
                  value={projectId ?? ''}
                  onChange={(e) => setProjectId(e.target.value || null)}
                  aria-label={t('Show project')}
                >
                  <option value="">{t('All offices')}</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {p.path}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {view !== 'overview' ? (
              <WorkPanel
                key={`${view}:${projectId ?? 'all'}`}
                campus={campus}
                projectId={projectId}
                view={view}
                readOnly={readOnly}
              />
            ) : (
              <>
                {!projects.length && (
                  <div className="opa-empty">
                    <h2>{t('Your campus is ready')}</h2>
                    <p>
                      {t(
                        'Connect Codex or OpenCode to bring your first project to life. Each working folder gets its own office.',
                      )}
                    </p>
                  </div>
                )}
                <div className="opa-office-grid">
                  {visible.map((project) => (
                    <article className="opa-office-card" key={project.id}>
                      <header>
                        <div>
                          <h2>{project.name}</h2>
                          <p title={project.path}>{project.path}</p>
                        </div>
                        <span className="opa-count">
                          {project.agents.length}{' '}
                          {countNoun(project.agents.length, 'agents', language)}
                        </span>
                      </header>
                      <ProjectCanvas project={project} layout={layout} />
                      <div className="opa-agent-list">
                        {!project.agents.length && (
                          <p className="opa-muted">
                            {t('No active sessions. This office is ready for your next visit.')}
                          </p>
                        )}
                        {project.agents.map((agent) => (
                          <button
                            className={`opa-agent-row ${agentId === agent.id ? 'opa-selected' : ''}`}
                            key={agent.id}
                            onClick={() => openAgent(project, agent)}
                          >
                            <span className={`opa-dot opa-${agent.status}`} />
                            <span className="opa-agent-name">
                              {agent.name}
                              <small>
                                {agent.provider}
                                {agent.role ? ` · ${agent.role}` : ''}
                              </small>
                            </span>
                            <span className="opa-agent-status">
                              {t(labels[agent.status])}
                              {needsAttention(agent, seen) && (
                                <span aria-label={t('Unread or needs attention')}> ●</span>
                              )}
                            </span>
                          </button>
                        ))}
                      </div>
                      <div className="opa-project-actions">
                        <button
                          className="opa-button"
                          onClick={() => {
                            setProjectId(project.id);
                            setView('tasks');
                          }}
                        >
                          {t('Tasks')}:{' '}
                          {
                            campus.tasks.filter(
                              (task) =>
                                task.projectPath === project.id &&
                                (task.status === 'open' || task.status === 'in_progress'),
                            ).length
                          }
                        </button>
                        <button
                          className="opa-button"
                          onClick={() => {
                            setProjectId(project.id);
                            setView('usage');
                          }}
                        >
                          {t('Usage & costs')}
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </>
            )}
          </main>
          {view === 'overview' && (
            <aside className="opa-attention" aria-label={t('Needs attention')}>
              <div className="opa-section-heading">
                <h2>{t('Needs you')}</h2>
                <span className="opa-count">{rows.length}</span>
              </div>
              <p className="opa-muted">
                {t('Permission requests stay here until answered in your agent.')}
              </p>
              {!rows.length && (
                <p className="opa-all-clear" role="status">
                  {t('All caught up.')}
                </p>
              )}
              <div className="opa-attention-list">
                {rows.map(({ project, agent }) => {
                  const overdue =
                    agent.status === 'blocked' &&
                    agent.blockedSince !== undefined &&
                    now - agent.blockedSince >= ATTENTION_DELAY_MS;
                  return (
                    <button
                      key={agent.id}
                      className={`opa-attention-item ${overdue ? 'opa-overdue' : ''}`}
                      onClick={() => openAgent(project, agent)}
                    >
                      <span className="opa-attention-top">
                        <strong>{agent.name}</strong>
                        <span className={`opa-dot opa-${agent.status}`} />
                      </span>
                      <small>
                        {project.name} · {agent.provider}
                      </small>
                      <span>
                        {agent.status === 'blocked'
                          ? waitingLabel(agent.blockedSince, now, language)
                          : agent.status === 'error'
                            ? t('Turn failed — open to review')
                            : t('Finished — open to review')}
                      </span>
                      {overdue && <small>{t('Waiting for more than two minutes')}</small>}
                    </button>
                  );
                })}
              </div>
              {selected && (
                <section className="opa-agent-details" aria-label={t('Selected agent')}>
                  <h2>{selected.name}</h2>
                  <p>
                    {selected.provider} · {t(labels[selected.status])}
                  </p>
                  {selected.status === 'blocked' && (
                    <p>
                      {t('Respond in')}{' '}
                      {selected.provider === 'codex'
                        ? 'Codex'
                        : selected.provider === 'opencode'
                          ? 'OpenCode'
                          : selected.provider}
                      {t('. Opening this panel does not approve the request.')}
                    </p>
                  )}
                  {selected.error && <p className="opa-error-detail">{selected.error}</p>}
                  {selected.tools.length > 0 && (
                    <ul>
                      {selected.tools.map((tool, i) => (
                        <li key={`${i}:${tool}`}>{tool}</li>
                      ))}
                    </ul>
                  )}
                  <button className="opa-button" onClick={() => setAgentId(null)}>
                    {t('Close details')}
                  </button>
                </section>
              )}
            </aside>
          )}
        </div>
      </div>
      {ambientId !== null && (
        <AmbientOffice
          returnFocus={ambientButton}
          projects={projects}
          projectId={ambientId}
          layout={layout}
          connection={campus.connection}
          attentionCount={rows.length}
          onProject={setAmbientId}
          onExit={exitAmbient}
          onTasks={() => {
            setProjectId(ambientId);
            setView('tasks');
            exitAmbient();
          }}
        />
      )}
    </section>
  );
}
