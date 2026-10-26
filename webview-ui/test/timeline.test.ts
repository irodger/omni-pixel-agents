import { describe, expect, it, vi } from 'vitest';

import type { OpaEventHistoryPage } from '../../core/src/messages.js';
import type { OpaHistoryEntry } from '../../core/src/opa/history.js';
import { parseRoute, publicLink, resolveRoute, routeHash } from '../src/opa/deepLinks.js';
import {
  mergeTimeline,
  timelineExcerpt,
  timelineQuery,
  timelineTaskId,
} from '../src/opa/timelineModel.js';
vi.mock('../src/i18n/index.js', () => ({
  t: (key: string) => key,
  useLanguage: () => ({ language: 'en' }),
  localeName: () => 'en-US',
}));

const entry = (ordinal: number): OpaHistoryEntry => ({
  ordinal,
  observedAt: 10000 + ordinal,
  origin: 'fixture',
  projectPath: '/fixture',
  event: {
    specVersion: '0.1',
    id: `event-${ordinal}`,
    provider: 'fixture',
    sessionId: 's',
    agentId: 'a',
    streamId: 'stream',
    sequence: ordinal,
    timestamp: new Date(1000 - ordinal).toISOString(),
    type: 'permission.requested',
  },
});
const page = (ids: number[]): OpaEventHistoryPage => ({
  type: 'opaEventHistoryPage',
  requestId: 'r',
  droppedThrough: 0,
  entries: ids.map(entry),
});
describe('passive saved timeline', () => {
  it('round trips every filter and selected observation without credentials', () => {
    const route = {
      view: 'timeline' as const,
      project: '/fixture',
      task: 'task #1',
      run: 'run &2',
      provider: 'fixture',
      session: 's',
      eventType: 'permission.requested',
      event: '7',
    };
    const link = publicLink('https://user:secret@localhost/?token=secret&command=start', route);
    expect(link).not.toContain('secret');
    expect(parseRoute(new URL(link).hash)).toEqual(route);
    expect(timelineQuery(route)).toEqual({
      projectPath: '/fixture',
      taskId: 'task #1',
      runId: 'run &2',
      provider: 'fixture',
      sessionId: 's',
      eventType: 'permission.requested',
      before: 8,
      limit: 20,
    });
    expect(timelineQuery(route, 3).before).toBe(3);
    expect(resolveRoute(route, [], [])).toBe(true);
  });
  it.each(['0', '-1', '1.2', 'NaN', '9007199254740991'])('rejects invalid ordinal %s', (event) =>
    expect(parseRoute(`#opa?v=1&view=timeline&project=%2Ffixture&event=${event}`)).toBeNull(),
  );
  it('rejects orphan filters, unknown types and executable fields', () => {
    expect(parseRoute('#opa?v=1&view=timeline&provider=fixture')).toBeNull();
    expect(
      parseRoute('#opa?v=1&view=timeline&project=%2Ffixture&eventType=command.start'),
    ).toBeNull();
    expect(parseRoute('#opa?v=1&view=tasks&project=%2Ffixture&event=1')).toBeNull();
    expect(parseRoute('#opa?v=1&view=timeline&project=%2Ffixture&command=start')).toBeNull();
    expect(
      parseRoute(routeHash({ view: 'timeline', project: '/fixture', run: 'unassociated-run' })),
    ).toMatchObject({ run: 'unassociated-run' });
  });
  it('deduplicates overlapping pages/reconnects in ordinal order despite skewed clocks', () => {
    const first = mergeTimeline([], page([5, 4, 3]), '/fixture');
    const more = mergeTimeline(first, page([3, 2, 1]), '/fixture');
    expect(more.map((e) => e.ordinal)).toEqual([5, 4, 3, 2, 1]);
    expect(mergeTimeline(more, page([5, 4, 3]), '/fixture')).toEqual(more);
    expect(first[0].event.timestamp < first[1].event.timestamp).toBe(true);
    expect(first[0].origin).toBe('fixture');
    expect(first[0].event.type).toBe('permission.requested');
    expect(timelineTaskId(first[0])).toBeUndefined();
  });
  it('rejects cross-project/corrupt pages without mutating cached evidence', () => {
    const current = [entry(2)];
    const snapshot = structuredClone(current);
    expect(() => mergeTimeline(current, page([1]), '/other')).toThrow('EVENT_HISTORY_INVALID');
    expect(() =>
      mergeTimeline(current, { ...page([1]), droppedThrough: undefined }, '/fixture'),
    ).toThrow();
    expect(() =>
      mergeTimeline(current, { ...page([1]), entries: [{ ...entry(1), event: {} }] }, '/fixture'),
    ).toThrow();
    expect(current).toEqual(snapshot);
  });
  it('shows captured association/text without inferring task state', () => {
    const e = entry(1);
    expect(timelineTaskId(e)).toBeUndefined();
    expect(timelineExcerpt(e)).toBeUndefined();
    const task: OpaHistoryEntry = {
      ...e,
      event: {
        ...e.event,
        specVersion: '0.2',
        type: 'task.upserted',
        cwd: '/fixture',
        taskId: 't',
        title: '<script>fixture</script>',
        status: 'open',
      },
    };
    expect(timelineTaskId(task)).toBe('t');
    expect(timelineExcerpt(task)).toBe('<script>fixture</script>');
    expect(timelineTaskId({ ...task, taskId: 'captured' })).toBe('captured');
  });
});

describe('timeline rendering', () => {
  it('escapes recorded text and exposes clocks, provenance and unknown associations', async () => {
    const { createElement } = await import('react');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { TimelineEntry } = await import('../src/opa/TimelineEntry.js');
    const e: OpaHistoryEntry = {
      ...entry(7),
      truncatedFields: ['text'],
      event: {
        ...entry(7).event,
        type: 'message',
        role: 'assistant',
        text: '<script>execute()</script>',
      },
    };
    let navigations = 0;
    const html = renderToStaticMarkup(
      createElement(TimelineEntry, {
        entry: e,
        route: { view: 'timeline', project: '/fixture', event: '7' },
        navigate: () => {
          navigations++;
        },
      }),
    );
    expect(html).toContain('Fixture / test data');
    expect(html).toContain('Source time');
    expect(html).toContain('Observed time');
    expect(html).toContain('Unknown');
    expect(html).toContain('Stored excerpt is truncated.');
    expect(html).toContain('&lt;script&gt;execute()&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('<details open=""');
    expect(navigations).toBe(0);
    expect(html).not.toMatch(/Approve|Retry|Start agent|Stop agent/);
  });
});
