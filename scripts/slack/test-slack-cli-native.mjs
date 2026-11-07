import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { build } from "esbuild";
import electron from "electron";
import { verifySlackCliRelease } from "./slack-cli-release.mjs";
import { stageSlackCli, verifyPackagedSlackCli } from "./slack-cli-package.mjs";
import { verifySlackCliCompatibility } from "./slack-cli-native-compatibility.mjs";

const target = `${process.platform}-${process.arch}`;
const lock = await verifySlackCliRelease();
const directory = await stageSlackCli(target, lock);
const temporary = await mkdtemp(join(tmpdir(), "artemis-slack-hook-"));
try {
  const hook = join(temporary, "slack-cli-hook.cjs");
  await build({
    entryPoints: [
      fileURLToPath(
        new URL(
          "../../apps/desktop/src/main/im/slack-cli-hook.ts",
          import.meta.url,
        ),
      ),
    ],
    outfile: hook,
    platform: "node",
    format: "cjs",
    bundle: true,
    target: "node24",
  });
  console.log(await verifyPackagedSlackCli(directory, target));
  console.log(
    await verifySlackCliCompatibility({
      executable: join(
        directory,
        process.platform === "win32" ? "slack.exe" : "slack",
      ),
      hook,
      nodeExecutable: electron,
    }),
  );
  if (process.platform === "win32") {
    // Exercise the GUI-subsystem parent as well as node.exe. Hiding the parent
    // prevents an inherited terminal from masking Slack CLI startup failures.
    const result = await promisify(execFile)(
      electron,
      [
        fileURLToPath(
          new URL("./test-slack-cli-electron.mjs", import.meta.url),
        ),
        directory,
        hook,
      ],
      {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
        windowsHide: true,
        timeout: 240000,
        maxBuffer: 256 * 1024,
      },
    );
    console.log(result.stdout);
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
