import { useEffect, useState } from "react";
import { Button } from "@artemis/ui/actions";
import { LoadingState } from "@artemis/ui/feedback";
import { ArtemisIcon } from "@artemis/ui/icons";
import type { AppLocale, ComputerControlState } from "@artemis/protocol";
import "./computer-use.css";
import { uiText, type UiMessageKey } from "../../shared/i18n/ui-text.js";
import { COMPUTER_USE_RESOURCES } from "../../shared/i18n/computer-use-resources.js";
import type { ComputerPermission } from "../../shared/api.js";

const reasonKeys: Readonly<Record<string, UiMessageKey>> = {
  "Permission revoked": "ComputerUse.reasonPermissionRevoked",
  "Task permission revoked": "ComputerUse.reasonTaskPermissionRevoked",
  "Task stopped": "ComputerUse.reasonTaskStopped",
  "Computer Use disabled": "ComputerUse.reasonDisabled",
  "User took control": "ComputerUse.reasonTakeover",
  "User paused control": "ComputerUse.reasonPaused",
  "Native Stop button pressed": "ComputerUse.reasonStopped",
  "Native control was stopped": "ComputerUse.reasonActionStopped",
  "User input during foreground control": "ComputerUse.reasonForegroundInput",
  "User keyboard input in the target application":
    "ComputerUse.reasonKeyboardInput",
  "User pointer input in the target application":
    "ComputerUse.reasonPointerInput",
  Released: "ComputerUse.reasonReleased",
  "Turn ended": "ComputerUse.reasonTurnEnded",
  "MCP call cancelled": "ComputerUse.reasonCallCancelled",
  "Artemis window closed": "ComputerUse.reasonWindowClosed",
  "Artemis renderer stopped": "ComputerUse.reasonRendererStopped",
  "Unable to observe the target. Reopen it to retry.":
    "ComputerUse.reasonObserveFailed",
  "Computer action exceeded 3 seconds. Resume control before retrying.":
    "ComputerUse.reasonTimeout",
  "Computer action stopped. Resume control before reopening the target.":
    "ComputerUse.reasonActionStopped",
};

export function ComputerUseControls({
  locale,
  permissionsOnly = false,
}: {
  locale: AppLocale;
  permissionsOnly?: boolean;
  nativeGlass?: boolean;
}) {
  const copy = COMPUTER_USE_RESOURCES[locale];
  const [state, setState] = useState<ComputerControlState>({
    version: 1,
    state: "idle",
  });
  const [permissions, setPermissions] = useState<
    ComputerPermission[] | undefined
  >();
  const [error, setError] = useState<string>();
  const active = !permissionsOnly && state.state !== "idle";
  const reasonKey =
    state.reason && Object.hasOwn(reasonKeys, state.reason)
      ? reasonKeys[state.reason]
      : undefined;
  const [elapsed, setElapsed] = useState(0);
  const [takenOver, setTakenOver] = useState(false);
  useEffect(() => {
    setElapsed(0);
    setTakenOver(false);
  }, [state.threadId, state.target?.name]);
  useEffect(() => {
    if (!active || state.state === "paused") return;
    const timer = window.setInterval(
      () => setElapsed((value) => value + 1),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [active, state.state]);
  useEffect(() => {
    if (permissionsOnly || !window.artemis.onComputerState) return;
    let live = true;
    let received = false;
    const unsubscribe = window.artemis.onComputerState((value) => {
      received = true;
      setState(value);
    });
    void window.artemis
      .getComputerState()
      .then((value) => {
        if (live && !received) setState(value);
      })
      .catch((e: unknown) => {
        if (live) setError(String(e));
      });
    return () => {
      live = false;
      unsubscribe();
    };
  }, [permissionsOnly]);
  useEffect(() => {
    if (!permissionsOnly) return;
    let live = true;
    void window.artemis.getComputerPermissions().then(
      (value) => {
        if (live) setPermissions(value);
      },
      (error: unknown) => {
        if (live)
          setError(error instanceof Error ? error.message : String(error));
      },
    );
    return () => {
      live = false;
    };
  }, [permissionsOnly]);
  const run = (operation: () => Promise<unknown>) => {
    setError(undefined);
    void operation().catch((e: unknown) =>
      setError(e instanceof Error ? e.message : String(e)),
    );
  };
  if (!permissionsOnly && state.state === "idle") return null;
  return (
    <aside
      className={permissionsOnly ? "computer-permissions" : "computer-control"}
      aria-label={uiText(locale, "ComputerUse.title")}
    >
      {!permissionsOnly ? (
        <>
          <div className="computer-control-status" role="status">
            <ArtemisIcon name="monitor" aria-hidden="true" />
            <span className="computer-control-timer">
              {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}
            </span>
            <span className="computer-control-summary">
              <span
                className="computer-control-name"
                title={state.target?.name}
              >
                {uiText(locale, "ComputerUse.title")}
                {state.target?.name ? ` · ${state.target.name}` : ""}
              </span>
              <span className="computer-control-mode">
                {state.state === "paused"
                  ? copy.paused
                  : state.foreground
                    ? copy.foreground
                    : copy.background}
              </span>
            </span>
          </div>
          {state.reason ? (
            <span className="computer-control-reason">
              {reasonKey ? uiText(locale, reasonKey) : state.reason}
            </span>
          ) : null}
          <div className="computer-control-actions">
            {state.state !== "paused" ? (
              <>
                <Button
                  variant="quiet"
                  icon={<ArtemisIcon name="pause" />}
                  onClick={() =>
                    run(async () => {
                      if (state.threadId)
                        await window.artemis.controlComputer(
                          "stop",
                          state.threadId,
                        );
                    })
                  }
                >
                  {uiText(locale, "ComputerUse.pause")}
                </Button>
                <Button
                  variant="quiet"
                  icon={<ArtemisIcon name="cursor" />}
                  onClick={() =>
                    run(async () => {
                      if (state.threadId) {
                        await window.artemis.controlComputer(
                          "stop",
                          state.threadId,
                        );
                        setTakenOver(true);
                      }
                    })
                  }
                >
                  {uiText(locale, "ComputerUse.takeOver")}
                </Button>
              </>
            ) : (
              <Button
                variant="quiet"
                icon={<ArtemisIcon name="play" />}
                onClick={() =>
                  run(async () => {
                    if (state.threadId) {
                      await window.artemis.controlComputer(
                        "resume",
                        state.threadId,
                      );
                      setTakenOver(false);
                    }
                  })
                }
              >
                {takenOver
                  ? uiText(locale, "ComputerUse.returnControl")
                  : copy.resume}
              </Button>
            )}
            <Button
              className="computer-control-stop"
              variant="quiet"
              icon={<ArtemisIcon name="stop" />}
              onClick={() =>
                run(async () => {
                  if (state.threadId)
                    await window.artemis.controlComputer(
                      "stop",
                      state.threadId,
                    );
                })
              }
            >
              {copy.stop}
            </Button>
          </div>
        </>
      ) : null}
      {permissionsOnly && !permissions && !error ? (
        <LoadingState label={copy.permissions} lines={1} />
      ) : null}
      {permissionsOnly && permissions ? (
        permissions.length === 0 ? (
          <p className="computer-permissions-empty">{copy.noPermissions}</p>
        ) : (
          <ul
            className="computer-permissions-list"
            aria-label={copy.permissions}
            role="list"
          >
            {permissions.map((permission) => (
              <li key={permission.id}>
                <span className="computer-permission-name">
                  {permission.name}
                </span>
                <span className="computer-permission-summary">
                  {copy[permission.scope]}
                  {` · ${permission.foreground ? copy.foregroundAllowed : copy.backgroundOnly}`}
                  {permission.threadTitle ? ` · ${permission.threadTitle}` : ""}
                </span>
                <Button
                  variant="quiet"
                  onClick={() =>
                    run(async () => {
                      await window.artemis.revokeComputerPermission(
                        permission.id,
                      );
                      setPermissions(
                        await window.artemis.getComputerPermissions(),
                      );
                    })
                  }
                >
                  {copy.revoke}
                </Button>
              </li>
            ))}
          </ul>
        )
      ) : null}
      {error ? <span role="alert">{error}</span> : null}
    </aside>
  );
}
