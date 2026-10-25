import { describe, expect, it } from 'vitest';

import type { OpaUsage } from '../../core/src/opa/work.js';
import { translate } from '../src/i18n/catalog.js';
import { waitingLabel } from '../src/opa/attention.js';
import { summarizeUsage, usageCsv, usageForPeriod } from '../src/opa/usage.js';

const record = (patch: Partial<OpaUsage> = {}): OpaUsage => ({
  usageId: 'u',
  provider: 'codex',
  projectPath: '/project',
  sessionId: 's',
  timestamp: new Date(2026, 9, 25, 12).toISOString(),
  inputTokens: 1000,
  outputTokens: 100,
  cachedInputTokens: 800,
  ...patch,
});

describe('interface language', () => {
  it('switches labels and interpolates Russian waiting time without translating user content', () => {
    expect(translate('Tasks', 'ru')).toBe('Задачи');
    expect(translate('Tasks', 'en')).toBe('Tasks');
    expect(translate('My custom project', 'ru')).toBe('My custom project');
    expect(waitingLabel(0, 120000, 'ru')).toBe('Ожидание 2 мин');
    expect(translate('{project} office, {count} agents', 'ru', { project: 'OPA', count: 2 })).toBe(
      'Офис OPA, агентов: 2',
    );
  });
});
describe('usage presentation', () => {
  it('separates unknown, reported and estimated prices, including known zero', () => {
    const summary = summarizeUsage([
      record(),
      record({ cost: { amount: 0, kind: 'reported', currency: 'USD' } }),
      record({ cost: { amount: 0.02, kind: 'estimated', currency: 'USD' } }),
    ]);
    expect(summary).toMatchObject({
      input: 3000,
      output: 300,
      cached: 2400,
      reported: 0,
      estimated: 0.02,
      reportedCount: 1,
      unknownCount: 1,
    });
  });
  it('filters periods at local calendar boundaries rather than a rolling 24 hours', () => {
    const old = record({ timestamp: new Date(2026, 9, 24, 23, 59).toISOString() });
    const now = new Date(2026, 9, 25, 13);
    expect(usageForPeriod([old, record()], 'today', now)).toEqual([record()]);
    expect(usageForPeriod([old, record()], 'month', now)).toHaveLength(2);
    expect(
      usageForPeriod([record({ timestamp: new Date(2026, 9, 26).toISOString() })], 'today', now),
    ).toHaveLength(0);
  });
  it('exports UTF-8 CSV with unknown prices empty and spreadsheet formulas escaped', () => {
    const csv = usageCsv([record({ model: '=SUM(1,2)' })]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('"\'=SUM(1,2)"');
    expect(csv).toContain('"800","",""');
  });
});
