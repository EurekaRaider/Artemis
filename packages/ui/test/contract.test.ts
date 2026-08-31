import { describe, expect, it } from "vitest";

import {
  ARTEMIS_UI_ROOT_ATTRIBUTE_NAMES,
  UI_CONTRACT_VERSION,
} from "../src/index.js";

describe("@artemis/ui CL0A boundary", () => {
  it("exports only the versioned root attribute contract", () => {
    expect(UI_CONTRACT_VERSION).toBe(1);
    expect(ARTEMIS_UI_ROOT_ATTRIBUTE_NAMES).toEqual([
      "data-artemis-skin",
      "data-artemis-theme",
      "data-artemis-contrast",
    ]);
  });
});
