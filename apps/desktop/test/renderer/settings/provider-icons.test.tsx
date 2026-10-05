// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { expect, it } from "vitest";
import { getBuiltinProviders } from "@earendil-works/pi-ai/providers/all";
import {
  ProviderIcon,
  PROVIDER_BRAND_ICONS,
} from "../../../src/renderer/settings/ProviderIcon.js";

it("has an explicit brand mapping for every bundled provider", () => {
  for (const id of getBuiltinProviders()) {
    expect(PROVIDER_BRAND_ICONS[id], id).toBeTruthy();
  }
});

it("keeps custom endpoints distinct from built-in brands even if IDs collide", () => {
  const { container, rerender } = render(
    <ProviderIcon providerId="deepseek" />,
  );
  expect(
    container.querySelector(".provider-brand-icon-deepseek"),
  ).not.toBeNull();
  rerender(<ProviderIcon providerId="deepseek" custom />);
  expect(container.querySelector(".provider-brand-icon-deepseek")).toBeNull();
  expect(container.querySelector("svg")).not.toBeNull();
});
