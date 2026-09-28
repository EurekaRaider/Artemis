import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { AppLocale } from "@artemis/protocol";
import { Button } from "@artemis/ui/actions";
import { WorkspaceContentState } from "@artemis/ui/workspace";
import { OfficeCapabilityPanel } from "./OfficeCapabilityPanel.js";
import { officeCopy } from "./office-copy.js";

export function OfficePreviewGate({
  locale,
  children,
}: {
  locale: AppLocale;
  children: ReactNode;
}) {
  const t = officeCopy(locale);
  const [ready, setReady] = useState<boolean>();
  const [error, setError] = useState<string>();
  const [management, setManagement] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const refresh = useCallback(() => setAttempt((value) => value + 1), []);
  useEffect(() => {
    let active = true;
    void window.artemis
      .officeCapabilityStatus()
      .then((status) => {
        if (active) {
          setReady(Boolean(status.activeVersion));
          setError(undefined);
        }
      })
      .catch((reason: unknown) => {
        if (active) {
          setReady(false);
          setError(String(reason));
        }
      });
    return () => {
      active = false;
    };
  }, [attempt]);
  if (ready) return <>{children}</>;
  const label =
    ready === undefined
      ? t.loading
      : locale.startsWith("zh")
        ? "不支持预览，如需预览请升级office功能"
        : "Preview is unavailable. Upgrade Office features to preview this file.";
  return (
    <>
      <WorkspaceContentState
        label={label}
        state={ready === undefined ? "loading" : "empty"}
      >
        <div className="office-preview-upgrade">
          <strong>{label}</strong>
          {ready === false ? (
            <>
              <p>
                {locale.startsWith("zh")
                  ? "点击下方按钮，选择在线安装或导入 .artemis-office 离线包。安装并启用后，将自动打开当前文件。"
                  : "Choose the button below, then install online or import an .artemis-office offline pack. This file opens automatically once the component is active."}
              </p>
              {error ? <p role="alert">{error}</p> : null}
              <Button variant="primary" onClick={() => setManagement(true)}>
                {t.runtime}
              </Button>
              <Button variant="quiet" onClick={refresh}>
                {locale.startsWith("zh")
                  ? "已安装，重新检查"
                  : "Installed? Check again"}
              </Button>
            </>
          ) : null}
        </div>
      </WorkspaceContentState>
      {management ? (
        <OfficeCapabilityPanel
          locale={locale}
          onClose={() => {
            setManagement(false);
            refresh();
          }}
          onInstalledChange={refresh}
        />
      ) : null}
    </>
  );
}
