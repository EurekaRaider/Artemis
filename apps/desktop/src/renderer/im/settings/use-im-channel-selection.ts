import type { Status } from "./im-settings-values.js";
import { useEffect, useLayoutEffect } from "react";

import { type ImConnectionStatus } from "@artemis/protocol";

import { type ImChannel } from "../ImNavigation";

interface UseImChannelSelectionContext {
  readonly groupDetail: boolean;
  readonly local: boolean;
  readonly status: Status | undefined;
  readonly setDiagnostics: import("react").Dispatch<
    import("react").SetStateAction<unknown | undefined>
  >;
  readonly run: (action: () => Promise<unknown>) => Promise<boolean>;
  readonly channelDetail: boolean;
  readonly channelConnections: ImConnectionStatus[];
  readonly setSelectedBotId: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
  readonly channel: ImChannel;
  readonly panelRef: import("react").RefObject<HTMLDivElement | null>;
  readonly setChannelDialogHeight: import("react").Dispatch<
    import("react").SetStateAction<number | undefined>
  >;
}
export function useImChannelSelection(context: UseImChannelSelectionContext) {
  const {
    groupDetail,
    local,
    status,
    setDiagnostics,
    run,
    channelDetail,
    channelConnections,
    setSelectedBotId,
    channel,
    panelRef,
    setChannelDialogHeight,
  } = context;
  useEffect(() => {
    /* 群诊断在群协作详情或授权弹窗（群选项/属主观察）打开时拉取。 */
    if (!groupDetail || !local || !status?.settings.deviceId) return;
    let active = true;
    void run(async () => {
      const result = await window.artemis.manageIm({
        action: "admin",
        operation: "status",
      });
      if (active) setDiagnostics(result);
    });
    return () => {
      active = false;
    };
  }, [groupDetail, local, status?.settings.deviceId]);
  useEffect(() => {
    /* 渠道详情主从：选中项失效（删除/切换渠道）时回落到本渠道首个机器人。 */
    if (!channelDetail) return;
    setSelectedBotId((previous) =>
      previous && channelConnections.some((c) => c.id === previous)
        ? previous
        : (channelConnections[0]?.id ?? ""),
    );
  }, [channelDetail, channel, channelConnections]);
  useLayoutEffect(() => {
    /* 主弹窗高度内容驱动（随概览/向导内容浮动）：渠道弹窗打开时量测其
       实际高度注入，两个面板视觉齐平；无主弹窗宿主（测试/嵌入）时走
       CSS 缺省公式。 */
    if (!channelDetail) return;
    const main = panelRef.current?.closest("dialog");
    if (!main) return;
    const height = main.getBoundingClientRect().height;
    if (height > 0) setChannelDialogHeight(height);
  }, [channelDetail]);
  return {};
}
