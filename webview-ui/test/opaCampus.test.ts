import { describe, expect, it } from 'vitest';

import type { OpaAgentSnapshot, OpaProjectSnapshot } from '../../core/src/messages.js';
import { createDefaultLayout } from '../src/office/layout/layoutSerializer.js';
import { TileType } from '../src/office/types.js';
import { attentionRows, markSeen, needsAttention, waitingLabel } from '../src/opa/attention.js';
import { ProjectOffice } from '../src/opa/projectOffice.js';
import { projectViewport } from '../src/opa/viewport.js';

const agent = (patch: Partial<OpaAgentSnapshot> = {}): OpaAgentSnapshot => ({
  id: 1,
  name: 'Coder',
  provider: 'codex',
  status: 'working',
  tools: [],
  ...patch,
});
const project = (id: string, agents: OpaAgentSnapshot[]): OpaProjectSnapshot => ({
  id,
  name: id,
  path: `/${id}`,
  agents,
});

describe('campus attention', () => {
  it('opening a completion marks it seen, but cannot acknowledge away an approval', () => {
    const done = agent({ status: 'done', attentionId: 'turn1' });
    const seen = markSeen([], done);
    expect(needsAttention(done, seen)).toBe(false);
    expect(needsAttention(agent({ status: 'done', attentionId: 'turn2' }), seen)).toBe(true);
    const blocked = agent({ status: 'blocked' });
    expect(needsAttention(blocked, markSeen([], blocked))).toBe(true);
  });
  it('prioritizes approvals over errors and completed results; oldest block first', () => {
    const rows = attentionRows(
      [
        project('a', [
          agent({ status: 'done', attentionId: 'done' }),
          agent({ id: 2, status: 'error', attentionId: 'error' }),
          agent({ id: 3, status: 'blocked', blockedSince: 20 }),
          agent({ id: 4, status: 'blocked', blockedSince: 10 }),
        ]),
      ],
      [],
    );
    expect(rows.map((r) => r.agent.id)).toEqual([4, 3, 2, 1]);
  });
  it('bounds seen history and formats waiting duration without negative values', () => {
    expect(
      markSeen(
        Array.from({ length: 2000 }, (_, i) => `e${i}`),
        agent({ attentionId: 'new' }),
      ),
    ).toHaveLength(2000);
    expect(waitingLabel(5000, 1000)).toBe('Waiting 0s');
    expect(waitingLabel(1000, 121000)).toBe('Waiting 2m');
    expect(waitingLabel(0, 3600000)).toBe('Waiting 1h');
  });
});

describe('independent project offices', () => {
  it('centers a room below unused expansion tiles and handles an empty room', () => {
    const layout = {
      ...createDefaultLayout(),
      cols: 10,
      rows: 10,
      tiles: Array(100).fill(TileType.VOID),
    };
    layout.tiles[85] = TileType.FLOOR_1;
    const view = projectViewport(layout, 300, 300);
    expect(view.panY).toBeLessThan(0);
    expect(view.zoom).toBeGreaterThan(
      projectViewport({ ...layout, tiles: Array(100).fill(TileType.FLOOR_1) }, 300, 300).zoom,
    );
    const empty = projectViewport({ ...layout, tiles: Array(100).fill(TileType.VOID) }, 300, 300);
    expect(empty.panX).toBe(0);
    expect(empty.panY).toBe(0);
    expect(Number.isFinite(empty.zoom)).toBe(true);
  });
  it('allocates separate seats and simulations, and preserves them across snapshot updates', () => {
    const layout = createDefaultLayout();
    const a = new ProjectOffice(layout);
    const b = new ProjectOffice(layout);
    a.sync(project('a', [agent()]));
    b.sync(project('b', [agent({ id: 2, provider: 'opencode' })]));
    expect([...a.office.characters.keys()]).toEqual([1]);
    expect([...b.office.characters.keys()]).toEqual([2]);
    expect(a.office.seats).not.toBe(b.office.seats);
    expect(a.office.layout).not.toBe(layout);
    const character = a.office.characters.get(1);
    a.sync(project('a', [agent({ status: 'blocked' })]));
    expect(a.office.characters.get(1)).toBe(character);
    expect(character?.bubbleType).toBe('permission');
    a.sync(project('a', [agent({ status: 'working' })]));
    expect(character?.bubbleType).toBeNull();
    expect(b.office.characters.get(2)?.bubbleType).toBeNull();
  });
});
