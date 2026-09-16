import { type UiTranslate } from "../shared/ui-text.js";
import {
  imAggregateConnectionStates,
  type ImConnectionState,
  type ImConnectionStatus,
} from "@artemis/protocol";

export type ImChannel = ImConnectionStatus["channel"];
export type ImView =
  | ImChannel
  | "gateway"
  | "pairing"
  | "permissions"
  | "spaces"
  | "setup-guide"
  /* 三步版：②尾验证段作为独立定位目标（不新增卡） */
  | "test";
export type ImTranslate = UiTranslate;
export const IM_CHANNELS = ["wecom", "feishu", "slack"] as const;
export function imChannelLabel(channel: ImChannel, t: ImTranslate) {
  return channel === "wecom"
    ? t("ImNavigation.message2")
    : channel === "feishu"
      ? t("ImNavigation.message1")
      : "Slack";
}
export function imChannelConstraint(channel: ImChannel, t: ImTranslate) {
  return channel === "feishu"
    ? t("ImNavigation.message5")
    : channel === "wecom"
      ? t("ImNavigation.message4")
      : t("ImNavigation.message3");
}
export function imConnectionLabel(
  state: ImConnectionState | undefined,
  t: ImTranslate,
) {
  return state === "connected"
    ? t("ImNavigation.message12")
    : state === "connecting"
      ? t("ImNavigation.message11")
      : state === "saving"
        ? t("ImNavigation.message10")
        : state === "saved"
          ? t("ImNavigation.message9")
          : state === "error"
            ? t("ImNavigation.message8")
            : state === "partial_error"
              ? t("ImNavigation.message7")
              : t("ImNavigation.message6");
}
export function imConnectionHealth(connections: readonly ImConnectionStatus[]) {
  const failed = connections.filter((c) => c.state === "error").length;
  return {
    total: connections.length,
    failed,
    state: imAggregateConnectionStates(connections.map((c) => c.state)),
  } as const;
}
/**
 * Merge renderer-side transients over the store aggregation: `saving` while
 * a credential PUT is in flight, and `saved` for the gap between a
 * successful save and the next refresh that reports the connection.
 */
export function imChannelConnectionState(
  connections: readonly ImConnectionStatus[],
  options: { saving?: boolean; savedCredentials?: boolean } = {},
): ImConnectionState {
  if (options.saving) return "saving";
  const state = imAggregateConnectionStates(connections.map((c) => c.state));
  if (state === "unconfigured" && options.savedCredentials) return "saved";
  return state;
}
export function imConnectionSummary(
  connections: readonly ImConnectionStatus[],
  t: ImTranslate,
) {
  const { total, failed } = imConnectionHealth(connections);
  return failed
    ? t("ImNavigation.message14", { value1: total, value2: failed })
    : t("ImNavigation.message13", { value1: total });
}
