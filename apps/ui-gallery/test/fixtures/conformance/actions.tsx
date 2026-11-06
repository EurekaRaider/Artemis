import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";
import { Badge, Button, Icon, IconButton, Status } from "@artemis/ui/actions";
import { ConformanceProbe } from "@artemis/ui/conformance";
import { MatrixIcon } from "./shared.js";

export const actionsCases = {
  "action-policy"() {
    const onValueChange = vi.fn();
    const onCommit = vi.fn();
    const onEvent = vi.fn();
    const { container, rerender } = render(
      <ConformanceProbe
        label="Matrix actions"
        defaultValue="value"
        disabled
        onValueChange={onValueChange}
        onCommit={onCommit}
        onEvent={onEvent}
      />,
    );
    let control = screen.getByRole("textbox", { name: "Matrix actions" });
    fireEvent.change(control, { target: { value: "blocked" } });
    fireEvent.keyDown(control, { key: "Enter" });
    control.focus();
    expect(onValueChange).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
    expect(onEvent).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(control);

    rerender(
      <ConformanceProbe
        label="Matrix actions"
        defaultValue="value"
        busy
        onValueChange={onValueChange}
        onCommit={onCommit}
        onEvent={onEvent}
      />,
    );
    control = screen.getByRole("textbox", { name: "Matrix actions" });
    fireEvent.change(control, { target: { value: "blocked" } });
    fireEvent.keyDown(control, { key: "Enter" });
    control.focus();
    expect(onValueChange).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
    expect(onEvent).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(control);

    rerender(
      <ConformanceProbe
        label="Matrix actions"
        defaultValue="value"
        stale
        onValueChange={onValueChange}
        onCommit={onCommit}
        onEvent={onEvent}
      />,
    );
    control = screen.getByRole("textbox", { name: "Matrix actions" });
    fireEvent.change(control, { target: { value: "stale-allowed" } });
    fireEvent.keyDown(control, { key: "Enter" });
    expect(onValueChange).toHaveBeenCalledWith("stale-allowed");
    expect(onCommit).toHaveBeenCalledWith("stale-allowed");
    expect(onEvent).toHaveBeenCalledTimes(2);
    onValueChange.mockClear();
    onCommit.mockClear();
    onEvent.mockClear();

    rerender(
      <ConformanceProbe
        label="Matrix actions"
        defaultValue="value"
        error="Error"
        onValueChange={onValueChange}
        onCommit={onCommit}
        onEvent={onEvent}
      />,
    );
    control = screen.getByRole("textbox", { name: "Matrix actions" });
    fireEvent.change(control, { target: { value: "error-allowed" } });
    fireEvent.keyDown(control, { key: "Enter" });
    expect(onValueChange).toHaveBeenCalledWith("error-allowed");
    expect(onCommit).toHaveBeenCalledWith("error-allowed");
    expect(onEvent).toHaveBeenCalledTimes(2);
    expect(
      container
        .querySelector('[data-artemis-component="conformance-probe"]')
        ?.getAttribute("data-state"),
    ).toBe("error");
  },
  "action-anatomy"() {
    const { container } = render(
      <div>
        <Button icon={<MatrixIcon />}>Button</Button>
        <IconButton icon={<MatrixIcon />} label="Matrix icon button" />
        <Badge tone="success">Complete</Badge>
        <Status tone="info">Running</Status>
      </div>,
    );
    expect(
      [...container.querySelectorAll("[data-artemis-component]")].map((node) =>
        node.getAttribute("data-artemis-component"),
      ),
    ).toEqual(["button", "icon", "icon-button", "icon", "badge", "status"]);
    expect(container.querySelectorAll('[data-part="indicator"]')).toHaveLength(
      2,
    );
  },
  "action-states"() {
    const statePair = (
      props: Readonly<{
        disabled?: boolean;
        error?: boolean;
        loading?: boolean;
        selected?: boolean;
      }> = {},
    ) => (
      <div>
        <Button {...props}>Matrix state</Button>
        <IconButton
          {...props}
          icon={<MatrixIcon />}
          label="Matrix icon state"
        />
      </div>
    );
    const { container, rerender } = render(statePair());
    const states = () =>
      [...container.querySelectorAll("button")].map((button) =>
        button.getAttribute("data-state"),
      );
    const indicators = [
      ...container.querySelectorAll('[data-part="state-indicator"]'),
    ];
    expect(states()).toEqual(["ready", "ready"]);
    rerender(statePair({ selected: true }));
    expect(states()).toEqual(["selected", "selected"]);
    rerender(statePair({ error: true, selected: true }));
    expect(states()).toEqual(["error", "error"]);
    rerender(statePair({ error: true, loading: true, selected: true }));
    expect(states()).toEqual(["loading", "loading"]);
    rerender(
      statePair({ disabled: true, error: true, loading: true, selected: true }),
    );
    expect(states()).toEqual(["disabled", "disabled"]);
    expect([
      ...container.querySelectorAll('[data-part="state-indicator"]'),
    ]).toEqual(indicators);
  },
  "action-variants-sizes"() {
    const buttonVariants = ["primary", "secondary", "quiet", "danger"] as const;
    const iconButtonVariants = ["secondary", "quiet", "danger"] as const;
    const sizes = ["compact", "comfortable"] as const;
    const states = [
      ["ready", {}],
      ["selected", { selected: true }],
      ["error", { error: true }],
      ["loading", { loading: true }],
      ["disabled", { disabled: true }],
    ] as const;
    const { container } = render(
      <div>
        {sizes.flatMap((size) =>
          buttonVariants.map((variant) => (
            <Button key={`${size}-${variant}`} size={size} variant={variant}>
              {`${size} ${variant}`}
            </Button>
          )),
        )}
        {sizes.flatMap((size) =>
          iconButtonVariants.flatMap((variant) =>
            states.map(([state, stateProps]) => (
              <IconButton
                key={`${size}-${variant}-${state}`}
                icon={<MatrixIcon />}
                label={`${size} ${variant} ${state}`}
                size={size}
                variant={variant}
                {...stateProps}
              />
            )),
          ),
        )}
      </div>,
    );
    const buttons = [
      ...container.querySelectorAll('[data-artemis-component="button"]'),
    ];
    const iconButtons = [
      ...container.querySelectorAll('[data-artemis-component="icon-button"]'),
    ];
    expect(buttons).toHaveLength(sizes.length * buttonVariants.length);
    expect(iconButtons).toHaveLength(
      sizes.length * iconButtonVariants.length * states.length,
    );
    expect(
      new Set(iconButtons.map((node) => node.getAttribute("data-state"))),
    ).toEqual(new Set(states.map(([state]) => state)));
    expect(
      new Set(iconButtons.map((node) => node.getAttribute("data-size"))),
    ).toEqual(new Set(sizes));
    expect(
      new Set(iconButtons.map((node) => node.getAttribute("data-variant"))),
    ).toEqual(new Set(iconButtonVariants));
  },
  async "action-events"() {
    const onClick = vi.fn();
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    const user = userEvent.setup();
    render(
      <form onSubmit={onSubmit}>
        <Button onClick={onClick}>Activate</Button>
      </form>,
    );
    const action = screen.getByRole("button", { name: "Activate" });
    await user.click(action);
    action.focus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(onClick).toHaveBeenCalledTimes(3);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(action.getAttribute("type")).toBe("button");
  },
  "icon-contract"() {
    const { container } = render(
      <div dir="rtl">
        {(["xs", "sm", "base", "lg", "xl"] as const).map((size) => (
          <Icon key={size} size={size}>
            <MatrixIcon />
          </Icon>
        ))}
        <IconButton icon={<MatrixIcon />} label="图标操作" />
      </div>,
    );
    expect(
      [...container.querySelectorAll('[data-artemis-component="icon"]')].map(
        (node) => node.getAttribute("data-size"),
      ),
    ).toEqual(["xs", "sm", "base", "lg", "xl", "base"]);
    expect(
      [...container.querySelectorAll('[data-artemis-component="icon"]')].every(
        (node) => node.getAttribute("data-part") === "root",
      ),
    ).toBe(true);
    expect(
      container.querySelector(
        '[data-artemis-component="icon-button"] > [data-part="icon"] > [data-artemis-component="icon"]',
      ),
    ).not.toBeNull();
    expect(screen.getByRole("button", { name: "图标操作" })).not.toBeNull();
    expect(container.querySelector("[data-artemis-portal]")).toBeNull();
  },
  "status-semantics"() {
    const longText = "同步完成，所有变更已安全保存到当前本地项目";
    const tones = ["neutral", "info", "success", "warning", "danger"] as const;
    const { container } = render(
      <div>
        <Badge tone="success">{longText}</Badge>
        {tones.map((tone) => (
          <Status
            key={tone}
            live={tone === "warning" ? "polite" : undefined}
            tone={tone}
          >
            {`${tone} status`}
          </Status>
        ))}
      </div>,
    );
    expect(container.textContent).toContain(longText);
    expect(screen.getByRole("status").getAttribute("aria-live")).toBe("polite");
    expect(
      [...container.querySelectorAll('[data-artemis-component="status"]')].map(
        (node) => node.getAttribute("data-tone"),
      ),
    ).toEqual(tones);
    expect(container.querySelectorAll('[data-part="indicator"]')).toHaveLength(
      tones.length + 1,
    );
  },
};
