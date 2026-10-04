import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../../", import.meta.url));
const runId = new Date().toISOString().replaceAll(":", "-");

/** Durable evidence location. Callers may still supply an explicit output path. */
export function verificationOutput(topic) {
  return join(root, "artifacts", "verification", topic, runId);
}
