import { useState } from "react";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/dist/icons/ArrowClockwise";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/icons/ArrowLeft";
import { ArrowRightIcon } from "@phosphor-icons/react/dist/icons/ArrowRight";
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
  TerminalHeader,
  TerminalHost,
  TerminalState,
  TerminalSurface,
  TerminalViewport,
} from "@artemis/ui/professional";

export function ProfessionalGallery() {
  const [address, setAddress] = useState("https://docs.example.test/artemis");
  const [visitedAddress, setVisitedAddress] = useState(address);

  return (
    <div className="gallery-professional-grid">
      <TerminalSurface label="Terminal shell sample" state="ready">
        <TerminalHeader
          detail="zsh · macOS Seatbelt"
          heading="Artemis Terminal"
        />
        <TerminalViewport>
          <TerminalHost>
            <pre>
              <span className="gallery-terminal-prompt">Artemis&gt;</span> npm
              run verify:skin-conformance{"\n"}
              Professional shell contract passed.{"\n"}
              <span className="gallery-terminal-prompt">Artemis&gt;</span>
            </pre>
          </TerminalHost>
        </TerminalViewport>
      </TerminalSurface>

      <BrowserSurface label="Browser shell sample" state="ready">
        <BrowserToolbar label="Browser shell toolbar">
          <BrowserNavigation label="Browser history controls">
            <BrowserNavigationButton
              icon={<ArrowLeftIcon weight="bold" />}
              label="Back"
            />
            <BrowserNavigationButton
              disabled
              icon={<ArrowRightIcon weight="bold" />}
              label="Forward"
            />
            <BrowserNavigationButton
              icon={<ArrowClockwiseIcon weight="bold" />}
              label="Reload"
            />
          </BrowserNavigation>
          <BrowserAddressForm
            label="Browser address"
            onSubmit={(event) => {
              event.preventDefault();
              setVisitedAddress(address);
            }}
          >
            <BrowserAddressInput
              label="Address"
              onChange={(event) => setAddress(event.target.value)}
              value={address}
            />
            <BrowserGoButton label="Go" />
          </BrowserAddressForm>
        </BrowserToolbar>
        <BrowserViewport label="Browser document sample">
          <article className="gallery-browser-document">
            <p>Isolated Browser document</p>
            <strong>{visitedAddress}</strong>
          </article>
        </BrowserViewport>
      </BrowserSurface>

      <TerminalSurface label="Terminal error sample" state="error">
        <TerminalHeader detail="Unavailable" heading="Terminal" />
        <TerminalViewport>
          <TerminalState state="error">
            The caller could not start the PTY.
          </TerminalState>
        </TerminalViewport>
      </TerminalSurface>

      <BrowserSurface label="Browser error sample" state="error">
        <BrowserState state="error">
          The caller rejected this navigation.
        </BrowserState>
        <BrowserViewport label="Unavailable Browser document">
          <div />
        </BrowserViewport>
      </BrowserSurface>
    </div>
  );
}
