// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import {
  APP_LOCALES,
  type RunMode,
  type TurnViewState,
} from "@artemis/protocol";
import { WorkRecord } from "../../../src/renderer/conversation/WorkRecord.js";
import { ComposerRunModeControl } from "../../../src/renderer/conversation/ComposerContextBar.js";
import { toolStepPresentation } from "../../../src/renderer/conversation/tool-presentation.js";

afterEach(cleanup);
const turn: TurnViewState = {
  id: "turn",
  mode: "work",
  status: "running",
  order: [],
  startedAt: new Date().toISOString(),
};
it("retains a manual running disclosure, then collapses when that turn completes", async () => {
  const props = {
    locale: "en" as const,
    entries: [{ kind: "tool-group" as const, key: "read", toolIds: ["a"] }],
    childAgents: {},
  };
  const { container, rerender } = render(
    <WorkRecord {...props} turn={turn}>
      <span>Tool details</span>
    </WorkRecord>,
  );
  const details = container.querySelector("details")!;
  expect(details.open).toBe(true);
  details.open = false;
  fireEvent(details, new Event("toggle"));
  rerender(
    <WorkRecord {...props} turn={{ ...turn }}>
      <span>Updated tool details</span>
    </WorkRecord>,
  );
  expect(details.open).toBe(false);
  details.open = true;
  fireEvent(details, new Event("toggle"));
  rerender(
    <WorkRecord
      {...props}
      turn={{ ...turn, status: "completed", durationMs: 3400 }}
    >
      <span>Final tool details</span>
    </WorkRecord>,
  );
  expect(container.querySelector("details")!.open).toBe(false);
  expect(container.querySelector("summary")).toBeVisible();
});
it("opens failed work and counts merged groups once", () => {
  const { container } = render(
    <WorkRecord
      locale="en"
      turn={{ ...turn, status: "failed" }}
      entries={[{ kind: "tool-group", key: "read", toolIds: ["a", "b"] }]}
      childAgents={{}}
    >
      Error details
    </WorkRecord>,
  );
  expect(container.querySelector("details")!.open).toBe(true);
  expect(screen.getByText(/1 steps/)).toBeVisible();
});
it.each(["completed", "failed"] as const)(
  "keeps a zero-step %s record static and shows changed files",
  (status) => {
    const { container } = render(
      <WorkRecord
        locale="en"
        turn={{ ...turn, status, durationMs: 41000 }}
        changedFileCount={2}
        entries={[]}
        childAgents={{}}
      >
        No tools
      </WorkRecord>,
    );
    expect(container.querySelector("details")).toBeNull();
    expect(container.querySelector(".work-record-chevron")).toBeNull();
    expect(screen.queryByText(/0 steps/)).toBeNull();
    expect(screen.getByText(/41s · 2 files/)).toBeVisible();
  },
);
it("keeps all modes visible and routes keyboard selection through the existing callback", async () => {
  const changed = vi.fn();
  function Harness({ disabled = false }: { disabled?: boolean }) {
    const [mode, setMode] = useState<RunMode>("work");
    return (
      <ComposerRunModeControl
        locale="en"
        mode={mode}
        disabled={disabled}
        onModeChange={(value) => {
          changed(value);
          setMode(value);
        }}
      />
    );
  }
  const { rerender } = render(<Harness />);
  const radios = screen.getAllByRole("radio");
  expect(radios).toHaveLength(3);
  radios.forEach((r) => expect(r).toBeVisible());
  radios[1]!.focus();
  await userEvent.keyboard("{ArrowRight}");
  expect(changed).toHaveBeenLastCalledWith("codemode");
  rerender(<Harness disabled />);
  await userEvent.click(radios[0]!);
  expect(changed).toHaveBeenCalledTimes(1);
  screen.getAllByRole("radio").forEach((r) => expect(r).toBeDisabled());
});
it("derives compact paths, search counts, diffs and shell results without inventing data", () => {
  const base = { status: "completed" as const, output: "" };
  expect(
    toolStepPresentation(
      ["a", "b", "c"].map((path) => ({
        ...base,
        name: "read",
        input: { path },
      })),
      "en",
    ).target,
  ).toBe("a · b · +1");
  expect(
    toolStepPresentation(
      [
        {
          ...base,
          name: "web_search",
          input: { query: "electron" },
          output: JSON.stringify({ results: [{}, {}] }),
        },
      ],
      "en",
    ),
  ).toMatchObject({ icon: "web", metadata: "2 results", target: "electron" });
  expect(
    toolStepPresentation(
      [
        {
          ...base,
          name: "edit",
          input: { path: "a.ts" },
          output: "--- a.ts\n+++ a.ts\n-old\n+new\n+line",
        },
      ],
      "en",
    ),
  ).toMatchObject({ added: 2, deleted: 1 });
  expect(
    toolStepPresentation(
      [
        {
          ...base,
          name: "bash",
          input: { command: "npm test\necho done" },
          output: "Tests 12 passed",
        },
      ],
      "en",
    ),
  ).toMatchObject({ target: "npm test", metadata: "12 passed" });
  expect(
    toolStepPresentation(
      [{ ...base, name: "read", input: { path: "file" } }],
      "en",
    ).metadata,
  ).toBe("");
  expect(
    toolStepPresentation([{ ...base, name: "mcp__server__fetch" }], "en"),
  ).toMatchObject({ icon: "mcp", target: "server · fetch" });
});
it.each(APP_LOCALES)("localizes work verbs in %s", (locale) => {
  expect(
    toolStepPresentation(
      [
        {
          name: "read",
          status: "running",
          output: "",
          input: { path: "README.md" },
        },
      ],
      locale,
    ).verb,
  ).not.toContain("WorkRecord.");
});
