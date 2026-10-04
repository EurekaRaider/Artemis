import { describe, expect, it } from "vitest";

import type { InstalledSkill } from "../../../src/shared/api.js";
import {
  nextRunMode,
  parseRunModeCommand,
} from "../../../src/renderer/conversation/run-mode-controls.js";
import {
  isSkillCommandPrompt,
  promptWithoutSelectedSkills,
  promptWithSelectedSkills,
  replaceActiveSlashCommand,
  selectedSkillNamesForPrompt,
  selectedSkillForPrompt,
  selectedSkillsForPrompt,
  skillCommandFor,
  skillSuggestionsForPrompt,
  slashCommandSuggestionsForPrompt,
} from "../../../src/renderer/plugins/skill-commands.js";

const skills: InstalledSkill[] = [
  {
    id: "local/document-authoring",
    name: "document-authoring",
    description: "Create and edit Word documents.",
    path: "C:\\Users\\developer\\.pi\\agent\\skills\\document-authoring",
    enabled: true,
  },
  {
    id: "local/spreadsheet-analysis",
    name: "spreadsheet-analysis",
    description: "Analyze workbook data.",
    path: "C:\\Users\\developer\\.pi\\agent\\skills\\spreadsheet-analysis",
    enabled: true,
  },
  {
    id: "local/disabled-skill",
    name: "disabled-skill",
    description: "This Skill is disabled.",
    path: "C:\\Users\\developer\\.pi\\agent\\skills\\disabled-skill",
    enabled: false,
  },
];

describe("Skill slash commands", () => {
  it("offers every enabled installed Skill as soon as slash is entered", () => {
    expect(
      skillSuggestionsForPrompt("/", skills).map((skill) => skill.name),
    ).toEqual(["document-authoring", "spreadsheet-analysis"]);
  });

  it("puts built-in commands and Skills in one keyboard-navigation sequence", () => {
    expect(
      slashCommandSuggestionsForPrompt("/", skills).map((suggestion) =>
        suggestion.kind !== "skill"
          ? suggestion.kind
          : `skill:${suggestion.skill.name}`,
      ),
    ).toEqual([
      "goal",
      "compact",
      "init",
      "plan",
      "work",
      "codemode",
      "skill:document-authoring",
      "skill:spreadsheet-analysis",
    ]);
  });

  it("offers mode commands at the start, middle, or end of a prompt", () => {
    expect(
      slashCommandSuggestionsForPrompt("Draft a guide /", skills).map(
        (suggestion) => suggestion.kind,
      ),
    ).toEqual(["plan", "work", "codemode", "skill", "skill"]);
    expect(
      slashCommandSuggestionsForPrompt("Draft /codem", skills).map(
        (suggestion) => suggestion.kind,
      ),
    ).toEqual(["codemode"]);
  });

  it("extracts mode commands from any whitespace-delimited prompt position", () => {
    expect(parseRunModeCommand("/plan Design the change")).toEqual({
      kind: "command",
      mode: "plan",
      prompt: "Design the change",
    });
    expect(parseRunModeCommand("Please /work implement this")).toEqual({
      kind: "command",
      mode: "work",
      prompt: "Please implement this",
    });
    expect(parseRunModeCommand("Inspect the diff /plan")).toEqual({
      kind: "command",
      mode: "plan",
      prompt: "Inspect the diff",
    });
    expect(parseRunModeCommand("  /PLAN  ")).toEqual({
      kind: "command",
      mode: "plan",
      prompt: "",
    });
  });

  it("rejects multiple mode commands and ignores command-like substrings", () => {
    expect(parseRunModeCommand("/plan compare /work")).toEqual({
      kind: "multiple",
      modes: ["plan", "work"],
    });
    expect(parseRunModeCommand("/work implement /work")).toEqual({
      kind: "multiple",
      modes: ["work", "work"],
    });
    expect(
      parseRunModeCommand("Explain /planning and https://x.test/review"),
    ).toBe(undefined);
  });

  it("cycles task modes in their visible Plan, Work, Codemode order", () => {
    expect(nextRunMode("plan")).toBe("work");
    expect(nextRunMode("work")).toBe("codemode");
    expect(nextRunMode("codemode")).toBe("plan");
  });

  it("does not recognize removed mode commands", () => {
    expect(parseRunModeCommand("/execute do this")).toBeUndefined();
    expect(parseRunModeCommand("/review changes")).toBeUndefined();
    expect(slashCommandSuggestionsForPrompt("/exe", skills)).toEqual([]);
    expect(slashCommandSuggestionsForPrompt("/review", skills)).toEqual([]);
  });

  it("filters the init command by its slash query", () => {
    expect(
      slashCommandSuggestionsForPrompt("/ini", skills).map(
        (suggestion) => suggestion.kind,
      ),
    ).toEqual(["init"]);
  });

  it("filters the compact command by its slash query", () => {
    expect(
      slashCommandSuggestionsForPrompt("/com", skills).map(
        (suggestion) => suggestion.kind,
      ),
    ).toEqual(["compact"]);
  });

  it("filters Skills by a plain slash query or Pi's skill prefix", () => {
    expect(
      skillSuggestionsForPrompt("/spread", skills).map((skill) => skill.name),
    ).toEqual(["spreadsheet-analysis"]);
    expect(
      skillSuggestionsForPrompt("/skill:document", skills).map(
        (skill) => skill.name,
      ),
    ).toEqual(["document-authoring"]);
  });

  it("stops suggesting after arguments begin", () => {
    expect(
      skillSuggestionsForPrompt(
        "/skill:document-authoring Draft a guide",
        skills,
      ),
    ).toEqual([]);
  });

  it("opens Skill suggestions after existing prompt text", () => {
    expect(isSkillCommandPrompt("Draft a guide /")).toBe(true);
    expect(
      slashCommandSuggestionsForPrompt("Draft a guide /spread", skills).map(
        (suggestion) =>
          suggestion.kind === "skill"
            ? `skill:${suggestion.skill.name}`
            : suggestion.kind,
      ),
    ).toEqual(["skill:spreadsheet-analysis"]);
    expect(replaceActiveSlashCommand("Draft a guide /spread", "")).toBe(
      "Draft a guide ",
    );
  });

  it("formats and recognizes the selected Skill in the composer", () => {
    const prompt = skillCommandFor(skills[0]!);

    expect(prompt).toBe("/skill:document-authoring ");
    expect(selectedSkillForPrompt(`${prompt}Draft a guide`, skills)?.name).toBe(
      "document-authoring",
    );
  });

  it("keeps selected Skill commands out of the visible draft until submit", () => {
    expect(promptWithSelectedSkills("Draft a guide", [skills[0]!])).toBe(
      "/skill:document-authoring Draft a guide",
    );
    expect(promptWithSelectedSkills("", [skills[0]!, skills[1]!])).toBe(
      "/skill:document-authoring /skill:spreadsheet-analysis",
    );
    expect(promptWithSelectedSkills("Draft a guide", [])).toBe("Draft a guide");
  });

  it("separates selected Skill metadata from the visible conversation text", () => {
    const submitted =
      "/skill:document-authoring /skill:spreadsheet-analysis Draft a guide";

    expect(selectedSkillNamesForPrompt(submitted)).toEqual([
      "document-authoring",
      "spreadsheet-analysis",
    ]);
    expect(promptWithoutSelectedSkills(submitted)).toBe("Draft a guide");
    expect(promptWithoutSelectedSkills("A normal message")).toBe(
      "A normal message",
    );
  });

  it("opens slash again after a selected Skill and appends another Skill", () => {
    const firstSkill = replaceActiveSlashCommand(
      "/",
      skillCommandFor(skills[0]!),
    );
    const secondSlash = `${firstSkill}/`;

    expect(isSkillCommandPrompt(secondSlash)).toBe(true);
    expect(
      skillSuggestionsForPrompt(secondSlash, skills).map((skill) => skill.name),
    ).toEqual(["spreadsheet-analysis"]);

    const prompt = replaceActiveSlashCommand(
      secondSlash,
      skillCommandFor(skills[1]!),
    );
    expect(prompt).toBe(
      "/skill:document-authoring /skill:spreadsheet-analysis ",
    );
    expect(
      selectedSkillsForPrompt(prompt, skills).map((skill) => skill.name),
    ).toEqual(["document-authoring", "spreadsheet-analysis"]);
  });
});
