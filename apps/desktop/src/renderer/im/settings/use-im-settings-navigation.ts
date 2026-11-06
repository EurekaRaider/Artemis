import { type Status } from "./im-settings-values.js";

import { type ImConnectionStatus, type ImSettings } from "@artemis/protocol";

import { type ImFlowStepId } from "../im-flow-derive";
import { IM_CHANNELS, type ImView, type ImChannel } from "../ImNavigation";

import { type ImPairCode } from "../ImAccountControls";

interface UseImSettingsNavigationContext {
  readonly setFields: import("react").Dispatch<
    import("react").SetStateAction<Record<string, string>>
  >;
  readonly setAdminToken: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
  readonly setBotDialog: import("react").Dispatch<
    import("react").SetStateAction<{ connectionId?: string } | null>
  >;
  readonly setFlowCard: import("react").Dispatch<
    import("react").SetStateAction<ImFlowStepId | null>
  >;
  readonly setChannelDetail: import("react").Dispatch<
    import("react").SetStateAction<boolean>
  >;
  readonly setGroupDetail: import("react").Dispatch<
    import("react").SetStateAction<boolean>
  >;
  readonly setFocusTarget: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
  readonly setScreen: import("react").Dispatch<
    import("react").SetStateAction<"flow" | "overview" | undefined>
  >;
  readonly setChannel: import("react").Dispatch<
    import("react").SetStateAction<ImChannel>
  >;
  readonly setChannelPane: import("react").Dispatch<
    import("react").SetStateAction<
      "bot" | "create" | "guide" | "import" | "verify"
    >
  >;
  readonly setSelectedBotId: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
  readonly setCredScan: import("react").Dispatch<
    import("react").SetStateAction<boolean>
  >;
  readonly connections: ImConnectionStatus[];
  readonly setConnectionId: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
  readonly verifyTouched: import("react").RefObject<boolean>;
  readonly channel: ImChannel;
  readonly setShowRemote: import("react").Dispatch<
    import("react").SetStateAction<boolean>
  >;
  readonly running: import("react").RefObject<boolean>;
  readonly refreshEpoch: import("react").RefObject<number>;
  readonly setBusy: import("react").Dispatch<
    import("react").SetStateAction<boolean>
  >;
  readonly setMessage: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
  readonly setMessageError: import("react").Dispatch<
    import("react").SetStateAction<boolean>
  >;
  readonly mounted: import("react").RefObject<boolean>;
  readonly setPairCode: import("react").Dispatch<
    import("react").SetStateAction<ImPairCode | undefined>
  >;
  readonly setStatus: import("react").Dispatch<
    import("react").SetStateAction<Status | undefined>
  >;
  readonly setRefreshError: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
  readonly setSettings: import("react").Dispatch<
    import("react").SetStateAction<ImSettings | undefined>
  >;
  readonly t: import("../../../shared/i18n/ui-text.js").UiTranslate;
}
export function useImSettingsNavigation(
  context: UseImSettingsNavigationContext,
) {
  const {
    setFields,
    setAdminToken,
    setBotDialog,
    setFlowCard,
    setChannelDetail,
    setGroupDetail,
    setFocusTarget,
    setScreen,
    setChannel,
    setChannelPane,
    setSelectedBotId,
    setCredScan,
    connections,
    setConnectionId,
    verifyTouched,
    channel,
    setShowRemote,
    running,
    refreshEpoch,
    setBusy,
    setMessage,
    setMessageError,
    mounted,
    setPairCode,
    setStatus,
    setRefreshError,
    setSettings,
    t,
  } = context;
  function selectView(next: ImView | "guide" | "flow" | "overview" | "group") {
    setFields({});
    setAdminToken("");
    setBotDialog(null);
    if (next === "group" || next === "spaces" || next === "permissions") {
      /* 群协作=右栏第三卡详情；深链统一落到该入口。 */
      setFlowCard(null);
      setChannelDetail(false);
      setGroupDetail(true);
      setFocusTarget("im-spaces");
      return;
    }
    if (next === "overview") {
      setScreen("overview");
      setFlowCard(null);
      setFocusTarget("im-overview");
      return;
    }
    if (next === "guide" || next === "flow" || next === "setup-guide") {
      setScreen("flow");
      setFocusTarget("im-guide");
      return;
    }
    /* 配对并入渠道卡；验证定位到渠道详情的验证页。 */
    const step = next === "gateway" ? "service" : "channel";

    if (IM_CHANNELS.includes(next as ImChannel)) {
      setChannel(next as ImChannel);
      setChannelDetail(true);
      setGroupDetail(false);
      setChannelPane("bot");
      setSelectedBotId("");
      setCredScan(false);
      setConnectionId(connections.find((c) => c.channel === next)?.id ?? "");
    }
    if (next === "test") {
      verifyTouched.current = true;
      /* 验证=渠道二级面板的一页，深链时一并下钻并切页。 */
      setChannelDetail(true);
      setGroupDetail(false);
      setChannelPane("verify");
    }
    setFlowCard(step);
    setFocusTarget(next === "test" ? "im-verify" : `im-${next}`);
  }
  function navigateStep(id: string) {
    const next =
      id === "im-prepare" || id === "im-device"
        ? "gateway"
        : id === "im-bot" || id === "im-pair"
          ? channel
          : id === "im-permissions"
            ? "permissions"
            : id === "im-test"
              ? "test"
              : channel;
    selectView(next);
    if (id === "im-device") {
      /* 手动注册改为弹窗：入口卡留在下层，焦点交给弹窗自管。 */
      setShowRemote(true);
      return;
    }
    setFocusTarget(id);
  }
  /* ②卡内切换平台：留在引导流里，只重置该渠道的编辑态。 */
  function flowSelectChannel(platform: ImChannel) {
    setChannel(platform);
    setConnectionId(connections.find((c) => c.channel === platform)?.id ?? "");
    setFields({});
    setAdminToken("");
    setBotDialog(null);
  }
  async function run(action: () => Promise<unknown>): Promise<boolean> {
    if (running.current) return false;
    running.current = true;
    refreshEpoch.current++;
    setBusy(true);
    setMessage("");
    setMessageError(false);
    try {
      const result = await action();
      return result !== false;
    } catch (error) {
      if (mounted.current) {
        setMessage(error instanceof Error ? error.message : String(error));
        setMessageError(true);
      }
      return false;
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function generatePairCode() {
    setPairCode(undefined);
    const started = Date.now();
    const result = (await window.artemis.manageIm({
      action: "pair",
      requireConfirmation: true,
    })) as { code: string; expiresIn: number };
    setStatus((previous) =>
      previous ? { ...previous, pairingRequests: [] } : previous,
    );
    setPairCode({
      code: result.code,
      expiresAt: started + Math.min(result.expiresIn ?? 300, 300) * 1000,
    });
  }
  async function refresh() {
    const current = (await window.artemis.manageIm({
      action: "refresh",
    })) as Status;
    if (mounted.current) {
      setStatus(current);
      setRefreshError("");
    }
  }
  async function save(next: ImSettings) {
    const current = await window.artemis.saveImSettings(next);
    setStatus((previous) => ({ ...previous, ...current }));
    setSettings(current.settings);
    setMessage(t("ImSettingsPanel.message1"));
  }
  return {
    selectView,
    navigateStep,
    flowSelectChannel,
    run,
    generatePairCode,
    refresh,
    save,
  };
}
