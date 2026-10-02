import { useSyncExternalStore, type ReactNode } from "react";
import { ArtemisIconProvider } from "@artemis/ui/icons";
import { getAppearanceController } from "./appearance-controller.js";

export function AppearanceProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  if (typeof window.artemis?.getAppearanceState !== "function") return children;
  return <ConnectedAppearanceProvider>{children}</ConnectedAppearanceProvider>;
}
function ConnectedAppearanceProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const controller = getAppearanceController();
  const appearance = useSyncExternalStore(
    controller.subscribe,
    controller.snapshot,
  );
  return (
    <ArtemisIconProvider icons={appearance.icons}>
      {children}
    </ArtemisIconProvider>
  );
}
