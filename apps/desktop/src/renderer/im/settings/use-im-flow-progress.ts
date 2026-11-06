import type { Status } from "./im-settings-values.js";
import { useEffect, useRef } from "react";

import {
  imFirstPendingStep,
  imFlowProgress,
  imFlowSteps,
  imReadVerify,
  type ImFlowStepId,
  type ImVerifyState,
} from "../im-flow-derive";
import { imChannelLabel, type ImChannel } from "../ImNavigation";

interface UseImFlowProgressContext {
  readonly setFlowCard: import("react").Dispatch<
    import("react").SetStateAction<ImFlowStepId | null>
  >;
  readonly status: Status | undefined;
  readonly flowCard: ImFlowStepId | null;
  readonly screen: "flow" | "overview" | undefined;
  readonly taskSeen: boolean;
  readonly verify: ImVerifyState;
  readonly t: import("../../../shared/i18n/ui-text.js").UiTranslate;
  readonly setScreen: import("react").Dispatch<
    import("react").SetStateAction<"flow" | "overview" | undefined>
  >;
  readonly setVerify: import("react").Dispatch<
    import("react").SetStateAction<ImVerifyState>
  >;
  readonly setTaskSeen: import("react").Dispatch<
    import("react").SetStateAction<boolean>
  >;
  readonly setMessage: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
}
export function useImFlowProgress(context: UseImFlowProgressContext) {
  const {
    setFlowCard,
    status,
    flowCard,
    screen,
    taskSeen,
    verify,
    t,
    setScreen,
    setVerify,
    setTaskSeen,
    setMessage,
  } = context;
  function flowAdvanceFrom() {
    setFlowCard(null);
  }

  /* 引导流 derive：必须在加载守卫之前，保证 Hook 顺序稳定。 */
  const flowSteps = imFlowSteps(status);
  const flowDone = imFlowProgress(flowSteps);
  const flowTotal = flowSteps.length;
  const allDone = flowDone === flowTotal;
  const flowOpenCard = flowCard ?? imFirstPendingStep(flowSteps) ?? "channel";
  const activeScreen = screen ?? (allDone ? "overview" : "flow");
  const taskDetected = taskSeen || !!status?.remoteTasks?.length;
  /* 验证折叠标签三态：已验证 · 渠道 / 验证进行中 / 初始（可选提示）。 */
  const verifiedChannelLabel = verify.channel
    ? verify.channel === "lark"
      ? "Lark"
      : imChannelLabel(verify.channel as ImChannel, t)
    : "";
  const verifyLabel = verify.confirmed
    ? t("ImSettingsPanel.message29", {
        value1: verifiedChannelLabel ? ` · ${verifiedChannelLabel}` : "",
      })
    : taskDetected
      ? t("ImSettingsPanel.message28")
      : t("ImSettingsPanel.message27");
  /* 完成即概览：接入和配对全部完成时粘性落在概览（群协作屏除外）；回退时停留概览并提示。 */
  useEffect(() => {
    if (allDone)
      setScreen((current) => (current === "overview" ? current : "overview"));
  }, [allDone, screen]);
  const flowDoneKey = flowSteps.map((step) => (step.done ? "1" : "0")).join("");
  const prevFlowDoneKey = useRef(flowDoneKey);
  useEffect(() => {
    setVerify(imReadVerify(status?.settings.deviceId));
  }, [status?.settings.deviceId]);
  useEffect(() => {
    const unsubscribe = window.artemis.onImTaskCreated?.(() =>
      setTaskSeen(true),
    );
    return () => unsubscribe?.();
  }, []);
  useEffect(() => {
    if (prevFlowDoneKey.current === flowDoneKey) return;
    const previous = prevFlowDoneKey.current;
    prevFlowDoneKey.current = flowDoneKey;
    if (
      [...previous].some(
        (flag, index) => flag === "1" && flowDoneKey[index] === "0",
      )
    )
      setMessage(t("ImSettingsPanel.message30"));
  }, [flowDoneKey, activeScreen]);
  return {
    flowAdvanceFrom,
    flowSteps,
    allDone,
    activeScreen,
    taskDetected,
    verifyLabel,
  };
}
