import { uiText } from "../../shared/i18n/ui-text.js";
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
    const timer = setInterval(refresh, 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [attempt]);
  if (ready) return <>{children}</>;
  const label =
    ready === undefined
      ? t.loading
      : uiText(
          locale,
          "OfficePreviewGate.installTheOfficeSuiteToPreviewThisFile",
        );
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
              <p>{uiText(locale, "OfficePreviewGate.installHint")}</p>
              {error ? <p role="alert">{error}</p> : null}
              <Button variant="primary" onClick={() => setManagement(true)}>
                {t.runtime}
              </Button>
              <Button variant="quiet" onClick={refresh}>
                {uiText(locale, "OfficePreviewGate.installedCheckAgain")}
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
