// @vitest-environment jsdom
// Composer @ sub-agent mention contract (D#152 PR4): cursor-tracked @query
// candidates (enabled + project-effective only), keyboard selection that
// removes the typed fragment and binds a structured draft reference, and
// the max-one-chip gate. The send-path wiring is locked by source contract
// (same convention as renderer-layout.test.ts).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { useRef, useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  CustomAgentMentionMenu,
  customAgentColorToken,
  customAgentEffectiveForProject,
  useCustomAgentMention,
} from "../src/renderer/CustomAgentMention.js";
import type { CustomAgentDraftReference } from "../src/renderer/composer-drafts.js";
import type { CustomAgentSummary } from "../src/shared/api.js";
import "./renderer-test-utils.js";

const appSource = readFileSync(
  resolve(process.cwd(), "src/renderer/App.tsx"),
  "utf8",
);

function summary(overrides: Partial<CustomAgentSummary>): CustomAgentSummary {
  return {
    id: "def-1",
    revision: 3,
    name: "Reviewer",
    description: "Reviews diffs",
    color: "blue",
    enabled: true,
    scope: "all",
    projectIds: [],
    modelPolicy: { kind: "inherit" },
    thinkingPolicy: { kind: "inherit" },
    toolPolicy: { kind: "inherit" },
    allowAutomaticInvocation: false,
    triggers: ["review"],
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

const definitions: CustomAgentSummary[] = [
  summary({ id: "def-1", name: "Reviewer" }),
  summary({
    id: "def-2",
    name: "文档写手",
    description: "Writes docs",
    color: "teal",
    scope: "selected",
    projectIds: ["proj-1"],
    triggers: [],
  }),
  summary({ id: "def-3", name: "Disabled one", enabled: false }),
];

function Harness({
  enabled = true,
  onSelect,
  projectId,
  members,
}: {
  enabled?: boolean;
  onSelect(reference: CustomAgentDraftReference): void;
  projectId?: string | undefined;
  members?: Parameters<typeof useCustomAgentMention>[0]["members"];
}) {
  const [text, setText] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const mention = useCustomAgentMention({
    definitions,
    projectId,
    text,
    setText,
    input,
    enabled,
    onSelect,
    members,
  });
  return (
    <>
      <textarea
        aria-label="prompt"
        onChange={(event) => {
          mention.changed(event.target.selectionStart);
          setText(event.target.value);
        }}
        onKeyDown={(event) => {
          mention.keyDown(event);
        }}
        onSelect={(event) =>
          mention.selected(event.currentTarget.selectionStart)
        }
        ref={input}
        value={text}
      />
      <CustomAgentMentionMenu mention={mention} zh={false} />
    </>
  );
}

const memberCandidates = [
  {
    deviceId: "device-1",
    name: "Reviewer",
    deviceName: "Test Mac",
    identity: {
      channel: "slack" as const,
      connectionId: "slack",
      appId: "bot",
      tenantId: "test",
      userId: "user",
    },
    state: "online" as const,
    token: "@Reviewer",
  },
];

describe("combined member and sub-agent mentions", () => {
  it("shows one list and selects the sub-agent after the member with the keyboard", async () => {
    const user = userEvent.setup(),
      onSelect = vi.fn(),
      insert = vi.fn();
    render(
      <Harness
        onSelect={onSelect}
        members={{ candidates: memberCandidates, insert }}
      />,
    );
    await user.type(screen.getByLabelText("prompt"), "@");
    expect(screen.getAllByRole("listbox")).toHaveLength(1);
    expect(screen.getAllByRole("option")).toHaveLength(2);
    await user.keyboard("{ArrowDown}{Enter}");
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ definitionId: "def-1" }),
    );
    expect(insert).not.toHaveBeenCalled();
    expect(screen.getByLabelText("prompt")).toHaveValue("");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("keeps member selection available while a sub-agent is already attached", async () => {
    const user = userEvent.setup(),
      onSelect = vi.fn(),
      insert = vi.fn();
    render(
      <Harness
        enabled={false}
        onSelect={onSelect}
        members={{ candidates: memberCandidates, insert }}
      />,
    );
    await user.type(screen.getByLabelText("prompt"), "@");
    await user.click(screen.getByRole("button", { name: /Test Mac/ }));
    expect(insert).toHaveBeenCalledWith("@Reviewer");
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});

describe("useCustomAgentMention", () => {
  it("lists only enabled definitions effective for the current project", async () => {
    const user = userEvent.setup();
    render(<Harness onSelect={vi.fn()} projectId="proj-1" />);
    const box = screen.getByLabelText("prompt");
    await user.click(box);
    await user.type(box, "@");

    const menu = screen.getByRole("listbox");
    expect(menu).toHaveTextContent("Reviewer");
    // Scoped to proj-1, so visible here.
    expect(menu).toHaveTextContent("文档写手");
    // Disabled definitions never appear.
    expect(menu).not.toHaveTextContent("Disabled one");
  });

  it("hides selected-scope definitions for other projects", async () => {
    const user = userEvent.setup();
    render(<Harness onSelect={vi.fn()} projectId="proj-2" />);
    const box = screen.getByLabelText("prompt");
    await user.click(box);
    await user.type(box, "@");

    const menu = screen.getByRole("listbox");
    expect(menu).toHaveTextContent("Reviewer");
    expect(menu).not.toHaveTextContent("文档写手");
  });

  it("filters candidates by name, description, and trigger substring", async () => {
    const user = userEvent.setup();
    render(<Harness onSelect={vi.fn()} projectId="proj-1" />);
    const box = screen.getByLabelText("prompt");
    await user.click(box);
    await user.type(box, "@docs");

    const menu = screen.getByRole("listbox");
    expect(menu).toHaveTextContent("文档写手");
    expect(menu).not.toHaveTextContent("Reviewer");
  });

  it("removes the typed @fragment and binds the structured reference", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} projectId="proj-1" />);
    const box = screen.getByLabelText("prompt");
    await user.click(box);
    await user.type(box, "please @rev");

    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith({
      definitionId: "def-1",
      revision: 3,
      name: "Reviewer",
      color: "blue",
    });
    // The @query text is gone; the reference rides the draft, not the text.
    expect(box).toHaveValue("please ");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("preserves text after the cursor when the fragment sits mid-prompt", () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} projectId="proj-1" />);
    const box = screen.getByLabelText("prompt") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "please @rev check this" } });
    // Park the cursor right after the fragment and tell the hook.
    box.setSelectionRange(11, 11);
    fireEvent.select(box);

    fireEvent.keyDown(box, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ definitionId: "def-1" }),
    );
    expect(box).toHaveValue("please  check this");
  });

  it("navigates with arrow keys and selects the highlighted candidate", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} projectId="proj-1" />);
    const box = screen.getByLabelText("prompt");
    await user.click(box);
    await user.type(box, "@");

    await user.keyboard("{ArrowDown}{Enter}");
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ definitionId: "def-2", name: "文档写手" }),
    );
  });

  it("dismisses on Escape and reopens on the next change", async () => {
    const user = userEvent.setup();
    render(<Harness onSelect={vi.fn()} projectId="proj-1" />);
    const box = screen.getByLabelText("prompt");
    await user.click(box);
    await user.type(box, "@");
    expect(screen.getByRole("listbox")).toBeTruthy();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();

    await user.type(box, "r");
    expect(screen.getByRole("listbox")).toBeTruthy();
  });

  it("stays closed while a chip is attached (max one reference)", async () => {
    const user = userEvent.setup();
    render(<Harness enabled={false} onSelect={vi.fn()} projectId="proj-1" />);
    const box = screen.getByLabelText("prompt");
    await user.click(box);
    await user.type(box, "@rev");
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});

describe("custom agent mention helpers", () => {
  it("sanitizes unknown chip colors to the gray token", () => {
    expect(customAgentColorToken("teal")).toBe("teal");
    expect(customAgentColorToken("hotpink")).toBe("gray");
    expect(customAgentColorToken("")).toBe("gray");
  });

  it("applies the scope contract without widening", () => {
    const all = summary({ scope: "all" });
    const selected = summary({ scope: "selected", projectIds: ["proj-1"] });
    expect(customAgentEffectiveForProject(all, undefined)).toBe(true);
    expect(customAgentEffectiveForProject(selected, "proj-1")).toBe(true);
    expect(customAgentEffectiveForProject(selected, "proj-2")).toBe(false);
    // Selected scope under a projectless draft is nowhere-effective.
    expect(customAgentEffectiveForProject(selected, undefined)).toBe(false);
    expect(
      customAgentEffectiveForProject(summary({ enabled: false }), "proj-1"),
    ).toBe(false);
  });
});

describe("composer send wiring (source contract)", () => {
  it("carries the reference on startTurn with a per-submission invocationId", () => {
    expect(appSource).toContain("customAgentTasks:");
    expect(appSource).toContain("invocationId: crypto.randomUUID()");
  });

  it("blocks @ dispatch on a busy thread instead of queueing it", () => {
    const followUp = appSource.indexOf("await window.artemis.followUpTurn({");
    const guard = appSource.indexOf("t.customAgentWhileRunning");
    expect(guard).toBeGreaterThan(-1);
    expect(followUp).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(followUp);
  });

  it("clears the chip together with the submitted prompt", () => {
    const clearStart = appSource.indexOf("const clearSubmittedPrompt");
    const body = appSource.slice(clearStart, clearStart + 800);
    expect(body).toContain("setCustomAgentTasks([])");
  });
});
