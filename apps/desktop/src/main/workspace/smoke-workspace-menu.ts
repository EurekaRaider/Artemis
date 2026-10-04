import { BrowserWindow } from "electron";

// Exercise the actual menu child window; the main renderer no longer owns it.
export async function selectSmokeWorkspaceMenu(
  parent: BrowserWindow,
  kind: "review" | "terminal" | "browser" | "file" | "design",
): Promise<void> {
  const wait = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));
  await wait(250);
  await parent.webContents.executeJavaScript(
    `document.querySelector('.workspace-tab-add')?.click()`,
  );
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await wait(50);
    const menu = BrowserWindow.getAllWindows().find(
      (candidate) =>
        candidate.getParentWindow() === parent &&
        candidate.isVisible() &&
        candidate.webContents.getURL().startsWith("data:text/html"),
    );
    if (!menu) continue;
    const selected = await menu.webContents.executeJavaScript(`(() => {
      const button = document.querySelector(${JSON.stringify(`button[data-kind="${kind}"]`)});
      if (!button) return false;
      setTimeout(() => button.click(), 30);
      return true;
    })()`);
    if (!selected) throw new Error(`Workspace menu entry missing: ${kind}.`);
    for (let closing = 0; closing < 100; closing += 1) {
      await wait(50);
      if (menu.isDestroyed()) {
        await wait(420);
        return;
      }
    }
    throw new Error(`Workspace menu did not close after selecting ${kind}.`);
  }
  throw new Error("Workspace menu child window did not open.");
}
