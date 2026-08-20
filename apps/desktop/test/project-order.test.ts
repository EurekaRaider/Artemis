import { describe, expect, it } from "vitest";

import {
  orderProjectsByPreference,
  reorderProjectIds,
} from "../src/renderer/project-order.js";

const projects = [
  { id: "alpha", name: "Alpha" },
  { id: "beta", name: "Beta" },
  { id: "gamma", name: "Gamma" },
];

describe("project sidebar order", () => {
  it("keeps the default order until a persisted preference exists", () => {
    expect(orderProjectsByPreference(projects, undefined)).toEqual(projects);
    expect(
      orderProjectsByPreference(projects, ["gamma", "alpha"]).map(
        (project) => project.id,
      ),
    ).toEqual(["gamma", "alpha", "beta"]);
  });

  it("moves projects before or after the indicated drop edge", () => {
    expect(
      reorderProjectIds(["alpha", "beta", "gamma"], "gamma", "alpha", "before"),
    ).toEqual(["gamma", "alpha", "beta"]);
    expect(
      reorderProjectIds(["alpha", "beta", "gamma"], "alpha", "beta", "after"),
    ).toEqual(["beta", "alpha", "gamma"]);
  });

  it("ignores invalid and no-op drag targets", () => {
    expect(
      reorderProjectIds(
        ["alpha", "beta", "gamma"],
        "missing",
        "beta",
        "before",
      ),
    ).toEqual(["alpha", "beta", "gamma"]);
    expect(
      reorderProjectIds(["alpha", "beta", "gamma"], "beta", "beta", "after"),
    ).toEqual(["alpha", "beta", "gamma"]);
  });
});
