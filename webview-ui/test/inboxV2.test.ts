import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { OpaAttentionItem, OpaAttentionSnapshot } from '../../core/src/opa/attention.js';
import { AttentionPanel } from '../src/opa/AttentionPanel.js';
import {
  emptyPreferences,
  inboxPresentation,
  inboxStorageKey,
  matchingInboxItem,
  parsePreferences,
  updateInboxMark,
} from '../src/opa/inboxPreferences.js';
import { activeInboxItems, attentionRoute, isAttentionSnapshot } from '../src/opa/inboxV2.js';
import type { useCampus } from '../src/opa/useCampus.js';
vi.mock('../src/i18n/index.js', () => ({
  t: (key: string) => key,
  useLanguage: () => ({ language: 'en' }),
  localeName: () => 'en-US',
}));
const fact = (id = 'run-one'): OpaAttentionItem => ({
  fact: {
    id,
    projectPath: '/fixture',
    kind: 'error',
    title: 'Fixture <result>',
    state: 'failed',
    origin: 'fixture',
    taskId: 't',
    runId: id,
    observedAt: 100,
  },
  activity: 'recorded',
});
const snapshot = (items: OpaAttentionItem[] = [fact()]): OpaAttentionSnapshot => ({
  version: 1,
  hostId: 'host-one',
  items,
  limited: false,
  droppedFacts: 0,
  droppedEventsThrough: 0,
});
describe('host/browser-scoped Inbox presentation', () => {
  it('round trips read/dismiss/snooze marks without mutating facts or carrying marks to another attempt', () => {
    const old = fact();
    const next = fact('run-two');
    const unchanged = structuredClone(old);
    let marks = updateInboxMark(emptyPreferences(), old, 'read', 1000);
    marks = parsePreferences(JSON.stringify(marks));
    expect(inboxPresentation(old, marks, 1000).active).toBe(false);
    expect(inboxPresentation(next, marks, 1000).active).toBe(true);
    expect(old).toEqual(unchanged);
    marks = updateInboxMark(marks, old, 'restore', 1000);
    marks = updateInboxMark(marks, old, 'snooze', 1000);
    expect(inboxPresentation(old, marks, 600999).snoozed).toBe(true);
    expect(inboxPresentation(old, marks, 601000).active).toBe(true);
    marks = updateInboxMark(marks, old, 'dismiss', 601000);
    expect(inboxPresentation(old, parsePreferences(JSON.stringify(marks)), 601000).dismissed).toBe(
      true,
    );
    expect(inboxStorageKey('host-one')).not.toBe(inboxStorageKey('host-two'));
  });
  it('never acknowledges/dismisses an active permission, and snoozing cannot resolve it', () => {
    const block: OpaAttentionItem = {
      fact: { ...fact().fact, kind: 'blocked', permissionId: 'p' },
      activity: 'current',
    };
    expect(() => updateInboxMark(emptyPreferences(), block, 'read', 0)).toThrow(
      'INBOX_BLOCK_ACTIVE',
    );
    expect(() => updateInboxMark(emptyPreferences(), block, 'dismiss', 0)).toThrow(
      'INBOX_BLOCK_ACTIVE',
    );
    const cached = parsePreferences(
      JSON.stringify({ version: 1, marks: [{ id: block.fact.id, read: true, dismissed: true }] }),
    );
    expect(inboxPresentation(block, cached, 0).active).toBe(true);
    const snoozed = updateInboxMark(emptyPreferences(), block, 'snooze', 0);
    expect(inboxPresentation(block, snoozed, 1).active).toBe(false);
    expect(block.activity).toBe('current');
    expect(block.fact.permissionId).toBe('p');
    expect(inboxPresentation(block, snoozed, 600000).active).toBe(true);
  });
  it('rejects actions for another host, missing fact or obsolete activity and keeps fact/run identity', () => {
    const data = snapshot([fact(), fact('run-two')]);
    expect(() => matchingInboxItem(data, 'run-one', 'host-two', 'recorded')).toThrow(
      'INBOX_ITEM_STALE',
    );
    expect(() => matchingInboxItem(data, 'missing', 'host-one', 'recorded')).toThrow();
    expect(() => matchingInboxItem(data, 'run-one', 'host-one', 'current')).toThrow();
    const marks = updateInboxMark(
      emptyPreferences(),
      matchingInboxItem(data, 'run-one', 'host-one', 'recorded'),
      'read',
      1,
    );
    expect(activeInboxItems(data.items, marks, 1).map((item) => item.id)).toEqual(['run-two']);
    expect(attentionRoute(data.items[0])).toMatchObject({
      view: 'tasks',
      task: 't',
      run: 'run-one',
    });
  });
  it('bounds preferences and rejects corrupt/future data instead of guessing marks', () => {
    const marks = {
      version: 1 as const,
      marks: Array.from({ length: 2000 }, (_, i) => ({ id: String(i), read: true })),
    };
    expect(updateInboxMark(marks, fact(), 'read', 1).marks).toHaveLength(2000);
    for (const raw of [
      '{',
      '{"version":2,"marks":[]}',
      '{"version":1,"marks":[{"id":"x","read":"yes"}]}',
      '{"version":1,"marks":[{"id":"x"},{"id":"x"}]}',
    ])
      expect(() => parsePreferences(raw)).toThrow();
    expect(isAttentionSnapshot({ ...snapshot(), items: [fact(), fact()] })).toBe(false);
    expect(isAttentionSnapshot({ ...snapshot(), items: [null] })).toBe(false);
  });
  it('uses one active projection for counts and keeps resolved/stale requests in the history view', () => {
    const resolved: OpaAttentionItem = {
      ...fact('resolved'),
      fact: { ...fact('resolved').fact, kind: 'blocked' },
      activity: 'resolved',
    };
    const stale: OpaAttentionItem = {
      ...resolved,
      fact: { ...resolved.fact, id: 'stale' },
      activity: 'stale',
    };
    const data = snapshot([resolved, stale, fact()]);
    expect(activeInboxItems(data.items, emptyPreferences(), 1).map((item) => item.id)).toEqual([
      'run-one',
    ]);
    expect(data.items).toHaveLength(3);
    expect(data.items.some((item) => item.fact.kind === 'check')).toBe(false);
  });
  it('renders fixture provenance and personal actions with no execution/permission methods', () => {
    const data = snapshot();
    const presentInbox = vi.fn();
    const navigate = vi.fn();
    const campus = {
      attention: data,
      inboxMarks: emptyPreferences(),
      now: 100,
      inbox: activeInboxItems(data.items, emptyPreferences(), 100),
      projects: [],
      connection: 'connected',
      presentInbox,
      refreshInbox: vi.fn(),
      resetInboxPreferences: vi.fn(),
    } as unknown as ReturnType<typeof useCampus>;
    const html = renderToStaticMarkup(
      createElement(AttentionPanel, { campus, projectId: '/fixture', navigate }),
    );
    expect(html).toContain('Fixture &lt;result&gt;');
    expect(html).toContain('Fixture / test data');
    expect(html).toContain('Snooze 10 minutes');
    expect(html).toContain('Dismiss');
    expect(html).not.toMatch(/Approve|Retry task|Start next task|Start task/);
    expect(presentInbox).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(html).toContain('other users or devices');
  });
});
