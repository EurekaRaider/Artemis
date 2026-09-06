import { useEffect, useState } from "react";
import type { AppLocale, ImDevicePresence } from "@artemis/protocol";
import { ArtemisIcon } from "@artemis/ui/icons";

const unknownDevices: ImDevicePresence = { mobile: false, desktop: true };

export function useImThreadDevices() {
  const [devices, setDevices] = useState<Record<string, ImDevicePresence>>({});
  useEffect(() => {
    let mounted = true;
    let pending = false;
    const refresh = async () => {
      if (pending || document.hidden) return;
      pending = true;
      try {
        const status = await window.artemis.getImStatus();
        if (mounted) {
          const next = Object.fromEntries(
            (status.remoteTasks ?? []).map((task) => [
              task.threadId,
              task.devicePresence ?? unknownDevices,
            ]),
          );
          setDevices((current) =>
            Object.keys(current).length === Object.keys(next).length &&
            Object.entries(next).every(
              ([id, value]) =>
                current[id]?.mobile === value.mobile &&
                current[id]?.desktop === value.desktop,
            )
              ? current
              : next,
          );
        }
      } catch {
        // Keep known IM identities during a temporary status lookup failure.
      } finally {
        pending = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2000);
    const unsubscribe = window.artemis.onImTaskCreated?.((thread) => {
      setDevices((current) => ({ ...current, [thread.id]: unknownDevices }));
    });
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      mounted = false;
      window.clearInterval(timer);
      unsubscribe?.();
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  return devices;
}

export function ImThreadDevices({
  devices,
  locale,
}: {
  devices: ImDevicePresence;
  locale: AppLocale;
}) {
  const zh = locale.startsWith("zh");
  const label = (device: "mobile" | "desktop") => {
    const name = zh
      ? device === "mobile"
        ? "手机"
        : "电脑"
      : device === "mobile"
        ? "Phone"
        : "Computer";
    return `${name}${zh ? (devices[device] ? "已连接" : "未连接") : devices[device] ? " connected" : " disconnected"}`;
  };
  const summary = `${label("mobile")} · ${label("desktop")}`;
  return (
    <span
      aria-label={summary}
      className="im-thread-devices"
      role="img"
      title={summary}
    >
      <ArtemisIcon
        data-connected={devices.mobile}
        name="mobile"
        width={12}
        height={12}
      />
      <ArtemisIcon
        data-connected={devices.desktop}
        name="monitor"
        width={12}
        height={12}
      />
    </span>
  );
}
