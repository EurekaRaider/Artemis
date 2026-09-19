import { useEffect, useState } from "react";
import type { ImConnectionStatus, ImStatus } from "@artemis/protocol";

export type ImLinkState = "ok" | "down";

/**
 * 侧栏 IM 图标联动信号：任一 bot 连接在线=ok，已配置连接但全部掉线=down，
 * 尚未配置连接=null（保持默认色）。轮询节奏与 useImThreadStatus 一致。
 */
export function useImLinkState(): ImLinkState | null {
  const [link, setLink] = useState<ImLinkState | null>(null);
  useEffect(() => {
    let mounted = true;
    let pending = false;
    const refresh = async () => {
      if (pending || document.hidden) return;
      pending = true;
      try {
        const status = (await window.artemis.getImStatus()) as ImStatus & {
          connections?: unknown[];
        };
        const connections = (status.connections ?? []) as ImConnectionStatus[];
        if (mounted)
          setLink(
            connections.length
              ? connections.some(
                  (connection) => connection.state === "connected",
                )
                ? "ok"
                : "down"
              : null,
          );
      } catch {
        // 状态查询失败时保留上一次信号。
      } finally {
        pending = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      mounted = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  return link;
}
