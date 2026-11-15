import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import { remoteResourceOverrides } from "../../src/tools/remote-tools.js";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  expandDesktopPromptTemplate,
  listPromptTemplates,
  prepareDesktopTemplateInput,
} from "../../src/context/prompt-templates.js";

// Test-only parity oracle: production uses only Pi's public SDK exports.
const native = await import(
  pathToFileURL(
    join(
      dirname(
        fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")),
      ),
      "core/prompt-templates.js",
    ),
  ).href
);
describe("desktop prompt templates", () => {
  it.each([
    "one two three",
    "\"two words\" 'other words'",
    "'' \"\" third",
    "it's a test",
    '"unclosed quote',
    '"say \\"hi\\"" tail',
    '"no end \\"',
    '"$2" "$@"',
  ])("matches Pi argument expansion for %s", (args) => {
    const templates = [
      {
        name: "review",
        content:
          "$1 | $2 | $@ | $ARGUMENTS | ${1:-default} | ${@:-empty} | ${@:2} | ${@:1:2} | ${@:0:0} | ${3:-$1}",
      },
    ];
    expect(expandDesktopPromptTemplate(`/review ${args}`, templates)).toBe(
      native.expandPromptTemplate(`/review ${args}`, templates),
    );
  });
  it("does not recursively expand arguments or unknown commands", () => {
    expect(
      expandDesktopPromptTemplate('/review "$2"', [
        { name: "review", content: "$1 $2" },
      ]),
    ).toBe("$2 ");
    expect(expandDesktopPromptTemplate("/missing hi", [])).toBe("/missing hi");
  });
  it("discovers user and project markdown without executing files, with user precedence", async () => {
    const root = await mkdtemp(join(tmpdir(), "templates-"));
    try {
      const agent = join(root, "agent"),
        project = join(root, "project");
      await mkdir(join(agent, "prompts"), { recursive: true });
      await mkdir(join(project, ".pi/prompts"), { recursive: true });
      await writeFile(
        join(agent, "prompts/review.md"),
        '---\ndescription: Review changes\nargument-hint: "<file>"\n---\nReview $1',
      );
      await writeFile(join(project, ".pi/prompts/review.md"), "shadow");
      await writeFile(join(project, ".pi/prompts/test.md"), "Test $@");
      await writeFile(
        join(project, ".pi/prompts/evil.js"),
        "throw new Error('executed')",
      );
      await symlink(join(root, "missing"), join(agent, "prompts/broken.md"));
      await writeFile(
        join(agent, "prompts/malformed.md"),
        "---\ndescription: [unterminated\n---\nBad",
      );
      await writeFile(join(agent, "prompts/invalid name.md"), "Bad");
      await writeFile(join(agent, "prompts/.md"), "Bad");
      await writeFile(join(agent, "prompts/skill:invalid.md"), "Bad");
      const templates = await listPromptTemplates(agent, project);
      const restricted = new DefaultResourceLoader({
        cwd: project,
        agentDir: agent,
        ...remoteResourceOverrides({ network: false, shell: false }),
      });
      await restricted.reload();
      expect(restricted.getPrompts().prompts).toEqual([]);
      expect(templates).toHaveLength(2);
      expect(templates[0]).toMatchObject({
        name: "review",
        description: "Review changes",
        argumentHint: "<file>",
        scope: "user",
      });
      expect(templates[1]).toMatchObject({ name: "test", scope: "project" });
      expect(await listPromptTemplates(join(root, "absent"))).toEqual([]);
      await writeFile(join(agent, "prompts/review.md"), "/review $1");
      expect(
        await prepareDesktopTemplateInput("/review changed", agent, project),
      ).toBe("\n/review changed");
      expect(
        await prepareDesktopTemplateInput(
          "/skill:review changed",
          agent,
          project,
        ),
      ).toBe("/skill:review changed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
