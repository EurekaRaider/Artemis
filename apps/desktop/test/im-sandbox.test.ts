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
  runRemoteShell,
} from "../src/main/im-sandbox.js";

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
