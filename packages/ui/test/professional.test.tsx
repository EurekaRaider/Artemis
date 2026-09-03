// @vitest-environment jsdom
import { createRef, type FormEvent } from "react";
import { renderToString } from "react-dom/server";

import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

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
  PROFESSIONAL_ACCESSIBLE_NAME_ERROR,
  PROFESSIONAL_COMPONENT_CONTRACTS,
  TerminalHeader,
  TerminalHost,
  TerminalState,
  TerminalSurface,
  TerminalViewport,
  validateProfessionalComponentContracts,
} from "../src/professional.js";

describe("professional shell public contract", () => {
  it("is deeply frozen and rejects exact-contract drift", () => {
    expect(Object.isFrozen(PROFESSIONAL_COMPONENT_CONTRACTS)).toBe(true);
    expect(
      Object.isFrozen(PROFESSIONAL_COMPONENT_CONTRACTS.terminalSurface.theme),
    ).toBe(true);
    expect(
      validateProfessionalComponentContracts(PROFESSIONAL_COMPONENT_CONTRACTS),
    ).toEqual({ valid: true, errors: [] });

    const drifted = structuredClone(PROFESSIONAL_COMPONENT_CONTRACTS);
    (drifted as Record<string, unknown>).extra = {};
    expect(validateProfessionalComponentContracts(drifted)).toEqual({
      valid: false,
      errors: ["contracts fields are not exact"],
    });
  });

  it("renders the complete terminal anatomy and forwards the runtime host ref", () => {
    const hostRef = createRef<HTMLDivElement>();
    const { container } = render(
      <TerminalSurface busy label="Terminal" state="connecting">
        <TerminalHeader detail="zsh · desktop-user" heading="Terminal" />
        <TerminalViewport>
          <TerminalHost className="terminal-host" ref={hostRef} />
          <TerminalState state="connecting">Connecting</TerminalState>
        </TerminalViewport>
      </TerminalSurface>,
    );

    expect(
      screen
        .getByRole("region", { name: "Terminal" })
        .getAttribute("aria-busy"),
    ).toBe("true");
    expect(screen.getByRole("status").textContent).toBe("Connecting");
    expect(hostRef.current).toBe(
      container.querySelector('[data-artemis-component="terminal-host"]'),
    );
    for (const contract of Object.values(
      PROFESSIONAL_COMPONENT_CONTRACTS,
    ).filter(({ name }) => name.startsWith("terminal-"))) {
      expect(
        container.querySelector(`[data-artemis-component="${contract.name}"]`),
      ).not.toBeNull();
    }
  });

  it("exposes browser semantics while keeping all effects caller-owned", async () => {
    const user = userEvent.setup();
    const back = vi.fn();
    const submit = vi.fn((event: FormEvent<HTMLFormElement>) =>
      event.preventDefault(),
    );
    const change = vi.fn();
    const { container } = render(
      <BrowserSurface busy label="Browser" state="loading">
        <BrowserToolbar label="Browser toolbar">
          <BrowserNavigation label="Browser navigation">
            <BrowserNavigationButton
              icon={<span>Back icon</span>}
              label="Back"
              onClick={back}
            />
            <BrowserNavigationButton
              disabled
              icon={<span>Forward icon</span>}
              label="Forward"
            />
          </BrowserNavigation>
          <BrowserAddressForm label="Address navigation" onSubmit={submit}>
            <BrowserAddressInput
              label="Address"
              onChange={change}
              value="https://example.test"
            />
            <BrowserGoButton label="Go" />
          </BrowserAddressForm>
        </BrowserToolbar>
        <BrowserState state="loading">Loading</BrowserState>
        <BrowserViewport label="Browser content">
          <div>Document</div>
        </BrowserViewport>
      </BrowserSurface>,
    );

    await user.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Address" }), {
      target: { value: "https://changed.test" },
    });
    await user.click(screen.getByRole("button", { name: "Go" }));

    expect(
      screen.getByRole("region", { name: "Browser" }).getAttribute("aria-busy"),
    ).toBe("true");
    expect(
      screen.getByRole("toolbar", { name: "Browser toolbar" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("group", { name: "Browser navigation" }),
    ).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Forward" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      screen.getByRole("region", { name: "Browser content" }),
    ).toBeTruthy();
    expect(back).toHaveBeenCalledOnce();
    expect(change).toHaveBeenCalledOnce();
    expect(submit).toHaveBeenCalledOnce();
    for (const contract of Object.values(
      PROFESSIONAL_COMPONENT_CONTRACTS,
    ).filter(({ name }) => name.startsWith("browser-"))) {
      expect(
        container.querySelector(`[data-artemis-component="${contract.name}"]`),
      ).not.toBeNull();
    }
  });

  it("uses assertive error semantics and rejects missing names", () => {
    render(
      <>
        <TerminalState state="error">Terminal failed</TerminalState>
        <BrowserState state="error">Browser failed</BrowserState>
      </>,
    );
    expect(screen.getAllByRole("alert")).toHaveLength(2);
    expect(() =>
      render(<TerminalSurface label=" ">Invalid</TerminalSurface>),
    ).toThrow(PROFESSIONAL_ACCESSIBLE_NAME_ERROR);
    expect(() =>
      renderToString(<BrowserNavigationButton icon={<span />} label="" />),
    ).toThrow(PROFESSIONAL_ACCESSIBLE_NAME_ERROR);
  });
});
