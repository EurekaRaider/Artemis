import { describe, expect, it } from "vitest";

import { expandSkillInvocations } from "../src/skill-invocations.js";

const skills = [
  {
    name: "document-authoring",
    filePath: "C:\\skills\\document-authoring\\SKILL.md",
    baseDir: "C:\\skills\\document-authoring",
  },
  {
    name: "using-superpowers",
    filePath: "C:\\skills\\using-superpowers\\SKILL.md",
    baseDir: "C:\\skills\\using-superpowers",
  },
];

describe("multiple Skill invocations", () => {
  it("expands every selected Skill before the synthesized user request", async () => {
    const contents = new Map([
      [
        skills[0]!.filePath,
        "---\nname: document-authoring\ndescription: Write documents\n---\nDocument instructions.",
      ],
      [
        skills[1]!.filePath,
        "---\nname: using-superpowers\ndescription: Start workflows\n---\nWorkflow instructions.",
      ],
    ]);

    const result = await expandSkillInvocations(
      "/skill:document-authoring /skill:using-superpowers User request:\nCreate the release notes.",
      skills,
      async (path) => contents.get(path) ?? "",
    );

    expect(result.expanded).toBe(true);
    expect(result.text).toContain(
      '<skill name="document-authoring" location="C:\\skills\\document-authoring\\SKILL.md">',
    );
    expect(result.text).toContain("Document instructions.");
    expect(result.text).toContain(
      '<skill name="using-superpowers" location="C:\\skills\\using-superpowers\\SKILL.md">',
    );
    expect(result.text).toContain("Workflow instructions.");
    expect(result.text).toContain("User request:\nCreate the release notes.");
    expect(result.text).not.toContain("/skill:");
  });

  it("leaves one Skill invocation for Pi's native expansion", async () => {
    const prompt = "/skill:document-authoring User request:\nCreate it.";

    await expect(
      expandSkillInvocations(prompt, skills, async () => {
        throw new Error("single Skill should be expanded by Pi");
      }),
    ).resolves.toEqual({ expanded: false, text: prompt });
  });
});
