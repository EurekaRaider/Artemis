import { expect, it, vi } from "vitest";
import { downloadPublicMacOfficeCatalog } from "./public-macos-catalog.mjs";

it("downloads the public catalog anonymously and uses its actual bytes", async () => {
  const candidate = '{"schemaVersion":1}\n';
  const request = vi.fn(async () => new Response(candidate));
  const result = await downloadPublicMacOfficeCatalog(
    candidate,
    "1.0.2",
    request,
  );
  expect(request.mock.calls[0]?.[0]).toBe(
    "https://github.com/EurekaRaider/Artemis/releases/download/office-runtime-v1.0.2/catalog.json",
  );
  expect(request.mock.calls[0]?.[1]).not.toHaveProperty("headers");
  expect(result.content.toString()).toBe(candidate);
});

it("rejects changed public catalog bytes rather than using the local candidate", async () => {
  await expect(
    downloadPublicMacOfficeCatalog(
      "accepted",
      "1.0.2",
      async () => new Response("changed"),
    ),
  ).rejects.toThrow("differs from the accepted candidate");
});

it("fails public acceptance when anonymous download fails", async () => {
  await expect(
    downloadPublicMacOfficeCatalog(
      "accepted",
      "1.0.2",
      async () => new Response("", { status: 404 }),
    ),
  ).rejects.toThrow("download failed");
});
