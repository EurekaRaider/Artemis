import { type ImIdentity } from "@artemis/protocol";

interface CreateImIdentityActionsContext {
  readonly refresh: () => Promise<void>;
  readonly t: import("../../../shared/i18n/ui-text.js").UiTranslate;
  readonly setMessage: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
  readonly flowAdvanceFrom: () => void;
  readonly setChannelDetail: import("react").Dispatch<
    import("react").SetStateAction<boolean>
  >;
  readonly setChannelPane: import("react").Dispatch<
    import("react").SetStateAction<
      "bot" | "create" | "guide" | "import" | "verify"
    >
  >;
  readonly setFocusTarget: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
  readonly verifyTouched: import("react").RefObject<boolean>;
  readonly run: (action: () => Promise<unknown>) => Promise<boolean>;
}
export function createImIdentityActions(
  context: CreateImIdentityActionsContext,
) {
  const {
    refresh,
    t,
    setMessage,
    setChannelDetail,
    setChannelPane,
    setFocusTarget,
    verifyTouched,
    run,
  } = context;
  const resolvePairing = (requestId: string, approve: boolean) =>
    run(async () => {
      await window.artemis.manageIm({
        action: "resolve-pairing",
        requestId,
        approve,
      });
      await refresh();
      setMessage(
        approve
          ? t("ImSettingsPanel.message25")
          : t("ImSettingsPanel.message24"),
      );
      if (approve) {
        context.flowAdvanceFrom();
        /* 首绑自动跳到②尾「顺手验证」页（用户动过后不再抢跳）。 */
        if (!verifyTouched.current) {
          setChannelDetail(true);
          setChannelPane("verify");
          setFocusTarget("im-verify");
        }
      }
    });
  const unpairIdentity = (identity: ImIdentity) =>
    run(async () => {
      await window.artemis.manageIm({ action: "unpair", identity });
      await refresh();
      setMessage(t("ImSettingsPanel.message26"));
    });
  return { resolvePairing, unpairIdentity };
}
