import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { isDiffSnapshot, type OpaDiffSnapshot } from '../../core/src/opa/diff.js';
import { DiffContent, DiffPanel } from '../src/opa/DiffPanel.js';

vi.mock('../src/i18n/index.js', () => ({ t: (s: string) => s }));
const send = vi.hoisted(() => vi.fn());
vi.mock('../src/transport/index.js', () => ({
  transport: { state: 'connected', send, onMessage: () => () => {} },
}));
const snapshot: OpaDiffSnapshot = {
  version: 1,
  projectPath: '/project',
  taskId: 'task',
  runId: 'run',
  mode: 'working',
  cwd: '/project',
  base: 'a'.repeat(40),
  head: 'b'.repeat(40),
  observedHead: 'b'.repeat(40),
  observedAt: 1,
  snapshot: 'c'.repeat(64),
  stale: true,
  filtersDisabled: true,
  historicalDirtyUnavailable: true,
  limited: false,
  files: [
    { path: '<file>.txt', added: 1, deleted: 0, binary: false, openPath: '/project/<file>.txt' },
  ],
  path: '<file>.txt',
  patch: '+<script>alert("escaped")</script>',
  truncated: true,
};
describe('diff evidence and read-only rendering', () => {
  it('escapes paths/patches, labels current and stale observations, and limits previews', () => {
    const html = renderToStaticMarkup(createElement(DiffContent, { result: snapshot }));
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;file&gt;');
    expect(html).toContain('Current changes, not a historical dirty snapshot');
    expect(html).toContain('Current HEAD or branch differs');
    expect(html).toContain('128 Ki characters');
    expect(html).toContain('Git filters are disabled');
    expect(html).toContain('vscode://file/project/%3Cfile%3E.txt');
  });
  it('shows binary/untracked absence without inferred contents or checks', () => {
    for (const file of [
      { path: 'binary', binary: true },
      { path: 'untracked', binary: false, untracked: true },
    ]) {
      const html = renderToStaticMarkup(
        createElement(DiffContent, {
          result: { ...snapshot, files: [file], path: file.path, patch: undefined },
        }),
      );
      expect(html).toMatch(/text preview unavailable|contents are not read/);
      expect(html).not.toContain('<pre');
      expect(html).not.toContain('passed');
    }
  });
  it('does not load or execute on rendering and rejects malformed/oversized responses', () => {
    const html = renderToStaticMarkup(
      createElement(DiffPanel, { projectPath: '/project', taskId: 'task', runId: 'run' }),
    );
    expect(send).not.toHaveBeenCalled();
    expect(html).toContain('Show recorded commit diff');
    expect(html).not.toMatch(/>Stage|>Commit|>Merge|>Approve|>Run/);
    expect(isDiffSnapshot(snapshot)).toBe(true);
    expect(isDiffSnapshot({ ...snapshot, version: 2 })).toBe(false);
    expect(isDiffSnapshot({ ...snapshot, patch: 'x'.repeat(131073) })).toBe(false);
    expect(isDiffSnapshot({ ...snapshot, files: [...snapshot.files, ...snapshot.files] })).toBe(
      false,
    );
    expect(isDiffSnapshot({ ...snapshot, mode: ['working'] })).toBe(false);
    expect(isDiffSnapshot({ ...snapshot, historicalDirtyUnavailable: false })).toBe(false);
  });
});
