import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";
import {
  ActivityBar,
  ActivityBarItem,
  ApplicationShell,
  ApplicationShellResizer,
  ComposerSurface,
  NavigationSidebar,
  SURFACE_COMPONENT_CONTRACTS,
} from "@artemis/ui/surfaces";
import { MatrixIcon } from "./shared.js";

export const surfaceCases = {
  "surface-anatomy"() {
    const { container } = render(
      <ApplicationShell sidebarOpen sidebarSize={252}>
        <ActivityBar brand="A" footer="Footer" label="Activity">
          <ActivityBarItem icon={<MatrixIcon />} label="Projects" selected />
        </ActivityBar>
        <NavigationSidebar
          footer="Local user"
          header="Tasks"
          label="Projects"
          open
        >
          <button type="button">Task one</button>
        </NavigationSidebar>
        <ApplicationShellResizer label="Resize projects" open />
        <ComposerSurface label="Prompt composer">
          <textarea aria-label="Prompt" />
        </ComposerSurface>
      </ApplicationShell>,
    );
    expect(screen.getByRole("main")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Activity" })).toBeTruthy();
    expect(
      screen.getByRole("complementary", { name: "Projects" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("separator", { name: "Resize projects" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("region", { name: "Prompt composer" }),
    ).toBeTruthy();

    for (const contract of Object.values(SURFACE_COMPONENT_CONTRACTS)) {
      const root = container.querySelector(
        `[data-artemis-component="${contract.name}"]`,
      );
      expect(root).not.toBeNull();
      const actualParts = new Set(
        [root!, ...root!.querySelectorAll("[data-part]")].map((node) =>
          node.getAttribute("data-part"),
        ),
      );
      for (const requiredPart of contract.parts) {
        expect(actualParts.has(requiredPart)).toBe(true);
      }
    }
  },
  async "surface-controlled-events"() {
    const user = userEvent.setup();
    const activate = vi.fn();
    const resize = vi.fn();
    const drop = vi.fn((event: React.DragEvent<HTMLElement>) =>
      event.preventDefault(),
    );
    const { rerender } = render(
      <ApplicationShell sidebarOpen sidebarSize={252}>
        <ActivityBar brand="A" footer="Footer" label="Activity">
          <ActivityBarItem
            icon={<MatrixIcon />}
            label="Projects"
            onClick={activate}
          />
        </ActivityBar>
        <NavigationSidebar
          footer="Local user"
          header="Tasks"
          label="Projects"
          open
        >
          Task one
        </NavigationSidebar>
        <ApplicationShellResizer
          label="Resize projects"
          onKeyDown={resize}
          open
        />
        <ComposerSurface label="Prompt composer" onDrop={drop}>
          <textarea aria-label="Prompt" defaultValue="Preserved" />
        </ComposerSurface>
      </ApplicationShell>,
    );
    const shell = screen.getByRole("main");
    const sidebar = screen.getByRole("complementary", { name: "Projects" });
    const composer = screen.getByRole("region", { name: "Prompt composer" });
    await user.click(screen.getByRole("button", { name: "Projects" }));
    expect(activate).toHaveBeenCalledOnce();
    const resizer = screen.getByRole("separator", { name: "Resize projects" });
    fireEvent.keyDown(resizer, { key: "ArrowRight" });
    expect(resize).toHaveBeenCalledOnce();
    fireEvent.drop(composer);
    expect(drop).toHaveBeenCalledOnce();

    rerender(
      <ApplicationShell sidebarOpen={false} sidebarSize={252}>
        <ActivityBar brand="A" footer="Footer" label="Activity">
          <ActivityBarItem
            icon={<MatrixIcon />}
            label="Projects"
            onClick={activate}
          />
        </ActivityBar>
        <NavigationSidebar
          footer="Local user"
          header="Tasks"
          label="Projects"
          open={false}
        >
          Task one
        </NavigationSidebar>
        <ApplicationShellResizer
          label="Resize projects"
          onKeyDown={resize}
          open={false}
        />
        <ComposerSurface label="Prompt composer" onDrop={drop}>
          <textarea aria-label="Prompt" defaultValue="Preserved" />
        </ComposerSurface>
      </ApplicationShell>,
    );
    expect(screen.getByRole("main")).toBe(shell);
    expect(screen.getByRole("complementary", { hidden: true })).toBe(sidebar);
    expect(shell.dataset.sidebarOpen).toBe("false");
    expect(
      shell.style.getPropertyValue("--_artemis-application-shell-sidebar-size"),
    ).toBe("0px");
    expect(screen.getByRole("textbox", { name: "Prompt" })).toHaveProperty(
      "value",
      "Preserved",
    );
  },
  "surface-rtl-long-content"() {
    const longLabel =
      "شريط جانبي طويل جدا يبقى مقروءا ويستخدم الهندسة المنطقية من اليمين إلى اليسار";
    const { container } = render(
      <div dir="rtl">
        <ApplicationShell sidebarOpen={false} sidebarSize={252}>
          <ActivityBar brand="A" footer="Footer" label={longLabel}>
            <ActivityBarItem icon={<MatrixIcon />} label={longLabel} selected />
          </ActivityBar>
          <NavigationSidebar
            footer="المستخدم المحلي"
            header="المهام"
            label={longLabel}
            open={false}
          >
            {longLabel}
          </NavigationSidebar>
          <ApplicationShellResizer label={longLabel} open={false} />
          <ComposerSurface label={longLabel}>{longLabel}</ComposerSurface>
        </ApplicationShell>
      </div>,
    );
    for (const root of container.querySelectorAll(
      '[data-artemis-component^="application-shell"], [data-artemis-component="activity-bar"], [data-artemis-component="activity-bar-item"], [data-artemis-component="navigation-sidebar"], [data-artemis-component="composer-surface"]',
    )) {
      expect(root.closest('[dir="rtl"]')).not.toBeNull();
    }
    expect(
      screen
        .getByRole("complementary", { hidden: true })
        .getAttribute("aria-hidden"),
    ).toBe("true");
  },
};
