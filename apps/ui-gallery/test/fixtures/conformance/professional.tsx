import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type FormEvent } from "react";
import { expect, vi } from "vitest";
import {
  BrowserAddressForm,
  BrowserAddressInput,
  BrowserGoButton,
  BrowserNavigation,
  BrowserNavigationButton,
  BrowserState,
  BrowserSurface,
  BrowserToolbar,
  BrowserViewport,
  PROFESSIONAL_COMPONENT_CONTRACTS,
  TerminalHeader,
  TerminalHost,
  TerminalState,
  TerminalSurface,
  TerminalViewport,
} from "@artemis/ui/professional";
import { MatrixIcon, professionalSource, uiCss } from "./shared.js";

export const professionalCases = {
  "professional-anatomy"() {
    const { container } = render(
      <>
        <TerminalSurface label="Terminal" state="ready">
          <TerminalHeader detail="zsh · desktop-user" heading="Terminal" />
          <TerminalViewport>
            <TerminalHost>Artemis&gt;</TerminalHost>
            <TerminalState state="connecting">Connecting</TerminalState>
          </TerminalViewport>
        </TerminalSurface>
        <BrowserSurface label="Browser" state="ready">
          <BrowserToolbar label="Browser toolbar">
            <BrowserNavigation label="Browser navigation">
              <BrowserNavigationButton icon={<MatrixIcon />} label="Back" />
            </BrowserNavigation>
            <BrowserAddressForm label="Browser address">
              <BrowserAddressInput
                label="Address"
                readOnly
                value="about:blank"
              />
              <BrowserGoButton label="Go" />
            </BrowserAddressForm>
          </BrowserToolbar>
          <BrowserState state="loading">Loading</BrowserState>
          <BrowserViewport label="Browser document">Document</BrowserViewport>
        </BrowserSurface>
      </>,
    );
    for (const contract of Object.values(PROFESSIONAL_COMPONENT_CONTRACTS)) {
      expect(
        container.querySelector(`[data-artemis-component="${contract.name}"]`),
      ).not.toBeNull();
    }
    expect(screen.getByRole("region", { name: "Terminal" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Browser" })).toBeTruthy();
    expect(
      screen.getByRole("region", { name: "Browser document" }),
    ).toBeTruthy();
  },
  "professional-state-matrix"() {
    const { container } = render(
      <>
        <TerminalSurface busy label="Connecting terminal" state="connecting">
          <TerminalState state="connecting">Connecting</TerminalState>
        </TerminalSurface>
        <TerminalState state="empty">No task</TerminalState>
        <TerminalState state="exited">Exited</TerminalState>
        <TerminalState state="error">PTY failed</TerminalState>
        <BrowserSurface busy label="Loading browser" state="loading">
          <BrowserState state="loading">Loading</BrowserState>
        </BrowserSurface>
        <BrowserState state="empty">No document</BrowserState>
        <BrowserState state="error">Navigation failed</BrowserState>
        <BrowserNavigationButton
          disabled
          icon={<MatrixIcon />}
          label="Back unavailable"
        />
        <BrowserAddressInput disabled label="Address unavailable" />
        <BrowserGoButton disabled label="Go unavailable" />
      </>,
    );
    expect(container.querySelectorAll('[aria-busy="true"]')).toHaveLength(2);
    expect(screen.getAllByRole("alert")).toHaveLength(2);
    expect(screen.getAllByRole("status")).toHaveLength(5);
    expect(
      (
        screen.getByRole("button", {
          name: "Back unavailable",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("textbox", {
          name: "Address unavailable",
        }) as HTMLInputElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "Go unavailable",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  },
  async "professional-controlled-events"() {
    const back = vi.fn();
    const reload = vi.fn();
    const change = vi.fn();
    const submit = vi.fn((event: FormEvent<HTMLFormElement>) =>
      event.preventDefault(),
    );
    render(
      <BrowserSurface label="Browser" state="ready">
        <BrowserToolbar label="Browser toolbar">
          <BrowserNavigation label="Browser navigation">
            <BrowserNavigationButton
              icon={<MatrixIcon />}
              label="Back"
              onClick={back}
            />
            <BrowserNavigationButton
              icon={<MatrixIcon />}
              label="Reload"
              onClick={reload}
            />
          </BrowserNavigation>
          <BrowserAddressForm label="Browser address" onSubmit={submit}>
            <BrowserAddressInput
              label="Address"
              onChange={change}
              value="https://example.test"
            />
            <BrowserGoButton label="Go" />
          </BrowserAddressForm>
        </BrowserToolbar>
        <BrowserViewport label="Browser document">Document</BrowserViewport>
      </BrowserSurface>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Back" }));
    await user.click(screen.getByRole("button", { name: "Reload" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Address" }), {
      target: { value: "https://changed.test" },
    });
    await user.click(screen.getByRole("button", { name: "Go" }));
    expect(back).toHaveBeenCalledOnce();
    expect(reload).toHaveBeenCalledOnce();
    expect(change).toHaveBeenCalledOnce();
    expect(submit).toHaveBeenCalledOnce();
  },
  "professional-rtl-long-content"() {
    const longAddress =
      "https://example.test/a/very/long/path/that/must/not/expand/the/browser/shell";
    const { container } = render(
      <div dir="rtl">
        <TerminalSurface label="طرفية" state="ready">
          <TerminalHeader detail="تفاصيل طويلة جدا" heading="طرفية" />
          <TerminalViewport>
            <TerminalHost>{longAddress.repeat(4)}</TerminalHost>
          </TerminalViewport>
        </TerminalSurface>
        <BrowserSurface label="متصفح" state="ready">
          <BrowserToolbar label="شريط أدوات المتصفح">
            <BrowserNavigation label="التنقل">
              <BrowserNavigationButton icon={<MatrixIcon />} label="رجوع" />
            </BrowserNavigation>
            <BrowserAddressForm label="عنوان المتصفح">
              <BrowserAddressInput
                label="العنوان"
                readOnly
                value={longAddress}
              />
              <BrowserGoButton label="انتقال" />
            </BrowserAddressForm>
          </BrowserToolbar>
          <BrowserViewport label="مستند المتصفح">مستند</BrowserViewport>
        </BrowserSurface>
      </div>,
    );
    for (const root of container.querySelectorAll("[data-artemis-component]")) {
      expect(root.closest('[dir="rtl"]')).not.toBeNull();
    }
    expect(professionalSource).not.toMatch(/window\.artemis|electron|node:/u);
    expect(professionalSource).toContain(
      "caller-owns-pty-process-input-resize-and-cleanup",
    );
    expect(professionalSource).toContain(
      "caller-owns-webview-navigation-session-and-security",
    );
    expect(uiCss).toContain("direction: ltr");
    expect(container.querySelector("[data-artemis-portal]")).toBeNull();
  },
};
