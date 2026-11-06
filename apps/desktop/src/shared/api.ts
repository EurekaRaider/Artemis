export type {
  ConnectorDefinition,
  ConnectorCatalogEntry,
  ConnectorConnection,
  ConnectorConnectInput,
} from "./connectors.js";
export type {
  AgentConcurrencyPreference,
  AgentConcurrencyPressureReason,
  AgentConcurrencyStatus,
} from "./agent-concurrency.js";
export type {
  ReviewAction,
  ReviewMutationInput,
  ReviewQuery,
  ReviewScope,
} from "@artemis/protocol";
import type { ComputerApi } from "./api/computer.js";
import type { HooksApi } from "./api/hooks.js";
import type { TaskNotificationsApi } from "./api/task-notifications.js";
import type { ImApi } from "./api/im.js";
import type { HistoryApi } from "./api/history.js";
import type { ProjectsApi } from "./api/projects.js";
import type { AttachmentsApi } from "./api/attachments.js";
import type { ConversationApi } from "./api/conversation.js";
import type { AutomationApi } from "./api/automation.js";
import type { ReviewApi } from "./api/review.js";
import type { WorkspacePreviewsApi } from "./api/workspace-previews.js";
import type { OfficeApi } from "./api/office.js";
import type { DesignApi } from "./api/design.js";
import type { WorkspaceFilesApi } from "./api/workspace-files.js";
import type { TerminalApi } from "./api/terminal.js";
import type { AppearanceApi } from "./api/appearance.js";
import type { SettingsApi } from "./api/settings.js";
import type { CustomAgentsApi } from "./api/custom-agents.js";
import type { ConfigurationImportApi } from "./api/configuration-import.js";
import type { McpApi } from "./api/mcp.js";
import type { SkillsApi } from "./api/skills.js";
import type { IntegrationsApi } from "./api/integrations.js";
import type { ExtensionsApi } from "./api/extensions.js";
import type { UpdatesDiagnosticsApi } from "./api/updates-diagnostics.js";
import type { EventsApi } from "./api/events.js";

export interface ArtemisApi
  extends
    ComputerApi,
    HooksApi,
    TaskNotificationsApi,
    ImApi,
    HistoryApi,
    ProjectsApi,
    AttachmentsApi,
    ConversationApi,
    AutomationApi,
    ReviewApi,
    WorkspacePreviewsApi,
    OfficeApi,
    DesignApi,
    WorkspaceFilesApi,
    TerminalApi,
    AppearanceApi,
    SettingsApi,
    CustomAgentsApi,
    ConfigurationImportApi,
    McpApi,
    SkillsApi,
    IntegrationsApi,
    ExtensionsApi,
    UpdatesDiagnosticsApi,
    EventsApi {}
export type { ComputerPermission } from "./api/computer.js";
export type { DesktopSnapshot } from "./api/history.js";
export type {
  ProjectGitBranch,
  ProjectGitInfo,
  ProjectPullRequestState,
  ProjectPullRequestCheckStatus,
  ProjectPullRequestCheck,
  ProjectPullRequest,
  ProjectPullRequestLookup,
  ProjectGitCommitResult,
  ProjectGitPushResult,
} from "./api/projects.js";
export type {
  AttachmentImportProgress,
  AttachmentImportResult,
  AttachmentImportResponse,
  AttachmentFilePreview,
} from "./api/attachments.js";
export type {
  CreateThreadInput,
  StartTurnInput,
  StartTurnResult,
  QueueTurnInput,
  QueuedTurnMessages,
  ReplaceQueuedTurnInput,
  SteerQueuedTurnInput,
  ChildAgentControlInput,
  ChildAgentControlResult,
  AgentTeamControlInput,
  AgentTeamControlResult,
  ForkThreadResult,
} from "./api/conversation.js";
export type { SaveAutomationInput } from "./api/automation.js";
export type {
  ReviewHunk,
  ReviewLine,
  ReviewCommentAnchor,
  ReviewComment,
  AddReviewCommentInput,
  ReviewFile,
  ReviewDiff,
  UndoTurnChangesResult,
  ReviewMutationResult,
} from "./api/review.js";
export type {
  WorkspaceTextFile,
  WorkspaceImageFile,
  WorkspaceDirectoryEntry,
  WorkspaceFileContent,
  WorkspaceFileLink,
} from "./api/workspace-files.js";
export type {
  TerminalOpenInput,
  TerminalDescriptor,
  TerminalData,
  TerminalExit,
} from "./api/terminal.js";
export type {
  CredentialSummary,
  AddedModelConfiguration,
  SettingsSnapshot,
  GlobalAgentsSnapshot,
} from "./api/settings.js";
export type {
  CustomAgentSummary,
  SaveCustomAgentInput,
  CustomAgentCapabilityPreview,
} from "./api/custom-agents.js";
export type {
  ConfigurationImportSource,
  ConfigurationImportCategory,
  ConfigurationImportCounts,
  ConfigurationImportSourcePreview,
  ConfigurationImportPreview,
  ConfigurationImportRequest,
  ConfigurationImportSummary,
  ConfigurationImportResult,
} from "./api/configuration-import.js";
export type {
  McpResourceMetadata,
  McpServerConfig,
  McpServerStatus,
  McpCatalogItem,
  McpCatalogInstallInput,
  McpCatalogInstallOption,
  McpCatalogInstallRequest,
} from "./api/mcp.js";
export type { SkillCatalogItem, InstalledSkill } from "./api/skills.js";
export type {
  ArtemisPluginSource,
  ArtemisPluginSkillPreview,
  ArtemisPluginMcpPreview,
  ArtemisPluginAppPreview,
  ArtemisPluginPreview,
  InstalledArtemisPlugin,
  ArtemisPluginMarketplace,
  ArtemisPluginMarketplaceSource,
  ArtemisPluginMarketplaceTrustPreview,
  ArtemisPluginOfflineMarketplacePreview,
  ArtemisPluginMarketplaceEntry,
  ArtemisPluginMarketplaceError,
  ArtemisPluginMarketplaceState,
  ArtemisPluginMutationResult,
} from "./api/integrations.js";
export type {
  TrustedExtensionConfig,
  TrustedExtensionStatus,
} from "./api/extensions.js";
export type {
  ReleaseUpdateStatus,
  RendererDiagnostic,
} from "./api/updates-diagnostics.js";
export type { ResourceInstallProgress } from "./api/events.js";
export type {
  WorktreeCleanupCandidate,
  CleanupWorktreeResult,
  RestoreWorktreeSnapshotResult,
  HandoffWorkspaceResult,
} from "./api/worktrees.js";
export { IPC } from "./ipc-channels.js";
