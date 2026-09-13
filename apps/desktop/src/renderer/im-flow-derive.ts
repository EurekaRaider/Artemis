import type { ImConnectionStatus, ImStatus } from "@artemis/protocol";

/** Live status shape returned by getImStatus / manageIm refresh. */
export type ImFlowStatus = ImStatus & {
  connections?: unknown[];
  spaces?: unknown[];
};

export const IM_FLOW_STEP_IDS = [
  "service",
  "bots",
  "account",
  "projects",
  "test",
] as const;
export type ImFlowStepId = (typeof IM_FLOW_STEP_IDS)[number];

export interface ImFlowStep {
  id: ImFlowStepId;
  done: boolean;
}

/**
 * Guided-flow step completion, derived only from real store state:
 * ① device registered, ② some bot connection established, ③ an account
 * paired, ④ at least one saved grant, ⑤ the owner confirmed the test task.
 */
export function imFlowSteps(
  status: ImFlowStatus | undefined,
  testConfirmed: boolean,
): ImFlowStep[] {
  const settings = status?.settings;
  const connections = (status?.connections ?? []) as ImConnectionStatus[];
  return [
    { id: "service", done: !!settings?.deviceId },
    {
      id: "bots",
      done: connections.some((connection) => connection.state === "connected"),
    },
    { id: "account", done: !!status?.identities?.length },
    { id: "projects", done: !!settings?.grants?.length },
    { id: "test", done: testConfirmed },
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

const testConfirmedKey = (deviceId: string) =>
  `artemis.im.flow.testConfirmed.${deviceId}`;

/**
 * Step ⑤ is an honest owner self-confirmation (D4), so it lives in local
 * storage per registered device rather than in the shared settings.
 */
export function imReadTestConfirmed(deviceId?: string): boolean {
  if (!deviceId || typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(testConfirmedKey(deviceId)) === "1";
  } catch {
    return false;
  }
}

export function imWriteTestConfirmed(
  deviceId: string | undefined,
  confirmed: boolean,
): void {
  if (!deviceId || typeof localStorage === "undefined") return;
  try {
    if (confirmed) localStorage.setItem(testConfirmedKey(deviceId), "1");
    else localStorage.removeItem(testConfirmedKey(deviceId));
  } catch {
    // Storage unavailable: the confirmation simply does not persist.
  }
}
