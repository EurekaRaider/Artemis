import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const files = [
  ...new Set(
    execFileSync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      { cwd: root, encoding: "utf8" },
    ).split("\0"),
  ),
].filter((file) => file.endsWith(".md") && existsSync(join(root, file)));
let pairs = 0;
for (const file of files) {
  // Root documents intentionally remain English-only. Runtime instructions and
  // third-party license originals are not translations.
  if (
    !file.includes("/") ||
    basename(file) === "SKILL.md" ||
    file.startsWith("third-party/")
  )
    continue;
  const content = readFileSync(join(root, file), "utf8");
  if (file === "docs/records/release-notes.md") {
    assert.match(content, /[\u4e00-\u9fff]/u);
    assert.match(content, /[A-Za-z]{4}/u);
    continue;
  }
  if (/-en\.md$|-zh-CN\.md$/u.test(file)) {
    const original = file.replace(/-en\.md$|-zh-CN\.md$/u, ".md");
    assert.ok(files.includes(original), `${file}: missing original`);
    continue;
  }
  const counterpart = [
    file.replace(/\.md$/u, "-en.md"),
    file.replace(/\.md$/u, "-zh-CN.md"),
  ].find((candidate) => files.includes(candidate));
  assert.ok(counterpart, `${file}: add a complete Chinese/English counterpart`);
  const translated = readFileSync(join(root, counterpart), "utf8");
  assert.ok(
    content.includes(`](${basename(counterpart)})`),
    `${file}: missing language link`,
  );
  assert.ok(
    translated.includes(`](${basename(file)})`),
    `${counterpart}: missing language link`,
  );
  pairs += 1;
}
// Resolve local Markdown targets without requiring external network requests.
for (const file of files) {
  if (basename(file) === "SKILL.md") continue;
  const content = readFileSync(join(root, file), "utf8").replace(
    /```[^]*?```/gu,
    "",
  );
  for (const match of content.matchAll(/\]\(([^\s)]+)(?:\s+"[^"]*")?\)/gu)) {
    const target = match[1].split("#")[0];
    if (!target || /^[a-z][\w+.-]*:/iu.test(target) || target.startsWith("/"))
      continue;
    assert.ok(
      existsSync(join(root, dirname(file), decodeURIComponent(target))),
      `${file}: missing link ${target}`,
    );
  }
}
console.log(
  `Bilingual documentation verified: ${pairs} pairs, bilingual release notes, local Markdown links. Translation completeness requires editorial review.`,
);
