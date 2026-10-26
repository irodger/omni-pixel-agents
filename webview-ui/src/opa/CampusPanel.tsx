import './campus.css';

import { useCallback, useRef, useState } from 'react';

import type { OpaAgentSnapshot, OpaProjectSnapshot } from '../../../core/src/messages.js';
import { countNoun } from '../i18n/catalog.js';
import { t, useLanguage } from '../i18n/index.js';
import { LanguageSelect } from '../i18n/LanguageSelect.js';
import type { OfficeLayout } from '../office/types.js';
import { AmbientOffice } from './AmbientOffice.js';
import { ATTENTION_DELAY_MS, needsAttention, waitingLabel } from './attention.js';
import { AttentionPanel } from './AttentionPanel.js';
import { type CampusRoute, resolveRoute, ROOT_ROUTE } from './deepLinks.js';
import { LinkControls } from './LinkControls.js';
import { ProjectCanvas } from './ProjectCanvas.js';
import { ProjectDecor } from './ProjectDecor.js';
import { ProjectIdeLink } from './ProjectIdeLink.js';
import { TimelinePanel } from './TimelinePanel.js';
import type { useCampus } from './useCampus.js';
import { useCampusRoute } from './useCampusRoute.js';
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
  const { route, navigate } = useCampusRoute();
  const current = route ?? ROOT_ROUTE;
  const projectId = current.project ?? null;
  const setProjectId = (project: string | null) =>
    navigate({ view: current.view, project: project ?? undefined });
  const [ambientId, setAmbientId] = useState<string | null>(null);
  const ambientButton = useRef<HTMLButtonElement>(null);
  const exitAmbient = useCallback(() => setAmbientId(null), []);
  const [agentId, setAgentId] = useState<number | null>(null);
  const view = current.view;
  const setView = (view: CampusRoute['view']) => navigate({ view, project: current.project });
  const inbox = campus.inbox;
  const agents = projects.flatMap((p) => p.agents);
  const selected = current.session
    ? projects
        .find((p) => p.id === projectId)
        ?.agents.find(
          (a) =>
            a.provider === current.provider &&
            a.sessionId === current.session &&
            a.sourceAgentId === current.agent,
        )
    : projects.find((p) => p.id === projectId)?.agents.find((a) => a.id === agentId);
  const missing = !route || !resolveRoute(current, projects, campus.tasks);
  const visible = projectId ? projects.filter((p) => p.id === projectId) : projects;
  const openAgent = (project: OpaProjectSnapshot, agent: OpaAgentSnapshot) => {
    if (agent.sessionId && agent.sourceAgentId)
      navigate({
        view: 'overview',
        project: project.id,
        provider: agent.provider,
        session: agent.sessionId,
        agent: agent.sourceAgentId,
      });
    else setProjectId(project.id);
    setAgentId(agent.id);
    acknowledge(agent, project.id);
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
        {missing && (
          <p className="opa-notice" role="status">
            {t(
              !route
                ? 'Invalid or unsupported OPA link.'
                : !campus.projectsLoaded || (current.task && !campus.workLoaded)
                  ? 'Waiting for connection to resolve this link.'
                  : 'Linked target is unavailable. It may be missing or not visible in this session.',
            )}{' '}
            <button className="opa-button" onClick={() => navigate(ROOT_ROUTE)}>
              {t('Overview')}
            </button>
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
            <strong>{inbox.filter((item) => item.kind === 'blocked').length}</strong>{' '}
            {' ' + t('waiting for you')}
          </span>
          <span>
            <strong>{inbox.filter((item) => item.kind !== 'blocked').length}</strong>{' '}
            {countNoun(
              inbox.filter((item) => item.kind !== 'blocked').length,
              'unread results',
              language,
            )}
          </span>
        </div>
        <nav className="opa-view-tabs" aria-label={t('View')}>
          {(['overview', 'tasks', 'usage', 'attention', 'timeline'] as const).map((item) => (
            <button
              key={item}
              className="opa-button"
              aria-pressed={view === item}
              onClick={() => setView(item)}
            >
              {t(
                item === 'overview'
                  ? 'Overview'
                  : item === 'tasks'
                    ? 'Tasks'
                    : item === 'attention'
                      ? 'Attention Inbox'
                      : item === 'timeline'
                        ? 'Timeline'
                        : 'Usage & costs',
              )}
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
                  {projectId && !projects.some((p) => p.id === projectId) && (
                    <option value={projectId}>{projectId}</option>
                  )}
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {p.path}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {view === 'timeline' ? (
              <TimelinePanel
                key={JSON.stringify(current)}
                campus={campus}
                route={current}
                navigate={navigate}
              />
            ) : view === 'attention' ? (
              <AttentionPanel campus={campus} projectId={projectId} navigate={navigate} />
            ) : view !== 'overview' ? (
              <WorkPanel
                key={`${view}:${projectId ?? 'all'}`}
                campus={campus}
                projectId={projectId}
                view={view}
                readOnly={readOnly}
                selectedTaskId={current.task}
                selectedRunId={current.run}
                navigate={navigate}
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
                          <LinkControls route={{ view: 'overview', project: project.id }} />
                          <p title={project.path}>{project.path}</p>
                        </div>
                        <span className="opa-count">
                          {project.agents.length}{' '}
                          {countNoun(project.agents.length, 'agents', language)}
                        </span>
                      </header>
                      <ProjectIdeLink path={project.path} />
                      <ProjectCanvas project={project} layout={layout} />
                      <ProjectDecor
                        project={project}
                        shared={layout}
                        campus={campus}
                        readOnly={readOnly}
                      />
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
                            navigate({ view: 'tasks', project: project.id });
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
                            navigate({ view: 'usage', project: project.id });
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
                <span className="opa-count">{inbox.length}</span>
              </div>
              <button
                className="opa-button"
                onClick={() => navigate({ view: 'attention', project: current.project })}
              >
                {t('Attention Inbox')}
              </button>
              {!inbox.length && (
                <p className="opa-all-clear" role="status">
                  {t('All caught up.')}
                </p>
              )}
              <div className="opa-attention-list">
                {inbox.slice(0, 5).map((item) => {
                  const overdue =
                    item.kind === 'blocked' &&
                    item.since !== undefined &&
                    now - item.since >= ATTENTION_DELAY_MS;
                  return (
                    <button
                      key={item.id}
                      className={`opa-attention-item ${overdue ? 'opa-overdue' : ''}`}
                      onClick={() => navigate(item.route)}
                    >
                      <strong>{item.title}</strong>
                      <small>
                        {projects.find((p) => p.id === item.project)?.name ?? item.project}
                      </small>
                      <span>
                        {item.kind === 'blocked'
                          ? waitingLabel(item.since, now, language)
                          : t(item.state)}
                      </span>
                    </button>
                  );
                })}
              </div>
              {selected && (
                <section className="opa-agent-details" aria-label={t('Selected agent')}>
                  <h2>{selected.name}</h2>
                  {selected.sessionId && selected.sourceAgentId && projectId && (
                    <LinkControls
                      route={{
                        view: 'overview',
                        project: projectId,
                        provider: selected.provider,
                        session: selected.sessionId,
                        agent: selected.sourceAgentId,
                      }}
                    />
                  )}
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
                  <button
                    className="opa-button"
                    onClick={() => {
                      setAgentId(null);
                      navigate({ view: 'overview', project: current.project });
                    }}
                  >
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
          attentionCount={inbox.length}
          onProject={setAmbientId}
          onExit={exitAmbient}
          onTasks={() => {
            navigate({ view: 'tasks', project: ambientId });
            exitAmbient();
          }}
        />
      )}
    </section>
  );
}
