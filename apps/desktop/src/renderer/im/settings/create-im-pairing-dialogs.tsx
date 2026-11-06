import { type Status } from "./im-settings-values.js";

import { type ImConnectionStatus, type ImSettings } from "@artemis/protocol";

import { Dialog } from "@artemis/ui/feedback";

import { ImPairingCode, type ImPairCode } from "../ImAccountControls";

interface CreateImPairingDialogsContext {
  readonly botDialog: { connectionId?: string } | null;
  readonly t: import("../../../shared/i18n/ui-text.js").UiTranslate;
  readonly dialogConnection: ImConnectionStatus | undefined;
  readonly dismissBotDialog: (savedId?: string) => void;
  readonly renderBotForm: (
    cancel: (savedId: string) => void,
  ) => import("react").JSX.Element;
  readonly botDialogTrigger: import("react").RefObject<HTMLButtonElement | null>;
  readonly pairDialogId: string;
  readonly pairCode: ImPairCode | undefined;
  readonly activePairingPlatform: string;
  readonly busy: boolean;
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
  readonly generatePairCode: () => Promise<void>;
  readonly run: (action: () => Promise<unknown>) => Promise<boolean>;
  readonly refresh: () => Promise<void>;
  readonly pairDialogTrigger: import("react").RefObject<HTMLButtonElement | null>;
  readonly setPairDialogId: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
  readonly pendingRequests: import("react").JSX.Element;
  readonly pairingPlatformLabel: string;
  readonly setMessage: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
  readonly setDiagnostics: import("react").Dispatch<
    import("react").SetStateAction<unknown | undefined>
  >;
  readonly setStatus: import("react").Dispatch<
    import("react").SetStateAction<Status | undefined>
  >;
  readonly setSettings: import("react").Dispatch<
    import("react").SetStateAction<ImSettings | undefined>
  >;
}
export function createImPairingDialogs(context: CreateImPairingDialogsContext) {
  const {
    botDialog,
    t,
    dialogConnection,
    dismissBotDialog,
    renderBotForm,
    botDialogTrigger,
    pairDialogId,
    pairCode,
    activePairingPlatform,
    busy,
    activeSettings,
    generatePairCode,
    run,
    refresh,
    pairDialogTrigger,
    setPairDialogId,
    pendingRequests,
    pairingPlatformLabel,
    setMessage,
    setDiagnostics,
    setStatus,
    setSettings,
  } = context;
  function renderBotDialog() {
    /* 更换凭据弹窗（新建已改右栏创建页）：与创建页共用同一表单体。 */
    return (
      <>
        {botDialog && (
          <Dialog
            className="im-bot-dialog"
            label={
              dialogConnection
                ? t("ImSettingsPanel.message97", {
                    value1: dialogConnection.name,
                  })
                : t("ImSettingsPanel.message76")
            }
            returnFocusRef={botDialogTrigger}
            onOpenChange={(open) => {
              if (!open) dismissBotDialog();
            }}
            open
          >
            <header>
              <h2>
                {dialogConnection
                  ? t("ImSettingsPanel.message77", {
                      value1: dialogConnection.name,
                    })
                  : t("ImSettingsPanel.message76")}
              </h2>
            </header>
            <div className="im-bot-dialog-body">
              {renderBotForm(dismissBotDialog)}
            </div>
          </Dialog>
        )}
      </>
    );
  }
  function renderPairDialog() {
    return (
      <>
        {pairDialogId && (
          <ImPairingCode
            t={t}
            pair={pairCode}
            slack={activePairingPlatform === "slack"}
            busy={busy || !activeSettings.deviceId}
            generate={() => void run(generatePairCode)}
            onPoll={() => void run(refresh)}
            returnFocusRef={pairDialogTrigger}
            onClose={() => setPairDialogId("")}
            requests={pendingRequests}
            guide={
              <div className="im-pair-guide">
                <p>
                  {t("ImSettingsPanel.message101", {
                    value1: pairingPlatformLabel,
                  })}
                </p>
                <ol>
                  <li>
                    {activePairingPlatform === "slack"
                      ? t("ImSettingsPanel.message103")
                      : t("ImSettingsPanel.message102", {
                          value1: pairingPlatformLabel,
                        })}
                  </li>
                  <li>
                    {activePairingPlatform === "wecom"
                      ? t("ImSettingsPanel.message106")
                      : activePairingPlatform === "slack"
                        ? t("ImSettingsPanel.message105")
                        : t("ImSettingsPanel.message104", {
                            value1: pairingPlatformLabel,
                          })}
                  </li>
                  <li>{t("ImSettingsPanel.message107")}</li>
                </ol>
              </div>
            }
            copy={(text) =>
              void run(async () => {
                await navigator.clipboard.writeText(text);
                setMessage(t("ImSettingsPanel.message108"));
              })
            }
          />
        )}
      </>
    );
  }
  async function refreshGroups() {
    await window.artemis.manageIm({
      action: "admin",
      operation: "refresh-groups",
    });
    const [next, current] = await Promise.all([
      window.artemis.manageIm({ action: "admin", operation: "status" }),
      window.artemis.manageIm({ action: "refresh" }),
    ]);
    setDiagnostics(next);
    setStatus(current as Status);
    setSettings((current as Status).settings);
  }
  return { renderBotDialog, renderPairDialog, refreshGroups };
}
