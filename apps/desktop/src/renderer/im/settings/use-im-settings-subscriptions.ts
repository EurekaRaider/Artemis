import type { BotMetadata } from "./im-settings-values.js";
import { type Status } from "./im-settings-values.js";

import { useEffect } from "react";

import {
  type ImConnectionStatus,
  type ImSettings,
  type Project,
} from "@artemis/protocol";

import { type ImFlowStepId } from "../im-flow-derive";
import { type ImChannel } from "../ImNavigation";

import { type ImPairCode } from "../ImAccountControls";

interface UseImSettingsSubscriptionsContext {
  readonly setSavedMetadata: import("react").Dispatch<
    import("react").SetStateAction<Partial<Record<ImChannel, BotMetadata>>>
  >;
  readonly setSavedPending: import("react").Dispatch<
    import("react").SetStateAction<Partial<Record<ImChannel, boolean>>>
  >;
  readonly setSavingChannel: import("react").Dispatch<
    import("react").SetStateAction<ImChannel | null>
  >;
  readonly setDiagnostics: import("react").Dispatch<
    import("react").SetStateAction<unknown | undefined>
  >;
  readonly setPairCode: import("react").Dispatch<
    import("react").SetStateAction<ImPairCode | undefined>
  >;
  readonly setFields: import("react").Dispatch<
    import("react").SetStateAction<Record<string, string>>
  >;
  readonly setAdminToken: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
  readonly status: Status | undefined;
  readonly messageError: boolean;
  readonly message: string;
  readonly setMessage: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
  readonly setStatus: import("react").Dispatch<
    import("react").SetStateAction<Status | undefined>
  >;
  readonly setSettings: import("react").Dispatch<
    import("react").SetStateAction<ImSettings | undefined>
  >;
  readonly setUrl: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
  readonly setName: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
  readonly setProjects: import("react").Dispatch<
    import("react").SetStateAction<Project[]>
  >;
  readonly setChannel: import("react").Dispatch<
    import("react").SetStateAction<ImChannel>
  >;
  readonly setConnectionId: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
  readonly running: import("react").RefObject<boolean>;
  readonly refreshEpoch: import("react").RefObject<number>;
  readonly groupDetail: boolean;
  readonly setRefreshError: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
  readonly screen: "flow" | "overview" | undefined;
  readonly flowCard: ImFlowStepId | null;
  readonly mounted: import("react").RefObject<boolean>;
  readonly panelRef: import("react").RefObject<HTMLDivElement | null>;
  readonly setCompact: import("react").Dispatch<
    import("react").SetStateAction<boolean>
  >;
  readonly settings: ImSettings | undefined;
}
export function useImSettingsSubscriptions(
  context: UseImSettingsSubscriptionsContext,
) {
  const {
    setSavedMetadata,
    setSavedPending,
    setSavingChannel,
    setDiagnostics,
    setPairCode,
    setFields,
    setAdminToken,
    status,
    messageError,
    message,
    setMessage,
    setStatus,
    setSettings,
    setUrl,
    setName,
    setProjects,
    setChannel,
    setConnectionId,
    running,
    refreshEpoch,
    groupDetail,
    setRefreshError,
    screen,
    flowCard,
    mounted,
    panelRef,
    setCompact,
    settings,
  } = context;
  useEffect(() => {
    setSavedMetadata({});
    setSavedPending({});
    setSavingChannel(null);
    setDiagnostics(undefined);
    setPairCode(undefined);
    setFields({});
    setAdminToken("");
  }, [status?.settings.deviceId]);
  useEffect(() => {
    if (messageError)
      document
        .getElementById("im-feedback")
        ?.scrollIntoView?.({ block: "nearest" });
  }, [message, messageError]);
  useEffect(() => {
    let active = true;
    void Promise.all([
      window.artemis.getImStatus(),
      window.artemis.getSnapshot(),
    ])
      .then(([current, snapshot]) => {
        if (active) {
          setStatus(current);
          setSettings(current.settings);
          setUrl(current.settings.gatewayUrl);
          setName(current.settings.deviceName);
          setProjects(snapshot.projects);
          /* 手动注册入口卡不再自动顶开整屏详情，用户点击时才进入。 */
          const connections = (
            (current.connections ?? []) as ImConnectionStatus[]
          ).filter((c) => c.channel !== "wecom");
          const connected =
            connections.find((c) => c.state === "connected") ?? connections[0];
          if (connected?.channel) {
            setChannel(connected.channel);
            setConnectionId(connected.id);
          }
        }
      })
      .catch((error) => {
        if (active) setMessage(String(error));
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    let refreshing = false;
    const refreshStatus = async () => {
      if (running.current || refreshing) return;
      refreshing = true;
      const epoch = refreshEpoch.current;
      try {
        let current = await window.artemis.getImStatus();
        if (current.settings.deviceId)
          current = (await window.artemis.manageIm({
            action: "refresh",
          })) as Status;
        const groupDiagnostics =
          groupDetail && current.localGateway && current.settings.deviceId
            ? await window.artemis.manageIm({
                action: "admin",
                operation: "status",
              })
            : undefined;
        if (active && !running.current && epoch === refreshEpoch.current) {
          setStatus(current);
          if (groupDiagnostics !== undefined) setDiagnostics(groupDiagnostics);
          setRefreshError("");
          // The store is authoritative again; drop save-gap transients.
          setSavedPending({});
        }
      } catch (error) {
        if (active && !running.current && epoch === refreshEpoch.current)
          setRefreshError(String(error));
      } finally {
        refreshing = false;
      }
    };
    const timer = window.setInterval(() => void refreshStatus(), 2000);
    window.addEventListener("focus", refreshStatus);
    document.addEventListener("visibilitychange", refreshStatus);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshStatus);
      document.removeEventListener("visibilitychange", refreshStatus);
    };
  }, [screen, groupDetail, flowCard]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const root = panelRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const dialog = root.closest(".settings-panel");
    const observer = new ResizeObserver(() =>
      setCompact(root.clientWidth < 720),
    );
    observer.observe(root);
    if (dialog) observer.observe(dialog);
    return () => observer.disconnect();
  }, [!!settings]);
  return {};
}
