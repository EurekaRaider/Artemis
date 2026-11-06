import { useState } from "react";

import type {
  InstalledArtemisPlugin,
  InstalledSkill,
} from "../../../shared/api.js";

import { type ComposerDrafts } from "../../conversation/composer-drafts.js";

export function useConversationDraftState() {
  const [composerDrafts, setComposerDrafts] = useState<ComposerDrafts>({});
  const [promptSubmittedAtByThread, setPromptSubmittedAtByThread] = useState<
    Record<string, number>
  >({});
  const [promptHistory, setPromptHistory] = useState<string[]>([]);
  const [installedSkills, setInstalledSkills] = useState<InstalledSkill[]>([]);
  const [installedPlugins, setInstalledPlugins] = useState<
    InstalledArtemisPlugin[]
  >([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillsError, setSkillsError] = useState<string>();
  const [skillMenuDismissed, setSkillMenuDismissed] = useState(false);
  const [activeSlashSuggestion, setActiveSlashSuggestion] = useState(0);
  const [attachmentDragActive, setAttachmentDragActive] = useState(false);
  return {
    composerDrafts,
    setComposerDrafts,
    promptSubmittedAtByThread,
    setPromptSubmittedAtByThread,
    promptHistory,
    setPromptHistory,
    installedSkills,
    setInstalledSkills,
    installedPlugins,
    setInstalledPlugins,
    skillsLoading,
    setSkillsLoading,
    skillsError,
    setSkillsError,
    skillMenuDismissed,
    setSkillMenuDismissed,
    activeSlashSuggestion,
    setActiveSlashSuggestion,
    attachmentDragActive,
    setAttachmentDragActive,
  };
}
