import type { OpaProjectSnapshot } from '../../../core/src/messages.js';
import type { OpaTask } from '../../../core/src/opa/work.js';

export type CampusRoute = {
  view: 'overview' | 'tasks' | 'usage';
  project?: string;
  task?: string;
  provider?: string;
  session?: string;
  agent?: string;
};
export const ROOT_ROUTE: CampusRoute = { view: 'overview' };
const fields = ['v', 'view', 'project', 'task', 'provider', 'session', 'agent'];
const valid = (value: string) =>
  value.length > 0 &&
  value.length <= 8192 &&
  ![...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);

/** A route contains identity only. Never copy the management URL's query or credentials. */
export function routeHash(route: CampusRoute): string {
  const params = new URLSearchParams({ v: '1', view: route.view });
  for (const field of fields.slice(2) as (keyof CampusRoute)[]) {
    const value = route[field];
    if (value !== undefined) params.set(field, value);
  }
  const hash = '#opa?' + params.toString();
  if (!parseRoute(hash)) throw new Error('Invalid OPA link');
  return hash;
}
export function parseRoute(hash: string): CampusRoute | null {
  if (!hash || hash === '#') return ROOT_ROUTE;
  if (!hash.startsWith('#opa?') || hash.length > 40000 || /%(?![0-9a-f]{2})/i.test(hash))
    return null;
  try {
    decodeURIComponent(hash.slice(5).replaceAll('+', ' '));
  } catch {
    return null;
  }
  const params = new URLSearchParams(hash.slice(5));
  if ([...params.keys()].some((key) => !fields.includes(key) || params.getAll(key).length !== 1))
    return null;
  if ([...params.values()].some((value) => !valid(value))) return null;
  if (params.get('v') !== '1' || !['overview', 'tasks', 'usage'].includes(params.get('view') ?? ''))
    return null;
  const route = Object.fromEntries([...params].filter(([key]) => key !== 'v')) as CampusRoute;
  if ((route.task || route.session || route.provider || route.agent) && !route.project) return null;
  if (route.task && (route.view !== 'tasks' || route.session || route.provider || route.agent))
    return null;
  if (
    (route.session || route.provider || route.agent) &&
    (route.view !== 'overview' || !route.session || !route.provider || !route.agent)
  )
    return null;
  return route;
}
export function publicLink(href: string, route: CampusRoute): string {
  const url = new URL(href);
  if (!['http:', 'https:'].includes(url.protocol))
    throw new Error('Links are unavailable in this host');
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = routeHash(route);
  return url.toString();
}
export function resolveRoute(
  route: CampusRoute,
  projects: OpaProjectSnapshot[],
  tasks: OpaTask[],
): boolean {
  if (!route.project) return true;
  const project = projects.find((p) => p.id === route.project);
  if (!project) return false;
  if (route.task) return tasks.some((t) => t.projectPath === route.project && t.id === route.task);
  if (route.session)
    return project.agents.some(
      (a) =>
        a.provider === route.provider &&
        a.sessionId === route.session &&
        a.sourceAgentId === route.agent,
    );
  return true;
}

/** Only the documented folder URI; no command/query/fragment schemes accepted. */
export function vscodeProjectLink(path: string): string | null {
  if (
    !valid(path) ||
    (!path.startsWith('/') && !/^[a-z]:[\\/]/i.test(path)) ||
    path.startsWith('//') ||
    path.startsWith('/\\')
  )
    return null;
  const normalized = path.replaceAll('\\', '/');
  return (
    'vscode://file/' +
    normalized
      .replace(/^\//, '')
      .split('/')
      .map((part, i) => (i === 0 && /^[a-z]:$/i.test(part) ? part : encodeURIComponent(part)))
      .join('/')
  );
}
