import { describe, expect, it } from 'vitest';

import type { OpaProjectSnapshot } from '../../core/src/messages.js';
import {
  parseRoute,
  publicLink,
  resolveRoute,
  routeHash,
  vscodeProjectLink,
} from '../src/opa/deepLinks.js';

const projects: OpaProjectSnapshot[] = ['/a/same', '/b/same'].map((id) => ({
  id,
  path: id,
  name: 'same',
  agents: [
    {
      id: 99,
      provider: 'codex',
      sessionId: 'session',
      sourceAgentId: 'one',
      name: 'agent',
      status: 'blocked',
      tools: [],
    },
    {
      id: 100,
      provider: 'opencode',
      sessionId: 'session',
      sourceAgentId: 'one',
      name: 'agent',
      status: 'done',
      tools: [],
    },
  ],
}));
describe('versioned passive deep links', () => {
  it('restricts IDE links to encoded folder paths', () => {
    expect(vscodeProjectLink('/a/folder #?&')).toBe('vscode://file/a/folder%20%23%3F%26');
    expect(vscodeProjectLink('C:\\project')).toBe('vscode://file/C:/project');
    expect(vscodeProjectLink('command:exec')).toBeNull();
    expect(vscodeProjectLink('//remote/share')).toBeNull();
    expect(vscodeProjectLink('/a\n')).toBeNull();
  });
  it('round trips encoded identities and removes credentials and every query parameter', () => {
    const route = { view: 'tasks' as const, project: '/a/Проект #?&', task: 'id #&?' };
    const link = publicLink('https://user:pass@localhost:3100/?token=secret&prompt=run#old', route);
    expect(link).not.toContain('secret');
    const url = new URL(link);
    expect(url.search).toBe('');
    expect(url.username).toBe('');
    expect(url.password).toBe('');
    expect(parseRoute(url.hash)).toEqual(route);
    expect(() => publicLink('vscode-webview://host/index.html', route)).toThrow();
  });
  it.each([
    '#opa?v=2&view=overview',
    '#opa?v=1&view=tasks&task=missing',
    '#opa?v=1&view=tasks&view=usage',
    '#opa?v=1&view=overview&command=exec',
    '#opa?v=1&view=overview&project=%00',
    '#opa?v=1&view=overview&project=%xy',
    '#opa?v=1&view=overview&session=x',
    '#other',
  ])('rejects malformed routes: %s', (hash) => expect(parseRoute(hash)).toBeNull());
  it('resolves full project and source identity without relying on display names or transient numeric IDs', () => {
    const route = {
      view: 'overview' as const,
      project: '/b/same',
      provider: 'codex',
      session: 'session',
      agent: 'one',
    };
    expect(resolveRoute(parseRoute(routeHash(route))!, projects, [])).toBe(true);
    expect(resolveRoute({ ...route, project: '/missing/same' }, projects, [])).toBe(false);
    expect(resolveRoute({ ...route, provider: 'other' }, projects, [])).toBe(false);
    expect(resolveRoute({ ...route, agent: 'two' }, projects, [])).toBe(false);
    expect(resolveRoute({ view: 'tasks', project: '/a/same', task: 'missing' }, projects, [])).toBe(
      false,
    );
    expect(projects[1].agents[0].status).toBe('blocked');
  });
});
