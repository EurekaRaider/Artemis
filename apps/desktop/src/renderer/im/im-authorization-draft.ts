import {
  IM_SECURITY_VERSION,
  imAuthorizationImpactVersion,
  imAuthorizationFingerprint,
  imPolicyVersion,
  imProjectPolicy,
  imScopeRevision,
  imIdentityKey,
  type ExecutionGrant,
  type ImAuthorizationCommand,
  type ImSettings,
} from "@artemis/protocol";
import type { imNativeGroupChoices } from "./ImNativeGroups";
export type AuthorizationTarget = ReturnType<
  typeof imNativeGroupChoices
>[number];
export interface AuthorizationDraft {
  supersedes?: string;
  confirmedAt: number;
  entry: "group" | "project";
  intent: ImAuthorizationCommand["intent"];
  target: AuthorizationTarget | undefined;
  projectId: string;
  baseline: ImSettings;
  grant: ExecutionGrant;
  editPolicy: boolean;
  step: 1 | 2;
  operationId: string;
  confirmation: string;
  dirty: boolean;
}
export function createAuthorizationDraft(
  settings: ImSettings,
  target: AuthorizationTarget | undefined,
  projectId: string,
  intent: AuthorizationDraft["intent"],
  entry: AuthorizationDraft["entry"],
): AuthorizationDraft {
  const existing = settings.grants.find((g) => g.projectId === projectId);
  const scope = existing?.security?.scopes.find(
    (s) => s.audience === target?.value,
  );
  return {
    confirmedAt: Date.now(),
    entry,
    intent,
    target,
    projectId,
    baseline: structuredClone(settings),
    grant: {
      ...(existing ?? {
        projectId,
        mode: "plan",
        approval: "ask",
        shell: false,
        network: false,
        groups: [],
        expiresAt: Date.now() + 30 * 86400000,
      }),
      security: {
        version: IM_SECURITY_VERSION,
        revision: "draft",
        confirmedAt: 0,
        scopes: [
          {
            ...(scope ?? {
              readMode: "project",
              readPaths: [],
              writePaths: [],
            }),
            audience: "owner",
            confirmedAt: 0,
          },
        ],
      },
    },
    editPolicy: !existing || intent === "renew",
    step: intent === "create" || intent === "rebind" ? 1 : 2,
    operationId: crypto.randomUUID(),
    confirmation: "",
    dirty: false,
  };
}
export function draftAuthorizationCommand(
  draft: AuthorizationDraft,
): ImAuthorizationCommand | undefined {
  const { target, baseline, grant } = draft;
  if (!target?.owner || !draft.projectId) return undefined;
  const previous = baseline.grants.find((g) => g.projectId === draft.projectId);
  const scope = previous?.security?.scopes.find(
    (s) => s.audience === target.value,
  );
  const command: ImAuthorizationCommand = {
    version: 1,
    operationId: draft.operationId,
    intent: draft.intent,
    ...(draft.supersedes ? { supersedes: draft.supersedes } : {}),
    deviceId: baseline.deviceId,
    gatewayUrl: baseline.gatewayUrl,
    conversation: target.conversation,
    owner: target.owner,
    name: target.name?.trim() || target.conversation.id,
    projectId: draft.projectId,
    expectedPolicyVersion: imPolicyVersion(previous),
    expectedGroupVersion: target.saved?.revision ?? null,
    expectedScopeVersion:
      scope && previous?.security
        ? imScopeRevision(previous.security, scope)
        : null,
    expectedDeviceEnabled: baseline.enabled,
    expectedImpactVersion: imAuthorizationImpactVersion(
      baseline,
      draft.projectId,
      draft.editPolicy,
      draft.intent !== "pause",
    ),
    ...(draft.editPolicy ? { policy: imProjectPolicy(grant) } : {}),
    scope: { ...grant.security!.scopes[0]!, confirmedAt: draft.confirmedAt },
    ...(grant.security!.scopes[0]!.localAccess === "full" &&
    draft.intent !== "pause"
      ? { fullAccessConfirmed: true }
      : {}),
    enableService: draft.intent !== "pause",
    confirmationFingerprint: "",
  };
  command.confirmationFingerprint = imAuthorizationFingerprint(command);
  return command;
}
export function authorizationDraftConflict(
  draft: AuthorizationDraft,
  settings: ImSettings,
  target?: AuthorizationTarget,
): boolean {
  const command = draftAuthorizationCommand(draft);
  if (!command) return false;
  const grant = settings.grants.find((g) => g.projectId === draft.projectId);
  const scope = grant?.security?.scopes.find(
    (s) => s.audience === target?.value,
  );
  return (
    settings.deviceId !== command.deviceId ||
    settings.gatewayUrl !== command.gatewayUrl ||
    settings.enabled !== command.expectedDeviceEnabled ||
    imAuthorizationImpactVersion(
      settings,
      command.projectId,
      !!command.policy,
      command.enableService,
    ) !== command.expectedImpactVersion ||
    imPolicyVersion(grant) !== command.expectedPolicyVersion ||
    (target?.saved?.revision ?? null) !== command.expectedGroupVersion ||
    (scope && grant?.security
      ? imScopeRevision(grant.security, scope)
      : null) !== command.expectedScopeVersion ||
    !target?.owner ||
    (!!target.owner &&
      imIdentityKey(target.owner) !== imIdentityKey(command.owner))
  );
}
