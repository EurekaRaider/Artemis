const { spawn } = require("node:child_process");
const { writeFileSync } = require("node:fs");
const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
  stdio: "ignore",
  windowsHide: true,
});
child.once("spawn", () => {
  writeFileSync("process-tree.json", JSON.stringify([process.pid, child.pid]));
});
setInterval(() => {}, 1000);
