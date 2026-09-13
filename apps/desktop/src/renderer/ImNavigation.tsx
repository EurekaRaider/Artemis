import {
  imAggregateConnectionStates,
  type ImConnectionState,
  type ImConnectionStatus,
} from "@artemis/protocol";

export type ImChannel = ImConnectionStatus["channel"];
export type ImView =
  ImChannel | "gateway" | "pairing" | "permissions" | "spaces" | "setup-guide";
export type ImTranslate = (cn: string, en: string) => string;
export const IM_CHANNELS = ["wecom", "feishu", "slack"] as const;
export function imChannelLabel(channel: ImChannel, t: ImTranslate) {
  return channel === "wecom"
    ? t("企业微信", "WeCom")
    : channel === "feishu"
      ? t("飞书 / Lark", "Feishu / Lark")
      : "Slack";
}
export function imChannelConstraint(channel: ImChannel, t: ImTranslate) {
  return channel === "feishu"
    ? t("长连接或 HTTPS 回调", "Long connection or HTTPS callback")
    : channel === "wecom"
      ? t("长连接 · 无需公网地址", "Long connection · No public URL")
      : t("Socket Mode · Manifest 导入", "Socket Mode · Import manifest");
}
export function imConnectionLabel(
  state: ImConnectionState | undefined,
  t: ImTranslate,
) {
  return state === "connected"
    ? t("已连接", "Connected")
    : state === "connecting"
      ? t("连接中", "Connecting")
      : state === "saving"
        ? t("保存中", "Saving")
        : state === "saved"
          ? t("已保存，待连接", "Saved, awaiting connection")
          : state === "error"
            ? t("连接错误", "Connection error")
            : state === "partial_error"
              ? t("部分连接异常", "Partial connection failure")
              : t("未配置", "Not configured");
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
    ? t(
        `${total} 个连接，${failed} 个异常`,
        `${total} connections, ${failed} failed`,
      )
    : t(`${total} 个连接`, `${total} connections`);
}
