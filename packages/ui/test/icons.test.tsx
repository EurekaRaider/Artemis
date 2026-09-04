// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  ARTEMIS_ICON_NAMES,
  ARTEMIS_ICON_SOURCE,
  ArtemisIcon,
} from "../src/icons.js";

describe("ArtemisIcon", () => {
  it("publishes the complete prototype v17 icon catalog", () => {
    expect(ARTEMIS_ICON_SOURCE).toBe(
      "ui-prototype-v17:components.html#cat-icons",
    );
    expect(ARTEMIS_ICON_NAMES).toHaveLength(98);
    expect(new Set(ARTEMIS_ICON_NAMES)).toHaveLength(98);
    expect(ARTEMIS_ICON_NAMES).toEqual(
      expect.arrayContaining([
        "folder",
        "sidebar-l",
        "queue",
        "environment",
        "approval",
        "skill",
        "web-video",
      ]),
    );
  });

  it.each(ARTEMIS_ICON_NAMES)(
    "renders %s with the standard monochrome contract",
    (name) => {
      const { container } = render(<ArtemisIcon name={name} />);
      const icon = container.querySelector("svg");

      expect(icon?.getAttribute("aria-hidden")).toBe("true");
      expect(icon?.getAttribute("data-artemis-icon")).toBe(name);
      expect(icon?.getAttribute("fill")).toBe("none");
      expect(icon?.getAttribute("focusable")).toBe("false");
      expect(icon?.getAttribute("height")).toBe("1em");
      expect(icon?.getAttribute("stroke")).toBe("currentColor");
      expect(icon?.getAttribute("stroke-linecap")).toBe("round");
      expect(icon?.getAttribute("stroke-linejoin")).toBe("round");
      expect(icon?.getAttribute("stroke-width")).toBe("1.5");
      expect(icon?.getAttribute("viewBox")).toBe("0 0 24 24");
      expect(icon?.getAttribute("width")).toBe("1em");
      expect(
        icon?.querySelector("path, circle, rect, line, ellipse"),
      ).not.toBeNull();
      expect(icon?.getAttribute("data-artemis-contrast")).toBeNull();
    },
  );

  it("preserves the prototype glyph while allowing consumer sizing", () => {
    const { container } = render(
      <ArtemisIcon
        className="navigation-icon"
        height={20}
        name="plus"
        width={20}
      />,
    );
    const icon = container.querySelector("svg");

    expect(icon?.classList.contains("navigation-icon")).toBe(true);
    expect(icon?.getAttribute("height")).toBe("20");
    expect(icon?.getAttribute("width")).toBe("20");
    expect(icon?.querySelector("path")?.getAttribute("d")).toBe(
      "M12 5.5v13M5.5 12h13",
    );
  });
});
