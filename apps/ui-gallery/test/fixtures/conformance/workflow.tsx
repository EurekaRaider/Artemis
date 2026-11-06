import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";
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
  SourceEntryIcon,
  SourcesScroll,
  SourcesState,
  SourcesSurface,
  WORKFLOW_COMPONENT_CONTRACTS,
} from "@artemis/ui/workflow";
import { MatrixIcon, workflowSource, uiCss } from "./shared.js";

export const workflowCases = {
  "workflow-anatomy"() {
    const { container } = render(
      <>
        <ReviewSurface label="Review">
          <ReviewToolbar>Toolbar</ReviewToolbar>
          <ReviewWorkspace>
            <ReviewDiffReader label="Diff reader">
              <ReviewDiff state="selected">
                <ReviewDiffHeader>App.tsx</ReviewDiffHeader>
                <ReviewDiffHunk>
                  <ReviewDiffLines>
                    <ReviewDiffLine kind="addition">public</ReviewDiffLine>
                  </ReviewDiffLines>
                </ReviewDiffHunk>
              </ReviewDiff>
            </ReviewDiffReader>
            <ReviewFileSidebar label="Changed files">App.tsx</ReviewFileSidebar>
          </ReviewWorkspace>
        </ReviewSurface>
        <EnvironmentControl open>
          <EnvironmentTrigger
            controls="matrix-environment-details"
            expanded
            icon={<MatrixIcon />}
            label="Environment"
          />
          <EnvironmentPanelSurface
            id="matrix-environment-details"
            label="Environment details"
          >
            <EnvironmentSection title="Git">main</EnvironmentSection>
          </EnvironmentPanelSurface>
        </EnvironmentControl>
        <GoalEditorSurface label="Goal" state="ready">
          <GoalEditorInput aria-label="Objective" value="Ship" />
          <GoalEditorFooter actions={<button type="button">Save</button>}>
            Updated now
          </GoalEditorFooter>
        </GoalEditorSurface>
        <SourcesSurface label="Sources">
          <SourcesScroll>
            <SourceEntry>
              <SourceEntryIcon>
                <MatrixIcon />
              </SourceEntryIcon>
              <SourceEntryBody>source.txt</SourceEntryBody>
            </SourceEntry>
          </SourcesScroll>
        </SourcesSurface>
      </>,
    );
    for (const contract of Object.values(WORKFLOW_COMPONENT_CONTRACTS)) {
      expect(
        container.querySelector(`[data-artemis-component="${contract.name}"]`),
      ).not.toBeNull();
    }
    expect(
      screen.getByRole("dialog", { name: "Environment details" }),
    ).toBeTruthy();
    expect(screen.getByRole("region", { name: "Goal" })).toBeTruthy();
  },
  "workflow-state-matrix"() {
    const { container } = render(
      <>
        <ReviewState state="loading">Loading</ReviewState>
        <ReviewState state="empty">No changes</ReviewState>
        <ReviewState state="error">Unavailable</ReviewState>
        <GoalEditorSurface busy label="Goal loading" state="loading">
          Loading
        </GoalEditorSurface>
        <GoalEditorSurface label="Goal stale" state="stale">
          Changed elsewhere
        </GoalEditorSurface>
        <SourcesState state="empty">No sources</SourcesState>
        <SourcesState state="error">Preview failed</SourcesState>
      </>,
    );
    expect(container.querySelectorAll('[data-state="loading"]')).toHaveLength(
      2,
    );
    expect(container.querySelectorAll('[data-state="empty"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-state="error"]')).toHaveLength(2);
    expect(container.querySelector('[data-state="stale"]')).not.toBeNull();
    expect(screen.getAllByRole("alert")).toHaveLength(2);
  },
  async "workflow-controlled-events"() {
    const toggle = vi.fn();
    const change = vi.fn();
    const save = vi.fn();
    render(
      <>
        <EnvironmentControl open={false}>
          <EnvironmentTrigger
            controls="controlled-environment-details"
            expanded={false}
            icon={<MatrixIcon />}
            label="Environment"
            onClick={toggle}
          />
        </EnvironmentControl>
        <GoalEditorSurface label="Goal" state="dirty">
          <GoalEditorInput
            aria-label="Objective"
            onChange={change}
            value="Ship"
          />
          <GoalEditorFooter actions={<button onClick={save}>Save</button>}>
            Unsaved
          </GoalEditorFooter>
        </GoalEditorSurface>
      </>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Environment" }));
    await user.type(screen.getByRole("textbox", { name: "Objective" }), " now");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(toggle).toHaveBeenCalledOnce();
    expect(change).toHaveBeenCalled();
    expect(save).toHaveBeenCalledOnce();
  },
  "workflow-permission-boundary"() {
    expect(workflowSource).not.toMatch(/window\.artemis|electron|node:/);
    expect(workflowSource).toContain(
      "caller-owns-data-permissions-and-effects",
    );
    expect(workflowSource).toContain(
      "caller-owned-git-agent-source-and-permission-actions",
    );
  },
  "workflow-rtl-overlay-geometry"() {
    const longArabic =
      "واجهة مراجعة طويلة تحافظ على هندسة منطقية ومحتوى قابل للقراءة";
    const { container } = render(
      <div dir="rtl">
        <EnvironmentControl open>
          <EnvironmentTrigger
            controls="rtl-environment-details"
            expanded
            icon={<MatrixIcon />}
            label="البيئة"
          />
          <EnvironmentPanelSurface
            id="rtl-environment-details"
            label="تفاصيل البيئة"
          >
            <EnvironmentSection title="المصادر">
              {longArabic.repeat(4)}
            </EnvironmentSection>
          </EnvironmentPanelSurface>
        </EnvironmentControl>
      </div>,
    );
    expect(
      container
        .querySelector('[data-artemis-component="environment-panel"]')
        ?.closest('[dir="rtl"]'),
    ).not.toBeNull();
    expect(uiCss).toContain("inset-inline-end: 0");
    expect(uiCss).toContain("inline-size: min(20rem");
    expect(uiCss).toContain("calc(100vw - var(--artemis-space-6))");
  },
};
