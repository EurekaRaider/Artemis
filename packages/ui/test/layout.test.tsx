// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LAYOUT_ACCESSIBLE_NAME_ERROR,
  LAYOUT_COMPONENT_CONTRACTS,
  ListRow,
  PanelHeader,
  ScrollArea,
  SplitPane,
  Toolbar,
  validateLayoutComponentContracts,
} from "../src/layout.js";

afterEach(() => cleanup());

describe("Layout component contracts", () => {
  it("freezes exact anatomy and controlled split intent", () => {
    expect(Object.isFrozen(LAYOUT_COMPONENT_CONTRACTS)).toBe(true);
    expect(LAYOUT_COMPONENT_CONTRACTS.splitPane.parts).toEqual([
      "root",
      "primary",
      "separator",
      "secondary",
    ]);
    expect(LAYOUT_COMPONENT_CONTRACTS.splitPane.interaction).toContain(
      "controlled-size-only",
    );
    expect(
      validateLayoutComponentContracts(LAYOUT_COMPONENT_CONTRACTS),
    ).toEqual({ valid: true, errors: [] });
  });

  it("rejects drift from reviewed fields", () => {
    const drift = structuredClone(LAYOUT_COMPONENT_CONTRACTS);
    (drift.toolbar.states as string[]).push("busy");
    expect(validateLayoutComponentContracts(drift).valid).toBe(false);
  });
});

describe("Layout primitives", () => {
  it("names toolbars and scroll regions and renders panel structure", () => {
    render(
      <>
        <Toolbar actions={<button type="button">Refresh</button>} label="Files">
          Workspace
        </Toolbar>
        <PanelHeader
          actions={<button type="button">Close</button>}
          description="Project settings"
          headingLevel={3}
          title="Settings"
        />
        <ScrollArea label="Settings sections">
          <p>Content</p>
        </ScrollArea>
      </>,
    );
    expect(screen.getByRole("toolbar", { name: "Files" })).toBeTruthy();
    expect(
      screen.getByRole("heading", { level: 3, name: "Settings" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("region", { name: "Settings sections" }),
    ).toBeTruthy();
  });

  it("uses native button activation and state for list rows", async () => {
    const user = userEvent.setup();
    const activate = vi.fn();
    render(
      <div role="listbox">
        <ListRow label="Alpha" onClick={activate} selected />
        <ListRow disabled label="Beta" />
      </div>,
    );
    const alpha = screen.getByRole("option", { name: "Alpha" });
    expect(alpha.getAttribute("aria-selected")).toBe("true");
    await user.click(alpha);
    expect(activate).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("option", { name: "Beta" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("keeps split size caller-controlled and supports LTR keyboard bounds", () => {
    const changes = vi.fn();
    render(
      <SplitPane
        label="Resize navigation"
        maximumSize={400}
        minimumSize={160}
        onSizeChange={changes}
        primary="Navigation"
        secondary="Content"
        size={240}
        step={20}
      />,
    );
    const separator = screen.getByRole("separator", {
      name: "Resize navigation",
    });
    expect(separator.getAttribute("aria-valuenow")).toBe("240");
    fireEvent.keyDown(separator, { key: "ArrowRight" });
    fireEvent.keyDown(separator, { key: "ArrowLeft" });
    fireEvent.keyDown(separator, { key: "Home" });
    fireEvent.keyDown(separator, { key: "End" });
    expect(changes.mock.calls.map(([value]) => value)).toEqual([
      260, 220, 160, 400,
    ]);
    expect(separator.getAttribute("aria-valuenow")).toBe("240");
  });

  it("reverses horizontal keyboard intent in RTL", () => {
    const changes = vi.fn();
    render(
      <div dir="rtl">
        <SplitPane
          label="Resize sidebar"
          maximumSize={400}
          minimumSize={160}
          onSizeChange={changes}
          primary="Sidebar"
          secondary="Main"
          size={240}
          step={20}
        />
      </div>,
    );
    const separator = screen.getByRole("separator", {
      name: "Resize sidebar",
    });
    fireEvent.keyDown(separator, { key: "ArrowLeft" });
    fireEvent.keyDown(separator, { key: "ArrowRight" });
    expect(changes.mock.calls.map(([value]) => value)).toEqual([260, 220]);
  });

  it("emits pointer drag intent and remains controlled", () => {
    const changes = vi.fn();
    const setPointerCapture = vi.fn();
    const releasePointerCapture = vi.fn();
    render(
      <SplitPane
        label="Resize files"
        maximumSize={400}
        minimumSize={160}
        onSizeChange={changes}
        primary="Files"
        secondary="Editor"
        size={240}
      />,
    );
    const separator = screen.getByRole("separator", { name: "Resize files" });
    Object.assign(separator, {
      hasPointerCapture: () => true,
      releasePointerCapture,
      setPointerCapture,
    });
    fireEvent.pointerDown(separator, {
      button: 0,
      clientX: 200,
      pointerId: 7,
    });
    fireEvent.pointerMove(separator, { clientX: 250, pointerId: 7 });
    fireEvent.pointerUp(separator, { clientX: 250, pointerId: 7 });
    expect(setPointerCapture).toHaveBeenCalledWith(7);
    expect(releasePointerCapture).toHaveBeenCalledWith(7);
    expect(changes).toHaveBeenCalledWith(290);
    expect(separator.getAttribute("aria-valuenow")).toBe("240");
  });

  it("removes disabled separators from the tab order and validates labels", () => {
    render(
      <SplitPane
        disabled
        label="Resize disabled panel"
        maximumSize={400}
        minimumSize={160}
        onSizeChange={() => undefined}
        primary="One"
        secondary="Two"
        size={240}
      />,
    );
    expect(
      screen
        .getByRole("separator", { name: "Resize disabled panel" })
        .getAttribute("tabindex"),
    ).toBe("-1");
    expect(() =>
      render(
        <ScrollArea label=" ">
          <span />
        </ScrollArea>,
      ),
    ).toThrow(LAYOUT_ACCESSIBLE_NAME_ERROR);
  });

  it("rejects non-finite sizes and non-positive steps", () => {
    const renderSplit = (size: number, step: number) =>
      render(
        <SplitPane
          label="Resize invalid panel"
          maximumSize={400}
          minimumSize={160}
          onSizeChange={() => undefined}
          primary="One"
          secondary="Two"
          size={size}
          step={step}
        />,
      );
    expect(() => renderSplit(Number.NaN, 16)).toThrow(
      "Artemis SplitPane requires finite size bounds and a positive step",
    );
    expect(() => renderSplit(240, 0)).toThrow(
      "Artemis SplitPane requires finite size bounds and a positive step",
    );
  });
});
