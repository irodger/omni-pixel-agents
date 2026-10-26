import type { OpaEvent } from './events.js';

export interface OpaHistoryEntry {
  ordinal: number;
  observedAt: number;
  projectPath: string;
  origin: 'ingestion' | 'task-journal' | 'fixture';
  taskId?: string;
  runId?: string;
  truncatedFields?: string[];
  event: OpaEvent;
}
export interface OpaEventHistory {
  version: 1;
  nextOrdinal: number;
  droppedThrough: number;
  entries: OpaHistoryEntry[];
  /** Durable per-stream high-water marks outlive the retained event window. */
  streams: Record<string, number>;
  projects: Record<string, string>;
}
export interface OpaHistoryPage {
  entries: OpaHistoryEntry[];
  nextCursor?: number;
  droppedThrough: number;
}
