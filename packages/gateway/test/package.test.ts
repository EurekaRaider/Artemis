import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extract } from "tar";
import { expect, it } from "vitest";
import { packageGateway } from "../../../scripts/package-gateway.mjs";

it("runs the exported package outside the repository with no npm install and preserves generated secrets", async () => {
  const root = await mkdtemp(join(tmpdir(), "artemis-gateway-portable-"));
  try {
    const archive = join(root, "artemis-gateway.tar.gz");
    await packageGateway(archive);
    await extract({ file: archive, cwd: root });
    expect((await readdir(root)).sort()).toEqual([
      "README.md",
      "THIRD-PARTY-LICENSES.txt",
      "artemis-gateway.tar.gz",
      "gateway.mjs",
    ]);
    expect(await readFile(join(root, "gateway.mjs"), "utf8")).not.toContain(
      "sourceMappingURL",
    );
    let configuration = "";
    for (let run = 0; run < 2; run++) {
      const env = { ...process.env, ARTEMIS_GATEWAY_PORT: "0", NODE_PATH: "" };
      for (const key of [
        "ARTEMIS_GATEWAY_ADMIN_TOKEN",
        "ARTEMIS_GATEWAY_ENCRYPTION_KEY",
        "ARTEMIS_GATEWAY_DATABASE",
        "ARTEMIS_GATEWAY_HOST",
      ])
        delete env[key];
      const child = spawn(process.execPath, [join(root, "gateway.mjs")], {
        cwd: root,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "",
        errors = "";
      child.stdout.on("data", (data) => {
        output += data;
      });
      child.stderr.on("data", (data) => {
        errors += data;
      });
      try {
        await expect
          .poll(
            () => {
              if (child.exitCode !== null)
                throw new Error(`Gateway exited: ${errors}`);
              return /listening on port (\d+)/u.exec(output)?.[1];
            },
            { timeout: 10000 },
          )
          .toBeTruthy();
        const port = /listening on port (\d+)/u.exec(output)![1];
        expect(
          await (await fetch(`http://127.0.0.1:${port}/health`)).json(),
        ).toMatchObject({ ok: true });
        const current = await readFile(join(root, ".env.gateway"), "utf8");
        const admin = /^ARTEMIS_GATEWAY_ADMIN_TOKEN=(.+)$/mu.exec(current)![1];
        const encryption = /^ARTEMIS_GATEWAY_ENCRYPTION_KEY=(.+)$/mu.exec(
          current,
        )![1];
        expect(admin).toHaveLength(64);
        expect(admin).not.toBe(encryption);
        expect(output).not.toContain(admin);
        expect(output).not.toContain(encryption);
        if (run) expect(current).toBe(configuration);
        configuration = current;
      } finally {
        if (child.exitCode === null) {
          const exited = once(child, "exit");
          child.kill("SIGTERM");
          await exited;
        }
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30000);
