import type { ChildAgentState } from "@artemis/protocol";

export interface AgentTeamTreeIndex {
  memberById: Map<string, ChildAgentState>;
  currentMembers: ChildAgentState[];
  childrenByParent: Map<string, ChildAgentState[]>;
}

const TERMINAL_AGENT_STATUSES = new Set<ChildAgentState["status"]>([
  "completed",
  "failed",
  "cancelled",
]);

function activityTime(agent: ChildAgentState): number {
  const value = agent.lastActivityAt ?? agent.updatedAt ?? agent.startedAt;
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function compareAgentActivity(
  left: ChildAgentState,
  right: ChildAgentState,
): number {
  const terminalDifference =
    Number(TERMINAL_AGENT_STATUSES.has(left.status)) -
    Number(TERMINAL_AGENT_STATUSES.has(right.status));
  if (terminalDifference !== 0) return terminalDifference;
  return activityTime(right) - activityTime(left);
}

export function sortAgentsByActivity(
  agents: readonly ChildAgentState[],
): ChildAgentState[] {
  return [...agents].sort(compareAgentActivity);
}

export function indexAgentTeamTree(
  members: readonly ChildAgentState[],
  memberAgentIds: readonly string[],
): AgentTeamTreeIndex {
  const memberById = new Map(
    members.map((member) => [member.agentId, member] as const),
  );
  const currentMembers = memberAgentIds.flatMap((agentId) => {
    const member = memberById.get(agentId);
    return member ? [member] : [];
  });
  const childrenByParent = new Map<string, ChildAgentState[]>();
  for (const member of currentMembers) {
    const parentAgentId = member.parentAgentId ?? "parent";
    const children = childrenByParent.get(parentAgentId) ?? [];
    children.push(member);
    childrenByParent.set(parentAgentId, children);
  }
  for (const children of childrenByParent.values()) {
    children.sort(compareAgentActivity);
  }
  return { memberById, currentMembers, childrenByParent };
}

export function visibleAgentTeamMembers(
  childrenByParent: ReadonlyMap<string, readonly ChildAgentState[]>,
  expandedAgentIds: ReadonlySet<string>,
): ChildAgentState[] {
  const visible: ChildAgentState[] = [];
  const pending = [...(childrenByParent.get("parent") ?? [])].reverse();
  while (pending.length > 0) {
    const member = pending.pop()!;
    visible.push(member);
    if (!expandedAgentIds.has(member.agentId)) continue;
    const children = childrenByParent.get(member.agentId) ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push(children[index]!);
    }
  }
  return visible;
}
