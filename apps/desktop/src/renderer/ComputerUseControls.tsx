import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@artemis/ui/actions";
import { LoadingState } from "@artemis/ui/feedback";
import { ArtemisIcon } from "@artemis/ui/icons";
import type { AppLocale, ComputerControlState } from "@artemis/protocol";
import "./computer-use.css";
import { COMPUTER_USE_RESOURCES } from "../shared/computer-use-resources.js";
import type { ComputerPermission } from "../shared/api.js";

export function ComputerUseControls({
  locale,
  permissionsOnly = false,
}: {
  locale: AppLocale;
  permissionsOnly?: boolean;
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
  const controlRef = useRef<HTMLElement>(null);
  const active = !permissionsOnly && state.state !== "idle";
  useLayoutEffect(() => {
    const control = controlRef.current;
    const conversation = control?.closest<HTMLElement>(".conversation");
    if (
      !active ||
      !control ||
      !conversation ||
      !control.closest('.app-shell[data-platform="darwin"]')
    )
      return;
    const update = () => {
      const pane = conversation.getBoundingClientRect();
      const bar = control.getBoundingClientRect();
      // The BrowserWindow already has the sidebar's native vibrancy underneath.
      // Cut only this rounded rectangle out of the opaque conversation canvas.
      const mask = `<svg xmlns="http://www.w3.org/2000/svg" width="${pane.width}" height="${pane.height}"><defs><mask id="cutout"><rect width="100%" height="100%" fill="white"/><rect x="${bar.x - pane.x}" y="${bar.y - pane.y}" width="${bar.width}" height="${bar.height}" rx="12" fill="black"/></mask></defs><rect width="100%" height="100%" mask="url(#cutout)"/></svg>`;
      conversation.style.setProperty(
        "--computer-glass-mask",
        `url('data:image/svg+xml,${encodeURIComponent(mask)}')`,
      );
      conversation.dataset.computerGlass = "true";
      control.dataset.nativeGlass = "true";
    };
    update();
    const observer = new ResizeObserver(update);
    // Also track banners/composer growth that moves the bar without resizing it.
    for (
      let element: HTMLElement | null = control;
      element;
      element = element.parentElement
    ) {
      observer.observe(element);
      if (element === conversation) break;
    }
    return () => {
      observer.disconnect();
      delete control.dataset.nativeGlass;
      delete conversation.dataset.computerGlass;
      conversation.style.removeProperty("--computer-glass-mask");
    };
  }, [active]);
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
      ref={controlRef}
      className={permissionsOnly ? "computer-permissions" : "computer-control"}
      aria-label="Computer Use"
    >
      {!permissionsOnly ? (
        <>
          <div className="computer-control-status" role="status">
            <ArtemisIcon name="monitor" aria-hidden="true" />
            <span className="computer-control-summary">
              <span
                className="computer-control-name"
                title={state.target?.name}
              >
                Computer Use
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
            <span className="computer-control-reason">{state.reason}</span>
          ) : null}
          <div className="computer-control-actions">
            <Button
              className="computer-control-stop"
              variant="quiet"
              icon={
                <span
                  className={
                    state.state === "paused"
                      ? "computer-resume-symbol"
                      : "computer-stop-symbol"
                  }
                  aria-hidden="true"
                />
              }
              onClick={() =>
                run(async () => {
                  if (state.threadId)
                    await window.artemis.controlComputer(
                      state.state === "paused" ? "resume" : "stop",
                      state.threadId,
                    );
                })
              }
            >
              {state.state === "paused" ? copy.resume : copy.stop}
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
                  {permission.scope !== "persistent"
                    ? ` · ${permission.foreground ? copy.foregroundAllowed : copy.backgroundOnly}`
                    : ""}
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
