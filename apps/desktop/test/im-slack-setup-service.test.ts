import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  imManagementSchema,
  imSlackSetupStatusSchema,
} from "@artemis/protocol";
import {
  SlackSetupService,
  type SlackSetupOptions,
} from "../src/main/slack-setup-service.js";
import {
  slackCliEnvironment,
  type SlackCliCommand,
} from "../src/main/slack-cli-runner.js";

const appToken = "xapp-1-ATEST-private-app-secret",
  botToken = "xoxb-private-bot-secret",
  managementToken = "xoxe.xoxp-private-management-secret";
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
  vi.restoreAllMocks();
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "artemis-slack-setup-test-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const key = randomBytes(32);
  const secure = {
    isEncryptionAvailable: () => true,
    encryptString: (text: string) => {
      const iv = randomBytes(12),
        cipher = createCipheriv("aes-256-gcm", key, iv);
      const body = Buffer.concat([cipher.update(text), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), body]);
    },
    decryptString: (bytes: Buffer) => {
      const cipher = createDecipheriv(
        "aes-256-gcm",
        key,
        bytes.subarray(0, 12),
      );
      cipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([
        cipher.update(bytes.subarray(28)),
        cipher.final(),
      ]).toString();
    },
  };
  const controls = {
    owner: "device-a",
    code: "valid",
    approval: false,
    interrupt: false,
    unknown: false,
    team: "TTEST",
    botMismatch: false,
    revoked: false,
  };
  const commands: SlackCliCommand[] = [];
  const run: NonNullable<SlackSetupOptions["run"]> = async (command) => {
    commands.push(command);
    const [operation, subcommand] = command.args;
    if (operation === "auth" && subcommand === "logout")
      return { code: 0, output: "Logged out" };
    if (operation === "auth" && command.args.includes("--no-prompt"))
      return { code: 0, output: "/slackauthticket YXV0aG9yaXphdGlvbi10ZXN0\n" };
    if (operation === "auth") {
      if (controls.code === "invalid")
        return { code: 1, output: `invalid_challenge ${managementToken}` };
      await writeFile(
        join(command.directory, "config", "credentials.json"),
        JSON.stringify({
          [controls.team]: {
            team_id: controls.team,
            user_id: "UTEST",
            token: managementToken,
          },
        }),
      );
      return { code: 0, output: "Authenticated" };
    }
    if (controls.unknown) throw new Error("network");
    await writeFile(
      join(command.directory, "project", ".slack", "apps.json"),
      JSON.stringify({
        apps: { TTEST: { app_id: "ATEST", team_id: "TTEST" } },
      }),
    );
    if (controls.interrupt)
      await new Promise<void>((_resolve, reject) =>
        command.signal.addEventListener(
          "abort",
          () => reject(new Error("cancelled")),
          { once: true },
        ),
      );
    if (controls.approval)
      return { code: 0, output: "App approval request pending" };
    if (controls.revoked) return { code: 1, output: "token_revoked" };
    await new Promise<void>((resolve, reject) => {
      const socket = createConnection({
        host: "127.0.0.1",
        port: command.handoff!.port,
      });
      socket.on("connect", () =>
        socket.end(
          JSON.stringify({
            secret: command.handoff!.secret,
            appToken,
            botToken,
          }),
        ),
      );
      socket.on("data", () => undefined);
      socket.on("end", resolve);
      socket.on("error", reject);
    });
    return { code: 0, output: `Success ${botToken}` };
  };
  const connect = vi.fn(async () => undefined);
  const options: SlackSetupOptions = {
    directory,
    secure,
    runtime: {
      executable: "/bundled/slack",
      nodeExecutable: process.execPath,
      hook: "/bundled/hook.cjs",
    },
    owner: () => controls.owner,
    run,
    connect,
    resolve: async (input) => {
      if (controls.botMismatch) throw new Error(botToken);
      return { ...(input as any), botUserId: "UBOT" };
    },
  };
  const service = new SlackSetupService(options);
  cleanup.push(() => service.close());
  return { directory, service, options, controls, commands, connect, secure };
}
async function waitForState(service: SlackSetupService, state: string) {
  await vi.waitFor(async () =>
    expect((await service.status()).state).toBe(state),
  );
  return service.status();
}
async function authorize(service: SlackSetupService) {
  await service.start("Personal");
  const awaiting = await waitForState(service, "awaiting-code");
  await service.submit(awaiting.sessionId!, "ABC123xy");
  return awaiting.sessionId!;
}

describe("local Slack CLI setup transaction", () => {
  it("rejects duplicate names before invoking Slack and accepts a renamed retry", async () => {
    const f = await fixture();
    f.options.connections = async () => [{ id: "existing", name: "Personal" }];
    const conflict = await f.service.start("  PERSONAL  ");
    expect(conflict).toMatchObject({
      state: "error",
      name: "PERSONAL",
      error: "name-taken",
    });
    expect(f.commands).toHaveLength(0);
    await f.service.start("Personal 2", conflict.sessionId);
    await waitForState(f.service, "awaiting-code");
    expect(f.commands).toHaveLength(1);
  });
  it("checks for a new name conflict again after authorization", async () => {
    const f = await fixture();
    await f.service.start("Personal");
    const awaiting = await waitForState(f.service, "awaiting-code");
    f.options.connections = async () => [{ id: "existing", name: "Personal" }];
    await f.service.submit(awaiting.sessionId!, "ABC123xy");
    expect((await waitForState(f.service, "error")).error).toBe("name-taken");
    expect(f.commands.some((command) => command.args[0] === "deploy")).toBe(
      false,
    );
    expect(f.connect).not.toHaveBeenCalled();
  });
  it("enforces the Slack app name limit before starting the CLI", async () => {
    const f = await fixture();
    await expect(f.service.start("A".repeat(36))).rejects.toThrow();
    expect(
      imManagementSchema.safeParse({
        action: "slack-setup-start",
        name: "A".repeat(36),
      }).success,
    ).toBe(false);
    expect(f.commands).toHaveLength(0);
  });
  it("updates the existing Slack app when renaming after a connection failure", async () => {
    const f = await fixture();
    f.connect.mockRejectedValueOnce(new Error("unreachable"));
    const id = await authorize(f.service);
    const failed = await waitForState(f.service, "error");
    expect(failed.error).toBe("connection");
    expect(failed.connectionId).toMatch(/^slack-/u);
    f.options.connections = async () => [
      { id: failed.connectionId!, name: "Renamed bot" },
    ];
    await f.service.start("Renamed bot", id);
    await waitForState(f.service, "connected");
    const deployments = f.commands.filter(
      (command) => command.args[0] === "deploy",
    );
    expect(deployments).toHaveLength(2);
    expect(deployments[1]!.args).toContain("ATEST");
    const manifest = JSON.parse(
      await readFile(join(f.directory, id, "project", "manifest.json"), "utf8"),
    );
    expect(manifest.display_information.name).toBe("Renamed bot");
    expect(manifest.features.bot_user.display_name).toBe("Renamed bot");
  });
  it("hands credentials to Gateway once and returns only public status", async () => {
    const f = await fixture();
    await authorize(f.service);
    const result = await waitForState(f.service, "connected");
    expect(imSlackSetupStatusSchema.parse(result).connectionId).toMatch(
      /^slack-/u,
    );
    expect(f.connect).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        appToken,
        botToken,
        appId: "ATEST",
        tenantId: "TTEST",
      }),
      expect.any(AbortSignal),
    );
    await vi.waitFor(() =>
      expect(f.commands.some((c) => c.args[1] === "logout")).toBe(true),
    );
    await f.service.close();
    const onDisk = await readFile(join(f.directory, "state.enc"));
    for (const secret of [appToken, botToken, managementToken]) {
      expect(JSON.stringify(result)).not.toContain(secret);
      expect(onDisk.toString()).not.toContain(secret);
      expect(f.secure.decryptString(onDisk)).not.toContain(secret);
    }
    await expect(
      access(join(f.directory, result.sessionId!, "config")),
    ).rejects.toThrow();
  });
  it("retains the challenge for an incorrect code without leaking CLI errors", async () => {
    const f = await fixture();
    f.controls.code = "invalid";
    const id = await authorize(f.service);
    const result = await waitForState(f.service, "awaiting-code");
    expect(result.error).toBe("invalid-code");
    expect(JSON.stringify(result)).not.toContain(managementToken);
    f.controls.code = "valid";
    await f.service.submit(id, "ABC123xy");
    await waitForState(f.service, "connected");
  });
  it("does not submit an expired confirmation code", async () => {
    const f = await fixture();
    await f.service.start("Personal");
    const status = await waitForState(f.service, "awaiting-code"),
      count = f.commands.length;
    vi.spyOn(Date, "now").mockReturnValue(status.expiresAt! + 1);
    expect((await f.service.submit(status.sessionId!, "ABC123xy")).state).toBe(
      "expired",
    );
    expect(f.commands).toHaveLength(count);
  });
  it("requests fresh authorization after management credentials are revoked", async () => {
    const f = await fixture();
    f.controls.revoked = true;
    const id = await authorize(f.service);
    expect((await waitForState(f.service, "expired")).appId).toBe("ATEST");
    await f.service.start("Personal", id);
    await waitForState(f.service, "awaiting-code");
    expect(
      f.commands.filter((c) => c.args.includes("--no-prompt")),
    ).toHaveLength(2);
    f.controls.revoked = false;
    await f.service.submit(id, "ABC123xy");
    await waitForState(f.service, "connected");
    expect(
      f.commands.filter((c) => c.args[0] === "deploy").at(-1)!.args,
    ).toContain("ATEST");
  });
  it("removes ephemeral plaintext even if encrypting CLI credentials fails", async () => {
    const f = await fixture();
    const run = f.options.run!,
      encrypt = f.secure.encryptString;
    f.options.run = async (command) => {
      const result = await run(command);
      if (command.args.includes("--challenge")) {
        f.secure.encryptString = (text) => {
          f.secure.encryptString = encrypt;
          throw new Error("keychain failed");
        };
      }
      return result;
    };
    const id = await authorize(f.service);
    expect((await waitForState(f.service, "error")).error).toBe(
      "secure-storage",
    );
    await expect(
      access(join(f.directory, id, "config", "credentials.json")),
    ).rejects.toThrow();
  });
  it("resumes administrator approval with the same app after service restart", async () => {
    const f = await fixture();
    f.controls.approval = true;
    const id = await authorize(f.service);
    await waitForState(f.service, "approval-required");
    await f.service.close();
    const restored = new SlackSetupService(f.options);
    cleanup.push(() => restored.close());
    expect((await restored.status()).appId).toBe("ATEST");
    f.controls.approval = false;
    await restored.start("Personal", id);
    await waitForState(restored, "connected");
    expect(
      f.commands
        .filter((c) => c.args[0] === "deploy")
        .map((c) => c.args[c.args.indexOf("--app") + 1]),
    ).toEqual(["deployed", "ATEST"]);
  });
  it("cancels the child, clears secrets, and reuses the recorded app on retry", async () => {
    const f = await fixture();
    f.controls.interrupt = true;
    const id = await authorize(f.service);
    await vi.waitFor(() =>
      expect(f.commands.some((c) => c.args[0] === "deploy")).toBe(true),
    );
    const cancelled = await f.service.cancel(id);
    expect(cancelled.state).toBe("idle");
    expect(cancelled.appId).toBe("ATEST");
    expect(cancelled.authorizationCommand).toBeUndefined();
    expect(cancelled.expiresAt).toBeUndefined();
    expect(f.connect).not.toHaveBeenCalled();
    f.controls.interrupt = false;
    await f.service.start("Renamed bot", id);
    await waitForState(f.service, "awaiting-code");
    await f.service.submit(id, "ABC123xy");
    await waitForState(f.service, "connected");
    expect(f.connect).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Renamed bot" }),
      expect.any(AbortSignal),
    );
    const manifest = JSON.parse(
      await readFile(join(f.directory, id, "project", "manifest.json"), "utf8"),
    );
    expect(manifest.display_information.name).toBe("Renamed bot");
    expect(manifest.features.bot_user.display_name).toBe("Renamed bot");
    expect(
      f.commands.filter((c) => c.args[0] === "deploy").at(-1)?.args,
    ).toContain("ATEST");
  });
  it("migrates a cancelled legacy name without losing the existing app", async () => {
    const f = await fixture();
    await writeFile(
      join(f.directory, "state.enc"),
      f.secure.encryptString(
        JSON.stringify({
          version: 1,
          id: "726d9206-e855-454c-8322-a04ce9bfb222",
          owner: "device-a",
          name: "Personal",
          status: "cancelled",
          connectionId: "saved",
          appId: "ATEST",
          creationAttempted: true,
        }),
      ),
    );
    expect(await f.service.status()).toMatchObject({
      state: "idle",
      name: "Personal_bot",
      appId: "ATEST",
    });
    const saved = JSON.parse(
      f.secure.decryptString(await readFile(join(f.directory, "state.enc"))),
    );
    expect(saved.version).toBe(2);
    expect(saved.name).toBe("Personal_bot");
  });
  it("never duplicates an app after an unknown creation outcome", async () => {
    const f = await fixture();
    f.controls.unknown = true;
    const id = await authorize(f.service);
    await waitForState(f.service, "recovery-required");
    const count = f.commands.length;
    expect((await f.service.start("Personal", id)).state).toBe(
      "recovery-required",
    );
    expect(f.commands).toHaveLength(count);
  });
  it("rejects device identity changes and does not disclose another session", async () => {
    const f = await fixture();
    await f.service.start("Personal");
    const status = await waitForState(f.service, "awaiting-code");
    f.controls.owner = "device-b";
    await expect(f.service.status()).rejects.toThrow(/identity/u);
    await expect(
      f.service.submit(status.sessionId!, "ABC123xy"),
    ).rejects.toThrow(/identity/u);
    expect(f.connect).not.toHaveBeenCalled();
  });
  it("rejects bot identity mismatch before persisting a Gateway connection", async () => {
    const f = await fixture();
    f.controls.botMismatch = true;
    await authorize(f.service);
    const result = await waitForState(f.service, "error");
    expect(result.error).toBe("identity");
    expect(f.connect).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(botToken);
  });
  it("rejects an unavailable keychain before running the CLI", async () => {
    const f = await fixture();
    f.secure.isEncryptionAvailable = () => false;
    await expect(f.service.start("Personal")).rejects.toThrow("secure-storage");
    expect(f.commands).toHaveLength(0);
  });
  it("deduplicates simultaneous start and submit calls", async () => {
    const f = await fixture();
    await Promise.all([
      f.service.start("Personal"),
      f.service.start("Personal"),
    ]);
    const status = await waitForState(f.service, "awaiting-code");
    await Promise.all([
      f.service.submit(status.sessionId!, "ABC123xy"),
      f.service.submit(status.sessionId!, "ABC123xy"),
    ]);
    await waitForState(f.service, "connected");
    expect(f.commands.filter((c) => c.args[0] === "deploy")).toHaveLength(1);
  });
});

it("the setup protocol accepts four explicit operations and rejects secret-bearing status", () => {
  expect(
    imManagementSchema.safeParse({
      action: "slack-setup-start",
      name: "Artemis",
      botToken,
    }).success,
  ).toBe(false);
  expect(
    imSlackSetupStatusSchema.safeParse({ state: "connected", appToken })
      .success,
  ).toBe(false);
  expect(
    imManagementSchema.safeParse({
      action: "slack-setup-submit",
      sessionId: "not-a-session",
      challenge: "$(shell)",
    }).success,
  ).toBe(false);
});
it("the CLI environment excludes inherited credentials and runtime injection", () => {
  vi.stubEnv("SLACK_BOT_TOKEN", botToken);
  vi.stubEnv("NODE_OPTIONS", "--require injected.js");
  const env = slackCliEnvironment({
    runtime: { executable: "cli", hook: "hook", nodeExecutable: "electron" },
    directory: "private",
    args: [],
    signal: new AbortController().signal,
  });
  expect(env.SLACK_BOT_TOKEN).toBeUndefined();
  expect(env.NODE_OPTIONS).toBeUndefined();
  expect(env.ELECTRON_RUN_AS_NODE).toBe("1");
  expect(env.SLACK_DISABLE_TELEMETRY).toBe("true");
  expect(env.HOME).toBe("private");
  expect(env.USERPROFILE).toBe("private");
  vi.unstubAllEnvs();
});
