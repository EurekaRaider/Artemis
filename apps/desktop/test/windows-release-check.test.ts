import { describe, expect, it, vi } from "vitest";
import { checkWindowsRelease } from "../src/main/windows-release-check.js";
const release = (version = "1.10.0") => ({
  tag_name: `v${version}`,
  draft: false,
  prerelease: false,
  assets: [
    {
      name: `Artemis-Windows-x64-${version}.zip`,
      browser_download_url: `https://github.com/EurekaRaider/ArtemisRelease/releases/download/v${version}/Artemis-Windows-x64-${version}.zip`,
    },
  ],
});
const fetcher = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }));
describe("Windows manual release check", () => {
  it("compares numeric versions and requires the exact Windows ZIP", async () => {
    expect(
      await checkWindowsRelease(
        "1.9.0",
        undefined,
        undefined,
        fetcher(release()),
      ),
    ).toMatchObject({ version: "1.10.0" });
    for (const body of [
      release("1.9.0"),
      release("1.8.0"),
      { ...release(), assets: [] },
      { ...release(), draft: true },
      { ...release(), prerelease: true },
      release("2.0.0-beta.1"),
    ])
      expect(
        await checkWindowsRelease("1.9.0", undefined, undefined, fetcher(body)),
      ).toBeUndefined();
  });
  it("rejects untrusted links and malformed metadata", async () => {
    const body = release();
    body.assets[0]!.browser_download_url = "https://evil.test/download.zip";
    await expect(
      checkWindowsRelease("1.0.0", undefined, undefined, fetcher(body)),
    ).rejects.toThrow("URL");
    await expect(
      checkWindowsRelease(
        "1.0.0",
        undefined,
        undefined,
        fetcher({ tag_name: "oops" }),
      ),
    ).rejects.toThrow("version");
  });
  it("handles no release, rate limits and bounded responses", async () => {
    expect(
      await checkWindowsRelease(
        "1.0.0",
        undefined,
        undefined,
        fetcher({}, 404),
      ),
    ).toBeUndefined();
    await expect(
      checkWindowsRelease("1.0.0", undefined, undefined, fetcher({}, 403)),
    ).rejects.toThrow("HTTP 403");
    await expect(
      checkWindowsRelease(
        "1.0.0",
        undefined,
        undefined,
        fetcher("x".repeat(1024 * 1024)),
      ),
    ).rejects.toThrow("too large");
  });
});
