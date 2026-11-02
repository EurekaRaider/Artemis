import type { AppLocale } from "@artemis/protocol";
import { uiText } from "../../shared/i18n/ui-text.js";
/**
 * Structured @ mention for custom sub-agents in the composer (D#152 PR4).
 * Mirrors the IM member-mention interaction (cursor-tracked @query,
 * listbox keyboard navigation, Escape dismissal) but selection produces a
 * draft task block instead of text: the @query fragment is removed and
 * each selected definition rides its own task block until send.
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { Button } from "@artemis/ui/actions";
import { Checkbox } from "@artemis/ui/forms";
import { Dialog } from "@artemis/ui/feedback";

import type { useImMemberMentions } from "../im/ImMemberMentions.js";
import { ArtemisIcon } from "@artemis/ui/icons";
import { ResourceAvatar } from "../plugins/resource-icons.js";
import type {
  InstalledArtemisPlugin,
  InstalledSkill,
  CustomAgentSummary,
} from "../../shared/api.js";
import type { CustomAgentDraftReference } from "../conversation/composer-drafts.js";

const COLOR_TOKENS = [
  "gray",
  "red",
  "orange",
  "yellow",
  "green",
  "teal",
  "blue",
  "purple",
  "pink",
] as const;

export type CustomAgentColorToken = (typeof COLOR_TOKENS)[number];

const COLOR_TOKEN_SET: ReadonlySet<string> = new Set(COLOR_TOKENS);

/** Controlled color token for a chip dot; unknown values fall back to gray. */
export function customAgentColorToken(color: string): CustomAgentColorToken {
  return COLOR_TOKEN_SET.has(color) ? (color as CustomAgentColorToken) : "gray";
}

/** A definition is a candidate when enabled and effective for the project. */
export function customAgentEffectiveForProject(
  summary: CustomAgentSummary,
  projectId: string | undefined,
): boolean {
  return (
    summary.enabled &&
    (summary.scope === "all" ||
      (projectId !== undefined && summary.projectIds.includes(projectId)))
  );
}

const MENTION_QUERY = /(?:^|[\s，。；：、(（])@([^@\n]*)$/u;

export function useCustomAgentMention({
  definitions,
  projectId,
  text,
  setText,
  input,
  enabled,
  onSelect,
  members,
  plugins,
  remaining = 1,
}: {
  definitions: readonly CustomAgentSummary[];
  projectId: string | undefined;
  text: string;
  setText(text: string): void;
  input: RefObject<HTMLTextAreaElement | null>;
  /** Whether more sub-agent task blocks can be added; member targeting stays available. */
  enabled: boolean;
  remaining?: number;
  onSelect(reference: CustomAgentDraftReference): void;
  plugins?: {
    installed: readonly InstalledArtemisPlugin[];
    skills: readonly InstalledSkill[];
    selectedNames: readonly string[];
    onSelect(skill: InstalledSkill): void;
  };
  members?:
    | Pick<ReturnType<typeof useImMemberMentions>, "candidates" | "insert">
    | undefined;
}) {
  const [cursor, setCursor] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(0);
  const [teamOpen, setTeamOpen] = useState(false);
  const pendingCursor = useRef<number | null>(null);
  useLayoutEffect(() => {
    const position = pendingCursor.current;
    if (position === null) return;
    pendingCursor.current = null;
    input.current?.focus();
    input.current?.setSelectionRange(position, position);
  }, [text, input]);
  const match = text.slice(0, cursor).match(MENTION_QUERY);
  const query = match?.[1];
  const candidates =
    !enabled || query === undefined
      ? []
      : definitions
          .filter((definition) =>
            customAgentEffectiveForProject(definition, projectId),
          )
          .filter((definition) => {
            if (!query) return true;
            const needle = query.toLocaleLowerCase();
            return (
              definition.name.toLocaleLowerCase().includes(needle) ||
              definition.description.toLocaleLowerCase().includes(needle) ||
              definition.triggers.some((trigger) =>
                trigger.toLocaleLowerCase().includes(needle),
              )
            );
          });
  const memberCandidates =
    query === undefined ? [] : (members?.candidates ?? []);
  const pluginCandidates =
    query === undefined
      ? []
      : (plugins?.skills ?? []).flatMap((skill) => {
          if (!skill.enabled || plugins?.selectedNames.includes(skill.name))
            return [];
          const plugin = plugins?.installed.find(
            (item) => item.installable && item.skillNames.includes(skill.name),
          );
          if (!plugin) return [];
          const needle = query.toLocaleLowerCase();
          return [
            plugin.name,
            plugin.displayName,
            skill.name,
            skill.description,
          ].some((value) => value.toLocaleLowerCase().includes(needle))
            ? [{ plugin, skill }]
            : [];
        });
  const canBuildTeam =
    enabled && remaining >= 2 && query === "" && candidates.length >= 2;
  const candidateCount =
    memberCandidates.length +
    candidates.length +
    pluginCandidates.length +
    (canBuildTeam ? 1 : 0);
  const open = !dismissed && query !== undefined && candidateCount > 0;
  const activeIndex = Math.min(active, Math.max(0, candidateCount - 1));
  useEffect(() => {
    setActive(0);
  }, [query, projectId]);
  const removeQuery = () => {
    const element = input.current;
    const end = element?.selectionEnd ?? text.length;
    // Remove the @query fragment the user typed; the reference is carried
    // by the draft, never by prompt text.
    const start = query !== undefined ? cursor - query.length - 1 : cursor;
    pendingCursor.current = start;
    setText(`${text.slice(0, start)}${text.slice(end)}`);
    setDismissed(true);
  };
  const select = (definition: CustomAgentSummary) => {
    removeQuery();
    onSelect({
      definitionId: definition.id,
      revision: definition.revision,
      name: definition.name,
      color: definition.color,
    });
  };
  const selectPlugin = (skill: InstalledSkill) => {
    removeQuery();
    plugins?.onSelect(skill);
  };
  const selectMember = (token: string) => {
    members?.insert(token);
    setDismissed(true);
  };
  const openTeam = () => {
    setDismissed(true);
    setTeamOpen(true);
  };
  return {
    open,
    queryActive: !dismissed && query !== undefined,
    pluginCandidates,
    selectPlugin,
    memberCandidates,
    selectMember,
    candidates,
    activeIndex,
    select,
    canBuildTeam,
    teamOpen,
    openTeam,
    closeTeam: () => setTeamOpen(false),
    remaining,
    selectTeam(ids: string[]) {
      if (!enabled || ids.length > remaining) return;
      const selected = candidates.filter((candidate) =>
        ids.includes(candidate.id),
      );
      if (!selected.length) return;
      removeQuery();
      for (const definition of selected)
        onSelect({
          definitionId: definition.id,
          revision: definition.revision,
          name: definition.name,
          color: definition.color,
        });
      setTeamOpen(false);
    },
    changed(position: number) {
      setCursor(position);
      setDismissed(false);
    },
    selected(position: number) {
      setCursor(position);
    },
    keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
      if (!open || event.nativeEvent.isComposing) return false;
      if (event.key === "Escape") {
        event.preventDefault();
        setDismissed(true);
        return true;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setActive(
          (activeIndex + (event.key === "ArrowDown" ? 1 : candidateCount - 1)) %
            candidateCount,
        );
        return true;
      }
      if ((event.key === "Enter" || event.key === "Tab") && !event.shiftKey) {
        event.preventDefault();
        const member = memberCandidates[activeIndex];
        if (member) selectMember(member.token);
        else {
          const candidate = candidates[activeIndex - memberCandidates.length];
          if (candidate) select(candidate);
          else if (
            canBuildTeam &&
            activeIndex === memberCandidates.length + candidates.length
          )
            openTeam();
          else {
            const plugin =
              pluginCandidates[
                activeIndex -
                  memberCandidates.length -
                  candidates.length -
                  (canBuildTeam ? 1 : 0)
              ];
            if (plugin) selectPlugin(plugin.skill);
          }
        }
        return true;
      }
      return false;
    },
  };
}

export function CustomAgentMentionMenu({
  mention,
  locale,
}: {
  mention: ReturnType<typeof useCustomAgentMention>;
  locale: AppLocale;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const [teamIds, setTeamIds] = useState<string[]>([]);
  useLayoutEffect(() => {
    menu.current
      ?.querySelector<HTMLElement>(
        `#custom-agent-mention-${mention.activeIndex}`,
      )
      ?.scrollIntoView?.({ block: "nearest" });
  }, [mention.open, mention.activeIndex]);
  if (mention.teamOpen)
    return (
      <Dialog
        open
        className="custom-agent-team-dialog"
        label={uiText(locale, "Review06.teamTitle")}
        onOpenChange={(open) => {
          if (!open) {
            mention.closeTeam();
            setTeamIds([]);
          }
        }}
      >
        <h2>{uiText(locale, "Review06.teamTitle")}</h2>
        <p>{uiText(locale, "Review06.teamDetail")}</p>
        {mention.candidates.map((definition) => (
          <Checkbox
            key={definition.id}
            checked={teamIds.includes(definition.id)}
            disabled={
              !teamIds.includes(definition.id) &&
              teamIds.length >= mention.remaining
            }
            label={definition.name}
            onCheckedChange={(checked) =>
              setTeamIds((current) =>
                checked
                  ? [...current, definition.id]
                  : current.filter((id) => id !== definition.id),
              )
            }
          />
        ))}
        <footer className="confirmation-actions">
          <Button
            size="compact"
            variant="quiet"
            onClick={() => {
              mention.closeTeam();
              setTeamIds([]);
            }}
          >
            {uiText(locale, "App_copy.renameCancel")}
          </Button>
          <Button
            size="compact"
            disabled={!teamIds.length}
            onClick={() => {
              mention.selectTeam(teamIds);
              setTeamIds([]);
            }}
          >
            {uiText(locale, "Review06.addTeam")}
          </Button>
        </footer>
      </Dialog>
    );
  if (!mention.open) return null;
  return (
    <div
      aria-label={[
        uiText(locale, "App_copy.installedPlugins"),
        uiText(locale, "CustomAgentMention.inline2"),
      ].join(" · ")}
      className="slash-command-menu custom-agent-mention-menu"
      ref={menu}
      id="custom-agent-mention-menu"
      role="listbox"
    >
      {mention.memberCandidates.length > 0 && (
        <div className="slash-command-heading">
          {uiText(locale, "CustomAgentMention.inline1")}
        </div>
      )}
      {mention.memberCandidates.map((member, index) => (
        <div
          aria-selected={index === mention.activeIndex}
          id={`custom-agent-mention-${index}`}
          key={member.deviceId}
          onMouseDown={(event) => event.preventDefault()}
          role="option"
        >
          <Button
            className={`slash-command-suggestion${index === mention.activeIndex ? " active" : ""}`}
            onClick={() => mention.selectMember(member.token)}
            variant="quiet"
          >
            <span>
              <strong>{member.name}</strong>
              <small>{member.deviceName}</small>
            </span>
          </Button>
        </div>
      ))}
      {mention.candidates.length > 0 && (
        <div className="slash-command-heading">
          {uiText(locale, "Review06.agentsHeading")}
        </div>
      )}
      {mention.candidates.map((definition, agentIndex) => {
        const index = mention.memberCandidates.length + agentIndex;
        return (
          <div
            aria-selected={index === mention.activeIndex}
            id={`custom-agent-mention-${index}`}
            key={definition.id}
            onMouseDown={(event) => event.preventDefault()}
            role="option"
          >
            <Button
              className={`slash-command-suggestion${index === mention.activeIndex ? " active" : ""}`}
              onClick={() => mention.select(definition)}
              variant="quiet"
            >
              <ArtemisIcon name="agent" width={14} height={14} />
              <span>
                <strong>{definition.name}</strong>
                <small title={definition.description}>
                  {definition.description}
                </small>
              </span>
            </Button>
          </div>
        );
      })}
      {mention.canBuildTeam && (
        <div
          role="option"
          aria-selected={
            mention.activeIndex ===
            mention.memberCandidates.length + mention.candidates.length
          }
          id={`custom-agent-mention-${mention.memberCandidates.length + mention.candidates.length}`}
          onMouseDown={(event) => event.preventDefault()}
        >
          <Button
            className={`slash-command-suggestion${mention.activeIndex === mention.memberCandidates.length + mention.candidates.length ? " active" : ""}`}
            variant="quiet"
            onClick={mention.openTeam}
          >
            <ArtemisIcon name="agents" width={14} height={14} />
            <span>
              <strong>{uiText(locale, "Review06.createTeam")}</strong>
              <small>{uiText(locale, "Review06.teamDetail")}</small>
            </span>
          </Button>
        </div>
      )}
      {mention.pluginCandidates.length > 0 && (
        <div className="slash-command-heading">
          {uiText(locale, "App_copy.installedPlugins")}
        </div>
      )}
      {mention.pluginCandidates.map(({ plugin, skill }, pluginIndex) => {
        const index =
          mention.memberCandidates.length +
          mention.candidates.length +
          (mention.canBuildTeam ? 1 : 0) +
          pluginIndex;
        return (
          <div
            aria-selected={index === mention.activeIndex}
            id={`custom-agent-mention-${index}`}
            key={skill.id}
            onMouseDown={(event) => event.preventDefault()}
            role="option"
          >
            <Button
              className={`slash-command-suggestion${index === mention.activeIndex ? " active" : ""}`}
              onClick={() => mention.selectPlugin(skill)}
              variant="quiet"
            >
              <ResourceAvatar
                brandColor={plugin.brandColor}
                iconDataUrl={plugin.iconDataUrl}
                kind="skill"
                name={skill.name}
                pluginName={plugin.name}
              />
              <span>
                <strong>{skill.name}</strong>
                <small title={skill.description}>
                  {plugin.displayName} · {skill.description}
                </small>
              </span>
            </Button>
          </div>
        );
      })}
    </div>
  );
}
