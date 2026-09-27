import { useEffect, useState } from "react";
import { Button } from "@artemis/ui/actions";
import type { AppLocale, ComputerControlState } from "@artemis/protocol";
import "./computer-use.css";
import { COMPUTER_USE_RESOURCES } from "../shared/computer-use-resources.js";

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
    Array<{ id: string; name: string }> | undefined
  >();
  const [error, setError] = useState<string>();
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
      aria-label="Computer Use"
    >
      {!permissionsOnly ? (
        <>
          <span role="status">
            <strong>Computer Use · {state.target?.name}</strong> —{" "}
            {state.state === "paused"
              ? copy.paused
              : state.foreground
                ? copy.foreground
                : copy.background}
          </span>
          {state.reason ? (
            <span className="computer-control-reason">{state.reason}</span>
          ) : null}
          <Button
            variant={state.state === "paused" ? "secondary" : "danger"}
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
        </>
      ) : null}
      <Button
        variant="quiet"
        onClick={() =>
          run(async () =>
            setPermissions(
              permissions
                ? undefined
                : await window.artemis.getComputerPermissions(),
            ),
          )
        }
      >
        {copy.permissions}
      </Button>
      {permissions ? (
        <div className="computer-permissions-list">
          {permissions.length === 0 ? (
            <span>{copy.noPermissions}</span>
          ) : (
            permissions.map((permission) => (
              <div key={permission.id}>
                <span>{permission.name}</span>
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
              </div>
            ))
          )}
        </div>
      ) : null}
      {error ? <span role="alert">{error}</span> : null}
    </aside>
  );
}
