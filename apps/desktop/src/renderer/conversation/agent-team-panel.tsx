import { Button } from "@artemis/ui/actions";
import { Badge } from "@artemis/ui/actions";
import { ArtemisIcon } from "@artemis/ui/icons";
import { ChildAgentIcon } from "../components/ChildAgentIcon.js";
import { UI_COPY } from "../../shared/i18n/ui-copy.js";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  type AgentTeamMessageState,
  type AgentTeamState,
  type ChildAgentState,
} from "@artemis/protocol";
import {
  indexAgentTeamTree,
  visibleAgentTeamMembers,
} from "./agent-team-tree.js";

import { customAgentInstanceIdentity } from "../settings/custom-agent-identity.js";
import { copy } from "../app/app-copy.js";
import { type Locale } from "../app/app-types.js";
export function agentMemberStatus(
  status: ChildAgentState["status"],
  locale: Locale,
) {
  const copy = UI_COPY.App_copy_9734[locale];
  return { agentMemberStatusLabel: copy[status] }.agentMemberStatusLabel;
}

export function agentMemberTone(status: ChildAgentState["status"]) {
  return status === "completed"
    ? "success"
    : status === "failed" || status === "cancelled"
      ? "danger"
      : status === "running" || status === "blocked"
        ? "warning"
        : "neutral";
}

export function AgentTeamPanel({
  active,
  controlPending,
  locale,
  members,
  messages,
  onOpenChildAgent,
  onStop,
  runtimeAvailable,
  team,
}: {
  active: boolean;
  controlPending: boolean;
  locale: Locale;
  members: ChildAgentState[];
  messages: AgentTeamMessageState[];
  onOpenChildAgent: (child: ChildAgentState) => void;
  onStop: (team: AgentTeamState) => void;
  runtimeAvailable: boolean;
  team: AgentTeamState | undefined;
}) {
  const messageList = useRef<HTMLDivElement>(null);
  const labels = UI_COPY.App_labels[locale];
  const teamStatusLabels = UI_COPY.App_teamStatusLabels[locale];
  const messageKindLabels = UI_COPY.App_messageKindLabels[locale];
  const teamRunning =
    team &&
    (team.status === "forming" ||
      team.status === "running" ||
      team.status === "blocked" ||
      team.status === "integrating");
  const teamId = team?.teamId ?? "";
  const memberAgentIds = team?.memberAgentIds;
  const { memberById, currentMembers, childrenByParent } = useMemo(
    () => indexAgentTeamTree(members, memberAgentIds ?? []),
    [memberAgentIds, members],
  );
  const [expandedAgentIds, setExpandedAgentIds] = useState<Set<string>>(
    () => new Set(),
  );
  const expansionTeamId = useRef(teamId);
  const manuallyToggledAgentIds = useRef(new Set<string>());
  useEffect(() => {
    const defaultExpanded = currentMembers
      .filter(
        (member) =>
          (member.depth ?? 1) === 1 &&
          (childrenByParent.get(member.agentId)?.length ?? 0) > 0,
      )
      .map((member) => member.agentId);
    if (expansionTeamId.current !== teamId) {
      expansionTeamId.current = teamId;
      manuallyToggledAgentIds.current.clear();
      setExpandedAgentIds(new Set(defaultExpanded));
      return;
    }
    setExpandedAgentIds((current) => {
      const next = new Set(current);
      let changed = false;
      for (const agentId of defaultExpanded) {
        if (
          !next.has(agentId) &&
          !manuallyToggledAgentIds.current.has(agentId)
        ) {
          next.add(agentId);
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [childrenByParent, currentMembers, teamId]);
  const visibleMembers = useMemo(() => {
    return visibleAgentTeamMembers(childrenByParent, expandedAgentIds);
  }, [childrenByParent, expandedAgentIds]);
  const agentName = (agentId: string) =>
    agentId === "parent"
      ? labels.parent
      : agentId === "all"
        ? labels.everyone
        : (memberById.get(agentId)?.label ?? agentId);

  useLayoutEffect(() => {
    if (!active || !messageList.current) return;
    messageList.current.scrollTop = messageList.current.scrollHeight;
  }, [active, messages.length]);

  if (!team) {
    return (
      <section className="agent-team-panel unavailable">
        <div className="agent-team-empty">
          <ChildAgentIcon
            className="agent-team-empty-icon"
            identity="agent-team"
          />
          <strong>{labels.title}</strong>
          <p>{labels.unavailable}</p>
          <span aria-hidden="true" className="agent-team-skeleton">
            <i />
            <i />
            <i />
          </span>
        </div>
      </section>
    );
  }

  return (
    <section className={`agent-team-panel ${team.status}`}>
      <header className="agent-team-header">
        <div>
          <span className="agent-team-eyebrow">
            <ArtemisIcon name="agents" width={14} height={14} />
            {labels.title}
          </span>
          <strong title={team.mission}>{team.mission}</strong>
          <Badge
            className="agent-panel-status"
            tone={
              team.status === "completed"
                ? "success"
                : team.status === "blocked" || team.status === "aborted"
                  ? "danger"
                  : "warning"
            }
          >
            {(team.status === "running"
              ? teamStatusLabels.teamRunning
              : teamStatusLabels[team.status]) +
              (!runtimeAvailable && teamRunning ? ` · ${labels.history}` : "")}
          </Badge>
        </div>
      </header>
      {team.error && <p className="agent-team-error">{team.error}</p>}
      <div className="agent-team-grid">
        <aside className="agent-team-members">
          <h3>
            {labels.teamMembers} · {currentMembers.length}
          </h3>
          <div className="agent-team-member-list">
            {visibleMembers.map((member) => {
              const childCount =
                childrenByParent.get(member.agentId)?.length ?? 0;
              const expanded = expandedAgentIds.has(member.agentId);
              return (
                <div
                  className={`agent-team-member ${member.status}`}
                  key={member.agentId}
                  style={{
                    paddingInlineStart: ((member.depth ?? 1) - 1) * 16,
                  }}
                >
                  {childCount > 0 ? (
                    <button
                      aria-expanded={expanded}
                      aria-label={`${expanded ? labels.collapse : labels.expand}: ${member.label}`}
                      className="agent-team-member-disclosure"
                      onClick={() => {
                        manuallyToggledAgentIds.current.add(member.agentId);
                        setExpandedAgentIds((current) => {
                          const next = new Set(current);
                          if (next.has(member.agentId)) {
                            next.delete(member.agentId);
                          } else {
                            next.add(member.agentId);
                          }
                          return next;
                        });
                      }}
                      type="button"
                    >
                      <ArtemisIcon name="chev-right" />
                    </button>
                  ) : null}
                  <button
                    className="agent-team-member-open"
                    onClick={() => onOpenChildAgent(member)}
                    type="button"
                  >
                    <ChildAgentIcon identity={member.agentId} />
                    <span className="agent-team-member-summary">
                      <strong>{member.label}</strong>
                      <small>
                        {member.customAgent
                          ? customAgentInstanceIdentity(
                              member.customAgent,
                              locale,
                            )
                          : member.status === "completed"
                            ? agentMemberStatus(member.status, locale)
                            : (member.currentTool ??
                              member.activity
                                ?.split("\n")
                                .find((line) => line.trim()) ??
                              agentMemberStatus(member.status, locale))}
                      </small>
                    </span>
                    {member.status === "completed" ? (
                      <span className="agent-team-member-view">
                        {labels.teamView}
                      </span>
                    ) : (
                      <Badge
                        className="agent-panel-status"
                        tone={agentMemberTone(member.status)}
                      >
                        {agentMemberStatus(member.status, locale)}
                      </Badge>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </aside>
        <section className="agent-team-collaboration">
          <h3>{labels.teamMessages}</h3>
          <div className="agent-team-message-list" ref={messageList}>
            {messages.length === 0 ? (
              <p className="agent-team-message-empty">{labels.noMessages}</p>
            ) : (
              messages.map((message) => (
                <article
                  className={`agent-team-message ${message.kind}`}
                  key={message.messageId}
                >
                  <header>
                    <strong>{agentName(message.fromAgentId)}</strong>
                    <span title={agentName(message.recipient)}>
                      {messageKindLabels[message.kind]}
                      {message.recipient !== "all" &&
                      message.recipient !== "parent"
                        ? ` → ${agentName(message.recipient)}`
                        : ""}
                    </span>
                    <time>
                      {new Intl.DateTimeFormat(locale, {
                        hour: "2-digit",
                        hourCycle: "h23",
                        minute: "2-digit",
                      }).format(new Date(message.createdAt))}
                    </time>
                  </header>
                  <p>{message.content}</p>
                </article>
              ))
            )}
          </div>
        </section>
        {teamRunning && runtimeAvailable && (
          <div className="agent-team-footer">
            <Button
              variant="quiet"
              disabled={controlPending}
              onClick={() => onStop(team)}
            >
              {labels.teamStop}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
