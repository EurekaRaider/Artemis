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
  lastActivityAt?: string,
  status: ChildAgentState["status"] = "queued",
): ChildAgentState {
  return {
    type: "child-agent.status",
    agentId,
    label: agentId,
    parentAgentId,
    depth,
    subtreeStatus: depth === 1 ? "running" : "leaf",
    directChildCount: depth === 1 ? 7 : 0,
    status,
    ...(lastActivityAt ? { lastActivityAt } : {}),
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

  it("orders siblings by recent activity and sinks finished members", () => {
    const older = member(
      "older",
      "parent",
      1,
      "2026-08-31T10:00:00.000Z",
      "running",
    );
    const recent = member(
      "recent",
      "parent",
      1,
      "2026-08-31T10:05:00.000Z",
      "running",
    );
    const finished = member(
      "finished",
      "parent",
      1,
      "2026-08-31T10:10:00.000Z",
      "completed",
    );
    const index = indexAgentTeamTree(
      [older, recent, finished],
      [older.agentId, recent.agentId, finished.agentId],
    );

    expect(visibleAgentTeamMembers(index.childrenByParent, new Set())).toEqual([
      recent,
      older,
      finished,
    ]);
  });
});
