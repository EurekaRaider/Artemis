import type { Status } from "./im-settings-values.js";
import { Button } from "@artemis/ui/actions";

import { Checkbox } from "@artemis/ui/forms";

import { ImFirstTaskInstructions } from "../ImSetupGuide";

import { imWriteVerify, type ImVerifyState } from "../im-flow-derive";
import { type ImView, type ImChannel } from "../ImNavigation";

interface CreateImVerificationRendererContext {
  readonly status: Status | undefined;
  readonly t: import("../../../shared/i18n/ui-text.js").UiTranslate;
  readonly activePairingPlatform: string;
  readonly taskDetected: boolean;
  readonly verify: ImVerifyState;
  readonly busy: boolean;
  readonly setVerify: import("react").Dispatch<
    import("react").SetStateAction<ImVerifyState>
  >;
  readonly channel: ImChannel;
  readonly selectView: (
    next: ImView | "guide" | "flow" | "overview" | "group",
  ) => void;
}
export function createImVerificationRenderer(
  context: CreateImVerificationRendererContext,
) {
  const {
    status,
    t,
    activePairingPlatform,
    taskDetected,
    verify,
    busy,
    setVerify,
    channel,
    selectView,
  } = context;
  function renderVerifyBody() {
    const deviceId = status?.settings.deviceId;
    return (
      <div id="im-verify-body" className="im-verify-body">
        <section id="im-test" tabIndex={-1}>
          <ImFirstTaskInstructions
            t={t}
            slack={activePairingPlatform === "slack"}
            copy={(text) => void navigator.clipboard.writeText(text)}
          />
        </section>
        {/* D4 诚实版轨道：仅「桌面出现任务」由系统检测，完成与回复以用户确认为准。 */}
        <ol
          className="im-test-track"
          aria-label={t("ImSettingsPanel.message174")}
        >
          <li data-state="guide">{t("ImSettingsPanel.message167")}</li>
          <li data-state={taskDetected ? "done" : "pending"}>
            {taskDetected
              ? t("ImSettingsPanel.message169")
              : t("ImSettingsPanel.message168")}
          </li>
          <li data-state={verify.confirmed ? "done" : "pending"}>
            {verify.confirmed
              ? t("ImSettingsPanel.message171")
              : t("ImSettingsPanel.message170")}
          </li>
          <li data-state={verify.confirmed ? "done" : "pending"}>
            {verify.confirmed
              ? t("ImSettingsPanel.message173")
              : t("ImSettingsPanel.message172")}
          </li>
        </ol>
        <Checkbox
          label={t("ImSettingsPanel.message175")}
          checked={verify.confirmed}
          disabled={busy || !deviceId}
          onCheckedChange={(checked) => {
            const next = {
              confirmed: checked,
              channel: checked ? activePairingPlatform : undefined,
            };
            imWriteVerify(deviceId, next);
            setVerify(next);
          }}
        />
        {channel !== "wecom" && (
          <Button variant="quiet" onClick={() => selectView("spaces")}>
            {t("ImSettingsPanel.message176")}
          </Button>
        )}
      </div>
    );
  }
  return { renderVerifyBody };
}
