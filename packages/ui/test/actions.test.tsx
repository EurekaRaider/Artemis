// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  ACTION_ACCESSIBLE_NAME_ERROR,
  ACTION_COMPONENT_CONTRACTS,
  ACTION_VISIBLE_TEXT_ERROR,
  Badge,
  Button,
  Icon,
  IconButton,
  Status,
} from "../src/actions.js";

const TestIcon = () => (
  <svg viewBox="0 0 16 16">
    <path d="M2 8h12" />
  </svg>
);

describe("Action component contracts", () => {
  it("deep-freezes the exact public anatomy, states, and finite variants", () => {
    expect(Object.isFrozen(ACTION_COMPONENT_CONTRACTS)).toBe(true);
    expect(Object.isFrozen(ACTION_COMPONENT_CONTRACTS.button.parts)).toBe(true);
    expect(ACTION_COMPONENT_CONTRACTS.button.parts).toEqual([
      "root",
      "label",
      "state-indicator",
    ]);
    expect(ACTION_COMPONENT_CONTRACTS.button.optionalParts).toEqual(["icon"]);
    expect(ACTION_COMPONENT_CONTRACTS.button.states).toEqual([
      "ready",
      "selected",
      "error",
      "loading",
      "disabled",
    ]);
    expect(ACTION_COMPONENT_CONTRACTS.icon.sizes).toEqual([
      "xs",
      "sm",
      "base",
      "lg",
      "xl",
    ]);
    expect(ACTION_COMPONENT_CONTRACTS.status.tones).toEqual([
      "neutral",
      "info",
      "success",
      "warning",
      "danger",
    ]);
  });
});

describe("Button and IconButton behavior", () => {
  it("defaults to a non-submitting button and permits an explicit submit", async () => {
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    const user = userEvent.setup();
    const { rerender } = render(
      <form onSubmit={onSubmit}>
        <Button label="Safe action">Run</Button>
      </form>,
    );
    const action = screen.getByRole("button", { name: "Safe action" });
    expect(action.getAttribute("type")).toBe("button");
    await user.click(action);
    expect(onSubmit).not.toHaveBeenCalled();

    rerender(
      <form onSubmit={onSubmit}>
        <Button label="Submit action" type="submit">
          Submit
        </Button>
      </form>,
    );
    await user.click(screen.getByRole("button", { name: "Submit action" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("fires exactly once for mouse, Enter, and Space activation", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <Button label="Activate" onClick={onClick}>
        Activate
      </Button>,
    );
    const action = screen.getByRole("button", { name: "Activate" });
    await user.click(action);
    expect(onClick).toHaveBeenCalledTimes(1);
    action.focus();
    await user.keyboard("{Enter}");
    expect(onClick).toHaveBeenCalledTimes(2);
    await user.keyboard(" ");
    expect(onClick).toHaveBeenCalledTimes(3);
  });

  it("uses native blocking semantics for disabled and loading states", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <Button disabled label="Disabled" onClick={onClick}>
        Disabled
      </Button>,
    );
    let action = screen.getByRole("button", { name: "Disabled" });
    expect((action as HTMLButtonElement).disabled).toBe(true);
    expect(action.getAttribute("data-state")).toBe("disabled");
    expect(
      action.querySelector('[data-part="state-indicator"]'),
    ).not.toBeNull();
    expect(
      action.querySelector('[data-part="state-indicator"]')?.textContent,
    ).toBe("");
    await user.click(action);
    expect(onClick).not.toHaveBeenCalled();

    rerender(
      <Button label="Loading" loading onClick={onClick}>
        Preserve label
      </Button>,
    );
    action = screen.getByRole("button", { name: "Loading" });
    expect((action as HTMLButtonElement).disabled).toBe(true);
    expect(action.getAttribute("aria-busy")).toBe("true");
    expect(action.getAttribute("data-state")).toBe("loading");
    expect(action.textContent).toContain("Preserve label");
    expect(action.textContent).toContain("…");
    await user.click(action);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("exposes selected and error states with non-color indicators", () => {
    const { rerender } = render(
      <Button label="Selection" selected>
        Selected
      </Button>,
    );
    let action = screen.getByRole("button", { name: "Selection" });
    expect(action.getAttribute("aria-pressed")).toBe("true");
    expect(action.getAttribute("data-state")).toBe("selected");
    expect(action.textContent).toContain("✓");

    rerender(
      <Button error label="Invalid action">
        Retry
      </Button>,
    );
    action = screen.getByRole("button", { name: "Invalid action" });
    expect(action.getAttribute("aria-invalid")).toBe("true");
    expect(action.getAttribute("data-state")).toBe("error");
    expect(action.textContent).toContain("!");
  });

  it("requires a perceptible IconButton name before DOM or SSR output", () => {
    for (const label of ["", "  \n", "\u200B\u2060"]) {
      expect(() =>
        render(<IconButton icon={<TestIcon />} label={label} />),
      ).toThrowError(ACTION_ACCESSIBLE_NAME_ERROR);
      expect(() =>
        renderToString(<IconButton icon={<TestIcon />} label={label} />),
      ).toThrowError(ACTION_ACCESSIBLE_NAME_ERROR);
    }
    const markup = renderToString(
      <IconButton icon={<TestIcon />} label="删除" title="删除" />,
    );
    expect(markup).toContain('aria-label="删除"');
    expect(markup).toContain('data-artemis-component="icon-button"');
    expect(markup).not.toContain("apple");
  });
});

describe("Icon, Badge, and Status semantics", () => {
  it("keeps all five icon sizes decorative with stable anatomy", () => {
    const { container } = render(
      <div>
        {(["xs", "sm", "base", "lg", "xl"] as const).map((size) => (
          <Icon key={size} size={size}>
            <TestIcon />
          </Icon>
        ))}
      </div>,
    );
    const icons = [
      ...container.querySelectorAll('[data-artemis-component="icon"]'),
    ];
    expect(icons.map((icon) => icon.getAttribute("data-size"))).toEqual([
      "xs",
      "sm",
      "base",
      "lg",
      "xl",
    ]);
    expect(
      icons.every((icon) => icon.getAttribute("aria-hidden") === "true"),
    ).toBe(true);
  });

  it("renders redundant tone indicators, long text, and opt-in live status", () => {
    const longText = "同步完成，所有变更已安全保存到当前本地项目";
    const { container } = render(
      <div dir="rtl">
        <Badge tone="success">{longText}</Badge>
        <Status live="polite" tone="warning">
          2.5K / 10K
        </Status>
      </div>,
    );
    const badge = container.querySelector('[data-artemis-component="badge"]');
    const status = screen.getByRole("status");
    expect(badge?.textContent).toBe(longText);
    expect(badge?.getAttribute("data-tone")).toBe("success");
    expect(badge?.querySelector('[data-part="indicator"]')).not.toBeNull();
    expect(status.textContent).toBe("2.5K / 10K");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.closest('[dir="rtl"]')).not.toBeNull();
  });

  it("rejects non-perceptible status text before DOM or SSR output", () => {
    expect(() => render(<Badge>{"\u200B"}</Badge>)).toThrowError(
      ACTION_VISIBLE_TEXT_ERROR,
    );
    expect(() => renderToString(<Status>{"   "}</Status>)).toThrowError(
      ACTION_VISIBLE_TEXT_ERROR,
    );
  });

  it("does not make a Status live unless the consumer opts in", () => {
    const { container } = render(<Status>Ready</Status>);
    const status = container.querySelector('[data-artemis-component="status"]');
    expect(status?.getAttribute("role")).toBeNull();
    expect(status?.getAttribute("aria-live")).toBeNull();
  });
});
