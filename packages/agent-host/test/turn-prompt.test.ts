import { describe, expect, it } from "vitest";

import { appendPromptFiles, buildTurnPrompt } from "../src/turn-prompt.js";

describe("buildTurnPrompt", () => {
  it("injects a persistent task goal without changing the user request", () => {
    const prompt = buildTurnPrompt(
      "execute",
      "Add archive search.",
      "Ship a complete conversation lifecycle",
    );

    expect(prompt).toContain(
      "Persistent task goal:\nShip a complete conversation lifecycle",
    );
    expect(prompt).toContain("User request:\nAdd archive search.");
    expect(prompt.indexOf("Persistent task goal")).toBeLessThan(
      prompt.indexOf("User request"),
    );
  });

  it("omits the goal section when no goal is active", () => {
    expect(buildTurnPrompt("plan", "Inspect the design.")).not.toContain(
      "Persistent task goal",
    );
  });

  it("injects recalled memory as hidden context without changing the user request", () => {
    const userText = "Repair the Windows Ninja target rebuild.";
    const prompt = buildTurnPrompt(
      "execute",
      userText,
      undefined,
      "## Target-only rebuild\nInspect exact Ninja process command lines first.",
    );

    expect(prompt).toContain(
      "Relevant experiential memory:\n## Target-only rebuild",
    );
    expect(prompt).toContain(`User request:\n${userText}`);
    expect(prompt.indexOf("Relevant experiential memory")).toBeLessThan(
      prompt.indexOf("User request"),
    );
    expect(userText).toBe("Repair the Windows Ninja target rebuild.");
  });

  it("omits the hidden memory section when recall returns no context", () => {
    expect(
      buildTurnPrompt("review", "Inspect the change.", undefined, ""),
    ).not.toContain("Relevant experiential memory");
  });

  it("keeps repeated plan and memory rules out of the dynamic user turn", () => {
    const prompt = buildTurnPrompt("execute", "Verify the release workflow.");

    expect(prompt).not.toContain("call update_plan");
    expect(prompt).not.toContain("call save_memory");
    expect(prompt).toContain("User request:\nVerify the release workflow.");
  });

  it("places interrupted team context before the current request", () => {
    const prompt = buildTurnPrompt(
      "execute",
      "Continue the interrupted work.",
      undefined,
      undefined,
      "Agent A finished the protocol audit.",
    );

    expect(prompt).toContain("Previous interrupted agent-team context");
    expect(prompt.indexOf("Previous interrupted")).toBeLessThan(
      prompt.indexOf("User request"),
    );
    expect(
      prompt.endsWith("User request:\nContinue the interrupted work."),
    ).toBe(true);
  });

  it("keeps an explicit Skill command at the start so Pi expands it", () => {
    const prompt = buildTurnPrompt(
      "execute",
      "/skill:document-authoring Create the release notes.",
    );

    expect(prompt).toMatch(/^\/skill:document-authoring /u);
    expect(prompt).toContain("User request:\nCreate the release notes.");
    expect(prompt).not.toContain(
      "User request:\n/skill:document-authoring Create the release notes.",
    );
  });

  it("preserves every selected Skill command before the user request", () => {
    const prompt = buildTurnPrompt(
      "execute",
      "/skill:document-authoring /skill:using-superpowers Create the release notes.",
    );

    expect(prompt).toMatch(
      /^\/skill:document-authoring \/skill:using-superpowers /u,
    );
    expect(prompt).toContain("User request:\nCreate the release notes.");
    expect(prompt).not.toContain(
      "User request:\n/skill:document-authoring /skill:using-superpowers",
    );
  });

  it("delivers attached file contents as clearly delimited user data", () => {
    const prompt = appendPromptFiles(
      buildTurnPrompt("review", "Review the attached config."),
      [
        {
          type: "file",
          name: "settings.json",
          mimeType: "application/json",
          content: '{ "theme": "dark" }',
        },
      ],
    );

    expect(prompt).toContain("Attached files (user-provided data)");
    expect(prompt).toContain('name="settings.json"');
    expect(prompt).toContain('media-type="application/json"');
    expect(prompt).toContain('{ "theme": "dark" }');
    expect(prompt.indexOf("Attached files")).toBeLessThan(
      prompt.indexOf("User request"),
    );
    expect(prompt.endsWith("User request:\nReview the attached config.")).toBe(
      true,
    );
  });

  it("preserves the Skill command prefix when files are appended", () => {
    const prompt = appendPromptFiles(
      buildTurnPrompt(
        "execute",
        "/skill:spreadsheet-analysis Inspect the attached workbook.",
      ),
      [
        {
          type: "file",
          name: "report.csv",
          mimeType: "text/csv",
          content: "month,total\nJuly,42",
        },
      ],
    );

    expect(prompt).toMatch(/^\/skill:spreadsheet-analysis /u);
    expect(prompt).toContain("Attached files (user-provided data)");
  });
});
