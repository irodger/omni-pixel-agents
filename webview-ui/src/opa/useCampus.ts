import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  OpaAgentSnapshot,
  OpaEventHistoryPage,
  OpaEventHistoryRequest,
  OpaProjectSnapshot,
  SaveLayout,
} from '../../../core/src/messages.js';
import type {
  OpaTask,
  OpaTaskCommand,
  OpaUsage,
  TaskRunsPage,
  TaskRunsQuery,
} from '../../../core/src/opa/work.js';
import { transport } from '../transport/index.js';
import { markSeen, MAX_SEEN_EVENTS } from './attention.js';

const SEEN_KEY = 'opa.campus.seen.v1';
function readSeen(): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]');
    return Array.isArray(raw)
      ? raw.filter((id): id is string => typeof id === 'string').slice(-MAX_SEEN_EVENTS)
      : [];
  } catch {
    return [];
  }
}

export function useCampus() {
  const [executors, setExecutors] = useState<{ id: string; name: string }[]>([]);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [workLoaded, setWorkLoaded] = useState(false);
  const [tasks, setTasks] = useState<OpaTask[]>([]);
  const [usage, setUsage] = useState<OpaUsage[]>([]);
  const pending = useRef(
    new Map<string, { resolve: () => void; reject: (e: Error) => void; timer: number }>(),
  );
  const historyRequests = useRef(
    new Map<
      string,
      { resolve: (page: TaskRunsPage) => void; reject: (error: Error) => void; timer: number }
    >(),
  );
  const eventRequests = useRef(
    new Map<
      string,
      {
        resolve: (page: OpaEventHistoryPage) => void;
        reject: (error: Error) => void;
        timer: number;
      }
    >(),
  );
  const [projects, setProjects] = useState<OpaProjectSnapshot[]>([]);
  const [seen, setSeen] = useState(readSeen);
  const [now, setNow] = useState(Date.now);
  const [connection, setConnection] = useState(transport.state);
  useEffect(() => {
    // The socket may connect before React mounts this subscriber.
    setConnection(transport.state);
    return transport.onStateChange(setConnection);
  }, []);
  useEffect(
    () =>
      transport.onMessage((message) => {
        if (message.type === 'opaCampusState') {
          setProjects(message.projects);
          setProjectsLoaded(true);
        }
        if (message.type === 'opaWorkState') {
          setWorkLoaded(true);
          setTasks(message.tasks);
          setExecutors(message.executors ?? []);
          setUsage(message.usage);
        }
        if (message.type === 'opaEventHistoryPage') {
          const request = eventRequests.current.get(message.requestId);
          if (request) {
            window.clearTimeout(request.timer);
            eventRequests.current.delete(message.requestId);
            if (message.error) request.reject(new Error(message.error));
            else request.resolve(message);
          }
        }
        if (message.type === 'opaTaskRunsPage') {
          const request = historyRequests.current.get(message.requestId);
          if (request) {
            window.clearTimeout(request.timer);
            historyRequests.current.delete(message.requestId);
            if (message.error) request.reject(new Error(message.error));
            else request.resolve({ runs: message.runs, nextCursor: message.nextCursor });
          }
        }
        if (message.type === 'opaTaskResult') {
          const request = pending.current.get(message.requestId);
          if (request) {
            window.clearTimeout(request.timer);
            pending.current.delete(message.requestId);
            if (message.error) request.reject(new Error(message.error));
            else request.resolve();
          }
        }
      }),
    [],
  );
  useEffect(() => {
    const requests = pending.current;
    return () => {
      requests.forEach((r) => {
        window.clearTimeout(r.timer);
        r.reject(new Error('REQUEST_TIMEOUT'));
      });
      requests.clear();
    };
  }, []);
  useEffect(() => {
    const requests = historyRequests.current;
    return () => {
      requests.forEach((r) => {
        window.clearTimeout(r.timer);
        r.reject(new Error('REQUEST_TIMEOUT'));
      });
      requests.clear();
    };
  }, []);
  const requestHistory = useCallback(
    (query: TaskRunsQuery) =>
      new Promise<TaskRunsPage>((resolve, reject) => {
        if (transport.state !== 'connected') {
          reject(new Error('REQUEST_TIMEOUT'));
          return;
        }
        const requestId = crypto.randomUUID();
        const timer = window.setTimeout(() => {
          historyRequests.current.delete(requestId);
          reject(new Error('REQUEST_TIMEOUT'));
        }, 10000);
        historyRequests.current.set(requestId, { resolve, reject, timer });
        transport.send({ type: 'opaTaskRunsRequest', requestId, ...query });
      }),
    [],
  );
  useEffect(() => {
    const requests = eventRequests.current;
    return () => {
      requests.forEach((r) => {
        window.clearTimeout(r.timer);
        r.reject(new Error('REQUEST_TIMEOUT'));
      });
      requests.clear();
    };
  }, []);
  const requestEvents = useCallback(
    (query: Omit<OpaEventHistoryRequest, 'type' | 'requestId'>) =>
      new Promise<OpaEventHistoryPage>((resolve, reject) => {
        if (transport.state !== 'connected') {
          reject(new Error('REQUEST_TIMEOUT'));
          return;
        }
        const requestId = crypto.randomUUID();
        const timer = window.setTimeout(() => {
          eventRequests.current.delete(requestId);
          reject(new Error('REQUEST_TIMEOUT'));
        }, 10000);
        eventRequests.current.set(requestId, { resolve, reject, timer });
        transport.send({ ...query, type: 'opaEventHistoryRequest', requestId });
      }),
    [],
  );
  const saveCommand = (
    command: Omit<OpaTaskCommand, 'requestId'> | Omit<SaveLayout, 'requestId'>,
  ) =>
    new Promise<void>((resolve, reject) => {
      if (transport.state !== 'connected') {
        reject(new Error('REQUEST_TIMEOUT'));
        return;
      }
      const requestId = crypto.randomUUID();
      const timer = window.setTimeout(() => {
        pending.current.delete(requestId);
        reject(new Error('REQUEST_TIMEOUT'));
      }, 10000);
      pending.current.set(requestId, { resolve, reject, timer });
      transport.send({ type: 'opaTaskCommand', ...command, requestId });
    });
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const acknowledge = (agent: OpaAgentSnapshot) =>
    setSeen((current) => {
      const next = markSeen(current, agent);
      try {
        localStorage.setItem(SEEN_KEY, JSON.stringify(next));
      } catch {
        /* Private browsing still supports in-memory acknowledgement. */
      }
      return next;
    });
  const acknowledgeId = (id: string, relatedEventId?: string) =>
    setSeen((current) => {
      const added = [id, ...(relatedEventId ? [relatedEventId] : [])];
      const next = [...current.filter((entry) => !added.includes(entry)), ...added].slice(
        -MAX_SEEN_EVENTS,
      );
      try {
        localStorage.setItem(SEEN_KEY, JSON.stringify(next));
      } catch {
        /* Browser-local memory remains available. */
      }
      return next;
    });
  const saveTask = (command: Omit<OpaTaskCommand, 'requestId'>) => saveCommand(command);
  const saveLayout = (command: Omit<SaveLayout, 'requestId'>) => saveCommand(command);
  return {
    saveLayout,
    requestHistory,
    requestEvents,
    projectsLoaded,
    workLoaded,
    projects,
    seen,
    now,
    acknowledge,
    acknowledgeId,
    connection,
    tasks,
    usage,
    executors,
    saveTask,
  };
}
