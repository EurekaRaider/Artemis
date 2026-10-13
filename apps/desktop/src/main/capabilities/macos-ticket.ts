import { execFile } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import { promisify } from "node:util";

const run = promisify(execFile);

export async function validateMacTicket(app: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await run("/usr/bin/xcrun", ["stapler", "validate", app], {
        timeout: 60_000,
      });
      return;
    } catch (error) {
      const failure = error as Error & { stdout?: string; stderr?: string };
      const diagnostic = [failure.message, failure.stdout, failure.stderr]
        .filter(Boolean)
        .join("\n");
      if (attempt === 3 || !diagnostic.includes("NSURLErrorDomain Code=-1005"))
        throw new Error(diagnostic.slice(0, 8_000), { cause: error });
      await wait(attempt * 15_000);
    }
  }
}
