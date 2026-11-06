import { useMemo } from "react";

import type {
  InstalledArtemisPlugin,
  InstalledSkill,
} from "../../../shared/api.js";

import {
  isSkillCommandPrompt,
  slashCommandSuggestionsForPrompt,
} from "../../plugins/skill-commands.js";

interface UseComposerSuggestionsContext {
  readonly skillMenuDismissed: boolean;
  readonly prompt: string;
  readonly installedPlugins: InstalledArtemisPlugin[];
  readonly selectedComposerSkillNames: string[];
  readonly installedSkills: InstalledSkill[];
  readonly skillsLoading: boolean;
}
export function useComposerSuggestions(context: UseComposerSuggestionsContext) {
  const {
    skillMenuDismissed,
    prompt,
    installedPlugins,
    selectedComposerSkillNames,
    installedSkills,
    skillsLoading,
  } = context;
  const skillCommandMenuOpen =
    !skillMenuDismissed && isSkillCommandPrompt(prompt);
  const installedPluginBySkillName = useMemo(() => {
    const plugins = new Map<string, InstalledArtemisPlugin>();
    for (const plugin of installedPlugins) {
      for (const skillName of plugin.skillNames) {
        plugins.set(skillName, plugin);
      }
    }
    return plugins;
  }, [installedPlugins]);
  const slashCommandSuggestions = useMemo(() => {
    const selectedNames = new Set(selectedComposerSkillNames);
    const suggestions = slashCommandSuggestionsForPrompt(
      prompt,
      (skillsLoading ? [] : installedSkills).filter(
        (skill) =>
          !selectedNames.has(skill.name) &&
          !installedPluginBySkillName.has(skill.name),
      ),
    );
    return [
      ...suggestions.filter((suggestion) => suggestion.kind === "skill"),
      ...suggestions.filter(
        (suggestion) =>
          suggestion.kind !== "skill" &&
          (selectedComposerSkillNames.length === 0 ||
            suggestion.kind === "plan" ||
            suggestion.kind === "work" ||
            suggestion.kind === "codemode"),
      ),
    ];
  }, [
    installedPluginBySkillName,
    installedSkills,
    skillsLoading,
    prompt,
    selectedComposerSkillNames,
  ]);
  const goalSuggestionIndex = slashCommandSuggestions.findIndex(
    (suggestion) => suggestion.kind === "goal",
  );
  const compactSuggestionIndex = slashCommandSuggestions.findIndex(
    (suggestion) => suggestion.kind === "compact",
  );
  const initSuggestionIndex = slashCommandSuggestions.findIndex(
    (suggestion) => suggestion.kind === "init",
  );
  const modeSuggestions = slashCommandSuggestions.flatMap(
    (suggestion, index) =>
      suggestion.kind === "plan" ||
      suggestion.kind === "work" ||
      suggestion.kind === "codemode"
        ? [{ index, mode: suggestion.kind }]
        : [],
  );
  const skillSuggestions = slashCommandSuggestions.flatMap(
    (suggestion, index) =>
      suggestion.kind === "skill" ? [{ index, skill: suggestion.skill }] : [],
  );
  const selectedSkills = useMemo(
    () =>
      selectedComposerSkillNames.flatMap((name) => {
        const skill = installedSkills.find(
          (candidate) => candidate.enabled && candidate.name === name,
        );
        return skill ? [skill] : [];
      }),
    [installedSkills, selectedComposerSkillNames],
  );
  return {
    skillCommandMenuOpen,
    installedPluginBySkillName,
    slashCommandSuggestions,
    goalSuggestionIndex,
    compactSuggestionIndex,
    initSuggestionIndex,
    modeSuggestions,
    skillSuggestions,
    selectedSkills,
  };
}
