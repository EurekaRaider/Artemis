// @vitest-environment jsdom
import { fireEvent, render } from "@testing-library/react";
import { expect, it } from "vitest";
import { ResourceAvatar } from "../../../src/renderer/plugins/resource-icons.js";
import { pluginBrandIcon } from "../../../src/renderer/plugins/plugin-brand-icons.js";
import "../../fixtures/renderer-test-utils.js";

it.each([
  "atlassian",
  "figma",
  "github",
  "gmail",
  "google-workspace",
  "linear",
  "notion",
  "outlook",
  "qq-mail",
  "slack",
])("keeps the %s brand image when its manifest icon is absent", (name) => {
  const { container } = render(<ResourceAvatar kind="plugin" name={name} />);
  const image = container.querySelector("img");
  expect(image).toHaveAttribute("src", pluginBrandIcon(name));
  expect(container.querySelector(".resource-semantic-icon")).toBeNull();
});

it("prefers the manifest image and falls back after a load failure", () => {
  const { container, rerender } = render(
    <ResourceAvatar kind="plugin" name="figma" iconDataUrl="/custom.png" />,
  );
  const image = container.querySelector("img")!;
  expect(image).toHaveAttribute("src", "/custom.png");
  fireEvent.error(image);
  expect(image).toHaveAttribute("src", pluginBrandIcon("figma"));
  rerender(
    <ResourceAvatar kind="plugin" name="figma" iconDataUrl="/updated.png" />,
  );
  expect(image).toHaveAttribute("src", "/updated.png");
});

it("uses the owning plugin identity independently of a translated label", () => {
  const { container, rerender } = render(
    <ResourceAvatar kind="plugin" name="QQ 邮箱" pluginName="qq-mail" />,
  );
  expect(container.querySelector("img")).toHaveAttribute(
    "src",
    pluginBrandIcon("qq-mail"),
  );
  rerender(
    <ResourceAvatar kind="skill" name="邮件检索" pluginName="qq-mail" />,
  );
  expect(container.querySelector("img")).toHaveAttribute(
    "src",
    pluginBrandIcon("qq-mail"),
  );
});

it("keeps unknown plugins semantic without guessing a brand from keywords", () => {
  const { container } = render(
    <ResourceAvatar kind="plugin" name="third-party-gmail-helper" />,
  );
  expect(container.querySelector("img")).toBeNull();
  expect(container.querySelector("[data-artemis-icon='email']")).not.toBeNull();
});

it.each(["figma", "github"])(
  "renders standalone %s as a filled glyph without masking its opaque plate",
  (name) => {
    const { container } = render(<ResourceAvatar kind="skill" name={name} />);
    const icon = container.querySelector<SVGElement>(
      `[data-artemis-icon='${name}']`,
    )!;
    expect(icon.style.fill.toLowerCase()).toBe("currentcolor");
    expect(icon.style.stroke).toBe("none");
    expect(
      container.querySelector("img, mask, .resource-brand-mark"),
    ).toBeNull();
  },
);

it.each([
  ["linear", "2", "-0.6"],
  ["notion", "-1", "1"],
  ["outlook", "-5", "4.5"],
  ["qq-mail", "-5", "4.5"],
])(
  "removes the opaque %s plate with a luminance mask",
  (name, slope, intercept) => {
    const { container } = render(
      <>
        <ResourceAvatar kind="mcp" name={name} />
        <ResourceAvatar kind="mcp" name={name} />
      </>,
    );
    const masks = [...container.querySelectorAll("mask")];
    expect(masks).toHaveLength(2);
    expect(masks[0]!.id).not.toBe(masks[1]!.id);
    for (const mask of masks) {
      expect(mask.style.maskType).toBe("luminance");
      expect(mask.querySelector("image")).toHaveAttribute(
        "href",
        pluginBrandIcon(name),
      );
      const svg = mask.closest("svg")!;
      expect(svg.querySelector("rect")).toHaveAttribute(
        "mask",
        `url(#${mask.id})`,
      );
      for (const transfer of svg.querySelectorAll(
        "feFuncR, feFuncG, feFuncB",
      )) {
        expect(transfer).toHaveAttribute("slope", slope);
        expect(transfer).toHaveAttribute("intercept", intercept);
      }
    }
  },
);

it.each(["slack", "gmail"])(
  "keeps the transparent %s asset as an alpha mask",
  (name) => {
    const { container } = render(<ResourceAvatar kind="skill" name={name} />);
    const mark = container.querySelector<HTMLElement>(".resource-brand-mark")!;
    expect(mark.style.maskImage).toContain(pluginBrandIcon(name));
    expect(container.querySelector("img, mask")).toBeNull();
  },
);
