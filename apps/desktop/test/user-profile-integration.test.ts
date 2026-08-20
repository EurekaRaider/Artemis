import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
}

const appSource = source("../src/renderer/App.tsx");
const pageSource = source("../src/renderer/TokenUsagePage.tsx");
const apiSource = source("../src/shared/api.ts");
const preloadSource = source("../src/preload/preload.ts");
const mainSource = source("../src/main/main.ts");
const stylesSource = source("../src/renderer/styles.css");

describe("current user profile integration", () => {
  it("adds the OS login username to the existing isolated desktop snapshot", () => {
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
    expect(snapshotHandler).toContain("userName: userInfo().username");
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

  it("renders a centered local avatar with initials fallback above the token summary", () => {
    const profileStart = pageSource.indexOf(
      '<header className="token-usage-profile">',
    );
    const profileEnd = pageSource.indexOf("</header>", profileStart);
    const profile = pageSource.slice(profileStart, profileEnd);
    const summaryStart = pageSource.indexOf(
      '<section className="token-usage-summary"',
    );

    expect(pageSource).toContain("username: string");
    expect(profileStart).toBeGreaterThan(-1);
    expect(profileEnd).toBeGreaterThan(profileStart);
    expect(profileStart).toBeLessThan(summaryStart);
    expect(profile).toContain('className="token-usage-avatar"');
    expect(profile).toContain("profileAvatar ? (");
    expect(profile).toContain('className="token-usage-avatar-image"');
    expect(profile).toContain("userInitials(username)");
    expect(profile).toContain("<h1>{username}</h1>");
    expect(profile).toContain('className="token-usage-handle"');
    expect(profile).toContain("@{username}");
    expect(profile).toContain('className="token-usage-profile-badge"');
    expect(pageSource).toContain('className="token-usage-details"');
    expect(pageSource).toContain("usageTotals.input");
    expect(stylesSource).toMatch(
      /\.token-usage-profile\s*\{(?=[^}]*align-items:\s*center)(?=[^}]*flex-direction:\s*column)(?=[^}]*text-align:\s*center)[^}]*\}/u,
    );
    expect(stylesSource).toMatch(
      /\.token-usage-avatar\s*\{(?=[^}]*border-radius:\s*50%)(?=[^}]*display:\s*grid)[^}]*\}/u,
    );
  });
});
