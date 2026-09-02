// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  EnvironmentControl,
  EnvironmentPanelSurface,
  EnvironmentSection,
  EnvironmentTrigger,
  GoalEditorFooter,
  GoalEditorInput,
  GoalEditorSurface,
  ReviewDiff,
  ReviewDiffHeader,
  ReviewDiffHunk,
  ReviewDiffLine,
  ReviewDiffLines,
  ReviewDiffReader,
  ReviewFileSidebar,
  ReviewState,
  ReviewSurface,
  ReviewToolbar,
  ReviewWorkspace,
  SourceEntry,
  SourceEntryBody,
  SourceEntryButton,
  SourceEntryIcon,
  SourcesScroll,
  SourcesState,
  SourcesSurface,
  WORKFLOW_ACCESSIBLE_NAME_ERROR,
  WORKFLOW_COMPONENT_CONTRACTS,
  validateWorkflowComponentContracts,
} from "../src/workflow.js";

afterEach(() => cleanup());

describe("workflow surface public contract", () => {
  it("is deeply frozen and rejects contract drift", () => {
    expect(Object.isFrozen(WORKFLOW_COMPONENT_CONTRACTS)).toBe(true);
    expect(Object.isFrozen(WORKFLOW_COMPONENT_CONTRACTS.reviewSurface)).toBe(
      true,
    );
    expect(
      validateWorkflowComponentContracts(WORKFLOW_COMPONENT_CONTRACTS),
    ).toEqual({ valid: true, errors: [] });
    expect(
      validateWorkflowComponentContracts({
        ...WORKFLOW_COMPONENT_CONTRACTS,
        goalEditor: {
          ...WORKFLOW_COMPONENT_CONTRACTS.goalEditor,
          states: ["ready"],
        },
      }).valid,
    ).toBe(false);
  });

  it("requires perceptible labels", () => {
    expect(() =>
      render(<SourcesSurface label={"\u200b"}>Sources</SourcesSurface>),
    ).toThrow(WORKFLOW_ACCESSIBLE_NAME_ERROR);
    expect(() =>
      render(<SourceEntryButton label={"\u200b"}>Open</SourceEntryButton>),
    ).toThrow(WORKFLOW_ACCESSIBLE_NAME_ERROR);
  });

  it("renders review anatomy, states, and non-color diff markers", () => {
    render(
      <ReviewSurface busy label="Code review">
        <ReviewToolbar>Workspace against HEAD</ReviewToolbar>
        <ReviewWorkspace>
          <ReviewDiffReader label="Changed code">
            <ReviewDiff state="selected">
              <ReviewDiffHeader>src/App.tsx</ReviewDiffHeader>
              <ReviewDiffHunk>
                <ReviewDiffLines>
                  <ReviewDiffLine kind="deletion">old line</ReviewDiffLine>
                  <ReviewDiffLine kind="addition">new line</ReviewDiffLine>
                  <ReviewDiffLine kind="context">context line</ReviewDiffLine>
                </ReviewDiffLines>
              </ReviewDiffHunk>
            </ReviewDiff>
          </ReviewDiffReader>
          <ReviewFileSidebar label="Changed files">App.tsx</ReviewFileSidebar>
        </ReviewWorkspace>
      </ReviewSurface>,
    );
    const review = screen.getByRole("region", { name: "Code review" });
    expect(review).toHaveAttribute("aria-busy", "true");
    expect(review).toHaveAttribute("data-state", "loading");
    expect(
      document.querySelectorAll('[data-artemis-component="review-diff"]'),
    ).toHaveLength(7);
    expect(screen.getByText("old line")).toHaveAttribute(
      "data-state",
      "deletion",
    );
    expect(
      [...document.querySelectorAll('[data-part="marker"]')].map(
        (marker) => marker.textContent,
      ),
    ).toEqual(["−", "+", " "]);
    for (const marker of document.querySelectorAll('[data-part="marker"]')) {
      expect(marker).toHaveAttribute("aria-hidden", "true");
    }
    expect(
      document.querySelector(
        '[data-artemis-component="review-diff"][data-part="root"]',
      ),
    ).toHaveAttribute("data-state", "selected");
  });

  it("exposes empty and error semantics", () => {
    render(
      <>
        <ReviewState state="loading">Loading changes</ReviewState>
        <ReviewState state="empty">No changes</ReviewState>
        <ReviewState state="error">Diff unavailable</ReviewState>
        <SourcesState state="loading">Loading sources</SourcesState>
        <SourcesState state="empty">No sources</SourcesState>
        <SourcesState state="error">Preview failed</SourcesState>
      </>,
    );
    expect(screen.getAllByRole("status")).toHaveLength(4);
    expect(screen.getAllByRole("alert")).toHaveLength(2);
    expect(document.querySelectorAll('[data-part="loading"]')).toHaveLength(2);
  });

  it("keeps Environment open state and actions caller-owned", async () => {
    const onToggle = vi.fn();
    render(
      <EnvironmentControl open>
        <EnvironmentTrigger
          controls="environment-details"
          expanded
          icon={<svg aria-hidden="true" />}
          label="Environment"
          onClick={onToggle}
        />
        <EnvironmentPanelSurface
          id="environment-details"
          label="Environment details"
        >
          <EnvironmentSection
            action={<button type="button">Refresh</button>}
            title="Git"
          >
            main · clean
          </EnvironmentSection>
        </EnvironmentPanelSurface>
      </EnvironmentControl>,
    );
    const trigger = screen.getByRole("button", { name: "Environment" });
    expect(trigger).toHaveAttribute("aria-controls", "environment-details");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const panel = screen.getByRole("dialog", { name: "Environment details" });
    expect(panel).toHaveAttribute("id", "environment-details");
    expect(panel).toHaveAttribute("data-state", "open");
    await userEvent.setup().click(trigger);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("renders controlled Goal input, footer status, and native disabled state", async () => {
    const onChange = vi.fn();
    render(
      <GoalEditorSurface label="Goal" state="dirty">
        <GoalEditorInput
          aria-label="Goal objective"
          onChange={onChange}
          value="Ship MIG3B"
        />
        <GoalEditorFooter actions={<button disabled>Save</button>}>
          Updated now
        </GoalEditorFooter>
      </GoalEditorSurface>,
    );
    await userEvent
      .setup()
      .type(screen.getByRole("textbox", { name: "Goal objective" }), "!");
    expect(onChange).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("region", { name: "Goal" })).toHaveAttribute(
      "data-state",
      "dirty",
    );
  });

  it("renders Sources anatomy and caller-owned entries", () => {
    render(
      <SourcesSurface label="Sources">
        <SourcesScroll>
          <SourceEntry>
            <SourceEntryIcon>icon</SourceEntryIcon>
            <SourceEntryBody>
              <h2>report.pdf</h2>
              <p>Added to task</p>
            </SourceEntryBody>
          </SourceEntry>
          <SourceEntryButton label="Open report">Open report</SourceEntryButton>
        </SourcesScroll>
      </SourcesSurface>,
    );
    expect(screen.getByRole("region", { name: "Sources" })).toHaveAttribute(
      "data-state",
      "ready",
    );
    expect(screen.getByRole("article")).toHaveAttribute("data-part", "entry");
    expect(screen.getByRole("button", { name: "Open report" })).toHaveAttribute(
      "data-part",
      "entry",
    );
  });

  it("supports deterministic server rendering without runtime ownership", () => {
    const html = renderToString(
      <GoalEditorSurface label="Goal" state="loading">
        Loading
      </GoalEditorSurface>,
    );
    expect(html).toContain('data-artemis-component="goal-editor"');
    expect(html).not.toContain("aria-busy");
    expect(html).not.toContain("window.artemis");
  });
});
