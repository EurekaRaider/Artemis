import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@artemis/ui/actions";
import { Select } from "@artemis/ui/forms";
import { InlineNotice } from "@artemis/ui/feedback";
import type { AppLocale } from "@artemis/protocol";
import { getAppearanceController } from "./appearance-controller.js";

export function AppearanceSettingsSection({
  locale,
}: {
  readonly locale: AppLocale;
}) {
  if (typeof window.artemis?.getAppearanceState !== "function") return null;
  return <ConnectedAppearanceSettingsSection locale={locale} />;
}
function ConnectedAppearanceSettingsSection({
  locale,
}: {
  readonly locale: AppLocale;
}) {
  const controller = getAppearanceController();
  const view = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const [error, setError] = useState("");
  const chinese = locale.startsWith("zh");
  const selected =
    view.preview === undefined ? view.state?.selection : view.preview;
  const value = selected
    ? `${selected.pluginId}/${selected.skinId}`
    : "default";
  useEffect(
    () => () => {
      if (controller.snapshot().preview !== undefined)
        void controller.cancelPreview();
    },
    [controller],
  );
  if (!view.state) return null;
  async function run(action: () => Promise<unknown>) {
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  return (
    <div className="appearance-settings">
      <Select<string>
        label={chinese ? "视觉皮肤" : "Visual skin"}
        value={value}
        disabled={view.busy}
        options={[
          {
            value: "default",
            label: chinese ? "Artemis 默认" : "Artemis default",
          },
          ...view.state.catalog.map((s) => ({
            value: `${s.pluginId}/${s.id}`,
            label: `${s.name} · ${s.version} · ${s.pluginName}${s.available ? "" : chinese ? "（不可用）" : " (unavailable)"}`,
            disabled: !s.available,
          })),
        ]}
        onValueChange={(key) =>
          void run(() => {
            const skin = view.state?.catalog.find(
              (s) => `${s.pluginId}/${s.id}` === key,
            );
            return controller.preview(
              skin ? { pluginId: skin.pluginId, skinId: skin.id } : null,
            );
          })
        }
      />
      <div className="appearance-settings-actions">
        <Button
          disabled={view.busy || view.preview === undefined}
          onClick={() => void run(() => controller.confirmPreview())}
        >
          {chinese ? "应用皮肤" : "Apply skin"}
        </Button>
        <Button
          disabled={view.busy || view.preview === undefined}
          variant="quiet"
          onClick={() => void run(() => controller.cancelPreview())}
        >
          {chinese ? "取消预览" : "Cancel preview"}
        </Button>
        <Button
          disabled={view.busy}
          variant="quiet"
          onClick={() => void run(() => controller.reset())}
        >
          {chinese ? "恢复默认" : "Restore default"}
        </Button>
      </div>
      {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}
      {view.diagnostics.map((message) => (
        <InlineNotice key={message} tone="warning">
          {message}
        </InlineNotice>
      ))}
      <p className="appearance-settings-hint">
        {chinese
          ? "预览仅作用于当前窗口；应用后将在重启时恢复。皮肤来自已安装插件，可在资源中心管理。"
          : "Preview applies to this window. Applied skins are restored at startup. Manage skin plugins in Resources."}
      </p>
    </div>
  );
}
