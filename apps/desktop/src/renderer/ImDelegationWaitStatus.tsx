import { ArtemisIcon } from "@artemis/ui/icons";
import { useState } from "react";
import type { AppLocale, ImStatus } from "@artemis/protocol";
import { uiText } from "../shared/ui-text.js";

type Wait = NonNullable<
  NonNullable<ImStatus["remoteTasks"]>[number]["delegationWaits"]
>[number];
export function ImDelegationWaitStatus({
  waits,
  locale,
}: {
  waits: Wait[];
  locale: AppLocale;
}) {
  const [pending, setPending] = useState<string>();
  const [notice, setNotice] = useState("");
  return (
    <>
      {waits.map((wait) => (
        <div
          key={wait.id}
          className="im-delegation-wait"
          data-state={wait.state}
        >
          <details open={wait.state === "interrupted" ? true : undefined}>
            <summary
              title={uiText(
                locale,
                wait.state === "interrupted"
                  ? "ImDelegation.interrupted"
                  : wait.state === "ready"
                    ? "ImDelegation.ready"
                    : "ImDelegation.waiting",
              )}
            >
              <span className="im-delegation-dot" aria-hidden="true" />
              <span className="im-delegation-label">
                {uiText(
                  locale,
                  wait.state === "interrupted"
                    ? "ImDelegation.interrupted"
                    : wait.state === "ready"
                      ? "ImDelegation.ready"
                      : "ImDelegation.waitingShort",
                )}
              </span>
              {(wait.reason || wait.continuation).trim() && (
                <span
                  className="im-delegation-preview"
                  title={wait.reason || wait.continuation}
                >
                  · {wait.reason || wait.continuation}
                </span>
              )}
              <ArtemisIcon name="chevron" width={12} height={12} />
            </summary>
            <p>{wait.continuation}</p>
            {wait.reason && <p>{wait.reason}</p>}
            {wait.state === "interrupted" && (
              <p>{uiText(locale, "ImDelegation.retryHint")}</p>
            )}
            {wait.canContinue && (
              <button
                type="button"
                disabled={!!pending}
                className="im-delegation-continue"
                onClick={async () => {
                  setPending(wait.id);
                  setNotice("");
                  try {
                    await window.artemis.manageIm({
                      action: "delegation-continue-wait",
                      waitId: wait.id,
                    });
                  } catch (error) {
                    setNotice(
                      error instanceof Error ? error.message : String(error),
                    );
                  } finally {
                    setPending(undefined);
                  }
                }}
              >
                {uiText(locale, "ImDelegation.continueWaiting")}
              </button>
            )}
          </details>
          <button
            className="im-delegation-cancel"
            aria-label={uiText(
              locale,
              wait.state === "interrupted"
                ? "ImDelegation.retry"
                : "ImDelegation.cancel",
            )}
            title={uiText(
              locale,
              wait.state === "interrupted"
                ? "ImDelegation.retry"
                : "ImDelegation.cancel",
            )}
            type="button"
            disabled={!!pending}
            onClick={async () => {
              setPending(wait.id);
              setNotice("");
              try {
                await window.artemis.manageIm({
                  action:
                    wait.state === "interrupted"
                      ? "delegation-retry"
                      : "delegation-cancel",
                  waitId: wait.id,
                });
                setNotice(
                  wait.state === "interrupted"
                    ? ""
                    : uiText(locale, "ImDelegation.cancelSent"),
                );
              } catch (error) {
                setNotice(
                  error instanceof Error ? error.message : String(error),
                );
              } finally {
                setPending(undefined);
              }
            }}
          >
            {wait.state === "interrupted" ? (
              uiText(locale, "ImDelegation.retry")
            ) : (
              <ArtemisIcon name="close" width={14} height={14} />
            )}
          </button>
        </div>
      ))}
      {notice && (
        <p className="im-delegation-notice" role="status">
          {notice}
        </p>
      )}
    </>
  );
}
