import type { OpaEvent } from '../events.js';

/** OPA capabilities describe commands this adapter implements, not what its brand might support. */
export interface AdapterCapabilities {
  observe: boolean;
  prompt: boolean;
  cancel: boolean;
  permissions: boolean;
  loadSession: boolean;
}
export interface AdapterDescription {
  id: string;
  name: string;
  transport: 'native-jsonl' | 'acp-stdio' | 'claude-hooks' | 'unconfigured';
  status: 'available' | 'unavailable' | 'observe_only' | 'planned';
  capabilities: AdapterCapabilities;
  reason?: string;
}
export interface PermissionRequest {
  id: string;
  title: string;
  options: { optionId: string; name: string; kind: string }[];
}
export interface StreamHooks {
  event: (event: OpaEvent) => void;
  permission: (request: PermissionRequest) => Promise<string | null>;
}
