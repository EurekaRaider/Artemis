// @vitest-environment jsdom
import { fireEvent, render } from "@testing-library/react";
import { expect, it } from "vitest";
import { ResourceAvatar } from "../src/renderer/resource-icons.js";
import { pluginBrandIcon } from "../src/renderer/plugin-brand-icons.js";
import "./renderer-test-utils.js";

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
