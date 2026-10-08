import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { app, BrowserWindow } from "electron";
import type { ComputerPreviewState } from "@artemis/protocol";
import type { ComputerPreviewHost } from "../../src/main/computer-use/preview-host.js";
import { ComputerPreviewWindow } from "../../src/main/computer-use/preview-window.js";

async function main() {
  const [evidence, preload] = process.argv.slice(2);
  app.setPath("userData", join(evidence!, "profile"));
  await app.whenReady();
  const main = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true },
  });
  const commands: { action: string }[] = [],
    controls: unknown[] = [];
  let progress = 0;
  const task = setInterval(() => progress++, 10);
  const state: ComputerPreviewState = {
    version: 1,
    sessionId: "synthetic-preview",
    threadId: "synthetic-task",
    target: {
      id: "desktop:fixture",
      kind: "desktop",
      name: "Synthetic preview interaction",
    },
    state: "live",
    timestamp: 0,
    sequence: 0,
    actualFps: 0,
  };
  const floating = new ComputerPreviewWindow({
    main: () => main,
    locale: () => "zh-CN",
    host: () =>
      ({
        command(input: { action: string }) {
          commands.push(input);
          if (input.action === "hide")
            floating.update([{ ...state, state: "hidden" }]);
        },
        removeContents() {},
      }) as unknown as ComputerPreviewHost,
    control: (...args) => controls.push(args),
  });
  // The production window resolves its dedicated preload beside this fixture.
  assert(preload?.endsWith("computer-preview-preload.cjs"));
  floating.setThread(state.threadId);
  floating.update([state]);
  const window = BrowserWindow.getAllWindows().find((value) => value !== main)!;
  const until = async (condition: () => boolean | Promise<boolean>) => {
    const deadline = performance.now() + 5000;
    while (!(await condition())) {
      assert(
        performance.now() < deadline,
        "floating preview interaction timed out",
      );
      await delay(10);
    }
  };
  await until(() => window.isVisible());
  const layout = await window.webContents.executeJavaScript(`(() => {
    const close=document.getElementById('hide'), name=document.getElementById('name');
    return {closeText:close.textContent,closeLabel:close.getAttribute('aria-label'),closeX:close.getBoundingClientRect().x,nameX:name.getBoundingClientRect().x};
  })()`);
  assert.equal(layout.closeText, "×");
  assert(
    layout.closeX < layout.nameX,
    "X is on the left of the preview header",
  );
  await writeFile(
    join(evidence!, "floating.png"),
    (await window.webContents.capturePage()).toPNG(),
  );
  await window.webContents.executeJavaScript(
    "document.getElementById('computer-preview-floating-canvas').click()",
  );
  await until(() => commands.some((value) => value.action === "expand"));
  const before = progress;
  await window.webContents.executeJavaScript(
    "document.getElementById('hide').click()",
  );
  await until(() => !window.isVisible());
  await delay(100);
  assert(
    progress > before,
    "the synthetic task keeps running after closing PiP",
  );
  assert.deepEqual(controls, [], "closing PiP never calls task control");
  floating.update([state]);
  await until(() => window.isVisible());
  const result = {
    platform: process.platform,
    electron: process.versions.electron,
    layout,
    pictureClickRequestsExpand: true,
    closeHidesOnlyPreview: true,
    taskContinues: true,
    canShowAgain: true,
  };
  await writeFile(
    join(evidence!, "result.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
  clearInterval(task);
  floating.dispose();
  main.destroy();
  app.exit(0);
}
main().catch((error) => {
  console.error(error);
  app.exit(1);
});
