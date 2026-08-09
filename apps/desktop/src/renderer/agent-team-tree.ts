import type { ChildAgentState } from "@artemis/protocol";

export interface AgentTeamTreeIndex {
  memberById: Map<string, ChildAgentState>;
  currentMembers: ChildAgentState[];
  childrenByParent: Map<string, ChildAgentState[]>;
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
