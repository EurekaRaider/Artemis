import { useRef, useState, type KeyboardEvent } from "react";
import type { ImConnectionStatus } from "@artemis/protocol";
import { Popover } from "@artemis/ui/feedback";

export type ImChannel = ImConnectionStatus["channel"];
export type ImView =
  ImChannel | "gateway" | "pairing" | "permissions" | "spaces";
export type ImTranslate = (cn: string, en: string) => string;
export const IM_CHANNELS = ["wecom", "feishu", "slack"] as const;
export function imChannelLabel(channel: ImChannel, t: ImTranslate) {
  return channel === "wecom"
    ? t("企业微信", "WeCom")
    : channel === "feishu"
      ? t("飞书", "Feishu")
      : "Slack";
}
export function imChannelConstraint(channel: ImChannel, t: ImTranslate) {
  return channel === "feishu"
    ? t("需公网 HTTPS 回调 · 团队服务", "Public HTTPS callback · Team Gateway")
    : channel === "wecom"
      ? t("长连接 · 无需公网地址", "Long connection · No public URL")
      : t("Socket Mode · Manifest 导入", "Socket Mode · Import manifest");
}
export function imConnectionLabel(
  state: ImConnectionStatus["state"] | undefined,
  t: ImTranslate,
) {
  return state === "connected"
    ? t("已连接", "Connected")
    : state === "connecting"
      ? t("连接中", "Connecting")
      : state === "error"
        ? t("连接错误", "Connection error")
        : state === "disabled"
          ? t("已停用", "Disabled")
          : t("未配置", "Not configured");
}
export function ImNavigation({
  view,
  onSelect,
  connections,
  compact,
  t,
  busy = false,
}: {
  view: ImView;
  onSelect(view: ImView): void;
  connections: ImConnectionStatus[];
  compact: boolean;
  busy?: boolean;
  t: ImTranslate;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const common = [
    { id: "gateway", label: t("Gateway 与设备", "Gateway & device") },
    { id: "pairing", label: t("配对与账号", "Pairing & accounts") },
    { id: "permissions", label: t("项目授权", "Project permissions") },
    { id: "spaces", label: t("群协作空间", "Group spaces") },
  ] as const;
  const options = [
    ...IM_CHANNELS.map((id) => ({ id, label: imChannelLabel(id, t) })),
    ...common,
  ];
  const commonSelected = common.some((item) => item.id === view);
  function navigate(event: KeyboardEvent, selector: string) {
    const keys = [
      "ArrowDown",
      "ArrowUp",
      "ArrowLeft",
      "ArrowRight",
      "Home",
      "End",
    ];
    if (busy || !keys.includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const items = [
      ...event.currentTarget.querySelectorAll<HTMLElement>(selector),
    ];
    const current = items.indexOf(document.activeElement as HTMLElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : (current +
              (event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 1) +
              items.length) %
            items.length;
    items[next]?.focus();
    if (items[next]?.getAttribute("role") === "tab") items[next]?.click();
  }
  return (
    <div
      className="im-channel-list"
      role="tablist"
      aria-label={t("消息接入导航", "Message integration navigation")}
      aria-orientation={compact ? "horizontal" : "vertical"}
      onKeyDown={(event) => navigate(event, '[role="tab"], .im-common-trigger')}
    >
      {options
        .filter(
          (item) => !compact || IM_CHANNELS.includes(item.id as ImChannel),
        )
        .map((item, index) => {
          const channel = IM_CHANNELS.includes(item.id as ImChannel);
          const channelConnections = connections.filter(
            (c) => c.channel === item.id,
          );
          const connection =
            channelConnections.find((c) => c.state === "connected") ??
            channelConnections[0];
          return (
            <div className="im-nav-item" key={item.id} role="presentation">
              {!compact && (index === 0 || index === 3) && (
                <span className="im-nav-label" role="presentation">
                  {index === 0 ? t("渠道", "Channels") : t("通用", "General")}
                </span>
              )}
              <button
                disabled={busy}
                type="button"
                id={`im-nav-${item.id}`}
                className="im-channel-card"
                role="tab"
                aria-selected={view === item.id}
                aria-controls={`im-panel-${item.id}`}
                tabIndex={view === item.id ? 0 : -1}
                onClick={() => onSelect(item.id)}
              >
                <span>
                  {channel && (
                    <span
                      aria-hidden="true"
                      className="im-dot"
                      data-state={connection?.state}
                    />
                  )}
                  {item.label}
                </span>
                {channel && !compact && (
                  <small>{imConnectionLabel(connection?.state, t)}</small>
                )}
              </button>
            </div>
          );
        })}
      {compact && (
        <>
          <button
            disabled={busy}
            type="button"
            ref={anchor}
            className="im-common-trigger"
            id={commonSelected ? `im-nav-${view}` : "im-common-trigger"}
            role="tab"
            aria-selected={commonSelected}
            aria-controls={commonSelected ? `im-panel-${view}` : undefined}
            tabIndex={commonSelected ? 0 : -1}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(!menuOpen)}
          >
            {common.find((item) => item.id === view)?.label ??
              t("通用", "General")}{" "}
            ▾
          </button>
          <Popover
            anchorRef={anchor}
            portalContainer={anchor.current?.closest("dialog")}
            label={t("通用设置", "General settings")}
            role="menu"
            open={menuOpen}
            onOpenChange={setMenuOpen}
            className="im-common-menu"
            onKeyDown={(event) => navigate(event, '[role="menuitem"]')}
          >
            {common.map((item) => (
              <button
                disabled={busy}
                type="button"
                key={item.id}
                role="menuitem"
                onClick={() => {
                  onSelect(item.id);
                  setMenuOpen(false);
                }}
              >
                {item.label}
              </button>
            ))}
          </Popover>
        </>
      )}
    </div>
  );
}
