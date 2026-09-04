import { describe, expect, it } from "vitest";

import {
  MANAGEMENT_COMPONENT_CONTRACTS,
  validateManagementComponentContracts,
} from "@artemis/ui/management";
import { galleryContract } from "../src/gallery-contract.js";

describe("UI Gallery public package contract", () => {
  it("consumes the public UI and Artemis theme exports", () => {
    expect(galleryContract).toEqual(
      expect.objectContaining({
        uiContractVersion: 1,
        themeVersion: "1.4.59",
        skinId: "com.artemis.default",
        stressSkinId: "com.artemis.synthetic-stress",
      }),
    );
    expect(galleryContract.modes).toEqual(["light", "dark"]);
    expect(galleryContract.contrastModes).toEqual(["normal", "high"]);
  });

  it("consumes the frozen public management contract", () => {
    expect(Object.isFrozen(MANAGEMENT_COMPONENT_CONTRACTS)).toBe(true);
    expect(
      validateManagementComponentContracts(MANAGEMENT_COMPONENT_CONTRACTS),
    ).toEqual({ valid: true, errors: [] });
  });
});
