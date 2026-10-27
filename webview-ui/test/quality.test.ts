import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { isQualityData, isQualityRun, type QualityRun } from '../../core/src/opa/quality.js';
import { QualityPanel, QualityRunContent } from '../src/opa/QualityPanel.js';
vi.mock('../src/i18n/index.js', () => ({ t: (s: string) => s }));
const send = vi.hoisted(() => vi.fn());
vi.mock('../src/transport/index.js', () => ({
  transport: { state: 'connected', send, onMessage: () => () => {}, onStateChange: () => () => {} },
}));
const run: QualityRun = {
  id: 'plan',
  expiresAt: 1000,
  projectPath: '/fixture',
  taskId: 'task',
  runId: 'attempt',
  cwd: '/fixture/tree',
  repoId: '/fixture/.git',
  base: 'a'.repeat(40),
  head: 'b'.repeat(40),
  fingerprint: 'c'.repeat(64),
  configDigest: 'd'.repeat(64),
  program: 'e'.repeat(64),
  check: {
    id: 'check',
    name: '<Fixture check>',
    executable: '/bin/node',
    args: ['<script>'],
    timeoutMs: 1000,
  },
  checkRunId: 'observation',
  startedAt: 1,
  spawnedAt: 2,
  finishedAt: 3,
  exitCode: 0,
  state: 'passed',
  stale: true,
  stdout: '<script>alert("fixture")</script>',
  stderr: '',
  truncated: true,
  tests: 'unreported',
};
describe('local check evidence rendering', () => {
  it('escapes logs and renders stale process outcomes without inventing test counts', () => {
    const html = renderToStaticMarkup(createElement(QualityRunContent, { r: run }));
    expect(html).toContain('passed');
    expect(html).toContain('stale');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('test count: unreported');
    expect(html).toContain('8192 characters');
    expect(html).toContain('/fixture/tree');
  });
  it('never prepares or launches while rendering', () => {
    const html = renderToStaticMarkup(
      createElement(QualityPanel, { projectPath: '/fixture', taskId: 'task', runId: 'attempt' }),
    );
    expect(send).not.toHaveBeenCalled();
    expect(html).toContain('Refresh checks');
    expect(html).not.toContain('Approve and run once');
  });
  it('rejects fabricated success, oversized evidence and unknown formats', () => {
    expect(isQualityRun(run)).toBe(true);
    expect(isQualityRun({ ...run, spawnedAt: undefined })).toBe(false);
    expect(isQualityRun({ ...run, exitCode: 7 })).toBe(false);
    expect(isQualityRun({ ...run, stdout: 'x'.repeat(8193) })).toBe(false);
    expect(isQualityRun({ ...run, tests: '100 passed' })).toBe(false);
    expect(isQualityData({ version: 2, configs: [], runs: [] })).toBe(false);
  });
});
