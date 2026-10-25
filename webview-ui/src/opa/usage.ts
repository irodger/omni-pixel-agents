import type { OpaUsage } from '../../../core/src/opa/work.js';

export type UsagePeriod = 'all' | 'today' | 'month';
export function usageForPeriod(usage: OpaUsage[], period: UsagePeriod, now: Date): OpaUsage[] {
  if (period === 'all') return usage;
  const start =
    period === 'today'
      ? new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
      : new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  return usage.filter(
    (u) => Date.parse(u.timestamp) >= start && Date.parse(u.timestamp) <= now.getTime(),
  );
}
export function summarizeUsage(usage: OpaUsage[]) {
  return usage.reduce(
    (sum, u) => ({
      input: sum.input + u.inputTokens,
      output: sum.output + u.outputTokens,
      cached: sum.cached + (u.cachedInputTokens ?? 0),
      reported: sum.reported + (u.cost?.kind === 'reported' ? u.cost.amount : 0),
      estimated: sum.estimated + (u.cost?.kind === 'estimated' ? u.cost.amount : 0),
      reportedCount: sum.reportedCount + Number(u.cost?.kind === 'reported'),
      estimatedCount: sum.estimatedCount + Number(u.cost?.kind === 'estimated'),
      unknownCount: sum.unknownCount + Number(!u.cost),
    }),
    {
      input: 0,
      output: 0,
      cached: 0,
      reported: 0,
      estimated: 0,
      reportedCount: 0,
      estimatedCount: 0,
      unknownCount: 0,
    },
  );
}
export function usageCsv(usage: OpaUsage[]): string {
  const cell = (v: string | number | undefined) => {
    let text = String(v ?? '');
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  const rows: (string | number | undefined)[][] = [
    [
      'timestamp',
      'project',
      'provider',
      'session',
      'usage_id',
      'model',
      'input_tokens',
      'output_tokens',
      'cached_input_tokens',
      'cache_write_tokens',
      'reasoning_tokens',
      'cost_usd',
      'cost_kind',
    ],
  ];
  for (const u of usage)
    rows.push([
      u.timestamp,
      u.projectPath,
      u.provider,
      u.sessionId,
      u.usageId,
      u.model,
      u.inputTokens,
      u.outputTokens,
      u.cachedInputTokens,
      u.cacheWriteTokens,
      u.reasoningTokens,
      u.cost?.amount,
      u.cost?.kind,
    ]);
  return '\uFEFF' + rows.map((row) => row.map(cell).join(',')).join('\r\n');
}
