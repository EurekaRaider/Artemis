import { spawn, spawnSync } from "node:child_process";
import { resolve } from "node:path";

if (process.platform !== "win32") process.exit(0);

const executable = resolve(
  process.argv[2] ?? "artifacts/slack-cli/win32-x64/slack.exe",
);
for (const options of [
  {
    name: "hidden-pipes",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  },
  {
    name: "visible-pipes",
    windowsHide: false,
    stdio: ["ignore", "pipe", "pipe"],
  },
  { name: "visible-inherited", windowsHide: false, stdio: "inherit" },
]) {
  await new Promise((done) => {
    const started = Date.now();
    const child = spawn(executable, ["--version"], options);
    let output = "";
    let finished = false;
    const collect = (chunk) => {
      output += chunk.toString().slice(0, 1024);
    };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);
    const finish = (result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      child.stdout?.destroy();
      child.stderr?.destroy();
      console.log(
        JSON.stringify({
          mode: options.name,
          result,
          elapsedMs: Date.now() - started,
          output: output.trim(),
        }),
      );
      done();
    };
    const timer = setTimeout(() => {
      if (child.pid)
        spawnSync("taskkill.exe", ["/pid", String(child.pid), "/T", "/F"], {
          timeout: 5000,
          stdio: "ignore",
        });
      finish("timeout");
    }, 25000);
    child.once("error", (error) => finish(`error:${error.code}`));
    child.once("exit", (code, signal) =>
      finish(`exit:${code ?? signal ?? "unknown"}`),
    );
  });
}
