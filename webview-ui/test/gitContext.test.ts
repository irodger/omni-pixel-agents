import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { isGitContext, type OpaGitContext } from '../../core/src/opa/gitContext.js';
import { GitContextPanel, GitObservation } from '../src/opa/GitContextPanel.js';

vi.mock('../src/i18n/index.js', () => ({
  t: (key: string) => key,
  useLanguage: () => ({ language: 'en' }),
  localeName: () => 'en-US',
}));
vi.mock('../src/transport/index.js', () => ({
  transport: { state: 'connected', onMessage: () => () => {}, send: vi.fn() },
}));

describe('Git observation display', () => {
  it('keeps old attempts unknown, displays unborn and detached distinctly, and escapes paths', () => {
    const missing = renderToStaticMarkup(createElement(GitObservation, {}));
    expect(missing).toContain('not recorded');
    const context: OpaGitContext = {
      version: 1,
      observedAt: 1,
      cwd: '/fixture/<script>',
      state: 'available',
      root: '/fixture',
      gitDir: '/fixture/.git',
      commonDir: '/fixture/.git',
      branch: 'main',
      detached: false,
      dirty: true,
      conflicted: true,
      submodule: false,
    };
    const unborn = renderToStaticMarkup(createElement(GitObservation, { context }));
    expect(unborn).toContain('unborn');
    expect(unborn).toContain('Conflicts present');
    expect(unborn).toContain('&lt;script&gt;');
    expect(unborn).not.toContain('<script>');
    const detached = renderToStaticMarkup(
      createElement(GitObservation, {
        context: { ...context, detached: true, branch: undefined, head: 'a'.repeat(40) },
      }),
    );
    expect(detached).toContain('Detached HEAD');
    expect(detached).not.toContain('unborn');
  });
  it('contains only an observer action and preserves saved observations without inferring successful checks', () => {
    const html = renderToStaticMarkup(createElement(GitContextPanel, { projectPath: '/fixture' }));
    expect(html).toContain('Inspect current Git context');
    expect(html).toContain('file contents and submodule changes are not compared');
    expect(html).not.toMatch(/>Start<|>Retry<|>Merge<|>Approve<|passed|clean/);
    expect(isGitContext({ version: 1, observedAt: 1, cwd: '/fixture', state: 'unavailable' })).toBe(
      true,
    );
    expect(isGitContext({ version: 1, observedAt: 1, cwd: '/fixture', state: 'available' })).toBe(
      false,
    );
  });
});
