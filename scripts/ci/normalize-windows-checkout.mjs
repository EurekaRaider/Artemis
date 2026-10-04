import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

// A reused self-hosted checkout can retain CRLF bytes after its Git attributes
// change. Only rewrite tracked text whose index already contains LF bytes.
const entries = execFileSync("git", ["ls-files", "--eol", "-z"], {
  encoding: "utf8",
}).split("\0");
let normalized = 0;
for (const entry of entries) {
  const separator = entry.indexOf("\t");
  if (separator < 0) continue;
  const state = entry.slice(0, separator);
  if (!/i\/lf\s+w\/crlf\s+attr\/text=auto eol=lf/u.test(state)) continue;
  const path = entry.slice(separator + 1);
  const bytes = readFileSync(path);
  writeFileSync(
    path,
    Buffer.from(bytes.toString("utf8").replaceAll("\r\n", "\n")),
  );
  normalized++;
}
console.log(`Normalized ${normalized} tracked Windows checkout files to LF.`);
