// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  imSettingsSchema,
  type ExecutionGrant,
  type ImGroupContext,
} from "@artemis/protocol";
import { ImGroupContextSummary } from "../../../src/renderer/im/ImGroupContextSummary.js";
import { useImThreadStatus } from "../../../src/renderer/im/ImThreadConnection.js";
import { stubWindowArtemis } from "../../fixtures/renderer-test-utils.js";

const group: ImGroupContext = {
  spaceId: "team",
  name: "Research",
  confirmed: true,
  stale: false,
  executingDeviceId: "local",
  members: [],
};
const project = {
  id: "project",
  name: "Notes",
  path: "/synthetic/notes",
  createdAt: "2026-10-31T00:00:00Z",
  updatedAt: "2026-10-31T00:00:00Z",
};
const grant: ExecutionGrant = {
  projectId: project.id,
  mode: "plan",
  approval: "ask",
  network: false,
  shell: false,
  groups: ["space:team"],
  expiresAt: 4_000_000_000_000,
  security: {
    version: 2,
    revision: "revision",
    confirmedAt: 0,
    scopes: [
      { audience: "space:team", readPaths: ["docs/sources"], writePaths: [] },
    ],
  },
};
const connection = {
  channel: "slack",
  connectionState: "connected" as const,
  serviceEnabled: true,
  groupGrants: [grant],
  group,
};
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("presents the current group's saved project scope without claiming local files are invisible", () => {
  const manage = vi.fn();
  render(
    <ImGroupContextSummary
      group={group}
      connection={connection}
      project={project}
      locale="en"
      onManageAuthorization={manage}
    />,
  );
  expect(screen.getByText("Slack · Research")).toBeVisible();
  expect(screen.getByText("Connected")).toBeVisible();
  expect(screen.getByText("Notes")).toBeVisible();
  expect(
    screen.getByText("Queries only; writes and commands denied"),
  ).toBeVisible();
  expect(screen.getByText("Ask each time")).toBeVisible();
  expect(screen.getByText("docs/sources")).toBeVisible();
  expect(screen.getByText("Denied")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Edit authorization" }));
  expect(manage).toHaveBeenCalledOnce();
});

it.each(["stale", "missing-project", "missing-audience"] as const)(
  "does not infer authorization from %s data",
  (condition) => {
    const inputGroup =
      condition === "stale" ? { ...group, stale: true } : group;
    const inputGrant =
      condition === "missing-project"
        ? { ...grant, projectId: "other" }
        : condition === "missing-audience"
          ? {
              ...grant,
              security: {
                ...grant.security!,
                scopes: [
                  {
                    audience: "space:other",
                    readPaths: ["private"],
                    writePaths: [],
                  },
                ],
              },
            }
          : grant;
    render(
      <ImGroupContextSummary
        group={inputGroup}
        connection={{ ...connection, groupGrants: [inputGrant] }}
        project={project}
        locale="en"
      />,
    );
    expect(screen.queryByText("Execution authorized")).toBeNull();
    expect(screen.queryByText("docs/sources")).toBeNull();
    expect(screen.queryByText("private")).toBeNull();
    expect(screen.getAllByText("Status unknown").length).toBeGreaterThan(0);
  },
);

it("drops expired group grants on the existing status refresh and keeps other audiences out", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-31T00:00:00Z"));
  stubWindowArtemis({
    getImStatus: vi.fn().mockResolvedValue({
      settings: imSettingsSchema.parse({
        enabled: true,
        grants: [
          { ...grant, expiresAt: Date.now() + 1000 },
          { ...grant, projectId: "other", groups: ["space:other"] },
        ],
      }),
      state: "connected",
      identities: [],
      remoteTasks: [
        {
          threadId: "thread",
          kind: "group",
          channel: "slack",
          connectionState: "connected",
          group,
        },
      ],
    }),
  });
  const { result } = renderHook(useImThreadStatus);
  await act(async () => {});
  expect(result.current.thread?.groupGrants).toHaveLength(1);
  await act(() => vi.advanceTimersByTimeAsync(2000));
  expect(result.current.thread?.groupGrants).toEqual([]);
});
