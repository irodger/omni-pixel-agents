import { useMemo, useSyncExternalStore } from 'react';

import { type CampusRoute, parseRoute, routeHash } from './deepLinks.js';

function subscribe(listener: () => void) {
  window.addEventListener('hashchange', listener);
  return () => window.removeEventListener('hashchange', listener);
}
export function useCampusRoute() {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  const navigate = (route: CampusRoute) => {
    window.location.hash = routeHash(route);
  };
  const route = useMemo(() => parseRoute(hash), [hash]);
  return { route, navigate };
}
