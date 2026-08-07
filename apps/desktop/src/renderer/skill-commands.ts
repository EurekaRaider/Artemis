import type { RunMode } from "@artemis/protocol";

import type { InstalledSkill } from "../shared/api.js";
import { RUN_MODE_ORDER } from "./run-mode-controls.js";

interface ActiveSlashCommand {
  start: number;
  end: number;
  query: string;
  skillPrefixed: boolean;
}

export type SlashCommandSuggestion =
  | { kind: "goal" }
  | { kind: "compact" }
  | { kind: "init" }
  | { kind: RunMode }
  | { kind: "skill"; skill: InstalledSkill };

function activeSlashCommand(prompt: string): ActiveSlashCommand | undefined {
  const match = /(?:^|\s)(\/(?:skill:)?([^\s]*))$/iu.exec(prompt);
  const command = match?.[1];
  if (!command) return undefined;

  const start = prompt.length - command.length;
  return {
    start,
    end: prompt.length,
    query: (match?.[2] ?? "").toLocaleLowerCase(),
    skillPrefixed: command.toLocaleLowerCase().startsWith("/skill:"),
  };
}

export function selectedSkillNamesForPrompt(prompt: string): string[] {
  const names: string[] = [];
  let remaining = prompt.trimStart();

  while (remaining.startsWith("/skill:")) {
    const match = /^\/skill:([^\s]+)(?:\s+|$)/u.exec(remaining);
    if (!match?.[1]) break;
    names.push(match[1]);
    remaining = remaining.slice(match[0].length);
  }

  return names;
}

export function promptWithoutSelectedSkills(prompt: string): string {
  let remaining = prompt.trimStart();
  while (remaining.startsWith("/skill:")) {
    const match = /^\/skill:[^\s]+(?:\s+|$)/u.exec(remaining);
    if (!match) break;
    remaining = remaining.slice(match[0].length);
  }
  return remaining.trimStart();
}

export function isSkillCommandPrompt(prompt: string): boolean {
  return activeSlashCommand(prompt) !== undefined;
}

export function skillSuggestionsForPrompt(
  prompt: string,
  skills: readonly InstalledSkill[],
): InstalledSkill[] {
  const command = activeSlashCommand(prompt);
  if (!command) return [];
  const selectedNames = new Set(
    selectedSkillNamesForPrompt(prompt.slice(0, command.start)),
  );
  return skills.filter(
    (skill) =>
      skill.enabled &&
      !selectedNames.has(skill.name) &&
      (!command.query ||
        skill.name.toLocaleLowerCase().includes(command.query) ||
        skill.description.toLocaleLowerCase().includes(command.query)),
  );
}

export function slashCommandSuggestionsForPrompt(
  prompt: string,
  skills: readonly InstalledSkill[],
): SlashCommandSuggestion[] {
  const command = activeSlashCommand(prompt);
  if (!command) return [];

  const goalVisible =
    command.start === 0 &&
    !command.skillPrefixed &&
    "goal".startsWith(command.query);
  const compactVisible =
    command.start === 0 &&
    !command.skillPrefixed &&
    "compact".startsWith(command.query);
  const initVisible =
    command.start === 0 &&
    !command.skillPrefixed &&
    "init".startsWith(command.query);
  const modeSuggestions = RUN_MODE_ORDER.filter(
    (mode) => !command.skillPrefixed && mode.startsWith(command.query),
  ).map((kind): SlashCommandSuggestion => ({ kind }));
  return [
    ...(goalVisible ? ([{ kind: "goal" }] as const) : []),
    ...(compactVisible ? ([{ kind: "compact" }] as const) : []),
    ...(initVisible ? ([{ kind: "init" }] as const) : []),
    ...modeSuggestions,
    ...skillSuggestionsForPrompt(prompt, skills).map(
      (skill): SlashCommandSuggestion => ({ kind: "skill", skill }),
    ),
  ];
}

export function skillCommandFor(skill: InstalledSkill): string {
  return `/skill:${skill.name} `;
}

export function promptWithSelectedSkills(
  prompt: string,
  skills: readonly InstalledSkill[],
): string {
  const skillCommands = skills.map(skillCommandFor).join("").trim();
  return [skillCommands, prompt.trim()].filter(Boolean).join(" ");
}

export function replaceActiveSlashCommand(
  prompt: string,
  command: string,
): string {
  const active = activeSlashCommand(prompt);
  if (!active) return prompt;
  return `${prompt.slice(0, active.start)}${command}`;
}

export function selectedSkillsForPrompt(
  prompt: string,
  skills: readonly InstalledSkill[],
): InstalledSkill[] {
  return [...new Set(selectedSkillNamesForPrompt(prompt))].flatMap((name) => {
    const skill = skills.find(
      (candidate) => candidate.enabled && candidate.name === name,
    );
    return skill ? [skill] : [];
  });
}

export function selectedSkillForPrompt(
  prompt: string,
  skills: readonly InstalledSkill[],
): InstalledSkill | undefined {
  return selectedSkillsForPrompt(prompt, skills)[0];
}
