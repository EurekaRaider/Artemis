// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  ARTEMIS_ICON_NAMES,
  ARTEMIS_ICON_SOURCE,
  ArtemisIcon,
  ArtemisIconProvider,
  ArtemisLogo,
} from "../src/icons.js";

describe("ArtemisIcon", () => {
  it("overrides geometry without changing sizing or accessibility and falls back for missing names", () => {
    const { container, rerender } = render(
      <ArtemisIconProvider
        icons={{ send: [{ type: "circle", cx: 12, cy: 12, r: 8, fill: true }] }}
      >
        <ArtemisIcon name="send" width={20} />
      </ArtemisIconProvider>,
    );
    expect(container.querySelector("circle")?.getAttribute("fill")).toBe(
      "currentColor",
    );
    expect(container.querySelector("svg")?.getAttribute("width")).toBe("20");
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
    rerender(
      <ArtemisIconProvider icons={{}}>
        <ArtemisIcon name="send" width={20} />
      </ArtemisIconProvider>,
    );
    expect(container.querySelector("path")).not.toBeNull();
    expect(container.querySelector("circle")).toBeNull();
  });
  it("publishes the complete Nocturne icon catalog and workspace brand", () => {
    expect(ARTEMIS_ICON_SOURCE).toBe("nocturne:Icons.dc.html");
    expect(ARTEMIS_ICON_NAMES).toHaveLength(155);
    expect(new Set(ARTEMIS_ICON_NAMES)).toHaveLength(155);
    expect(ARTEMIS_ICON_NAMES).toEqual(
      expect.arrayContaining([
        "artemis",
        "chat",
        "pr",
        "mobile",
        "monitor",
        "folder",
        "sidebar-l",
        "queue",
        "environment",
        "approval",
        "approval-ask",
        "approval-agent",
        "approval-full",
        "skill",
        "web-video",
        "bot-add",
        "copy",
        "feishu",
        "slack",
        "wecom",
        "qr-code",
        "agent",
        "shield",
        "rocket",
        "book",
        "wand",
        "chart",
        "translate",
        "server",
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
      expect(icon?.getAttribute("stroke-width")).toBe("1.6");
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
      "M12 5v14 M5 12h14",
    );
  });
});

describe("ArtemisLogo", () => {
  it("draws the crescent-and-arrowhead mark, switching to the bold variant at 24px and below", () => {
    const { container, rerender } = render(<ArtemisLogo size={40} />);
    const paths = () =>
      [...container.querySelectorAll("path")].map((path) =>
        path.getAttribute("d"),
      );
    expect(container.querySelector("svg")?.getAttribute("width")).toBe("40");
    expect(container.querySelector("g")?.getAttribute("transform")).toBe(
      "rotate(-45 24 24)",
    );
    expect(paths()).toEqual([
      "M31.84 11.21A15 15 0 1 0 31.84 36.79A13 13 0 1 1 31.84 11.21Z",
      "M41.4 24L24.4 16.4L28.7 24L24.4 31.6Z",
    ]);
    rerender(<ArtemisLogo size={24} />);
    expect(paths()).toEqual([
      "M33.07 12.05A15 15 0 1 0 33.07 35.95A12.2 12.2 0 1 1 33.07 12.05Z",
      "M42.5 24L25.4 15.6L29.6 24L25.4 32.4Z",
    ]);
    expect(container.innerHTML).not.toContain("M35 9.17");
  });
});
