import { formatWorkedDuration } from "../conversation/turn-timeline.js";
import { ArtemisIcon, RunningArc } from "@artemis/ui/icons";
import { useEffect, useState } from "react";
import type { AppLocale, ImStatus } from "@artemis/protocol";
import { uiText, type UiMessageKey } from "../../shared/i18n/ui-text.js";

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
  const [now, setNow] = useState(Date.now);
  const counting = waits.some(
    (wait) => wait.state === "waiting" && wait.deadline !== undefined,
  );
  useEffect(() => {
    if (!counting) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [counting]);
  const [pending, setPending] = useState<string>();
  const [notice, setNotice] = useState<
    { key: UiMessageKey } | { error: string }
  >();
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
              {wait.state === "waiting" ? (
                <RunningArc size={16} />
              ) : (
                <ArtemisIcon
                  name={wait.state === "ready" ? "check" : "alert"}
                  width={16}
                  height={16}
                />
              )}
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
              {wait.state === "waiting" && wait.deadline !== undefined && (
                <time
                  className="im-delegation-countdown"
                  title={uiText(locale, "Review02.waitRemaining")}
                >
                  {formatWorkedDuration(
                    Math.max(0, wait.deadline - now),
                    locale,
                  )}
                </time>
              )}
              <ArtemisIcon name="chevron" width={12} height={12} />
            </summary>
            <p>{wait.continuation}</p>
            {wait.reason && <p>{wait.reason}</p>}
            {wait.state === "interrupted" && (
              <p>{uiText(locale, "ImDelegation.retryHint")}</p>
            )}
            {wait.state === "interrupted" && (
              <button
                type="button"
                disabled={!!pending}
                className="im-delegation-continue"
                onClick={async () => {
                  setPending(wait.id);
                  setNotice(undefined);
                  try {
                    await window.artemis.manageIm({
                      action: "delegation-stop-wait",
                      waitId: wait.id,
                    });
                    setNotice({ key: "ImDelegation.waitStopped" });
                  } catch (error) {
                    setNotice({
                      error:
                        error instanceof Error ? error.message : String(error),
                    });
                  } finally {
                    setPending(undefined);
                  }
                }}
              >
                {uiText(locale, "ImDelegation.stopWaiting")}
              </button>
            )}
            {wait.canContinue && (
              <button
                type="button"
                disabled={!!pending}
                className="im-delegation-continue"
                onClick={async () => {
                  setPending(wait.id);
                  setNotice(undefined);
                  try {
                    await window.artemis.manageIm({
                      action: "delegation-continue-wait",
                      waitId: wait.id,
                    });
                  } catch (error) {
                    setNotice({
                      error:
                        error instanceof Error ? error.message : String(error),
                    });
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
              setNotice(undefined);
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
                    ? undefined
                    : { key: "ImDelegation.cancelSent" },
                );
              } catch (error) {
                setNotice({
                  error: error instanceof Error ? error.message : String(error),
                });
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
          {"key" in notice ? uiText(locale, notice.key) : notice.error}
        </p>
      )}
    </>
  );
}
