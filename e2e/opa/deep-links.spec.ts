import { expect, test } from '@playwright/test';

const project = '/fixture/Проект #&';
const task = {
  id: 'task #1',
  title: 'Fixture task result',
  projectPath: project,
  status: 'done',
  revision: 1,
  createdAt: 1,
  updatedAt: 2,
};
const agent = {
  id: 20,
  provider: 'codex',
  sessionId: 'source-session',
  sourceAgentId: 'source-agent',
  name: 'Fixture agent',
  status: 'done',
  attentionId: 'fixture-completion',
  tools: [],
};
const projects = [{ id: project, path: project, name: 'Fixture office', agents: [agent] }];
const route = (values: Record<string, string>) =>
  '#opa?' + new URLSearchParams({ v: '1', view: 'overview', project, ...values }).toString();

test('deep link reload/back/forward is passive and copied links omit access query', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.addInitScript(() => localStorage.setItem('opa.language', 'en'));
  const seed = async () => {
    await expect(page.getByRole('heading', { name: 'Campus', exact: true })).toBeVisible();
    await page.evaluate(
      ({ projects, task }) => {
        window.postMessage({ type: 'opaCampusState', projects }, '*');
        window.postMessage({ type: 'opaWorkState', tasks: [task], usage: [], executors: [] }, '*');
      },
      { projects, task },
    );
  };
  await page.goto('/?token=fixture-secret' + route({ view: 'tasks', task: task.id }));
  await seed();
  await expect(page.getByRole('heading', { name: task.title, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Copy link', exact: true }).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).not.toContain('fixture-secret');
  expect(new URL(copied).search).toBe('');
  await page.reload();
  await seed();
  await expect(page.getByRole('heading', { name: task.title, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Fixture office', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: task.title, exact: true })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole('heading', { name: 'Fixture office', exact: true })).toBeVisible();
  await page.evaluate(
    (hash) => {
      location.hash = hash;
    },
    route({ provider: agent.provider, session: agent.sessionId, agent: agent.sourceAgentId }),
  );
  await expect(page.getByRole('region', { name: 'Selected agent' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('opa.campus.seen.v1'))).toBeNull();
  await page.evaluate(
    (hash) => {
      location.hash = hash;
    },
    route({ view: 'tasks', task: 'missing' }),
  );
  await expect(page.getByText('Linked target is unavailable.', { exact: false })).toBeVisible();
  await page.evaluate(() => {
    location.hash = '#opa?v=99';
  });
  await expect(page.getByText('Invalid or unsupported OPA link.', { exact: false })).toBeVisible();
});
