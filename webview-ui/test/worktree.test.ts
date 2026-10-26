import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { OpaTask } from '../../core/src/opa/work.js';
import { isWorktreeBinding } from '../../core/src/opa/worktree.js';
import { TaskSummary } from '../src/opa/TaskSummary.js';
import { WorktreePanel } from '../src/opa/WorktreePanel.js';

vi.mock('../src/i18n/index.js', () => ({
  t: (s: string) => s,
  useLanguage: () => ({ language: 'en' }),
  localeName: () => 'en-US',
}));
vi.mock('../src/transport/index.js', () => ({
  transport: { state: 'connected', onMessage: () => () => {}, send: vi.fn() },
}));
const binding = {
  version: 1 as const,
  cwd: '/isolated/<task>',
  sourceCwd: '/project',
  sourceRoot: '/project',
  commonDir: '/project/.git',
  gitDir: '/project/.git/worktrees/task',
  baseCommit: 'a'.repeat(40),
  created: true,
  branch: 'opa/task',
};
const task: OpaTask = {
  id: 't',
  projectPath: '/project',
  title: 'fixture',
  status: 'open',
  revision: 2,
  createdAt: 1,
  updatedAt: 2,
  worktree: binding,
};
describe('worktree controls and saved cwd links', () => {
  it('renders explicit setup only, escapes paths and never dispatches during rendering', () => {
    const save = vi.fn();
    const html = renderToStaticMarkup(
      createElement(WorktreePanel, { task, disabled: false, save }),
    );
    expect(save).not.toHaveBeenCalled();
    expect(html).toContain('Detach binding (keep files)');
    expect(html).toContain('/isolated/&lt;task&gt;');
    expect(html).toContain('vscode://file/isolated/%3Ctask%3E');
    expect(html).not.toMatch(/>Start|>Retry|>Approve|>Merge|>Delete/);
    expect(html).toMatch(/disabled=""[^>]*>Create worktree and bind/);
  });
  it('keeps historical IDE links tied to execution cwd after rebinding the task', () => {
    const html = renderToStaticMarkup(
      createElement(TaskSummary, {
        task: {
          ...task,
          worktree: { ...binding, cwd: '/new' },
          execution: {
            runId: 'run',
            state: 'cancelled',
            journal: '/fixture',
            startedAt: 1,
            finishedAt: 2,
            cwd: '/old-attempt',
            worktree: { ...binding, cwd: '/old-attempt' },
          },
        },
        historical: true,
      }),
    );
    expect(html).toContain('vscode://file/old-attempt');
    expect(html).not.toContain('vscode://file/new');
    expect(html).not.toContain('Inspect current Git context');
  });
  it('validates binding version and base identity instead of accepting arbitrary command metadata', () => {
    expect(isWorktreeBinding(binding)).toBe(true);
    expect(isWorktreeBinding({ ...binding, version: 2 })).toBe(false);
    expect(isWorktreeBinding({ ...binding, baseCommit: 'HEAD' })).toBe(false);
    expect(isWorktreeBinding({ ...binding, cwd: 'bad\0path' })).toBe(false);
  });
});
