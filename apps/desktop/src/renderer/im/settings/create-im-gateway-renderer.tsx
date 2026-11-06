import { type Status } from "./im-settings-values.js";

import { type ImSettings } from "@artemis/protocol";
import { Button } from "@artemis/ui/actions";

import { type ImView, type ImChannel } from "../ImNavigation";

interface CreateImGatewayRendererContext {
  readonly activeSettings: {
    enabled: boolean;
    gatewayUrl: string;
    deviceId: string;
    deviceName: string;
    defaultProjectId: string;
    grants: {
      projectId: string;
      policyVersion?: string | undefined;
      tokenBudget?: number | undefined;
      approval: "ask" | "automatic";
      mode: "codemode" | "plan" | "work";
      network: boolean;
      shell: boolean;
      groups: string[];
      expiresAt: number;
      security?:
        | {
            version: 2;
            revision: string;
            confirmedAt: number;
            scopes: {
              audience: string;
              revision?: string | undefined;
              contextRevision?: string | undefined;
              confirmedAt?: number | undefined;
              localAccess?: "full" | "project" | undefined;
              readMode?: "project" | "selected" | undefined;
              writeMode?: "project" | "selected" | undefined;
              spaceRevision?: string | undefined;
              filePaths?: string[] | undefined;
              readPaths: string[];
              writePaths: string[];
            }[];
          }
        | undefined;
    }[];
  };
  readonly status: Status | undefined;
  readonly t: import("../../../shared/i18n/ui-text.js").UiTranslate;
  readonly busy: boolean;
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
  readonly setShowRemote: import("react").Dispatch<
    import("react").SetStateAction<boolean>
  >;
  readonly setAdminToken: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
  readonly setMessage: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
  readonly channel: ImChannel;
  readonly selectView: (
    next: ImView | "guide" | "flow" | "overview" | "group",
  ) => void;
  readonly setFocusTarget: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
  readonly run: (action: () => Promise<unknown>) => Promise<boolean>;
}
export function createImGatewayRenderer(
  context: CreateImGatewayRendererContext,
) {
  const {
    activeSettings,
    status,
    t,
    busy,
    setStatus,
    setSettings,
    setUrl,
    setName,
    setShowRemote,
    setAdminToken,
    setMessage,
    channel,
    selectView,
    setFocusTarget,
    run,
  } = context;
  function renderGatewayBody() {
    const settings = activeSettings;
    const gatewayReady = status?.localGateway?.state === "running";
    return (
      <>
        {/* 顶部信息区随提示内容自适应高度。 */}
        <div className="im-service-meta">
          {/* 就绪后不再展示禁用态按钮，只留提示。 */}
          {!gatewayReady && (
            <Button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const current = (await window.artemis.manageIm({
                    action: "setup-local",
                  })) as Status;
                  setStatus(current);
                  setSettings(current.settings);
                  setUrl(current.settings.gatewayUrl);
                  setName(current.settings.deviceName);
                  setShowRemote(false);
                  setAdminToken("");
                  setMessage(t("ImSettingsPanel.message42"));
                  selectView(channel);
                  setFocusTarget("im-bot");
                })
              }
            >
              {t("Review02.startService")}
            </Button>
          )}
        </div>
      </>
    );
  }
  return { renderGatewayBody };
}
