/**
 * AUTO-GENERATED FROM core/asyncapi.yaml. DO NOT EDIT MANUALLY.
 *
 * Run `npm run asyncapi:generate` to regenerate.
 *
 * Source of truth: the yaml at core/asyncapi.yaml.
 * Editors and clients in any language can consume the spec directly.
 */

export type ServerMessage =
  | OpaCampusState
  | OpaWorkState
  | OpaTaskResult
  | OpaTaskRunsPage
  | OpaEventHistoryPage
  | OpaAttentionState
  | ProviderCapabilities
  | AgentCreated
  | AgentClosed
  | AgentSelected
  | ExistingAgents
  | AgentStatus
  | AgentToolStart
  | AgentToolDone
  | AgentToolsClear
  | AgentToolPermission
  | AgentToolPermissionClear
  | SubagentToolStart
  | SubagentToolDone
  | SubagentClear
  | SubagentToolPermission
  | AgentTeamInfo
  | AgentContextUsage
  | LayoutLoaded
  | FurnitureAssetsLoaded
  | CharacterSpritesLoaded
  | PetSpritesLoaded
  | FloorTilesLoaded
  | WallTilesLoaded
  | CarpetTilesLoaded
  | OfficeAccess
  | SettingsLoaded
  | BypassPermissionsUpdated
  | HooksStatus
  | HooksConsentRequest
  | ExternalAssetDirectoriesUpdated
  | AreaMappingsLoaded
  | DirectoriesLoaded
  | DirectorySaved
  | DirectoryRejected
  | DirectorySuggestions
  | TerminalAvailability
  | TerminalSessionOpened
  | TerminalSessionClosed
  | AgentDiagnostics;

export type ClientMessage =
  | OpaTaskCommand
  | OpaQueueCommand
  | OpaTaskRunsRequest
  | OpaEventHistoryRequest
  | OpaAttentionRequest
  | WebviewReady
  | LaunchAgent
  | FocusAgent
  | CloseAgent
  | SaveAgentSeats
  | SaveLayout
  | SetSoundEnabled
  | SetLastSeenVersion
  | SetAlwaysShowLabels
  | SetGhostHeadlessAgents
  | SetHooksEnabled
  | HooksConsentResponse
  | SetHooksInfoShown
  | SetWatchAllSessions
  | ExportLayout
  | ImportLayout
  | OpenSessionsFolder
  | AddExternalAssetDirectory
  | RemoveExternalAssetDirectory
  | SaveAreaMappings
  | SetShowAreas
  | SetBypassPermissions
  | SetShowHostDirectories
  | SaveDirectory
  | RemoveDirectory
  | RequestDirectorySuggestions
  | RequestDiagnostics;

export interface OpaCampusState {
  type: 'opaCampusState';
  projects: OpaProjectSnapshot[];
  additionalProperties?: Record<string, any>;
}

export interface OpaProjectSnapshot {
  id: string;
  name: string;
  path: string;
  layout?: Record<string, any>;
  layoutVersion?: number;
  agents: OpaAgentSnapshot[];
  additionalProperties?: Record<string, any>;
}

export interface OpaAgentSnapshot {
  id: number;
  provider: string;
  sessionId?: string;
  sourceAgentId?: string;
  name: string;
  role?: string;
  status: OpaActivityStatus;
  palette?: number;
  hueShift?: number;
  blockedSince?: number;
  completedAt?: number;
  attentionId?: string;
  error?: string;
  tools: string[];
  additionalProperties?: Record<string, any>;
}

export type OpaActivityStatus = 'idle' | 'working' | 'blocked' | 'done' | 'error';

export interface OpaWorkState {
  type: 'opaWorkState';
  tasks: OpaTaskRecord[];
  usage: OpaUsageRecord[];
  executors?: OpaExecutor[];
  queues?: OpaQueueState[];
  additionalProperties?: Record<string, any>;
}

export interface OpaTaskRecord {
  id: string;
  projectPath: string;
  title: string;
  status: OpaTaskStatus;
  assignee?: string;
  execution?: OpaExecution;
  createdAt: number;
  updatedAt: number;
  revision: number;
  additionalProperties?: Record<string, any>;
}

export type OpaTaskStatus = 'open' | 'in_progress' | 'done' | 'cancelled';

export interface OpaExecution {
  runId: string;
  executorId?: string;
  provider?: string;
  sessionId?: string;
  sourceAgentId?: string;
  usage?: OpaUsageRecord[];
  outputTruncated?: boolean;
  resultEventId?: string;
  state: string;
  journal: string;
  permissions?: OpaPermission[];
  startedAt: number;
  finishedAt?: number;
  output?: string;
  error?: string;
  additionalProperties?: Record<string, any>;
}

export interface OpaUsageRecord {
  usageId: string;
  projectPath: string;
  provider: string;
  sessionId: string;
  timestamp: string;
  model?: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  cost?: OpaCost;
  additionalProperties?: Record<string, any>;
}

export interface OpaCost {
  amount: number;
  currency: 'USD';
  kind: OpaCostKind;
  additionalProperties?: Record<string, any>;
}

export type OpaCostKind = 'reported' | 'estimated';

export interface OpaPermission {
  id: string;
  title: string;
  options: OpaPermissionOption[];
  additionalProperties?: Record<string, any>;
}

export interface OpaPermissionOption {
  optionId: string;
  name: string;
  kind: string;
  additionalProperties?: Record<string, any>;
}

export interface OpaExecutor {
  id: string;
  name: string;
  transport?: string;
  capabilities?: OpaAdapterCapabilities;
  additionalProperties?: Record<string, any>;
}

export interface OpaAdapterCapabilities {
  observe: boolean;
  prompt: boolean;
  cancel: boolean;
  permissions: boolean;
  loadSession: boolean;
  additionalProperties?: Record<string, any>;
}

export interface OpaQueueState {
  projectPath: string;
  revision: number;
  paused: boolean;
  taskIds: string[];
  additionalProperties?: Record<string, any>;
}

export interface OpaTaskResult {
  type: 'opaTaskResult';
  requestId: string;
  taskId?: string;
  error?: string;
  additionalProperties?: Record<string, any>;
}

export interface OpaTaskRunsPage {
  type: 'opaTaskRunsPage';
  requestId: string;
  runs: OpaTaskRunRecord[];
  nextCursor?: string;
  error?: string;
  additionalProperties?: Record<string, any>;
}

export interface OpaTaskRunRecord {
  version: OpaTaskRunVersion;
  projectPath: string;
  taskId: string;
  title: string;
  titleFromLegacyTask?: boolean;
  execution: OpaExecution;
  additionalProperties?: Record<string, any>;
}

export type OpaTaskRunVersion = 1;

export interface OpaEventHistoryPage {
  type: 'opaEventHistoryPage';
  requestId: string;
  entries: OpaHistoryEntry[];
  nextCursor?: number;
  droppedThrough?: number;
  error?: string;
  additionalProperties?: Record<string, any>;
}

export interface OpaHistoryEntry {
  ordinal: number;
  observedAt: number;
  projectPath: string;
  origin: OpaHistoryOrigin;
  taskId?: string;
  runId?: string;
  truncatedFields?: string[];
  event: Record<string, any>;
  additionalProperties?: Record<string, any>;
}

export type OpaHistoryOrigin = 'ingestion' | 'task-journal' | 'fixture';

export interface OpaAttentionState {
  type: 'opaAttentionState';
  requestId: string;
  version?: OpaAttentionVersion;
  hostId?: string;
  items?: OpaAttentionItem[];
  limited?: boolean;
  droppedFacts?: number;
  droppedEventsThrough?: number;
  error?: string;
  additionalProperties?: Record<string, any>;
}

export type OpaAttentionVersion = 1;

export interface OpaAttentionItem {
  fact: OpaAttentionFact;
  activity: OpaAttentionActivity;
  relatedIds?: string[];
  additionalProperties?: Record<string, any>;
}

export interface OpaAttentionFact {
  id: string;
  projectPath: string;
  kind: OpaAttentionKind;
  title: string;
  titleFromLegacyTask?: boolean;
  state: string;
  origin: OpaAttentionOrigin;
  observedAt?: number;
  sourceTime?: string;
  taskId?: string;
  runId?: string;
  permissionId?: string;
  provider?: string;
  sessionId?: string;
  agentId?: string;
  streamId?: string;
  eventId?: string;
  eventOrdinal?: number;
  relatedFactId?: string;
  code?: string;
  additionalProperties?: Record<string, any>;
}

export type OpaAttentionKind =
  'blocked' | 'error' | 'result' | 'queue-error' | 'resolution' | 'check';

export type OpaAttentionOrigin =
  'task-run' | 'task-permission' | 'queue' | 'ingestion' | 'task-journal' | 'fixture' | 'live';

export type OpaAttentionActivity = 'recorded' | 'current' | 'resolved' | 'stale';

export interface ProviderCapabilities {
  type: 'providerCapabilities';
  readingTools: string[];
  subagentToolNames: string[];
}

export interface AgentCreated {
  type: 'agentCreated';
  id: number;
  directoryName?: string;
  isExternal?: boolean;
  palette?: number;
  hueShift?: number;
}

export interface AgentClosed {
  type: 'agentClosed';
  id: number;
}

export interface AgentSelected {
  type: 'agentSelected';
  id: number;
}

export interface ExistingAgents {
  type: 'existingAgents';
  agents: number[];
  agentMeta: Record<string, AgentSeatMeta>;
  directoryNames: Record<string, string>;
  externalAgents: Record<string, boolean>;
}

export interface AgentSeatMeta {
  palette?: number;
  hueShift?: number;
  seatId?: string;
}

export interface AgentStatus {
  type: 'agentStatus';
  id: number;
  status: AgentActivityStatus;
  awaitingInput?: boolean;
}

export type AgentActivityStatus = 'active' | 'waiting';

export interface AgentToolStart {
  type: 'agentToolStart';
  id: number;
  toolId: string;
  status: string;
  toolName?: string;
  permissionActive?: boolean;
  runInBackground?: boolean;
  isTeammateSpawn?: boolean;
}

export interface AgentToolDone {
  type: 'agentToolDone';
  id: number;
  toolId: string;
}

export interface AgentToolsClear {
  type: 'agentToolsClear';
  id: number;
}

export interface AgentToolPermission {
  type: 'agentToolPermission';
  id: number;
}

export interface AgentToolPermissionClear {
  type: 'agentToolPermissionClear';
  id: number;
}

export interface SubagentToolStart {
  type: 'subagentToolStart';
  id: number;
  parentToolId: string;
  toolId: string;
  status: string;
}

export interface SubagentToolDone {
  type: 'subagentToolDone';
  id: number;
  parentToolId: string;
  toolId: string;
}

export interface SubagentClear {
  type: 'subagentClear';
  id: number;
  parentToolId: string;
}

export interface SubagentToolPermission {
  type: 'subagentToolPermission';
  id: number;
  parentToolId: string;
}

export interface AgentTeamInfo {
  type: 'agentTeamInfo';
  id: number;
  teamName?: string;
  agentName?: string;
  isTeamLead?: boolean;
  leadAgentId?: number;
  teamUsesTmux?: boolean;
}

export interface AgentContextUsage {
  type: 'agentContextUsage';
  id: number;
  contextTokens: number;
  maxContextTokens: number;
}

export interface LayoutLoaded {
  type: 'layoutLoaded';
  layout: Record<string, any> | null;
  wasReset?: boolean;
}

export interface FurnitureAssetsLoaded {
  type: 'furnitureAssetsLoaded';
  catalog: FurnitureAssetMessage[];
  sprites: Record<string, string[][]>;
}

export interface FurnitureAssetMessage {
  id: string;
  name: string;
  label: string;
  category: string;
  file: string;
  width: number;
  height: number;
  footprintW: number;
  footprintH: number;
  isDesk: boolean;
  canPlaceOnWalls: boolean;
  groupId?: string;
  canPlaceOnSurfaces?: boolean;
  backgroundTiles?: number;
  orientation?: string;
  state?: string;
  mirrorSide?: boolean;
  rotationScheme?: string;
  animationGroup?: string;
  frame?: number;
}

export interface CharacterSpritesLoaded {
  type: 'characterSpritesLoaded';
  characters: CharacterSpriteSet[];
}

export interface CharacterSpriteSet {
  down: string[][][];
  up: string[][][];
  right: string[][][];
}

export interface PetSpritesLoaded {
  type: 'petSpritesLoaded';
  pets: PetSpriteFrameSet[];
  petNames: string[];
}

export interface PetSpriteFrameSet {
  walkDown: string[][][];
  idleDown: string[][][];
  walkUp: string[][][];
  idleUp: string[][][];
  walkRight: string[][][];
}

export interface FloorTilesLoaded {
  type: 'floorTilesLoaded';
  sprites: string[][][];
}

export interface WallTilesLoaded {
  type: 'wallTilesLoaded';
  sets: string[][][][];
}

export interface CarpetTilesLoaded {
  type: 'carpetTilesLoaded';
  sets: string[][][][];
}

export interface OfficeAccess {
  type: 'officeAccess';
  readOnly: boolean;
}

export interface SettingsLoaded {
  type: 'settingsLoaded';
  soundEnabled: boolean;
  lastSeenVersion: string;
  extensionVersion: string;
  watchAllSessions: boolean;
  alwaysShowLabels: boolean;
  ghostHeadlessAgents: boolean;
  hooksEnabled: boolean;
  hooksInfoShown: boolean;
  externalAssetDirectories: string[];
  showAreas: boolean;
  bypassPermissions: boolean;
  showHostDirectories: boolean;
}

export interface BypassPermissionsUpdated {
  type: 'bypassPermissionsUpdated';
  enabled: boolean;
}

export interface HooksStatus {
  type: 'hooksStatus';
  providerId: string;
  installed: boolean;
}

export interface HooksConsentRequest {
  type: 'hooksConsentRequest';
  providerId: string;
  headline: string;
  disclosure: string;
}

export interface ExternalAssetDirectoriesUpdated {
  type: 'externalAssetDirectoriesUpdated';
  dirs: string[];
}

export interface AreaMappingsLoaded {
  type: 'areaMappingsLoaded';
  mappings: Record<string, string[]>;
}

export interface DirectoriesLoaded {
  type: 'directoriesLoaded';
  directories: Directory[];
}

export interface Directory {
  name: string;
  path: string;
  source: DirectorySource;
}

export type DirectorySource = 'user' | 'host';

export interface DirectorySaved {
  type: 'directorySaved';
  directory: Directory;
}

export interface DirectoryRejected {
  type: 'directoryRejected';
  path: string;
  reason: string;
}

export interface DirectorySuggestions {
  type: 'directorySuggestions';
  paths: string[];
}

export interface TerminalAvailability {
  type: 'terminalAvailability';
  available: boolean;
  reason?: string;
}

export interface TerminalSessionOpened {
  type: 'terminalSessionOpened';
  agentId: number;
}

export interface TerminalSessionClosed {
  type: 'terminalSessionClosed';
  agentId: number;
  exitCode?: number;
}

export interface AgentDiagnostics {
  type: 'agentDiagnostics';
  agents: Record<string, any>[];
}

export interface OpaTaskCommand {
  type: 'opaTaskCommand';
  requestId: string;
  projectPath: string;
  action: OpaTaskAction;
  taskId?: string;
  title?: string;
  status?: OpaTaskStatus;
  assignee?: string;
  expectedRevision?: number;
  launch?: boolean;
  runId?: string;
  permissionId?: string;
  optionId?: string;
  additionalProperties?: Record<string, any>;
}

export type OpaTaskAction = 'create' | 'update' | 'permission' | 'move' | 'start';

export interface OpaQueueCommand {
  type: 'opaQueueCommand';
  requestId: string;
  projectPath: string;
  action: OpaQueueAction;
  expectedRevision: number;
  taskId?: string;
  taskIds?: string[];
  expectedTaskRevision?: number;
  additionalProperties?: Record<string, any>;
}

export type OpaQueueAction = 'enqueue' | 'remove' | 'reorder' | 'pause' | 'resume' | 'start-next';

export interface OpaTaskRunsRequest {
  type: 'opaTaskRunsRequest';
  requestId: string;
  projectPath: string;
  taskId: string;
  limit?: number;
  before?: string;
  runId?: string;
  additionalProperties?: Record<string, any>;
}

export interface OpaEventHistoryRequest {
  type: 'opaEventHistoryRequest';
  requestId: string;
  projectPath: string;
  taskId?: string;
  runId?: string;
  provider?: string;
  sessionId?: string;
  eventType?: string;
  before?: number;
  limit?: number;
  additionalProperties?: Record<string, any>;
}

export interface OpaAttentionRequest {
  type: 'opaAttentionRequest';
  requestId: string;
  projectPath?: string;
  additionalProperties?: Record<string, any>;
}

export interface WebviewReady {
  type: 'webviewReady';
}

export interface LaunchAgent {
  type: 'launchAgent';
  directoryPath?: string;
}

export interface FocusAgent {
  type: 'focusAgent';
  id: number;
}

export interface CloseAgent {
  type: 'closeAgent';
  id: number;
}

export interface SaveAgentSeats {
  type: 'saveAgentSeats';
  seats: Record<string, SeatAssignment>;
}

export interface SeatAssignment {
  palette: number;
  hueShift: number;
  seatId: string | null;
}

export interface SaveLayout {
  type: 'saveLayout';
  projectPath?: string;
  expectedRevision?: number;
  requestId?: string;
  reset?: boolean;
  layout: Record<string, any>;
}

export interface SetSoundEnabled {
  type: 'setSoundEnabled';
  enabled: boolean;
}

export interface SetLastSeenVersion {
  type: 'setLastSeenVersion';
  version: string;
}

export interface SetAlwaysShowLabels {
  type: 'setAlwaysShowLabels';
  enabled: boolean;
}

export interface SetGhostHeadlessAgents {
  type: 'setGhostHeadlessAgents';
  enabled: boolean;
}

export interface SetHooksEnabled {
  type: 'setHooksEnabled';
  providerId: string;
  enabled: boolean;
}

export interface HooksConsentResponse {
  type: 'hooksConsentResponse';
  providerId: string;
  choice: HooksConsentChoice;
}

export type HooksConsentChoice = 'install' | 'notNow' | 'never';

export interface SetHooksInfoShown {
  type: 'setHooksInfoShown';
}

export interface SetWatchAllSessions {
  type: 'setWatchAllSessions';
  enabled: boolean;
}

export interface ExportLayout {
  type: 'exportLayout';
}

export interface ImportLayout {
  type: 'importLayout';
}

export interface OpenSessionsFolder {
  type: 'openSessionsFolder';
}

export interface AddExternalAssetDirectory {
  type: 'addExternalAssetDirectory';
  path?: string;
}

export interface RemoveExternalAssetDirectory {
  type: 'removeExternalAssetDirectory';
  path: string;
}

export interface SaveAreaMappings {
  type: 'saveAreaMappings';
  mappings: Record<string, string[]>;
}

export interface SetShowAreas {
  type: 'setShowAreas';
  enabled: boolean;
}

export interface SetBypassPermissions {
  type: 'setBypassPermissions';
  enabled: boolean;
}

export interface SetShowHostDirectories {
  type: 'setShowHostDirectories';
  enabled: boolean;
}

export interface SaveDirectory {
  type: 'saveDirectory';
  name: string;
  path: string;
  previousPath?: string;
}

export interface RemoveDirectory {
  type: 'removeDirectory';
  path: string;
}

export interface RequestDirectorySuggestions {
  type: 'requestDirectorySuggestions';
}

export interface RequestDiagnostics {
  type: 'requestDiagnostics';
}
