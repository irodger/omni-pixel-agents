import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  OpaAgentSnapshot,
  OpaEventHistoryPage,
  OpaEventHistoryRequest,
  OpaProjectSnapshot,
  OpaQueueState,
  SaveLayout,
} from '../../../core/src/messages.js';
import type { OpaAttentionSnapshot } from '../../../core/src/opa/attention.js';
import type {
  OpaQueueCommand,
  OpaTask,
  OpaTaskCommand,
  OpaUsage,
  TaskRunsPage,
  TaskRunsQuery,
} from '../../../core/src/opa/work.js';
import { transport } from '../transport/index.js';
import { markSeen, MAX_SEEN_EVENTS } from './attention.js';
import { inboxItems } from './inbox.js';
import {
  emptyPreferences,
  type InboxPreferences,
  type InboxPresentationAction,
  inboxStorageKey,
  matchingInboxItem,
  parsePreferences,
  updateInboxMark,
} from './inboxPreferences.js';
import { activeInboxItems, isAttentionSnapshot } from './inboxV2.js';

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
  const [queues, setQueues] = useState<OpaQueueState[]>([]);
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
  const [attention, setAttention] = useState<OpaAttentionSnapshot>();
  const attentionRef = useRef<OpaAttentionSnapshot | undefined>(undefined);
  const [inboxError, setInboxError] = useState('');
  const [inboxStorageWarning, setInboxStorageWarning] = useState(false);
  const marksWritable = useRef(true);
  const [inboxMarks, setInboxMarks] = useState<{ hostId: string; preferences: InboxPreferences }>({
    hostId: '',
    preferences: emptyPreferences(),
  });
  const marksRef = useRef(inboxMarks);
  const inboxPending = useRef<{ id: string; timer: number } | undefined>(undefined);
  const inboxScheduled = useRef<number | undefined>(undefined);
  const inboxDirty = useRef(false);
  const requestInbox = useCallback(() => {
    if (transport.state !== 'connected') return;
    if (inboxPending.current) {
      inboxDirty.current = true;
      return;
    }
    const id = crypto.randomUUID();
    const timer = window.setTimeout(() => {
      if (inboxPending.current?.id === id) {
        inboxPending.current = undefined;
        setInboxError('INBOX_TIMEOUT');
      }
    }, 10000);
    inboxPending.current = { id, timer };
    transport.send({ type: 'opaAttentionRequest', requestId: id });
  }, []);
  const scheduleInbox = useCallback(() => {
    if (inboxScheduled.current !== undefined) return;
    inboxScheduled.current = window.setTimeout(() => {
      inboxScheduled.current = undefined;
      requestInbox();
    }, 250);
  }, [requestInbox]);
  useEffect(() => {
    requestInbox();
    return () => {
      if (inboxPending.current) window.clearTimeout(inboxPending.current.timer);
      if (inboxScheduled.current !== undefined) window.clearTimeout(inboxScheduled.current);
      inboxPending.current = undefined;
      inboxScheduled.current = undefined;
    };
  }, [requestInbox]);

  useEffect(() => {
    // The socket may connect before React mounts this subscriber.
    setConnection(transport.state);
    return transport.onStateChange((state) => {
      setConnection(state);
      if (state === 'connected') scheduleInbox();
      else {
        if (inboxPending.current) window.clearTimeout(inboxPending.current.timer);
        inboxPending.current = undefined;
      }
    });
  }, [scheduleInbox]);
  useEffect(
    () =>
      transport.onMessage((message) => {
        if (
          message.type === 'opaAttentionState' &&
          inboxPending.current?.id === message.requestId
        ) {
          window.clearTimeout(inboxPending.current.timer);
          inboxPending.current = undefined;
          if (message.error || !isAttentionSnapshot(message))
            setInboxError(message.error ?? 'ATTENTION_INVALID');
          else {
            if (marksRef.current.hostId !== message.hostId) {
              let preferences = emptyPreferences();
              marksWritable.current = true;
              try {
                preferences = parsePreferences(
                  localStorage.getItem(inboxStorageKey(message.hostId)),
                );
              } catch {
                marksWritable.current = false;
                setInboxStorageWarning(true);
              }
              const loaded = { hostId: message.hostId, preferences };
              marksRef.current = loaded;
              setInboxMarks(loaded);
            }
            attentionRef.current = message;
            setAttention(message);
            setInboxError('');
          }
          if (inboxDirty.current) {
            inboxDirty.current = false;
            scheduleInbox();
          }
        }
        if (message.type === 'opaCampusState') {
          scheduleInbox();
          setProjects(message.projects);
          setProjectsLoaded(true);
        }
        if (message.type === 'opaWorkState') {
          scheduleInbox();
          setWorkLoaded(true);
          setTasks(message.tasks);
          setQueues(message.queues ?? []);
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
    [scheduleInbox],
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
    command:
      | Omit<OpaTaskCommand, 'requestId'>
      | Omit<SaveLayout, 'requestId'>
      | Omit<OpaQueueCommand, 'requestId'>,
    type: 'opaTaskCommand' | 'opaQueueCommand' = 'opaTaskCommand',
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
      transport.send({ type, ...command, requestId } as Parameters<typeof transport.send>[0]);
    });
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const acknowledge = (agent: OpaAgentSnapshot, projectPath?: string) => {
    const snapshot = attentionRef.current;
    const item =
      projectPath &&
      snapshot?.items.find(
        (entry) =>
          entry.fact.projectPath === projectPath &&
          entry.fact.provider === agent.provider &&
          entry.fact.sessionId === agent.sessionId &&
          entry.fact.agentId === agent.sourceAgentId &&
          entry.fact.eventId === agent.attentionId &&
          entry.fact.kind !== 'blocked',
      );
    if (snapshot && item) presentInbox(item.fact.id, 'read', snapshot.hostId, item.activity);
    setSeen((current) => {
      const next = markSeen(current, agent);
      try {
        localStorage.setItem(SEEN_KEY, JSON.stringify(next));
      } catch {
        /* Private browsing still supports in-memory acknowledgement. */
      }
      return next;
    });
  };

  const presentInbox = (
    id: string,
    action: InboxPresentationAction,
    hostId: string,
    activity: string,
  ) => {
    const snapshot = attentionRef.current;
    if (marksRef.current.hostId !== hostId) {
      setInboxError('INBOX_ITEM_STALE');
      return;
    }
    try {
      const item = matchingInboxItem(snapshot, id, hostId, activity);
      let preferences = updateInboxMark(marksRef.current.preferences, item, action, Date.now());
      if (action === 'read')
        for (const relatedId of item.relatedIds ?? []) {
          preferences = {
            ...preferences,
            marks: [
              ...preferences.marks.filter((mark) => mark.id !== relatedId),
              { id: relatedId, read: true },
            ].slice(-2000),
          };
        }
      const next = { hostId, preferences };
      marksRef.current = next;
      setInboxMarks(next);
      if (marksWritable.current) {
        try {
          localStorage.setItem(inboxStorageKey(hostId), JSON.stringify(preferences));
          setInboxStorageWarning(false);
        } catch {
          setInboxStorageWarning(true);
        }
      }
    } catch {
      setInboxError('INBOX_ITEM_STALE');
    }
  };
  const acknowledgeId = (id: string, relatedEventId?: string) => {
    const snapshot = attentionRef.current;
    const item = snapshot?.items.find((entry) => entry.fact.id === id);
    if (snapshot && item) {
      presentInbox(id, 'read', snapshot.hostId, item.activity);
      return;
    }
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
  };
  useEffect(() => {
    const syncMarks = (event: StorageEvent) => {
      const hostId = marksRef.current.hostId;
      if (!hostId || event.key !== inboxStorageKey(hostId)) return;
      try {
        const next = { hostId, preferences: parsePreferences(event.newValue) };
        marksRef.current = next;
        setInboxMarks(next);
        setInboxStorageWarning(false);
        marksWritable.current = true;
      } catch {
        setInboxStorageWarning(true);
        marksWritable.current = false;
      }
    };
    window.addEventListener('storage', syncMarks);
    return () => window.removeEventListener('storage', syncMarks);
  }, []);
  const resetInboxPreferences = () => {
    const hostId = marksRef.current.hostId;
    if (!hostId) return;
    const next = { hostId, preferences: emptyPreferences() };
    marksRef.current = next;
    setInboxMarks(next);
    marksWritable.current = true;
    try {
      localStorage.setItem(inboxStorageKey(hostId), JSON.stringify(next.preferences));
      setInboxStorageWarning(false);
    } catch {
      setInboxStorageWarning(true);
    }
  };
  const saveTask = (command: Omit<OpaTaskCommand, 'requestId'>) => saveCommand(command);
  const saveLayout = (command: Omit<SaveLayout, 'requestId'>) => saveCommand(command);
  return {
    saveLayout,
    attention,
    inboxMarks: inboxMarks.preferences,
    inboxError,
    inboxStorageWarning,
    presentInbox,
    resetInboxPreferences,
    refreshInbox: requestInbox,
    inbox:
      attention && attention.hostId === inboxMarks.hostId
        ? activeInboxItems(attention.items, inboxMarks.preferences, now)
        : inboxItems(projects, tasks, seen),
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
    queues,
    saveQueue: (command: Omit<OpaQueueCommand, 'requestId'>) =>
      saveCommand(command, 'opaQueueCommand'),
  };
}
