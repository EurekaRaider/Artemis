import type { BrokerExecutionRequest } from "@artemis/protocol";
import { type TurnLatencySample } from "../platform/diagnostic-bundle.js";
import { type SettingsSnapshot } from "../../shared/api.js";
export interface PendingApproval {
  workerRequestId: string;
  request: BrokerExecutionRequest;
  projectId: string;
  fingerprint: string;
  expiresAt?: number;
}
export type SingleQuestionUserInputRequest = Extract<
  Extract<BrokerExecutionRequest, { kind: "user.input" }>,
  { question: string }
>;
export type MultiQuestionUserInputRequest = Extract<
  Extract<BrokerExecutionRequest, { kind: "user.input" }>,
  { questions: { questionId: string }[] }
>;
export interface PendingUserInput {
  workerRequestId: string;
  request: SingleQuestionUserInputRequest;
  // Assigned synchronously right after registration succeeds (review item
  // 2): registration runs first so a rejected registration can never leak
  // an orphan timer.
  timeout?: ReturnType<typeof setTimeout> | undefined;
}
export interface PendingMultiUserInput {
  workerRequestId: string;
  request: MultiQuestionUserInputRequest;
  timeouts: Map<string, ReturnType<typeof setTimeout>>;
}
export interface TurnLatencyTrace {
  turnId: string;
  mainReceivedAt: number;
  submittedAt?: number;
  coldThread: boolean;
  mode: string;
  providerId?: string;
  modelId?: string;
  thinkingLevel?: string;
  enabledMcpServers: number;
  toolCount: number;
  mcpToolCount: number;
  optionalStartedAt: number;
  optionalReadyAt?: number;
  workspaceStartedAt: number;
  workspaceEndedAt?: number;
  threadOpenStartedAt?: number;
  threadOpenEndedAt?: number;
  memoryStartedAt?: number;
  memoryEndedAt?: number;
  hostDispatchedAt?: number;
  hostReceivedAt?: number;
  queuedAt?: number;
  modelRequestedAt?: number;
  firstActivityAt?: number;
  firstTextAt?: number;
  rendererPaintAt?: number;
  completedAt?: number;
  outcome?: "completed" | "failed";
  queueDepth: number;
  eventCount: number;
  contextTokens?: number;
  uncachedInputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  cacheReadReported?: boolean;
  cacheWriteReported?: boolean;
  cachePolicy?: TurnLatencySample["cachePolicy"];
  cachePolicyReason?: string;
  cacheKeyFingerprint?: string;
  systemPromptFingerprint?: string;
  toolSchemaFingerprint?: string;
  stablePrefixTokens?: number;
  cacheKeyRequestsPerMinute?: number;
  cacheKeyRateWarning?: boolean;
  providerInputTokens?: number;
  currentEstimatedTokens?: number;
  displayedContextTokens?: number;
  contextSource?: TurnLatencySample["contextSource"];
  providerLimitTokens?: number;
  providerRequestedTokens?: number;
  contextFootprint?: TurnLatencySample["contextFootprint"];
}
export type ModelSettingsSnapshot = Pick<
  SettingsSnapshot,
  | "models"
  | "addedModels"
  | "credentials"
  | "providers"
  | "contextWindow"
  | "selection"
>;
export type LocalFileBrokerRequest = Extract<
  BrokerExecutionRequest,
  { kind: "local.file.read" | "local.file.write" }
>;
export type GoalBrokerRequest = Extract<
  BrokerExecutionRequest,
  { kind: "goal.get" | "goal.create" | "goal.update" }
>;
