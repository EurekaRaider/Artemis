import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export async function verifyOfficeMacSignature(app: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    const started = performance.now();
    try {
      await run("/usr/bin/codesign", ["--verify", "--deep", "--strict", app], {
        timeout: 60_000,
      });
      return;
    } catch (error) {
      const failure = error as Error & {
        code?: string | number | null;
        signal?: string | null;
        killed?: boolean;
        stdout?: string;
        stderr?: string;
      };
      const elapsed = Math.round(performance.now() - started);
      // A timeout can interrupt a cold scan of the large Office bundle. A
      // second complete scan must succeed; signature failures never retry.
      if (
        attempt === 1 &&
        failure.code === null &&
        failure.killed === true &&
        failure.signal === "SIGTERM" &&
        elapsed >= 60_000
      )
        continue;
      throw new Error(
        [
          failure.message,
          `code=${String(failure.code)} signal=${String(failure.signal)} killed=${String(failure.killed)} elapsedMs=${String(elapsed)}`,
          failure.stdout,
          failure.stderr,
        ]
          .filter(Boolean)
          .join("\n")
          .slice(0, 8_000),
        { cause: error },
      );
    }
  }
}
