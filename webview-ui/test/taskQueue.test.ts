import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { TaskQueuePanel } from '../src/opa/TaskQueuePanel.js';
import type { useCampus } from '../src/opa/useCampus.js';
vi.mock('../src/i18n/index.js', () => ({ t: (key: string) => key }));
function fixture(patch: Record<string, unknown> = {}) {
  const saveQueue = vi.fn();
  const campus = {
    connection: 'connected',
    queues: [{ projectPath: '/fixture', revision: 2, paused: false, taskIds: ['a'] }],
    tasks: [
      {
        id: 'a',
        title: 'Prepared <fixture>',
        projectPath: '/fixture',
        status: 'open',
        revision: 3,
        assignee: 'fixture-executor',
      },
    ],
    executors: [{ id: 'fixture-executor', name: 'Fixture' }],
    saveQueue,
    ...patch,
  } as unknown as ReturnType<typeof useCampus>;
  const render = (readOnly = false, project: string | null = '/fixture') =>
    renderToStaticMarkup(createElement(TaskQueuePanel, { campus, readOnly, project }));
  return { campus, saveQueue, render };
}
describe('queue controls', () => {
  it('renders the exact prepared task/executor/project without dispatching on read', () => {
    const f = fixture();
    const html = f.render();
    expect(html).toContain('Prepared &lt;fixture&gt;');
    expect(html).toContain('fixture-executor');
    expect(html).toContain('/fixture');
    expect(html).toContain('the queue never drains automatically');
    expect(html).toContain('Start next task');
    expect(f.saveQueue).not.toHaveBeenCalled();
  });
  it.each([
    { queues: [{ projectPath: '/fixture', revision: 2, paused: true, taskIds: ['a'] }] },
    { connection: 'reconnecting' },
    { executors: [] },
  ])('disables Start next for an unavailable queue state %j', (patch) => {
    const html = fixture(patch).render();
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Start next task<\/button>/);
  });
  it('disables mutations for observers and requires a project rather than dispatching a global queue', () => {
    const f = fixture();
    expect(f.render(true)).toMatch(/<button[^>]*disabled=""[^>]*>Start next task<\/button>/);
    expect(f.render(false, null)).toContain('Choose one project');
    expect(f.render(false, null)).not.toContain('Start next task');
    expect(f.saveQueue).not.toHaveBeenCalled();
  });
});
