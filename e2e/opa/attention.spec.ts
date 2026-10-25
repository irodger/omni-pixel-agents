import { expect, test } from '@playwright/test';

test('Inbox stays passive, keeps blocks visible and persists explicit result read marks', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('opa.language', 'en'));
  await page.goto('/#opa?v=1&view=attention&project=%2Ffixture');
  const seed = async () => {
    await expect(page.getByRole('heading', { name: 'Campus', exact: true })).toBeVisible();
    await page.evaluate(() => {
      const base = {
        projectPath: '/fixture',
        status: 'open',
        revision: 1,
        createdAt: 1,
        updatedAt: 1,
      };
      const tasks = [
        {
          ...base,
          id: 'done',
          title: 'Fixture completion',
          execution: {
            runId: 'r',
            state: 'completed',
            journal: '/fixture-journal',
            startedAt: 1,
            finishedAt: 2,
          },
        },
        {
          ...base,
          id: 'blocked',
          title: 'Fixture approval',
          execution: {
            runId: 'b',
            state: 'running',
            journal: '/fixture-journal',
            startedAt: 1,
            permissions: [
              {
                id: 'permission',
                title: 'May I?',
                options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }],
              },
            ],
          },
        },
      ];
      window.postMessage(
        {
          type: 'opaCampusState',
          projects: [{ id: '/fixture', path: '/fixture', name: 'Fixture', agents: [] }],
        },
        '*',
      );
      for (let i = 0; i < 2; i++)
        window.postMessage({ type: 'opaWorkState', tasks, usage: [] }, '*');
    });
  };
  await seed();
  const inbox = page.getByRole('region', { name: 'Attention Inbox', exact: true });
  await expect(inbox.getByRole('article')).toHaveCount(2);
  await page.screenshot({ path: 'test-results/opa-inbox.png' });
  await expect(inbox.getByRole('button', { name: 'Mark read' })).toHaveCount(1);
  await inbox.getByRole('button', { name: 'Open result' }).click();
  await expect(
    page.getByRole('region', { name: 'Task summary: Fixture completion' }),
  ).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('opa.campus.seen.v1'))).toBeNull();
  await page.goBack();
  await expect(inbox.getByRole('article')).toHaveCount(2);
  await inbox.getByRole('button', { name: 'Mark read' }).click();
  await expect(inbox.getByRole('article')).toHaveCount(1);
  await expect(inbox.getByText('Fixture approval', { exact: true })).toBeVisible();
  await page.reload();
  await seed();
  await expect(inbox.getByRole('article')).toHaveCount(1);
  await inbox.getByRole('button', { name: 'Review block' }).click();
  await expect(page.getByText('May I?', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Allow (allow_once)', exact: true }),
  ).toBeDisabled();
});
