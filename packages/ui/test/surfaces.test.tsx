// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ActivityBar,
  ActivityBarItem,
  ApplicationShell,
  ApplicationShellResizer,
  ComposerSurface,
  NavigationSidebar,
  SURFACE_ACCESSIBLE_NAME_ERROR,
  SURFACE_COMPONENT_CONTRACTS,
  SURFACE_COMPONENT_MUTABLE_TOKENS,
  SURFACE_SIDEBAR_SIZE_ERROR,
  validateSurfaceComponentContracts,
} from "../src/surfaces.js";

afterEach(() => cleanup());

describe("Surface component contracts", () => {
  it("freezes exact anatomy and skin-safe ownership", () => {
    expect(Object.isFrozen(SURFACE_COMPONENT_CONTRACTS)).toBe(true);
    expect(SURFACE_COMPONENT_CONTRACTS.activityBar.parts).toEqual([
      "root",
      "brand",
      "items",
      "footer",
    ]);
    expect(SURFACE_COMPONENT_CONTRACTS.navigationSidebar.states).toEqual([
      "ready",
      "collapsed",
    ]);
    expect(SURFACE_COMPONENT_MUTABLE_TOKENS).toContain(
      "--artemis-color-background-sidebar",
    );
    expect(SURFACE_COMPONENT_MUTABLE_TOKENS).toContain(
      "--artemis-shadow-composer",
    );
    expect(
      validateSurfaceComponentContracts(SURFACE_COMPONENT_CONTRACTS),
    ).toEqual({ valid: true, errors: [] });
  });

  it("rejects additions to the reviewed contract", () => {
    const drift = structuredClone(SURFACE_COMPONENT_CONTRACTS);
    (drift.composerSurface.states as string[]).push("busy");
    expect(validateSurfaceComponentContracts(drift).valid).toBe(false);
  });
});

describe("Reference-slice surfaces", () => {
  it("keeps shell size caller-controlled without changing its children", () => {
    const { rerender } = render(
      <ApplicationShell sidebarOpen sidebarSize={252}>
        <span>Workspace</span>
      </ApplicationShell>,
    );
    const shell = screen.getByRole("main");
    const child = screen.getByText("Workspace");
    expect(
      shell.style.getPropertyValue("--_artemis-application-shell-sidebar-size"),
    ).toBe("252px");
    expect(shell.dataset.sidebarOpen).toBe("true");
    rerender(
      <ApplicationShell sidebarOpen={false} sidebarSize={252}>
        <span>Workspace</span>
      </ApplicationShell>,
    );
    expect(screen.getByText("Workspace")).toBe(child);
    expect(
      shell.style.getPropertyValue("--_artemis-application-shell-sidebar-size"),
    ).toBe("0px");
    expect(shell.dataset.sidebarOpen).toBe("false");
  });

  it("renders a named activity landmark and preserves native button aria", async () => {
    const user = userEvent.setup();
    const activate = vi.fn();
    render(
      <ActivityBar
        brand={<span>Artemis</span>}
        footer={<span>Footer</span>}
        label="Activity"
      >
        <ActivityBarItem
          aria-current="page"
          aria-expanded
          icon={<span>Folder</span>}
          label="Projects"
          onClick={activate}
          selected
        />
      </ActivityBar>,
    );
    expect(screen.getByRole("navigation", { name: "Activity" })).toBeTruthy();
    const item = screen.getByRole("button", { name: "Projects" });
    expect(item.getAttribute("aria-current")).toBe("page");
    expect(item.getAttribute("aria-expanded")).toBe("true");
    expect(item.dataset.state).toBe("selected");
    expect(item).toHaveProperty("type", "button");
    await user.click(item);
    expect(activate).toHaveBeenCalledTimes(1);
  });

  it("hides a collapsed named sidebar without remounting its content", () => {
    const { rerender } = render(
      <NavigationSidebar
        footer={<span>User</span>}
        header={<span>Tasks</span>}
        label="Projects"
        open
      >
        <button type="button">Task one</button>
      </NavigationSidebar>,
    );
    const sidebar = screen.getByRole("complementary", { name: "Projects" });
    const task = screen.getByRole("button", { name: "Task one" });
    expect(sidebar.dataset.state).toBe("ready");
    rerender(
      <NavigationSidebar
        footer={<span>User</span>}
        header={<span>Tasks</span>}
        label="Projects"
        open={false}
      >
        <button type="button">Task one</button>
      </NavigationSidebar>,
    );
    expect(screen.getByRole("complementary", { hidden: true })).toBe(sidebar);
    expect(screen.getByRole("button", { hidden: true })).toBe(task);
    expect(sidebar.getAttribute("aria-hidden")).toBe("true");
    expect(sidebar.dataset.state).toBe("collapsed");
  });

  it("keeps resizer state and keyboard behavior caller-controlled", async () => {
    const user = userEvent.setup();
    const resize = vi.fn();
    const { rerender } = render(
      <ApplicationShellResizer
        aria-valuemax={360}
        aria-valuemin={180}
        aria-valuenow={252}
        label="Resize projects"
        onKeyDown={resize}
        open
      />,
    );
    const resizer = screen.getByRole("separator", {
      name: "Resize projects",
    });
    expect(resizer.getAttribute("aria-orientation")).toBe("vertical");
    expect(resizer.tabIndex).toBe(0);
    resizer.focus();
    await user.keyboard("{ArrowRight}");
    expect(resize).toHaveBeenCalledTimes(1);

    rerender(
      <ApplicationShellResizer
        aria-valuemax={360}
        aria-valuemin={180}
        aria-valuenow={252}
        label="Resize projects"
        onKeyDown={resize}
        open={false}
      />,
    );
    expect(screen.getByRole("separator", { hidden: true })).toBe(resizer);
    expect(resizer.getAttribute("aria-hidden")).toBe("true");
    expect(resizer.dataset.state).toBe("collapsed");
    expect(resizer.tabIndex).toBe(-1);
  });

  it("names the composer region and forwards drop handlers", async () => {
    const onDrop = vi.fn((event: React.DragEvent<HTMLElement>) =>
      event.preventDefault(),
    );
    render(
      <ComposerSurface label="Prompt composer" onDrop={onDrop}>
        <textarea aria-label="Prompt" />
      </ComposerSurface>,
    );
    const composer = screen.getByRole("region", { name: "Prompt composer" });
    composer.dispatchEvent(new Event("drop", { bubbles: true }));
    expect(onDrop).toHaveBeenCalledTimes(1);
  });

  it("rejects imperceptible labels and invalid shell sizes", () => {
    expect(() =>
      render(
        <ActivityBar brand="A" footer="F" label=" ">
          Items
        </ActivityBar>,
      ),
    ).toThrow(SURFACE_ACCESSIBLE_NAME_ERROR);
    expect(() =>
      render(
        <ApplicationShell sidebarOpen sidebarSize={Number.NaN}>
          Workspace
        </ApplicationShell>,
      ),
    ).toThrow(SURFACE_SIDEBAR_SIZE_ERROR);
  });
});
