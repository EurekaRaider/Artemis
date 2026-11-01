// @vitest-environment jsdom
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { APP_LOCALES, type Automation, type Thread } from "@artemis/protocol";
import "../../fixtures/renderer-test-utils.js";
import { WelcomeResume } from "../../../src/renderer/conversation/WelcomeResume.js";
import type { ProjectGitInfo } from "../../../src/shared/api.js";
import { uiText } from "../../../src/shared/i18n/ui-text.js";

const timestamp = "2026-11-01T01:00:00.000Z";
const thread: Thread = {
  id: "recent",
  projectId: "project",
  title: "Continue my task",
  mode: "work",
  target: "local",
  status: "running",
  archived: false,
  pinned: false,
  createdAt: timestamp,
  updatedAt: timestamp,
};
const automation: Automation = {
  id: "next",
  projectId: "project",
  name: "Daily review",
  prompt: "Review",
  mode: "plan",
  target: "local",
  enabled: true,
  authorizationState: "not-required",
  schedule: { kind: "interval", every: 1, unit: "days" },
  nextRunAt: "2026-11-02T09:00:00.000Z",
  createdAt: timestamp,
  updatedAt: timestamp,
};
const git: ProjectGitInfo = {
  managed: true,
  detached: false,
  currentBranch: "main",
  changeCount: 2,
  additions: 27,
  deletions: 1,
  stagedAdditions: 0,
  stagedDeletions: 0,
  stagedCount: 0,
  unstagedCount: 2,
  untrackedCount: 0,
  conflictCount: 0,
  ahead: 0,
  behind: 0,
  branches: [],
};
const props = () => ({
  locale: "en" as const,
  projectId: "project",
  threads: [],
  events: {},
  automations: [],
  onOpenThread: vi.fn(),
  onOpenReview: vi.fn(),
  onOpenAutomation: vi.fn(),
});

describe("WelcomeResume", () => {
  it("hides the entire region when current-project data is unavailable", () => {
    const view = render(
      <WelcomeResume
        {...props()}
        threads={[
          { ...thread, projectId: "other" },
          { ...thread, status: "idle" },
          { ...thread, archived: true },
        ]}
        automations={[{ ...automation, projectId: "other" }]}
        gitInfo={{ ...git, changeCount: 0 }}
      />,
    );
    expect(view.container.childElementCount).toBe(0);
  });
  it("opens the latest eligible task without creating another one", () => {
    const p = props();
    const latest = {
      ...thread,
      id: "failed",
      title: "Retry the release",
      status: "failed" as const,
      updatedAt: "2026-11-01T02:00:00.000Z",
    };
    render(<WelcomeResume {...p} threads={[thread, latest]} />);
    expect(screen.getAllByRole("button")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /Retry the release/ }));
    expect(p.onOpenThread).toHaveBeenCalledWith(latest);
  });
  it("opens existing review and the soonest scheduled automation", () => {
    const p = props();
    render(
      <WelcomeResume
        {...p}
        gitInfo={git}
        automations={[
          { ...automation, id: "later", nextRunAt: "2026-11-04T09:00:00.000Z" },
          automation,
        ]}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Review uncommitted changes/ }),
    );
    expect(p.onOpenReview).toHaveBeenCalledOnce();
    expect(screen.getByText("+27")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Daily review/ }));
    expect(p.onOpenAutomation).toHaveBeenCalledWith("next");
  });
  it("falls back to the most recently paused automation", () => {
    const p = props();
    render(
      <WelcomeResume
        {...p}
        automations={[{ ...automation, enabled: false }]}
      />,
    );
    expect(screen.getByRole("button", { name: /Paused/ })).toBeTruthy();
  });
  it.each(APP_LOCALES)("renders real cards in %s", (locale) => {
    render(
      <WelcomeResume
        {...props()}
        locale={locale}
        threads={[thread]}
        gitInfo={git}
        automations={[automation]}
      />,
    );
    expect(
      screen.getByRole("region", {
        name: uiText(locale, "WelcomeResume.title"),
      }),
    ).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });
});
