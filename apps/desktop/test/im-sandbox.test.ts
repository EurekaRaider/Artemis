import {
  mkdtemp,
  mkdir,
  writeFile,
  symlink,
  rm,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { describe, it, expect } from "vitest";
import {
  checkedRemotePath,
  buildRemoteShellLaunch,
  buildScopedImShellLaunch,
  validateImShellScope,
  runRemoteShell,
} from "../src/main/im-sandbox.js";

it("never falls back to a broad Windows or Linux shell for scoped work", () => {
  for (const platform of ["win32", "linux"] as const)
    expect(() =>
      buildScopedImShellLaunch(
        "/project",
        "echo test",
        false,
        { audience: "owner", readPaths: ["src"], writePaths: ["src"] },
        platform,
      ),
    ).toThrow(/细粒度/);
});

it.runIf(process.platform === "darwin")(
  "enforces scoped native reads, writes and protected files independently of command text",
  async () => {
    const { readFile, link } = await import("node:fs/promises");
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "artemis-im-scoped-")),
    );
    try {
      await mkdir(join(root, "src"));
      await mkdir(join(root, "docs"));
      await writeFile(join(root, "private.txt"), "OUTSIDE_SCOPE_SENTINEL");
      await writeFile(join(root, "src", ".env"), "PROTECTED_SENTINEL");
      await writeFile(join(root, "src", "AGENTS.md"), "CONTROL_SENTINEL");
      await writeFile(join(root, "docs", "guide.txt"), "READABLE_SENTINEL");
      const result = await runRemoteShell(
        buildScopedImShellLaunch(
          root,
          "cat docs/guide.txt; cat private.txt; cat src/.env; cat src/AGENTS.md; printf altered > docs/guide.txt; printf altered > src/.env; printf allowed > src/output.txt; ln private.txt src/link.txt; cat src/link.txt",
          false,
          {
            audience: "owner",
            readPaths: ["src", "docs"],
            writePaths: ["src"],
          },
        ),
        new AbortController().signal,
        10,
      );
      expect(result.output, JSON.stringify(result)).toContain(
        "READABLE_SENTINEL",
      );
      expect(result.output).not.toMatch(
        /OUTSIDE_SCOPE_SENTINEL|PROTECTED_SENTINEL|CONTROL_SENTINEL/,
      );
      expect(await readFile(join(root, "src", "output.txt"), "utf8")).toBe(
        "allowed",
      );
      expect(await readFile(join(root, "src", ".env"), "utf8")).toBe(
        "PROTECTED_SENTINEL",
      );
      expect(await readFile(join(root, "docs", "guide.txt"), "utf8")).toBe(
        "READABLE_SENTINEL",
      );
      await link(
        join(root, "private.txt"),
        join(root, "src", "preexisting-link.txt"),
      );
      await expect(
        validateImShellScope(root, {
          audience: "owner",
          readPaths: ["src"],
          writePaths: ["src"],
        }),
      ).rejects.toThrow(/links/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

describe("remote filesystem policy", () => {
  it("rejects traversal and symlink escapes before executing", async () => {
    const root = await mkdtemp(join(tmpdir(), "artemis-im-policy-"));
    try {
      const workspace = join(root, "project");
      await mkdir(workspace);
      await writeFile(join(root, "secret"), "private");
      await symlink(root, join(workspace, "escape"));
      await expect(checkedRemotePath(workspace, "../secret")).rejects.toThrow();
      await expect(
        checkedRemotePath(workspace, "escape/secret"),
      ).rejects.toThrow();
      await expect(checkedRemotePath(workspace, "new/file.txt")).resolves.toBe(
        join(await realpath(workspace), "new/file.txt"),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("keeps inherited credentials and user shell startup files out of remote commands", () => {
    const launch = buildRemoteShellLaunch(
      "/tmp/project",
      "env",
      false,
      "darwin",
    );
    expect(launch.executable).toBe("/usr/bin/sandbox-exec");
    expect(launch.args[1]).toContain("(deny network*)");
    expect(launch.env).not.toHaveProperty("OPENAI_API_KEY");
    expect(launch.env?.HOME).toBe("/tmp/project");
    expect(launch.args).not.toContain("-l");
    expect(() =>
      buildRemoteShellLaunch("/tmp/project", "pwd", false, "linux"),
    ).toThrow();
  });
});

it.runIf(process.platform === "darwin")(
  "enforces the native Seatbelt filesystem and minimal environment",
  async () => {
    const { realpath, readFile } = await import("node:fs/promises");
    const { runRemoteShell } = await import("../src/main/im-sandbox.js");
    const root = await mkdtemp(join(tmpdir(), "artemis-im-native-"));
    try {
      const actual = await realpath(root),
        workspace = join(actual, "project");
      await mkdir(workspace);
      const secret = join(actual, "secret");
      await writeFile(secret, "PRIVATE_NATIVE_SENTINEL");
      const quote = (v: string) => `'${v.replaceAll("'", "'\\''")}'`;
      const result = await runRemoteShell(
        buildRemoteShellLaunch(
          workspace,
          `printf allowed > local.txt; cat ${quote(secret)}; printf leak > ${quote(secret)}; /usr/bin/env`,
          false,
        ),
        new AbortController().signal,
        10,
      );
      expect(result.output).not.toContain("PRIVATE_NATIVE_SENTINEL");
      expect(result.output).not.toContain("OPENAI_API_KEY=");
      expect(await readFile(secret, "utf8")).toBe("PRIVATE_NATIVE_SENTINEL");
      expect(await readFile(join(workspace, "local.txt"), "utf8")).toBe(
        "allowed",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

it.runIf(process.platform === "darwin")(
  "enforces read-only mode and the native network grant",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "artemis-im-network-"));
    let requests = 0;
    const server = createServer((_request, response) => {
      requests++;
      response.end("NETWORK_ALLOWED");
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    try {
      const workspace = await realpath(root);
      const signal = new AbortController().signal;
      const deniedWrite = await runRemoteShell(
        buildRemoteShellLaunch(
          workspace,
          "printf denied > readonly.txt",
          false,
          "darwin",
          undefined,
          "plan",
        ),
        signal,
        5,
      );
      expect(deniedWrite.exitCode).not.toBe(0);
      const address = server.address() as { port: number };
      const command = `/usr/bin/curl --noproxy '*' --max-time 3 http://127.0.0.1:${address.port}`;
      const deniedNetwork = await runRemoteShell(
        buildRemoteShellLaunch(workspace, command, false),
        signal,
        5,
      );
      expect(deniedNetwork.exitCode).not.toBe(0);
      expect(requests).toBe(0);
      const allowedNetwork = await runRemoteShell(
        buildRemoteShellLaunch(workspace, command, true),
        signal,
        5,
      );
      expect(allowedNetwork.output).toContain("NETWORK_ALLOWED");
      expect(requests).toBe(1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    }
  },
);
