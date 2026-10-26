import { expect, test } from '@playwright/test';

async function installHistoryFixture(page: import('@playwright/test').Page) {
  // Fixture-only WebSocket. No server or executor command can leave this browser.
  await page.addInitScript(() => {
    localStorage.setItem('opa.language', 'en');
    const sent: Record<string, unknown>[] = [];
    Object.assign(window, { __opaHistorySent: sent });
    class FixtureSocket {
      static OPEN = 1;
      readyState = 1;
      onopen?: () => void;
      onmessage?: (event: { data: string }) => void;
      onclose?: () => void;
      constructor() {
        setTimeout(() => this.onopen?.(), 0);
      }
      send(raw: string) {
        const message = JSON.parse(raw);
        sent.push(message);
        if (message.type !== 'opaTaskRunsRequest') return;
        const all = Array.from({ length: 21 }, (_, index) => {
          const n = 21 - index;
          const active =
            n === 21 &&
            !(window as unknown as { __opaHistoryComplete?: boolean }).__opaHistoryComplete;
          return {
            version: 1,
            projectPath: '/fixture',
            taskId: 'task',
            title: n === 1 ? 'Original task title' : 'Renamed task title',
            execution: {
              runId: `run-${n}`,
              executorId: 'fixture-executor',
              state: active ? 'running' : 'completed',
              journal: '/fixture-journal',
              startedAt: n * 1000,
              ...(active ? {} : { finishedAt: n * 1000 + 10 }),
              output: n === 1 ? 'First attempt result' : `Fixture result ${n}`,
            },
          };
        });
        const start = message.before
          ? all.findIndex((r) => r.execution.runId === message.before) + 1
          : 0;
        const list = message.runId
          ? all.filter((r) => r.execution.runId === message.runId)
          : all.slice(start, start + (message.limit ?? 20));
        const nextCursor =
          !message.runId && start + list.length < all.length
            ? list.at(-1)?.execution.runId
            : undefined;
        queueMicrotask(() =>
          this.onmessage?.({
            data: JSON.stringify({
              type: 'opaTaskRunsPage',
              requestId: message.requestId,
              runs: list,
              nextCursor,
              ...(message.runId && !list.length ? { error: 'RUN_NOT_FOUND' } : {}),
            }),
          }),
        );
      }
      close() {
        this.readyState = 3;
        this.onclose?.();
      }
    }
    Object.assign(window, { WebSocket: FixtureSocket });
  });
}
async function seed(page: import('@playwright/test').Page) {
  await expect(page.getByRole('heading', { name: 'Campus', exact: true })).toBeVisible();
  await page.evaluate(async () => {
    // Same singleton as the UI; explicitly connect it to the fixture-only socket.
    const moduleUrl = '/src/transport/index.ts';
    const { transport } = await import(moduleUrl);
    transport.connect();
    window.postMessage(
      {
        type: 'opaCampusState',
        projects: [{ id: '/fixture', path: '/fixture', name: 'Fixture', agents: [] }],
      },
      '*',
    );
    window.postMessage(
      {
        type: 'opaWorkState',
        tasks: [
          {
            id: 'task',
            projectPath: '/fixture',
            title: 'Renamed task title',
            status: 'in_progress',
            assignee: 'fixture-executor',
            createdAt: 1,
            updatedAt: 21,
            revision: 21,
            execution: {
              runId: 'run-21',
              executorId: 'fixture-executor',
              state: 'running',
              journal: '/fixture-journal',
              startedAt: 21000,
              permissions: [
                {
                  id: 'current-permission',
                  title: 'Current permission only',
                  options: [{ optionId: 'yes', name: 'Approve current', kind: 'allow_once' }],
                },
              ],
            },
          },
        ],
        usage: [],
      },
      '*',
    );
  });
}

test('saved attempts paginate, open stable run links and never show current permission controls', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await installHistoryFixture(page);
  await page.goto('/?token=fixture-secret#opa?v=1&view=tasks&project=%2Ffixture&task=task');
  await seed(page);
  await expect(page.getByText('Current permission only', { exact: true })).toBeVisible();
  await page.getByText('Run history', { exact: true }).click();
  await expect(page.locator('.opa-run-button')).toHaveCount(20);
  await page.getByRole('button', { name: 'Load older attempts' }).click();
  await expect(page.locator('.opa-run-button')).toHaveCount(21);
  await page.getByRole('button', { name: / · run-1$/ }).click();
  const summary = page.getByRole('region', {
    name: 'Task summary: Original task title',
    exact: true,
  });
  await expect(summary).toBeVisible();
  await expect(page.getByText('Current permission only', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Stop agent', exact: true })).toHaveCount(0);
  await summary.getByText('Result', { exact: true }).click();
  await expect(summary.locator('pre')).toHaveText('First attempt result');
  await summary.getByRole('button', { name: 'Copy link', exact: true }).click();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toContain('run=run-1');
  expect(link).not.toContain('fixture-secret');
  expect(await page.evaluate(() => localStorage.getItem('opa.campus.seen.v1'))).toBeNull();
  await page.reload();
  await seed(page);
  await expect(summary).toBeVisible();
  const sent = await page.evaluate(
    () => (window as unknown as { __opaHistorySent: { type: string }[] }).__opaHistorySent,
  );
  expect(sent.every((m) => ['opaTaskRunsRequest', 'webviewReady'].includes(m.type))).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await summary.scrollIntoViewIfNeeded();
  expect(
    await page.locator('.opa-campus').evaluate((node) => node.scrollWidth <= node.clientWidth),
  ).toBe(true);
  await page.screenshot({ path: 'test-results/opa-task-history-mobile.png' });
  await page.getByRole('button', { name: 'Return to latest', exact: true }).click();
  await expect(page.getByText('Current permission only', { exact: true })).toBeVisible();
  await page.evaluate(() => {
    location.hash += '&run=run-21';
  });
  await expect(
    page.getByText('This attempt is still active. Live controls stay on the latest task.', {
      exact: true,
    }),
  ).toBeVisible();
  await page.evaluate(() => {
    Object.assign(window, { __opaHistoryComplete: true });
    window.postMessage(
      {
        type: 'opaWorkState',
        tasks: [
          {
            id: 'task',
            projectPath: '/fixture',
            title: 'Renamed task title',
            status: 'done',
            createdAt: 1,
            updatedAt: 22,
            revision: 22,
            execution: {
              runId: 'run-21',
              state: 'completed',
              journal: '/fixture-journal',
              startedAt: 21000,
              finishedAt: 21010,
            },
          },
        ],
        usage: [],
      },
      '*',
    );
  });
  await expect(
    page.getByRole('region', { name: 'Task summary: Renamed task title', exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    location.hash = '#opa?v=1&view=tasks&project=%2Ffixture&task=task&run=missing';
  });
  await expect(
    page.getByText('This saved attempt is unavailable on this host.', { exact: true }),
  ).toBeVisible();
  await expect(summary).toHaveCount(0);
  await page.evaluate(() => {
    location.hash = '#opa?v=1&view=tasks&project=%2Ffixture&task=task&run=run-1';
  });
  await expect(summary).toBeVisible();
  await page.evaluate(async () => {
    const moduleUrl = '/src/transport/index.ts';
    const { transport } = await import(moduleUrl);
    transport.dispose();
  });
  await expect(summary).toBeVisible();
  await page.getByText('Run history', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Refresh history', exact: true })).toBeDisabled();
  expect(
    await page.evaluate(() =>
      (window as unknown as { __opaHistorySent: { type: string }[] }).__opaHistorySent.every(
        (message) => ['opaTaskRunsRequest', 'webviewReady'].includes(message.type),
      ),
    ),
  ).toBe(true);
});
