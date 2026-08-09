import { describe, expect, it } from "vitest";
import type { ChildAgentState } from "@artemis/protocol";

import {
  indexAgentTeamTree,
  visibleAgentTeamMembers,
} from "../src/renderer/agent-team-tree.js";

function member(
  agentId: string,
  parentAgentId: string,
  depth: number,
): ChildAgentState {
  return {
    type: "child-agent.status",
    agentId,
    label: agentId,
    parentAgentId,
    depth,
    subtreeStatus: depth === 1 ? "running" : "leaf",
    directChildCount: depth === 1 ? 7 : 0,
    status: "queued",
  };
}

describe("agent team tree", () => {
  it("indexes and expands a 64-node tree without repeated linear lookups", () => {
    const roots = Array.from({ length: 8 }, (_, index) =>
      member(`root-${index}`, "parent", 1),
    );
    const children = roots.flatMap((root) =>
      Array.from({ length: 7 }, (_, index) =>
        member(`${root.agentId}-child-${index}`, root.agentId, 2),
      ),
    );
    const members = [...roots, ...children];
    const index = indexAgentTeamTree(
      members,
      members.map((candidate) => candidate.agentId),
    );

    expect(index.memberById).toHaveLength(64);
    expect(visibleAgentTeamMembers(index.childrenByParent, new Set())).toEqual(
      roots,
    );
    expect(
      visibleAgentTeamMembers(
        index.childrenByParent,
        new Set(roots.map((root) => root.agentId)),
      ),
    ).toHaveLength(64);
  });
});
