import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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
} finally {
  await rm(temporary, { recursive: true, force: true });
}
