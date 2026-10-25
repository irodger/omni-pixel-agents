import { expect, test } from '@playwright/test';

test('final summary distinguishes run outcome, unknown evidence and escaped output', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.addInitScript(() => localStorage.setItem('opa.language', 'en'));
  await page.goto('/#opa?v=1&view=tasks&project=%2Ffixture');
  await expect(page.getByRole('heading', { name: 'Campus', exact: true })).toBeVisible();
  await page.evaluate(() => {
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
            id: 't',
            projectPath: '/fixture',
            title: 'Fixture interrupted task',
            status: 'open',
            assignee: 'new-assignee',
            createdAt: 1,
            updatedAt: 1,
            revision: 1,
            execution: {
              runId: 'fixture-run',
              state: 'interrupted',
              journal: '/fixture-journal',
              startedAt: 1000,
              output: '<script>window.injected=true</script> All tests passed',
              outputTruncated: true,
            },
          },
        ],
        usage: [],
      },
      '*',
    );
  });
  const summary = page.getByRole('region', { name: 'Task summary: Fixture interrupted task' });
  await expect(summary).toBeVisible();
  await expect(summary.getByText('interrupted', { exact: true })).toBeVisible();
  await expect(summary.getByText('Unknown', { exact: true })).toHaveCount(6);
  await expect(
    summary.getByText('Git diff, quality checks and artifacts:', { exact: false }),
  ).toBeVisible();
  await summary.getByText('Result', { exact: true }).click();
  await expect(summary.locator('pre')).toContainText('<script>');
  expect(await page.evaluate(() => 'injected' in window)).toBe(false);
  await summary.getByRole('button', { name: 'Copy summary', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('fixture-run');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/opa-summary-mobile.png' });
});
