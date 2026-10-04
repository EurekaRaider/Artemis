// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ComposerSkillChip } from "../../../src/renderer/conversation/ComposerSkillChip.js";
import type { InstalledArtemisPlugin } from "../../../src/shared/api.js";
import { pluginBrandIcon } from "../../../src/renderer/plugins/plugin-brand-icons.js";
const skill = {
  id: "skill",
  name: "brandkit",
  path: "/skills/brandkit",
  description: "",
  enabled: true,
};
afterEach(cleanup);
it("renders a single label and removes the selected skill", () => {
  const onRemove = vi.fn();
  const { container } = render(
    <ComposerSkillChip
      skill={skill}
      removeLabel="移除 Skill"
      onRemove={onRemove}
    />,
  );
  expect(screen.getByText("brandkit")).toBeInTheDocument();
  expect(container.querySelector("small")).toBeNull();
  expect(container.querySelector(".resource-avatar")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "移除 Skill: brandkit" }));
  expect(onRemove).toHaveBeenCalledOnce();
});
it("uses the plugin image and the shared brand fallback on load failure", () => {
  const plugin = {
    name: "figma",
    iconDataUrl: "/broken.png",
  } as InstalledArtemisPlugin;
  const { container } = render(
    <ComposerSkillChip
      skill={skill}
      plugin={plugin}
      removeLabel="Remove skill"
      onRemove={() => {}}
    />,
  );
  const image = container.querySelector("img")!;
  expect(image).toHaveAttribute("src", "/broken.png");
  fireEvent.error(image);
  expect(image).toHaveAttribute("src", pluginBrandIcon("figma"));
});
