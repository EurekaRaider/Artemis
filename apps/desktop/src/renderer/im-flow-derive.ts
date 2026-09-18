import { type ImConnectionStatus, type ImStatus } from "@artemis/protocol";

/** Live status shape returned by getImStatus / manageIm refresh. */
export type ImFlowStatus = ImStatus & {
  connections?: unknown[];
  spaces?: unknown[];
};

/**
 * Guided-flow completion chain, three steps total (2026-09 三步版原型迁移):
 * ① connect the service, ② onboard one channel end-to-end (a connected bot
 * AND a paired account on the same channel — the pairing predicate), ③ allow
 * at least one project. The optional end-to-end verify at the tail of ② and
 * the separate group-collaboration flow never enter the chain.
 */
export const IM_FLOW_STEP_IDS = ["service", "channel", "projects"] as const;
export type ImFlowStepId = (typeof IM_FLOW_STEP_IDS)[number];

export interface ImFlowStep {
  id: ImFlowStepId;
  done: boolean;
}

export function imFlowSteps(status: ImFlowStatus | undefined): ImFlowStep[] {
  const settings = status?.settings;
  const connections = (status?.connections ?? []) as ImConnectionStatus[];
  /* ② 配对谓词按渠道成立：该渠道有 connected 连接，且该渠道绑定了账号。 */
  const connectedChannels = new Set(
    connections
      .filter((connection) => connection.state === "connected")
      .map((connection) => connection.channel),
  );
  const channelDone = (status?.identities ?? []).some((identity) =>
    connectedChannels.has(identity.channel as never),
  );
  return [
    { id: "service", done: !!settings?.deviceId },
    { id: "channel", done: channelDone },
    {
      id: "projects",
      done: !!settings?.grants?.some(
        (grant) =>
          grant.expiresAt > Date.now() &&
          !!grant.security?.scopes.some(
            (scope) =>
              scope.audience === "owner" ||
              grant.groups.includes(scope.audience),
          ),
      ),
    },
  ];
}

export function imFlowProgress(steps: readonly ImFlowStep[]): number {
  return steps.filter((step) => step.done).length;
}

/** The earliest incomplete step the "继续设置" action should target. */
export function imFirstPendingStep(
  steps: readonly ImFlowStep[],
): ImFlowStepId | undefined {
  return steps.find((step) => !step.done)?.id;
}

/** Honest owner self-confirmation of the optional end-to-end verify (②尾). */
export interface ImVerifyState {
  confirmed: boolean;
  /** Channel the owner confirmed on, so the ② summary can say 已验证 · 飞书. */
  channel?: string | undefined;
}

const verifyKey = (deviceId: string) => `artemis.im.flow.verify.${deviceId}`;
const legacyTestConfirmedKey = (deviceId: string) =>
  `artemis.im.flow.testConfirmed.${deviceId}`;

/**
 * The verify tail is an honest owner self-confirmation (D4), so it lives in
 * local storage per registered device rather than in the shared settings.
 * Reads fall back to the pre-three-step key so an existing confirmation
 * survives the migration.
 */
export function imReadVerify(deviceId?: string): ImVerifyState {
  if (!deviceId || typeof localStorage === "undefined")
    return { confirmed: false };
  try {
    const raw = localStorage.getItem(verifyKey(deviceId));
    if (raw) {
      const parsed = JSON.parse(raw) as {
        confirmed?: boolean;
        channel?: string;
      };
      return {
        confirmed: !!parsed.confirmed,
        channel: parsed.channel || undefined,
      };
    }
    if (localStorage.getItem(legacyTestConfirmedKey(deviceId)) === "1")
      return { confirmed: true };
    return { confirmed: false };
  } catch {
    return { confirmed: false };
  }
}

export function imWriteVerify(
  deviceId: string | undefined,
  next: ImVerifyState,
): void {
  if (!deviceId || typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(legacyTestConfirmedKey(deviceId));
    if (next.confirmed)
      localStorage.setItem(
        verifyKey(deviceId),
        JSON.stringify({ confirmed: true, channel: next.channel ?? "" }),
      );
    else localStorage.removeItem(verifyKey(deviceId));
  } catch {
    // Storage unavailable: the confirmation simply does not persist.
  }
}
