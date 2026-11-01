import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
}

const appSource = source("../../../src/renderer/app/App.tsx");
const pageSource = source(
  "../../../src/renderer/conversation/TokenUsagePage.tsx",
);
const apiSource = source("../../../src/shared/api.ts");
const preloadSource = source("../../../src/preload/preload.ts");
const mainSource = source("../../../src/main/main.ts");
const stylesSource = source("../../../src/renderer/styles/nocturne.css");

describe("current user profile integration", () => {
  it("keeps the OS username private in smoke screenshots", () => {
    const snapshotHandlerStart = mainSource.indexOf(
      "ipcMain.handle(IPC.snapshot",
    );
    const snapshotHandlerEnd = mainSource.indexOf(
      "ipcMain.handle(",
      snapshotHandlerStart + "ipcMain.handle(IPC.snapshot".length,
    );
    const snapshotHandler = mainSource.slice(
      snapshotHandlerStart,
      snapshotHandlerEnd,
    );

    expect(apiSource).toMatch(
      /export interface DesktopSnapshot extends AppSnapshot\s*\{[^}]*userName:\s*string;[^}]*\}/u,
    );
    expect(apiSource).toContain("getSnapshot(): Promise<DesktopSnapshot>;");
    expect(preloadSource).toContain(
      "getSnapshot: () => ipcRenderer.invoke(IPC.snapshot)",
    );
    expect(apiSource).not.toContain("currentUsername:");
    expect(preloadSource).not.toContain("getCurrentUsername:");
    expect(mainSource).toMatch(
      /import\s+\{[^}]*\buserInfo\b[^}]*\}\s+from\s+"node:os";/u,
    );
    expect(snapshotHandlerStart).toBeGreaterThan(-1);
    expect(snapshotHandlerEnd).toBeGreaterThan(snapshotHandlerStart);
    expect(snapshotHandler).toContain(
      'userName: smokeMode ? "Artemis" : userInfo().username',
    );
  });

  it("replaces the sidebar Local label and passes the resolved username to Token Usage", () => {
    const footerStart = appSource.indexOf('<div className="sidebar-footer">');
    const footerEnd = appSource.indexOf("</div>", footerStart);
    const footer = appSource.slice(footerStart, footerEnd);

    expect(footerStart).toBeGreaterThan(-1);
    expect(footerEnd).toBeGreaterThan(footerStart);
    expect(appSource).toMatch(
      /const username = snapshot\?\.userName\s*\?\?\s*t\.local;/u,
    );
    expect(footer).toContain("{username}");
    expect(footer).not.toContain("{t.local}");
    expect(appSource).toMatch(
      /<TokenUsagePage\s+locale=\{locale\}[\s\S]*?username=\{username\}\s*\/>/u,
    );
    expect(appSource).toContain("runtimeSettings?.profileAvatar");
  });

  it("renders usage filters beside the heading without a duplicate account identity", () => {
    const profileStart = pageSource.indexOf(
      '<header className="token-usage-profile">',
    );
    const profile = pageSource.slice(
      profileStart,
      pageSource.indexOf("</header>", profileStart),
    );
    expect(profile).toContain("<h1>{t.title}</h1>");
    expect(profile).toContain(
      '<div className="token-usage-activity-controls">',
    );
    expect(profile).toContain("<Select");
    expect(profile).toContain("<SegmentedControl");
    expect(profile).not.toContain("token-usage-account");
    expect(profile).not.toContain("token-usage-avatar");
    expect(pageSource).toContain('className="token-usage-details"');
    expect(pageSource).toContain("usageTotals.input");
  });
});
